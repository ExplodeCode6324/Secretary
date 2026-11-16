import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  exportGradeBatch,
  validateGradeBatch,
} from "../../online/benchmark/grading-batch.ts";
import {
  approvedJudge,
  validateVerdicts,
} from "../../online/benchmark/grading.ts";
import {
  repository,
  writeJSON,
  sha,
  lease,
  assertLease,
} from "../../online/benchmark/io.ts";
import {
  deriveMigrationPayload,
  normalizeMigrationResponse,
  publicMigrationRequest,
  migrationPolicy,
  migrationBatchVersion,
} from "../../online/benchmark/grading-migration.ts";

// Retain these small owned fixtures for the task's verified NAS archive.
async function parentFixture(count = 1, existingRoot?: string) {
  const root =
    existingRoot ??
    path.join(
      repository,
      ".local/benchmark",
      "judge-migration-unit-" + randomUUID(),
    );
  if (!existingRoot)
    writeJSON(path.join(root, "facility.json"), {
      version: 1,
      repository,
      nonce: randomUUID(),
    });
  const runs: string[] = [],
    packets: any[] = [];
  for (let i = 0; i < count; i++) {
    const run = randomUUID();
    runs.push(run);
    writeJSON(path.join(root, "runs", run + ".json"), { state: "STOPPED" });
    const payload = {
      version: "secretary-sealed-grading-v3",
      assertions: [
        {
          assertion_id: "first-answer-fidelity",
          allowed_labels: ["PASS", "FAIL", "UNRESOLVED"],
        },
      ],
    };
    const packet = {
      packet_id: randomUUID(),
      payload_sha256: sha(JSON.stringify(payload)),
      payload,
      expected_judge: {
        provider: "Claude browser",
        model: "Fable 5.2",
        effort: "Extra",
      },
      control_requirement: "fixture",
    };
    writeJSON(path.join(root, "oracles", run + "-grade-packet.json"), {
      episode: { family: "fixture" },
    });
    packets.push(packet);
    writeJSON(path.join(root, "oracles", run + "-sealed-v3.json"), packet);
  }
  fs.mkdirSync(path.join(root, "reports"), { recursive: true, mode: 0o700 });
  const exported = await lease(root, async (context) =>
    exportGradeBatch(root, runs, context),
  );
  return {
    root,
    run: runs[0],
    runs,
    packets,
    packet: packets[0],
    parent: JSON.parse(fs.readFileSync(exported.file, "utf8")),
  };
}
function allFiles(root: string, prefix = ""): string[] {
  return fs
    .readdirSync(path.join(root, prefix), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? allFiles(root, path.join(prefix, e.name))
        : [path.join(prefix, e.name)],
    );
}

test("judge migration preserves V3 evidence and controls while restricting the new identity", async () => {
  const { parent, packet } = await parentFixture();
  const before = JSON.stringify(parent);
  const payload = deriveMigrationPayload(parent);
  assert.equal(payload.version, migrationBatchVersion);
  assert.deepEqual(payload.controls, parent.payload.controls);
  assert.equal(payload.controls.controls.length, 63);
  assert.equal(payload.packets[0].packet_id, packet.packet_id);
  assert.equal(
    JSON.stringify(payload.packets[0].payload),
    JSON.stringify(packet.payload),
  );
  assert.equal(payload.packets[0].payload_sha256, packet.payload_sha256);
  assert.equal(JSON.stringify(parent), before);
  assert.deepEqual(payload.provenance, { judge_policy: migrationPolicy });
  assert.equal(approvedJudge({ model: "Opus 5.5", effort: "Extra" }), false);
  const response = {
    packet_id: packet.packet_id,
    payload_sha256: packet.payload_sha256,
    judge: { model: "Opus 5.5", effort: "Extra" },
    verdicts: [
      {
        assertion_id: "first-answer-fidelity",
        label: "PASS",
        severity: "OK",
        evidence: ["event"],
        rationale: "Supported",
        human_review: false,
        hard_gate_tags: [],
      },
    ],
  };
  validateVerdicts(payload.packets[0], response, migrationPolicy);
  assert.throws(
    () => validateVerdicts(packet, response, "fable-5.2-extra-v3"),
    /IDENTITY/,
  );
  for (const judge of [
    { model: "claude-opus-5-5", effort: "Extra" },
    { model: "Opus 5.5", effort: "extra" },
    { model: "Opus 5.5", effort: "High" },
  ]) {
    assert.throws(
      () =>
        validateVerdicts(
          payload.packets[0],
          { ...response, judge },
          migrationPolicy,
        ),
      /IDENTITY/,
    );
  }
  const changedPayload = {
    ...parent.payload,
    instructions: parent.payload.instructions + " changed",
  };
  assert.throws(
    () => deriveMigrationPayload({ ...parent, payload: changedPayload }),
    /PARENT_INVALID/,
  );
  assert.throws(
    () =>
      deriveMigrationPayload({
        ...parent,
        payload: changedPayload,
        payload_sha256: sha(JSON.stringify(changedPayload)),
      }),
    /INSTRUCTION/,
  );
  const child = {
    batch_id: randomUUID(),
    payload_sha256: sha(JSON.stringify(payload)),
    private_data_sha256: "not public",
    payload,
    migration: { manifest_sha256: "not public" },
  };
  const upload = publicMigrationRequest(child);
  assert.equal(
    upload,
    JSON.stringify(
      {
        batch_id: child.batch_id,
        payload_sha256: child.payload_sha256,
        payload,
      },
      null,
      2,
    ) + "\n",
  );
  assert.equal(upload.includes("not public"), false);
});

test("response extraction handles outer LF/CRLF fences without scanning quoted interior backticks", () => {
  const json = JSON.stringify({
    rationale: "SUT quoted ``` inside its answer",
  });
  for (const nl of ["\n", "\r\n"]) {
    assert.equal(
      normalizeMigrationResponse("  ```json" + nl + json + nl + "```  ").text,
      json,
    );
    assert.equal(
      normalizeMigrationResponse("```" + nl + json + nl + "```").text,
      json,
    );
  }
  for (const opener of ["```JSON", "```json "]) {
    const raw = opener + "\n" + json + "\n```";
    assert.equal(normalizeMigrationResponse(raw).text, raw);
  }
  const prose = "Here is JSON:\n```json\n" + json + "\n```";
  assert.equal(normalizeMigrationResponse(prose).text, prose);
  assert.equal(normalizeMigrationResponse("  " + json + "\n").text, json);
});

test("controller capability cannot be forged or used after its holder dies", async () => {
  const root = path.join(
    repository,
    ".local/benchmark",
    "judge-migration-lease-" + randomUUID(),
  );
  assert.throws(
    () =>
      assertLease(
        {
          root,
          lockName: "controller.lock",
          holderPid: process.pid,
          assertActive() {},
        },
        root,
      ),
    /LEASE_REQUIRED/,
  );
  await lease(root, async (context) => {
    assertLease(context, root);
    process.kill(context.holderPid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.throws(() => assertLease(context, root), /LEASE_LOST/);
  });
});

test("grading publication preserves the baseline and rejects unmarked legacy-looking files", async () => {
  const { root } = await parentFixture();
  const { commitGradeFiles, assertGradeStore, gradeJSONBytes } =
    await import("../../online/benchmark/grading-transaction.ts");
  const marker = JSON.parse(
    fs.readFileSync(path.join(root, "facility.json"), "utf8"),
  );
  const names = ["facility.json", ...allFiles(root, "oracles")];
  const inventory = {
    files: names.map((relative) => {
      const b = fs.readFileSync(path.join(root, relative));
      return {
        namespace: "facility",
        facility_nonce: marker.nonce,
        relative,
        bytes: b.length,
        sha256: sha(b),
      };
    }),
  };
  const cohort = randomUUID(),
    bytes = gradeJSONBytes(inventory);
  await lease(root, async (context) => {
    const result = commitGradeFiles(root, context, "FIXTURE_BASELINE", [
      {
        name: `oracles/migrations/${cohort}/manifest.json`,
        content: gradeJSONBytes({ history_inventory_sha256: sha(bytes) }),
      },
      {
        name: `oracles/migrations/${cohort}/history-inventory.json`,
        content: bytes,
      },
    ]);
    assert.equal(assertGradeStore(root).size, 4);
    assert.throws(
      () =>
        commitGradeFiles(root, context, "OVERWRITE", [
          {
            name:
              "oracles/" +
              fs
                .readdirSync(path.join(root, "oracles"))
                .find((n) => n.endsWith("-sealed-v3.json")),
            content: Buffer.from("bad"),
          },
        ]),
      /NO_OVERWRITE/,
    );
    const rogue = `oracles/grade-batch-receipt-${randomUUID()}.json`;
    writeJSON(path.join(root, rogue), { unmarked: true });
    assert.throws(() => assertGradeStore(root), /UNMARKED_NEW_FILE/);
    assert.ok(fs.existsSync(result.marker));
    for (const f of inventory.files)
      assert.equal(sha(fs.readFileSync(path.join(root, f.relative))), f.sha256);
  });
});

test("an interrupted transaction is never counted and exact-hash reconciliation only quarantines it", async () => {
  const { root } = await parentFixture();
  const { assertGradeStore, reconcileGradeTransaction, gradeJSONBytes } =
    await import("../../online/benchmark/grading-transaction.ts");
  const id = randomUUID(),
    name = `oracles/grade-batch-receipt-${randomUUID()}.json`,
    content = gradeJSONBytes({ partial: true });
  const preparation = {
    version: "secretary-grading-commit-v1",
    transaction_id: id,
    operation: "FIXTURE_PARTIAL",
    files: [{ name, bytes: content.length, sha256: sha(content) }],
    parent_child: null,
  };
  writeJSON(
    path.join(root, `oracles/.grading-transactions/${id}/prepare.json`),
    preparation,
  );
  fs.writeFileSync(path.join(root, name), content, { mode: 0o600, flag: "wx" });
  assert.throws(() => assertGradeStore(root), /UNCOMMITTED/);
  await lease(root, async (context) => {
    assert.throws(
      () => reconcileGradeTransaction(root, context, id, "wrong"),
      /UNREVIEWED/,
    );
    const result = reconcileGradeTransaction(
      root,
      context,
      id,
      sha(gradeJSONBytes(preparation)),
    );
    assert.equal(result.status, "QUARANTINED_NOT_RETRIED");
    assert.equal(fs.existsSync(path.join(root, name)), false);
    assert.equal(assertGradeStore(root).size, 2);
    assert.ok(
      fs.existsSync(
        path.join(
          root,
          `oracles/.grading-quarantine/${result.quarantine_id}/published/${name}`,
        ),
      ),
    );
  });
});

import {
  migrationAnchor,
  deriveMigrationBatch,
  migrationDirectory,
  migrationManifestVersion,
  type MigrationBundle,
} from "../../online/benchmark/grading-migration.ts";
import {
  loadGradeBatch,
  exportJudgeMigration,
} from "../../online/benchmark/grading-migration-store.ts";
import {
  gradeJSONBytes,
  assertGradeStore,
  readOwnedGradeJSON,
} from "../../online/benchmark/grading-transaction.ts";
import {
  prepareMigrationReady,
  reserveMigrationAttempt,
  recordMigrationSend,
  recordMigrationNoResponse,
  assertReviewedMigrationHead,
  importMigrationResponse,
  migrationAttemptCoverage,
  validateMigrationReceiptBinding,
  validateMigrationIdentity,
} from "../../online/benchmark/grading-attempt.ts";
import {
  importGradeBatch,
  receiptCalibration,
} from "../../online/benchmark/grading-batch.ts";
import {
  summarizeJudgments,
  scoreDevelopment,
} from "../../online/benchmark/score.ts";

const fixtureProof = {
  version: "secretary-migration-execution-approval-v1",
  head: "fixture",
  review_status: "PASS",
  ci_status: "PASS",
  review_sha256: "a".repeat(64),
  ci_url: "https://github.com/ExplodeCode6324/Secretary/actions/runs/fixture",
};
const fixtureExecution = () => ({ head: "fixture", tracked_tree_clean: true });
async function cohortFixture(extra?: (root: string) => void) {
  const parents: Awaited<ReturnType<typeof parentFixture>>[] = [];
  for (let i = 0; i < 6; i++)
    parents.push(
      await parentFixture(
        [2, 1, 1, 1, 1, 3][i],
        i === 1
          ? parents[0].root
          : i === 3 || i === 4
            ? parents[2].root
            : undefined,
      ),
    );
  const roots = [...new Set(parents.map((p) => p.root))];
  extra?.(roots[0]);
  const review = path.join(
    repository,
    ".local/reviews/benchmark-fixtures",
    "migration-fixture-" + randomUUID(),
  );
  const rows = parents.map((p, i) => ({
    batch_id: p.parent.batch_id,
    runs: p.runs,
    submission_status: "NOT_SENT",
    attempts: [],
    import_attempts: [],
  }));
  const index = {
    batches: [
      ...Array.from({ length: 9 }, () => ({ batch_id: randomUUID() })),
      ...rows,
    ],
  };
  writeJSON(path.join(review, "index.json"), index);
  writeJSON(path.join(review, "submissions-a.json"), []);
  writeJSON(path.join(review, "submissions-b.json"), []);
  fs.writeFileSync(path.join(review, "empty-capture.txt"), "", { mode: 0o600 });
  writeJSON(path.join(review, "ui.json"), {
    fixture: "UI screenshot substitute for protocol tests only",
  });
  const submission_inventory = {
    batches: index.batches.map((r, i) => ({
      batch_id: r.batch_id,
      ordinal: i + 1,
      status: i < 9 ? "ACCEPTED" : "NOT_SENT",
      submitted_attempts: i < 9 ? 1 : 0,
      import_attempts: i < 9 ? 1 : 0,
    })),
    rejections: [],
    files: [
      "index.json",
      "submissions-a.json",
      "submissions-b.json",
      "empty-capture.txt",
    ].map((relative, i) => ({
      namespace: "review-ledger",
      relative,
      kind:
        i === 0 ? "BATCH_INDEX" : i < 3 ? "SUBMISSIONS" : "RETAINED_EVIDENCE",
      bytes: fs.statSync(path.join(review, relative)).size,
      sha256: sha(fs.readFileSync(path.join(review, relative))),
    })),
  };
  const facilities = roots.map((root) => ({
    facility_nonce: readOwnedGradeJSON(root, "facility.json").nonce,
  }));
  const history_inventory = {
    facilities,
    files: roots.flatMap((root) =>
      ["facility.json", ...allFiles(root, "oracles")].map((relative) => ({
        namespace: "facility",
        facility_nonce: readOwnedGradeJSON(root, "facility.json").nonce,
        relative,
        bytes: fs.statSync(path.join(root, relative)).size,
        sha256: sha(fs.readFileSync(path.join(root, relative))),
      })),
    ),
  };
  const entries = parents.map((p, i) => {
    const priv = readOwnedGradeJSON(
      p.root,
      `oracles/grade-batch-${p.parent.batch_id}-private.json`,
    );
    return {
      ordinal: i + 10,
      facility_nonce: readOwnedGradeJSON(p.root, "facility.json").nonce,
      parent_batch_id: p.parent.batch_id,
      child_batch_id: randomUUID(),
      parent_file_sha256: sha(gradeJSONBytes(p.parent)),
      parent_payload_sha256: p.parent.payload_sha256,
      parent_private_file_sha256: sha(gradeJSONBytes(priv)),
      parent_private_data_sha256: p.parent.private_data_sha256,
      child_payload_sha256: sha(
        JSON.stringify(deriveMigrationPayload(p.parent)),
      ),
      runs: p.runs,
      packet_ids: p.packets.map((p) => p.packet_id),
      not_sent_attestation: {
        state: "NOT_SENT" as const,
        submitted_attempts: 0,
        submission_inventory_sha256: sha(gradeJSONBytes(submission_inventory)),
      },
    };
  });
  const manifest = {
    version: migrationManifestVersion,
    cohort_id: randomUUID(),
    entries,
    history_inventory_sha256: sha(gradeJSONBytes(history_inventory)),
    submission_inventory_sha256: sha(gradeJSONBytes(submission_inventory)),
    authorization_reference: "synthetic fixture only",
  };
  const bundle: MigrationBundle = {
      manifest,
      history_inventory,
      submission_inventory,
      review_ledger_directory: review,
    },
    anchor = migrationAnchor(manifest);
  return { parents, roots, review, bundle, anchor };
}
async function exportedCohort() {
  const f = await cohortFixture();
  for (let i = 0; i < 6; i++)
    await lease(f.parents[i].root, async (context) =>
      exportJudgeMigration(
        f.parents[i].root,
        context,
        f.bundle,
        f.bundle.manifest.entries[i].child_batch_id,
        f.anchor,
      ),
    );
  await prepareMigrationReady(
    f.roots,
    fixtureProof,
    f.anchor,
    fixtureExecution,
  );
  return f;
}
function responseFor(root: string, child: string, anchor: any) {
  const { batch, privateData } = loadGradeBatch(root, child, anchor),
    judge = { model: "Opus 5.5", effort: "Extra" };
  return {
    batch_id: child,
    payload_sha256: batch.payload_sha256,
    judge,
    controls: {
      verdicts: Object.entries(privateData.expected).map(([id, v]) => ({
        id,
        ...(v as object),
        rationale: "Synthetic control evidence",
      })),
    },
    submissions: batch.payload.packets.map((p: any) => ({
      packet_id: p.packet_id,
      payload_sha256: p.payload_sha256,
      judge,
      verdicts: p.payload.assertions.map((a: any) => ({
        assertion_id: a.assertion_id,
        label: "PASS",
        severity: "OK",
        evidence: ["fixture"],
        rationale: "Synthetic evidence",
        human_review: false,
        hard_gate_tags: [],
      })),
      notes: [],
    })),
  };
}
async function reserved(
  f: Awaited<ReturnType<typeof exportedCohort>>,
  i: number,
) {
  const root = f.parents[i].root,
    child = f.bundle.manifest.entries[i].child_batch_id;
  return lease(root, async (context) => {
    const attempt = reserveMigrationAttempt(
      root,
      context,
      child,
      {
        model: "Opus 5.5",
        effort: "Extra",
        mode: "Manual",
        incognito: true,
        session_url:
          i === 0
            ? "https://claude.ai/new?incognito"
            : "https://claude.ai/chat/fixture",
        files: [path.join(f.review, "ui.json")],
      },
      f.anchor,
      fixtureExecution,
    );
    recordMigrationSend(
      root,
      context,
      attempt.attempt_id,
      f.anchor,
      fixtureExecution,
    );
    return attempt;
  });
}
async function submit(
  f: Awaited<ReturnType<typeof exportedCohort>>,
  i: number,
  attempt: any,
  response: any,
) {
  const file = path.join(f.review, randomUUID() + ".txt");
  fs.writeFileSync(
    file,
    typeof response === "string" ? response : JSON.stringify(response),
    { mode: 0o600 },
  );
  return lease(f.parents[i].root, async (context) =>
    importMigrationResponse(
      f.parents[i].root,
      context,
      attempt.attempt_id,
      file,
      {
        copy_matches_display: true,
        completed: true,
        in_flight: false,
        files: [path.join(f.review, "ui.json")],
      },
      f.anchor,
    ),
  );
}

test("six-child export verifies deterministic bytes, all-six readiness, ancestry and restored local chains", async () => {
  const f = await cohortFixture();
  const e = f.bundle.manifest.entries[0],
    root = f.parents[0].root;
  const source = JSON.stringify(f.bundle);
  const altered = structuredClone(f.bundle);
  altered.submission_inventory.rejections.push({ attributed: false });
  await lease(root, async (c) =>
    assert.throws(
      () => exportJudgeMigration(root, c, altered, e.child_batch_id, f.anchor),
      /INVENTORY/,
    ),
  );
  for (let i = 0; i < 6; i++) {
    await lease(f.parents[i].root, async (c) =>
      exportJudgeMigration(
        f.parents[i].root,
        c,
        f.bundle,
        f.bundle.manifest.entries[i].child_batch_id,
        f.anchor,
      ),
    );
    if (i === 0) {
      await assert.rejects(
        prepareMigrationReady(
          f.roots,
          fixtureProof,
          f.anchor,
          fixtureExecution,
        ),
        /ALL_SIX/,
      );
      await lease(root, async (c) =>
        assert.throws(
          () =>
            reserveMigrationAttempt(root, c, e.child_batch_id, {}, f.anchor),
          /MIGRATION_READY_MISSING/,
        ),
      );
    }
  }
  assert.equal(JSON.stringify(f.bundle), source);
  await prepareMigrationReady(
    f.roots,
    fixtureProof,
    f.anchor,
    fixtureExecution,
  );
  await lease(root, async (c) =>
    assert.throws(
      () => exportJudgeMigration(root, c, f.bundle, e.child_batch_id, f.anchor),
      /ALREADY_RESERVED/,
    ),
  );
  const loaded = loadGradeBatch(root, e.child_batch_id, f.anchor);
  assert.deepEqual(
    loaded.batch,
    deriveMigrationBatch(
      f.parents[0].parent,
      loaded.privateData,
      e,
      f.bundle.manifest,
    ),
  );
  const old = path.join(f.review, "late-parent.json");
  writeJSON(old, { batch_id: e.parent_batch_id });
  await lease(root, async (c) =>
    assert.throws(
      () => importGradeBatch(root, old, c),
      /GRADE_PARENT_SUPERSEDED/,
    ),
  );
  const rejected = fs
    .readdirSync(path.join(root, "oracles"))
    .filter((n) => n.startsWith("grade-batch-rejection-"));
  assert.equal(rejected.length, 1);
  assert.equal(
    readOwnedGradeJSON(root, "oracles/" + rejected[0]).error,
    "GRADE_PARENT_SUPERSEDED",
  );
  assert.ok(assertGradeStore(root).has("oracles/" + rejected[0]));
  const restore = path.join(
    repository,
    ".local/benchmark",
    "judge-migration-restore-" + randomUUID(),
  );
  fs.cpSync(root, restore, { recursive: true });
  fs.renameSync(f.review, f.review + "-retained");
  assert.equal(
    loadGradeBatch(restore, e.child_batch_id, f.anchor).batch.payload_sha256,
    e.child_payload_sha256,
  );
  const marker = fs.readFileSync(path.join(restore, "facility.json"));
  fs.renameSync(
    path.join(restore, "facility.json"),
    path.join(restore, "facility-retained.json"),
  );
  assert.throws(
    () => loadGradeBatch(restore, e.child_batch_id, f.anchor),
    /ENOENT/,
  );
  fs.writeFileSync(path.join(restore, "facility.json"), marker, {
    mode: 0o600,
  });
  const request = path.join(
    restore,
    migrationDirectory(f.bundle.manifest),
    "requests",
    `judge-migration-request-${e.child_batch_id}.txt`,
  );
  fs.appendFileSync(request, "tamper");
  assert.throws(
    () => loadGradeBatch(restore, e.child_batch_id, f.anchor),
    /COMMITTED_FILE_CHANGED/,
  );
});

test("attempt outcomes prohibit semantic retries, preserve control failures and exhaust three format attempts", async () => {
  const f = await exportedCohort();
  // First child accepts raw echoed provenance only as evidence; policy comes from its chain.
  const a = await reserved(f, 0),
    response = responseFor(f.parents[0].root, a.child_batch_id, f.anchor);
  Object.assign(response.submissions[0], {
    judge_stratum: "malicious",
    judge_policy: "fake",
    grading_envelope_version: "fake",
  });
  const accepted = await submit(f, 0, a, response);
  assert.equal(accepted.status, "ADVISORY_PENDING_HUMAN_REVIEW");
  await assert.rejects(reserved(f, 0), /NOT_PERMITTED/);
  const receiptName = fs
    .readdirSync(path.join(f.parents[0].root, "oracles"))
    .find((n) => n.startsWith("grade-batch-receipt-"))!;
  const stored = readOwnedGradeJSON(
    f.parents[0].root,
    "oracles/" + receiptName,
  );
  const verdictName = fs
    .readdirSync(path.join(f.parents[0].root, "oracles"))
    .find((n) => n.startsWith(f.parents[0].runs[0] + "-verdict-"))!;
  const verdict = readOwnedGradeJSON(
    f.parents[0].root,
    "oracles/" + verdictName,
  );
  validateMigrationReceiptBinding(
    f.parents[0].root,
    stored,
    verdictName,
    f.anchor,
  );
  assert.equal(
    receiptCalibration(
      f.parents[0].root,
      verdict,
      response.submissions[0],
      f.anchor,
    ).status,
    "PASS",
  );
  // Identity mismatch, including a valid-looking parent pair, is bound to this attempt.
  const b = await reserved(f, 1),
    parentEcho = responseFor(f.parents[1].root, b.child_batch_id, f.anchor);
  parentEcho.batch_id = f.parents[1].parent.batch_id;
  parentEcho.payload_sha256 = f.parents[1].parent.payload_sha256;
  assert.equal(
    (await submit(f, 1, b, parentEcho)).status,
    "TERMINAL_REJECTED_NOT_COUNTED",
  );
  await assert.rejects(reserved(f, 1), /NOT_PERMITTED/);
  // Complete identity-valid schema failure is terminal before semantic validation.
  const c = await reserved(f, 2),
    schema = responseFor(f.parents[2].root, c.child_batch_id, f.anchor);
  schema.submissions[0].verdicts[0].hard_gate_tags = ["other"];
  assert.equal(
    (await submit(f, 2, c, schema)).error,
    "GRADE_HARD_GATE_TAGS_REQUIRED",
  );
  assert.equal(
    migrationAttemptCoverage(
      f.parents[2].root,
      loadGradeBatch(f.parents[2].root, c.child_batch_id, f.anchor).batch,
    ).status,
    "TERMINAL_REJECTED_NOT_COUNTED",
  );
  // Structurally complete controls FAIL retains excluded receipt, never a retry.
  const d = await reserved(f, 3),
    badControls = responseFor(f.parents[3].root, d.child_batch_id, f.anchor);
  badControls.controls.verdicts[0].rationale = "";
  assert.equal((await submit(f, 3, d, badControls)).status, "CONTROL_INVALID");
  await assert.rejects(reserved(f, 3), /NOT_PERMITTED/);
  for (let i = 0; i < 3; i++) {
    const x = await reserved(f, 4);
    assert.equal(
      (await submit(f, 4, x, "Here is JSON: {broken")).status,
      i === 2 ? "ATTEMPTS_EXHAUSTED_PAUSED" : "RETRY_ELIGIBLE",
    );
  }
  const fifth = loadGradeBatch(
    f.parents[4].root,
    f.bundle.manifest.entries[4].child_batch_id,
    f.anchor,
  ).batch;
  assert.equal(
    migrationAttemptCoverage(f.parents[4].root, fifth).status,
    "ATTEMPTS_EXHAUSTED_PAUSED",
  );
  await assert.rejects(reserved(f, 4), /NOT_PERMITTED/);
  const last = await reserved(f, 5),
    nested = responseFor(f.parents[5].root, last.child_batch_id, f.anchor);
  Object.assign(nested.submissions[0], { calibration: { status: "PASS" } });
  assert.equal(
    (await submit(f, 5, last, nested)).error,
    "GRADE_SUBMISSION_RESERVED_METADATA",
  );
  for (const p of f.parents) assertGradeStore(p.root);
  const root = f.parents[0].root,
    before = allFiles(root).map((relative) => ({
      relative,
      sha256: sha(fs.readFileSync(path.join(root, relative))),
    }));
  await lease(root, async (context) => {
    const d: any = {
      root,
      assertControllerLease: () => {
        assertLease(context, root);
        return context;
      },
      load: (id: string) => ({
        id,
        state: "CLEANED",
        lineage: id,
        evidence: path.join(root, "missing-evidence"),
        config: {
          mode: "live",
          model: "fixture-sut",
          profile: "p",
          case_id: "c",
        },
      }),
    };
    const scored = scoreDevelopment(d, f.anchor),
      report = JSON.parse(fs.readFileSync(scored.file, "utf8"));
    assert.equal(
      report.version,
      "secretary-memory-descriptive-score-v2-judge-strata",
    );
    assert.ok(
      report.judgment_history.every(
        (r: any) =>
          r.judge_stratum === "Opus 5.5 / Extra" &&
          r.judge_policy === migrationPolicy,
      ),
    );
    assert.ok(
      report.run_coverage.some(
        (r: any) => r.status === "TERMINAL_REJECTED_NOT_COUNTED",
      ),
    );
    const added = allFiles(root).filter(
      (n) => !before.some((f) => f.relative === n),
    );
    assert.deepEqual(added, [path.relative(root, scored.file)]);
  });
  for (const f of before)
    assert.equal(sha(fs.readFileSync(path.join(root, f.relative))), f.sha256);
});

test("judge grouping separates identical SUT cases, canonical provenance and distinct runs", () => {
  const base = {
    run: "run",
    model: "sut",
    profile: "p",
    family: "f",
    case_id: "c",
    protocol_version: "p",
    version: "v3",
    judgment_sha256: "h",
    controls: { status: "PASS" },
    verdicts: [{ label: "PASS", severity: "OK" }],
  };
  const rows = [
    {
      ...base,
      judge_stratum: "Fable 5.2 / Extra",
      judge_policy: "fable-5.2-extra-v3",
      grading_envelope_version: "legacy",
    },
    {
      ...base,
      run: "tail",
      judge_stratum: "Opus 5.5 / Extra",
      judge_policy: migrationPolicy,
      grading_envelope_version: migrationBatchVersion,
    },
  ];
  const groups = summarizeJudgments([...rows, rows[0]]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.distinct_runs_with_judgments === 1));
});

test("lease loss during synchronous publication leaves an uncommitted transaction and blocks readers", async () => {
  const { root } = await parentFixture();
  const { commitGradeFiles } =
    await import("../../online/benchmark/grading-transaction.ts");
  await lease(root, async (context) => {
    const link = fs.linkSync;
    let killed = false;
    fs.linkSync = ((...args: Parameters<typeof fs.linkSync>) => {
      link(...args);
      if (!killed) {
        killed = true;
        process.kill(context.holderPid, "SIGKILL");
        // Deliberately remain in the same JS turn, before child exit callbacks.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }) as typeof fs.linkSync;
    try {
      assert.throws(
        () =>
          commitGradeFiles(root, context, "LOSS_FIXTURE", [
            { name: "oracles/loss-a.json", content: gradeJSONBytes({ a: 1 }) },
            { name: "oracles/loss-b.json", content: gradeJSONBytes({ b: 1 }) },
          ]),
        /LEASE_LOST/,
      );
    } finally {
      fs.linkSync = link;
    }
    assert.equal(fs.existsSync(path.join(root, "oracles/loss-b.json")), false);
    assert.throws(() => assertGradeStore(root), /UNCOMMITTED/);
  });
  await lease(root, async (context) => assertLease(context, root));
});

test("failed import publication reconciles only exact bytes and preserves the original attempt", async () => {
  const f = await exportedCohort(),
    a = await reserved(f, 0),
    root = f.parents[0].root,
    response = responseFor(root, a.child_batch_id, f.anchor);
  const link = fs.linkSync;
  let injected = false;
  fs.linkSync = ((...args: Parameters<typeof fs.linkSync>) => {
    link(...args);
    if (!injected && String(args[1]).includes("grade-batch-receipt-")) {
      injected = true;
      throw Error("FIXTURE_INTERRUPTED_AFTER_LINK");
    }
  }) as typeof fs.linkSync;
  try {
    await assert.rejects(submit(f, 0, a, response), /FIXTURE_INTERRUPTED/);
  } finally {
    fs.linkSync = link;
  }
  assert.throws(() => assertGradeStore(root), /UNCOMMITTED/);
  const pending = fs
    .readdirSync(path.join(root, "oracles/.grading-transactions"))
    .find(
      (id) =>
        !fs.existsSync(path.join(root, `oracles/grading-commit-${id}.json`)),
    )!;
  const { reconcileGradeTransaction } =
    await import("../../online/benchmark/grading-transaction.ts");
  await lease(root, async (c) =>
    reconcileGradeTransaction(
      root,
      c,
      pending,
      sha(
        fs.readFileSync(
          path.join(
            root,
            "oracles/.grading-transactions",
            pending,
            "prepare.json",
          ),
        ),
      ),
    ),
  );
  assert.equal(
    (await submit(f, 0, a, response)).status,
    "ADVISORY_PENDING_HUMAN_REVIEW",
  );
  assert.equal(
    migrationAttemptCoverage(
      root,
      loadGradeBatch(root, a.child_batch_id, f.anchor).batch,
    ).reservations,
    1,
  );
  await assert.rejects(reserved(f, 0), /NOT_PERMITTED/);
  const original = readOwnedGradeJSON(root, "facility.json");
  await lease(root, async (c) => {
    const { commitGradeFiles } =
      await import("../../online/benchmark/grading-transaction.ts");
    assert.throws(
      () =>
        commitGradeFiles(
          root,
          c,
          "WRONG_PREPARE",
          [{ name: "oracles/never.json", content: gradeJSONBytes({ a: 1 }) }],
          null,
          randomUUID(),
          "0".repeat(64),
        ),
      /COPY_MISMATCH/,
    );
  });
  assertGradeStore(root);
  assert.deepEqual(readOwnedGradeJSON(root, "facility.json"), original);
});

test("concurrent export, import and score cannot enter a held controller lease", async () => {
  const { root } = await parentFixture();
  await lease(root, async (context) => {
    for (const operation of ["export", "import", "score"]) {
      let entered = false;
      await assert.rejects(
        lease(root, async () => {
          entered = true;
          return operation;
        }),
        /CONTROLLER_BUSY/,
      );
      assert.equal(entered, false);
      assertLease(context, root);
    }
  });
});

test("first export rejects unlisted files and noncanonical parent bytes before creating a journal", async () => {
  const f = await cohortFixture((root) => {
      // Model the pre-transaction historical store; retain generated fixture journals outside oracles.
      const retained = path.join(root, "pretransaction-fixture-journals");
      fs.mkdirSync(retained);
      for (const n of fs.readdirSync(path.join(root, "oracles")))
        if (n === ".grading-transactions" || n.startsWith("grading-commit-"))
          fs.renameSync(path.join(root, "oracles", n), path.join(retained, n));
      fs.mkdirSync(path.join(root, "oracles/.grading-transactions"));
    }),
    root = f.roots[0],
    e = f.bundle.manifest.entries[0];
  const before = fs.readdirSync(
    path.join(root, "oracles/.grading-transactions"),
  );
  writeJSON(path.join(root, "oracles/stray-response.json"), { stray: true });
  await lease(root, async (c) =>
    assert.throws(
      () => exportJudgeMigration(root, c, f.bundle, e.child_batch_id, f.anchor),
      /GRADE_UNMARKED_NEW_FILE/,
    ),
  );
  assert.deepEqual(
    fs.readdirSync(path.join(root, "oracles/.grading-transactions")),
    before,
  );
  fs.renameSync(
    path.join(root, "oracles/stray-response.json"),
    path.join(root, "stray-retained.json"),
  );
  const relative = `oracles/grade-batch-${e.parent_batch_id}.json`;
  fs.appendFileSync(path.join(root, relative), " ");
  const adjusted = structuredClone(f.bundle),
    record = adjusted.history_inventory.files.find(
      (x: any) =>
        x.facility_nonce === e.facility_nonce && x.relative === relative,
    );
  const bytes = fs.readFileSync(path.join(root, relative));
  record.bytes = bytes.length;
  record.sha256 = sha(bytes);
  adjusted.manifest.history_inventory_sha256 = sha(
    gradeJSONBytes(adjusted.history_inventory),
  );
  await lease(root, async (c) =>
    assert.throws(
      () =>
        exportJudgeMigration(
          root,
          c,
          adjusted,
          e.child_batch_id,
          migrationAnchor(adjusted.manifest),
        ),
      /MIGRATION_PARENT_FILE_CHANGED/,
    ),
  );
  assert.deepEqual(
    fs.readdirSync(path.join(root, "oracles/.grading-transactions")),
    before,
  );
});

test("partially published readiness resumes identically after explicit reconciliation", async () => {
  const f = await cohortFixture();
  for (let i = 0; i < 6; i++)
    await lease(f.parents[i].root, async (c) =>
      exportJudgeMigration(
        f.parents[i].root,
        c,
        f.bundle,
        f.bundle.manifest.entries[i].child_batch_id,
        f.anchor,
      ),
    );
  const link = fs.linkSync,
    readyName = migrationDirectory(f.bundle.manifest) + "/ready.json";
  let failed = false;
  fs.linkSync = ((...args: Parameters<typeof fs.linkSync>) => {
    if (!failed && String(args[1]) === path.join(f.roots[1], readyName)) {
      failed = true;
      throw Error("FIXTURE_READY_SECOND_FAILURE");
    }
    link(...args);
  }) as typeof fs.linkSync;
  try {
    await assert.rejects(
      prepareMigrationReady(f.roots, fixtureProof, f.anchor, fixtureExecution),
      /FIXTURE_READY_SECOND_FAILURE/,
    );
  } finally {
    fs.linkSync = link;
  }
  const first = fs.readFileSync(path.join(f.roots[0], readyName));
  assert.equal(fs.existsSync(path.join(f.roots[2], readyName)), false);
  const root = f.roots[1],
    pending = fs
      .readdirSync(path.join(root, "oracles/.grading-transactions"))
      .find(
        (id) =>
          !fs.existsSync(path.join(root, `oracles/grading-commit-${id}.json`)),
      )!;
  const { reconcileGradeTransaction } =
    await import("../../online/benchmark/grading-transaction.ts");
  await lease(root, async (c) =>
    reconcileGradeTransaction(
      root,
      c,
      pending,
      sha(
        fs.readFileSync(
          path.join(
            root,
            "oracles/.grading-transactions",
            pending,
            "prepare.json",
          ),
        ),
      ),
    ),
  );
  await prepareMigrationReady(
    f.roots,
    fixtureProof,
    f.anchor,
    fixtureExecution,
  );
  for (const root of f.roots)
    assert.ok(fs.readFileSync(path.join(root, readyName)).equals(first));
  await prepareMigrationReady(
    f.roots,
    fixtureProof,
    f.anchor,
    fixtureExecution,
  );
});

test("quarantined reservations consume an ordinal and confirmed no-response outcomes never fabricate text", async () => {
  const f = await exportedCohort(),
    root = f.roots[0],
    child = f.bundle.manifest.entries[0].child_batch_id;
  const link = fs.linkSync;
  let failed = false;
  fs.linkSync = ((...args: Parameters<typeof fs.linkSync>) => {
    link(...args);
    if (!failed && String(args[1]).includes("/attempts/")) {
      failed = true;
      throw Error("FIXTURE_RESERVATION_INTERRUPTED");
    }
  }) as typeof fs.linkSync;
  try {
    await assert.rejects(reserved(f, 0), /FIXTURE_RESERVATION_INTERRUPTED/);
  } finally {
    fs.linkSync = link;
  }
  const pending = fs
    .readdirSync(path.join(root, "oracles/.grading-transactions"))
    .find(
      (id) =>
        !fs.existsSync(path.join(root, `oracles/grading-commit-${id}.json`)),
    )!;
  const { reconcileGradeTransaction } =
    await import("../../online/benchmark/grading-transaction.ts");
  await lease(root, async (c) =>
    reconcileGradeTransaction(
      root,
      c,
      pending,
      sha(
        fs.readFileSync(
          path.join(
            root,
            "oracles/.grading-transactions",
            pending,
            "prepare.json",
          ),
        ),
      ),
    ),
  );
  let coverage = migrationAttemptCoverage(
    root,
    loadGradeBatch(root, child, f.anchor).batch,
  );
  assert.equal(coverage.status, "RETRY_ELIGIBLE");
  assert.equal(coverage.reservations, 1);
  assert.equal(coverage.consumed_not_sent, 1);
  const image = path.join(f.review, "large-evidence.PNG");
  fs.writeFileSync(image, Buffer.alloc(1_100_000, 1), { mode: 0o600 });
  for (const ordinal of [2, 3]) {
    const a = await reserved(f, 0);
    assert.equal(a.ordinal, ordinal);
    await lease(root, async (c) => {
      assert.throws(
        () =>
          recordMigrationNoResponse(
            root,
            c,
            a.attempt_id,
            { confirmed_no_response: false, in_flight: false },
            f.anchor,
          ),
        /GRADE_NO_RESPONSE_UNCONFIRMED/,
      );
      const out = recordMigrationNoResponse(
        root,
        c,
        a.attempt_id,
        {
          confirmed_no_response: true,
          in_flight: false,
          failure_kind: "CONFIRMED_TRANSPORT_NO_RESPONSE",
          reason: "Synthetic transport error before any model text",
          files: [image],
        },
        f.anchor,
      );
      assert.equal(out.source_file_sha256, null);
      assert.equal(
        out.status,
        ordinal === 3 ? "ATTEMPTS_EXHAUSTED_PAUSED" : "RETRY_ELIGIBLE",
      );
      assert.equal(
        fs.existsSync(
          path.join(
            root,
            migrationDirectory(f.bundle.manifest),
            "attempts",
            child,
            a.attempt_id,
            "original.txt",
          ),
        ),
        false,
      );
    });
  }
  await assert.rejects(reserved(f, 0), /GRADE_ATTEMPT_NOT_PERMITTED/);
});

test("journal-less recovery records successful quarantine and reports other pending transactions", async () => {
  const { root } = await parentFixture();
  const { incompleteGradePreparation, reconcileGradeTransaction } =
    await import("../../online/benchmark/grading-transaction.ts");
  const first = randomUUID(),
    second = randomUUID();
  for (const id of [first, second])
    fs.mkdirSync(path.join(root, "oracles/.grading-transactions", id), {
      mode: 0o700,
    });
  fs.writeFileSync(
    path.join(
      root,
      "oracles/.grading-transactions",
      second,
      "prepare.json.tmp-" + randomUUID(),
    ),
    "{partial",
    { mode: 0o600 },
  );
  await lease(root, async (c) => {
    const a = reconcileGradeTransaction(
      root,
      c,
      first,
      incompleteGradePreparation(root, first).sha256,
    );
    assert.equal(a.status, "QUARANTINED_NOT_RETRIED");
    assert.deepEqual(a.remaining_pending_ids, [second]);
    assert.equal(a.store_status, "BLOCKED");
    const b = reconcileGradeTransaction(
      root,
      c,
      second,
      incompleteGradePreparation(root, second).sha256,
    );
    assert.equal(b.store_status, "READABLE");
  });
});

test("review proof validation is independent of anchor injection and protects every ready root", async () => {
  assert.throws(
    () =>
      assertReviewedMigrationHead(
        { ...fixtureProof, head: "wrong" },
        fixtureExecution(),
      ),
    /MIGRATION_REVIEWED_HEAD_REQUIRED/,
  );
  assert.throws(
    () =>
      assertReviewedMigrationHead(fixtureProof, {
        head: "fixture",
        tracked_tree_clean: false,
      }),
    /MIGRATION_TRACKED_WORKTREE_CHANGED/,
  );
  const f = await cohortFixture();
  await assert.rejects(
    prepareMigrationReady(f.roots, fixtureProof, f.anchor),
    /MIGRATION_REVIEWED_HEAD_REQUIRED/,
  );
  await assert.rejects(
    prepareMigrationReady(
      [f.roots[0], repository, f.roots[2]],
      fixtureProof,
      f.anchor,
      fixtureExecution,
    ),
    /OUTSIDE_BENCHMARK_ROOT/,
  );
});

test("a competing verdict detected after terminality commits a terminal rejected outcome", async () => {
  const f = await exportedCohort(),
    a = await reserved(f, 0),
    root = f.roots[0];
  const { commitGradeFiles } =
    await import("../../online/benchmark/grading-transaction.ts");
  await lease(root, async (c) =>
    commitGradeFiles(root, c, "FIXTURE_COMPETING_VERDICT", [
      {
        name: `oracles/${f.parents[0].run}-verdict-${randomUUID()}.json`,
        content: gradeJSONBytes({ competing: true }),
      },
    ]),
  );
  const out = await submit(
    f,
    0,
    a,
    responseFor(root, a.child_batch_id, f.anchor),
  );
  assert.equal(out.status, "TERMINAL_REJECTED_NOT_COUNTED");
  assert.equal(out.error, "GRADE_RUN_ALREADY_GRADED");
  const name = `${migrationDirectory(f.bundle.manifest)}/attempts/${a.child_batch_id}/${a.attempt_id}/outcome.json`;
  assert.ok(assertGradeStore(root).has(name));
});

function installMarklessLegacyChain(root: string) {
  const parentName = fs
    .readdirSync(path.join(root, "oracles"))
    .find((n) => /^grade-batch-[a-f0-9-]{36}\.json$/.test(n))!;
  const batch = readOwnedGradeJSON(root, "oracles/" + parentName),
    privateData = readOwnedGradeJSON(
      root,
      `oracles/grade-batch-${batch.batch_id}-private.json`,
    );
  const run = randomUUID(),
    packet = structuredClone(batch.payload.packets[0]);
  packet.packet_id = randomUUID();
  batch.batch_id = randomUUID();
  batch.payload.packets = [packet];
  privateData.mapping = [{ run, packet_id: packet.packet_id }];
  batch.payload_sha256 = sha(JSON.stringify(batch.payload));
  batch.private_data_sha256 = sha(JSON.stringify(privateData));
  const batchName = `oracles/grade-batch-${batch.batch_id}.json`,
    privateName = `oracles/grade-batch-${batch.batch_id}-private.json`;
  writeJSON(path.join(root, batchName), batch);
  writeJSON(path.join(root, privateName), privateData);
  writeJSON(path.join(root, "runs", run + ".json"), { state: "CLEANED" });
  writeJSON(path.join(root, "oracles", run + "-sealed-v3.json"), packet);
  writeJSON(path.join(root, "oracles", run + "-grade-packet.json"), {
    episode: { family: "legacy-fixture" },
  });
  const raw = responseFor(root, batch.batch_id, undefined),
    judge = { model: "claude-fable-5-2", effort: "extra" };
  raw.judge = judge;
  for (const s of raw.submissions) s.judge = judge;
  const controls = validateGradeBatch(
      batch,
      privateData,
      raw,
      "fable-5.2-extra-v3",
    ),
    receiptName = `grade-batch-receipt-${randomUUID()}.json`;
  const stored = {
    submission: raw,
    batch_payload_sha256: batch.payload_sha256,
    private_data_sha256: batch.private_data_sha256,
    controls,
    received_at: "2026-11-15T00:00:00.000Z",
    source_sha256: sha(JSON.stringify(raw)),
    source_file_sha256: sha(gradeJSONBytes(raw)),
    qualification: "ADVISORY_PENDING_HUMAN_REVIEW",
  };
  writeJSON(path.join(root, "oracles", receiptName), stored);
  const submission = raw.submissions[0],
    receipt = {
      ...submission,
      received_at: stored.received_at,
      qualification: stored.qualification,
      source_sha256: sha(JSON.stringify(submission)),
      source_file_sha256: stored.source_file_sha256,
      calibration: {
        batch_id: batch.batch_id,
        receipt_file: receiptName,
        receipt_sha256: sha(JSON.stringify(stored)),
      },
    };
  const verdictName = `oracles/${run}-verdict-${randomUUID()}.json`;
  writeJSON(path.join(root, verdictName), receipt);
  return {
    run,
    batch,
    privateData,
    batchName,
    privateName,
    stored,
    receipt,
    submission,
    receiptName,
    verdictName,
  };
}

test("unmarked historical receipt chains retain canonical Fable provenance before and after migration", async () => {
  const parent = await parentFixture(),
    root = parent.root,
    h = installMarklessLegacyChain(root);
  const { resolveGradeReceipt } =
    await import("../../online/benchmark/grading-batch.ts");
  assert.equal(assertGradeStore(root).has(h.verdictName), false);
  assert.equal(
    receiptCalibration(root, h.receipt, h.submission).status,
    "PASS",
  );
  assert.equal(
    resolveGradeReceipt(root, h.receipt, h.submission, []).judge_stratum,
    "Fable 5.2 / Extra",
  );
  const originalPrivate = fs.readFileSync(path.join(root, h.privateName)),
    originalBatch = fs.readFileSync(path.join(root, h.batchName));
  h.privateData.extra = "changed";
  h.batch.private_data_sha256 = sha(JSON.stringify(h.privateData));
  writeJSON(path.join(root, h.privateName), h.privateData);
  writeJSON(path.join(root, h.batchName), h.batch);
  assert.throws(
    () => receiptCalibration(root, h.receipt, h.submission),
    /GRADE_BATCH_CALIBRATION_SOURCE_CHANGED/,
  );
  fs.writeFileSync(path.join(root, h.privateName), originalPrivate);
  fs.writeFileSync(path.join(root, h.batchName), originalBatch);
  const originalStored = fs.readFileSync(
    path.join(root, "oracles", h.receiptName),
  );
  h.stored.controls.status = "MISSING";
  writeJSON(path.join(root, "oracles", h.receiptName), h.stored);
  h.receipt.calibration.receipt_sha256 = sha(JSON.stringify(h.stored));
  assert.throws(
    () => receiptCalibration(root, h.receipt, h.submission),
    /GRADE_BATCH_CALIBRATION_STATUS_CHANGED/,
  );
  fs.writeFileSync(path.join(root, "oracles", h.receiptName), originalStored);
  h.receipt.calibration.receipt_sha256 = sha(
    JSON.stringify(JSON.parse(originalStored.toString())),
  );
  fs.chmodSync(path.join(root, h.privateName), 0o644);
  assert.throws(
    () => loadGradeBatch(root, h.batch.batch_id),
    /GRADE_OWNED_FILE_REQUIRED/,
  );
  fs.chmodSync(path.join(root, h.privateName), 0o600);
  const getuid = process.getuid;
  process.getuid = () => getuid!() + 1;
  try {
    assert.throws(
      () => loadGradeBatch(root, h.batch.batch_id),
      /GRADE_OWNED_FILE_REQUIRED/,
    );
  } finally {
    process.getuid = getuid;
  }
  let migrated: ReturnType<typeof installMarklessLegacyChain>;
  const f = await cohortFixture((r) => {
    migrated = installMarklessLegacyChain(r);
  });
  for (let i = 0; i < 6; i++)
    await lease(f.parents[i].root, async (c) =>
      exportJudgeMigration(
        f.parents[i].root,
        c,
        f.bundle,
        f.bundle.manifest.entries[i].child_batch_id,
        f.anchor,
      ),
    );
  const m = migrated!,
    mr = f.roots[0];
  assert.equal(assertGradeStore(mr).has(m.verdictName), false);
  assert.equal(
    receiptCalibration(mr, m.receipt, m.submission, f.anchor).status,
    "PASS",
  );
  await lease(mr, async (context) => {
    const d: any = {
      root: mr,
      assertControllerLease: () => assertLease(context, mr),
      load: (id: string) => ({
        id,
        state: "CLEANED",
        lineage: id,
        evidence: path.join(mr, "missing-evidence"),
        config: {
          mode: "live",
          model: "fixture-sut",
          profile: "p",
          case_id: "c",
        },
      }),
    };
    const report = JSON.parse(
      fs.readFileSync(scoreDevelopment(d, f.anchor).file, "utf8"),
    );
    assert.equal(report.judgment_history.length, 1);
    assert.equal(report.judgment_history[0].judge_stratum, "Fable 5.2 / Extra");
    assert.equal(report.judgment_history[0].judge_policy, "fable-5.2-extra-v3");
  });
});

test("quarantined response capture binds exact bytes and never permits a no-response retry", async () => {
  const f = await exportedCohort();
  const { reconcileGradeTransaction } =
    await import("../../online/benchmark/grading-transaction.ts");
  for (const i of [0, 1]) {
    const a = await reserved(f, i),
      root = f.parents[i].root,
      response = responseFor(root, a.child_batch_id, f.anchor),
      link = fs.linkSync;
    let failed = false;
    fs.linkSync = ((...args: Parameters<typeof fs.linkSync>) => {
      const capture = String(args[1]).includes("/" + a.attempt_id + "/");
      if (!failed && capture && i === 0) {
        failed = true;
        throw Error("FIXTURE_CAPTURE_BEFORE_PROMOTION");
      }
      link(...args);
      if (!failed && capture && String(args[1]).endsWith("/original.txt")) {
        failed = true;
        throw Error("FIXTURE_CAPTURE_AFTER_ORIGINAL");
      }
    }) as typeof fs.linkSync;
    try {
      await assert.rejects(submit(f, i, a, response), /FIXTURE_CAPTURE_/);
    } finally {
      fs.linkSync = link;
    }
    const pending = fs
      .readdirSync(path.join(root, "oracles/.grading-transactions"))
      .find(
        (id) =>
          !fs.existsSync(path.join(root, `oracles/grading-commit-${id}.json`)),
      )!;
    const q = await lease(root, async (c) =>
      reconcileGradeTransaction(
        root,
        c,
        pending,
        sha(
          fs.readFileSync(
            path.join(
              root,
              "oracles/.grading-transactions",
              pending,
              "prepare.json",
            ),
          ),
        ),
      ),
    );
    const changed = structuredClone(response);
    changed.submissions[0].notes.push("different candidate response");
    await assert.rejects(
      submit(f, i, a, changed),
      /GRADE_EXACT_RESPONSE_REIMPORT_REQUIRED/,
    );
    await lease(root, async (c) =>
      assert.throws(
        () =>
          recordMigrationNoResponse(
            root,
            c,
            a.attempt_id,
            {
              confirmed_no_response: true,
              in_flight: false,
              failure_kind: "CONFIRMED_TRANSPORT_NO_RESPONSE",
              reason: "Synthetic no text claim",
              files: [path.join(f.review, "ui.json")],
            },
            f.anchor,
          ),
        /GRADE_ATTEMPT_RESPONSE_ALREADY_RECORDED/,
      ),
    );
    // A local quarantine record cannot be substituted for the preserved journal.
    const qFile = path.join(
        root,
        "oracles/.grading-quarantine",
        q.quarantine_id,
        "reconciliation.json",
      ),
      before = fs.readFileSync(qFile),
      bad = JSON.parse(before.toString());
    bad.original.operation = "changed";
    writeJSON(qFile, bad);
    await assert.rejects(
      submit(f, i, a, response),
      /GRADE_RESPONSE_RECONCILIATION_INVALID/,
    );
    fs.writeFileSync(qFile, before);
    const qJournal = path.join(
        root,
        "oracles/.grading-quarantine",
        q.quarantine_id,
        "transaction/prepare.json",
      ),
      journalBytes = fs.readFileSync(qJournal),
      omitted = JSON.parse(journalBytes.toString());
    omitted.files = [];
    writeJSON(qJournal, omitted);
    await assert.rejects(
      submit(f, i, a, response),
      /GRADE_RESPONSE_RECONCILIATION_INVALID/,
    );
    fs.writeFileSync(qJournal, journalBytes);
    assert.equal(
      (await submit(f, i, a, response)).status,
      "ADVISORY_PENDING_HUMAN_REVIEW",
    );
    assert.equal(
      migrationAttemptCoverage(
        root,
        loadGradeBatch(root, a.child_batch_id, f.anchor).batch,
      ).reservations,
      1,
    );
    await assert.rejects(reserved(f, i), /NOT_PERMITTED/);
  }
});

test("journal-less CLI inspection supports reconciliation and conservatively blocks a later no-response claim", async () => {
  const f = await exportedCohort(),
    root = f.roots[0],
    a = await reserved(f, 0),
    id = randomUUID();
  fs.mkdirSync(path.join(root, "oracles/.grading-transactions", id));
  const { spawnSync } = await import("node:child_process"),
    {
      reconcileGradeTransaction,
      incompleteGradePreparation,
      assertPlannedGradeBaseline,
    } = await import("../../online/benchmark/grading-transaction.ts");
  const p = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(repository, "test_case/online/benchmark/cli.ts"),
      "memory-judge-inspect",
      "--root",
      root,
      "--transaction",
      id,
    ],
    { encoding: "utf8" },
  );
  assert.equal(p.status, 0, p.stderr);
  const inspection = JSON.parse(p.stdout);
  assert.equal(inspection.kind, "INCOMPLETE_PREPARATION");
  assert.equal(inspection.sha256, incompleteGradePreparation(root, id).sha256);
  await lease(root, async (c) =>
    reconcileGradeTransaction(root, c, id, inspection.sha256),
  );
  await lease(root, async (c) =>
    assert.throws(
      () =>
        recordMigrationNoResponse(
          root,
          c,
          a.attempt_id,
          {
            confirmed_no_response: true,
            in_flight: false,
            failure_kind: "CONFIRMED_TRANSPORT_NO_RESPONSE",
            reason: "Synthetic no text claim",
            files: [path.join(f.review, "ui.json")],
          },
          f.anchor,
        ),
      /GRADE_NO_RESPONSE_UNBOUND_QUARANTINE/,
    ),
  );
  const inventory = structuredClone(f.bundle.history_inventory);
  inventory.files.push(
    inventory.files.find(
      (x: any) =>
        x.facility_nonce === f.bundle.manifest.entries[0].facility_nonce,
    )!,
  );
  assert.throws(
    () => assertPlannedGradeBaseline(root, inventory),
    /GRADE_BASELINE_DUPLICATE/,
  );
});
