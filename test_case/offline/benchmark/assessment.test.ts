import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  repository,
  writeJSON,
  sha,
  lease,
} from "../../online/benchmark/io.ts";
import { gradeJSONBytes } from "../../online/benchmark/grading-transaction.ts";
import {
  legacyGradeBatchPayload,
  exportGradeBatch,
} from "../../online/benchmark/grading-batch.ts";
import {
  deriveMigrationPayload,
  publicMigrationRequest,
} from "../../online/benchmark/grading-migration.ts";
import {
  buildAssessment,
  planFreshAssessment,
  exportAssessment,
  reserveAssessment,
  sendAssessment,
  importAssessment,
  assessmentNoResponse,
  readAssessmentResult,
  assessmentCoverage,
  validateAssessmentWorklist,
  worklistVersion,
} from "../../online/benchmark/assessment.ts";
import {
  createAssessmentReplayManifest,
  replayAssessment,
} from "../../online/benchmark/assessment-report.ts";
import { validatePublicGrade } from "../../online/benchmark/public-grading.ts";
const h = (v: any) => sha(gradeJSONBytes(v));
const observed = { head: "a".repeat(40), tracked_tree_clean: true };
const proof = {
  version: "secretary-assessment-execution-proof-v1",
  head: observed.head,
  review_status: "PASS",
  ci_status: "PASS",
  review_sha256: "b".repeat(64),
  ci_url: "https://github.com/ExplodeCode6324/Secretary/actions/runs/1",
};
function fixture() {
  const id = randomUUID(),
    run = randomUUID(),
    nonce = randomUUID(),
    root = path.join(repository, ".local/benchmark", "assessment-unit-" + id);
  writeJSON(path.join(root, "facility.json"), {
    version: 1,
    repository,
    nonce,
  });
  writeJSON(path.join(root, "runs", run + ".json"), {
    id: run,
    state: "STOPPED",
    lineage: run,
    config: { model: "fixture", profile: "DEP", case_id: "M1-fixture" },
  });
  writeJSON(path.join(root, "oracles", run + "-grade-packet.json"), {
    episode: { family: "M1" },
  });
  const payload = {
    version: "secretary-sealed-grading-v3",
    disposition: { protocol_version: "fixture-v1" },
    assertions: [
      {
        assertion_id: "first-answer-fidelity",
        allowed_labels: ["PASS", "FAIL", "UNRESOLVED"],
        host_coverage: "FIXTURE",
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
  };
  writeJSON(path.join(root, "oracles", run + "-sealed-v3.json"), packet);
  const hashFile = (n: string) => sha(fs.readFileSync(path.join(root, n)));
  const worklist = {
    version: worklistVersion,
    cohort_id: randomUUID(),
    new_batches: [{ assessment_id: id, facility_nonce: nonce, runs: [run] }],
    rows: [
      {
        facility_nonce: nonce,
        run,
        packet_id: packet.packet_id,
        packet_file_sha256: hashFile(`oracles/${run}-sealed-v3.json`),
        source_file_sha256: hashFile(`oracles/${run}-grade-packet.json`),
        run_file_sha256: hashFile(`runs/${run}.json`),
        metadata: {
          lineage: run,
          model: "fixture",
          profile: "DEP",
          case_id: "M1-fixture",
          family: "M1",
          cohort: "FIXTURE_ONLY",
          protocol_version: "fixture-v1",
        },
        selection: { kind: "ASSESSMENT", assessment_id: id },
      },
    ],
  };
  const b = fs.readFileSync(path.join(root, "facility.json")),
    history = {
      files: [
        {
          facility_nonce: nonce,
          relative: "facility.json",
          bytes: b.length,
          sha256: sha(b),
        },
      ],
    };
  const anchorRelative = "docs/fix/evidence/assessment-unit.json",
    p = buildAssessment(root, worklist, history, id, anchorRelative);
  const anchor = {
    version: "secretary-opus-assessment-anchor-v1",
    worklist_sha256: h(worklist),
    history_sha256: h(history),
    entries: [
      {
        assessment_id: id,
        record_sha256: h(p.record),
        request_sha256: p.record.request_sha256,
        preparation_sha256: p.preparation_sha256,
      },
    ],
  };
  const review = path.join(
    repository,
    ".local/reviews",
    "assessment-unit-" + id,
  );
  writeJSON(path.join(review, "ui.json"), { fixture: true });
  const ui = {
    model: "Opus 5.5",
    effort: "Extra",
    mode: "Manual",
    incognito: true,
    session_url: "https://claude.ai/new?incognito",
    files: [path.join(review, "ui.json")],
  };
  const observation = {
    copy_matches_display: true,
    completed: true,
    in_flight: false,
    files: ui.files,
  };
  return {
    id,
    run,
    nonce,
    root,
    worklist,
    history,
    anchorRelative,
    p,
    anchor,
    packet,
    review,
    ui,
    observation,
  };
}
function response(f: ReturnType<typeof fixture>): any {
  const judge = { model: "Opus 5.5", effort: "Extra" };
  return {
    batch_id: f.id,
    payload_sha256: f.p.record.batch.payload_sha256,
    judge,
    controls: {
      verdicts: Object.entries(f.p.privateData.expected).map(([id, v]) => ({
        id,
        ...(v as object),
        rationale: "fixture",
      })),
    },
    submissions: f.p.record.batch.payload.packets.map((p: any) => ({
      packet_id: p.packet_id,
      payload_sha256: p.payload_sha256,
      judge,
      verdicts: p.payload.assertions.map((a: any) => ({
        assertion_id: a.assertion_id,
        label: "PASS",
        severity: "OK",
        evidence: ["fixture"],
        rationale: "fixture",
        human_review: false,
        hard_gate_tags: [],
      })),
      notes: [],
    })),
  };
}
async function exported(f: ReturnType<typeof fixture>) {
  return lease(f.root, async (c) =>
    exportAssessment(
      f.root,
      c,
      f.worklist,
      f.history,
      f.id,
      f.anchorRelative,
      f.anchor,
      proof,
      observed,
    ),
  );
}
async function reserved(f: ReturnType<typeof fixture>) {
  return lease(f.root, async (c) => {
    const a = reserveAssessment(
      f.root,
      c,
      f.id,
      f.ui,
      proof,
      f.anchor,
      observed,
    );
    sendAssessment(f.root, c, f.id, a.attempt_id, f.anchor, observed);
    return a;
  });
}
async function submit(f: ReturnType<typeof fixture>, a: any, value: any) {
  const file = path.join(f.review, randomUUID() + ".txt");
  fs.writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value),
    { mode: 0o600 },
  );
  return lease(f.root, async (c) =>
    importAssessment(
      f.root,
      c,
      f.id,
      a.attempt_id,
      file,
      f.observation,
      f.anchor,
    ),
  );
}
test("Opus fresh export never publishes a Fable batch and exactly matches the frozen migration contract", async () => {
  const f = fixture(),
    payload = legacyGradeBatchPayload([f.packet]);
  const plan = planFreshAssessment(
    f.root,
    [f.run],
    "FIXTURE_ONLY",
    f.anchorRelative,
  );
  assert.equal(plan.worklist.rows.length, 1);
  assert.equal(
    buildAssessment(
      f.root,
      plan.worklist,
      plan.history,
      plan.worklist.new_batches[0].assessment_id,
      f.anchorRelative,
    ).record.batch.payload.instructions,
    f.p.record.batch.payload.instructions,
  );

  const derived = deriveMigrationPayload({
    payload,
    payload_sha256: sha(JSON.stringify(payload)),
  });
  assert.equal(
    f.p.request,
    publicMigrationRequest({
      batch_id: f.id,
      payload: derived,
      payload_sha256: sha(JSON.stringify(derived)),
    }),
  );
  await exported(f);
  assert.equal(
    fs
      .readdirSync(path.join(f.root, "oracles"))
      .some((n) => /^grade-batch-/.test(n)),
    false,
  );
  assert.equal(f.p.request.includes('"model": "Fable 5.2"'), false);
  assert.equal(
    JSON.stringify(f.p.record.batch.payload.packets[0].payload),
    JSON.stringify(f.packet.payload),
  );
  const cli = fs.readFileSync(
    path.join(repository, "test_case/online/benchmark/cli.ts"),
    "utf8",
  );
  assert.equal(/\bexportGradeBatch\(/.test(cli), false);
});
test("accepted Opus inputs replay deterministically, preserve raw fences and cannot be imported or reserved twice", async () => {
  const f = fixture();
  await exported(f);
  const a = await reserved(f);
  assert.equal(
    (
      await submit(
        f,
        a,
        "```json\r\n" + JSON.stringify(response(f)) + "\r\n```\n",
      )
    ).status,
    "ACCEPTED",
  );
  assert.equal(
    readAssessmentResult(f.root, f.id, f.anchor).accepted.controls.controls,
    63,
  );
  await assert.rejects(submit(f, a, response(f)), /IMPORT_NOT_PERMITTED/);
  await assert.rejects(reserved(f), /ATTEMPT_NOT_PERMITTED/);
  const locations = [{ facility_nonce: f.nonce, root: f.root }],
    manifest = createAssessmentReplayManifest(f.worklist, locations);
  const first = replayAssessment(manifest, locations, h(manifest), {
    assessment: f.anchor,
  });
  assert.equal(first.status, "COMPLETE_ADVISORY");
  assert.deepEqual(first.coverage_only, {
    original: 1,
    eligible: 1,
    assessed: 1,
    host_only: 0,
    unassessed: 0,
  });
  assert.equal(
    h(first),
    h(
      replayAssessment(manifest, locations, h(manifest), {
        assessment: f.anchor,
      }),
    ),
  );

  const restored = path.join(
    repository,
    ".local/benchmark",
    "assessment-replay-copy-" + randomUUID(),
  );
  fs.cpSync(f.root, restored, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const restoredLocations = [{ facility_nonce: f.nonce, root: restored }];
  assert.equal(
    h(first),
    h(
      replayAssessment(manifest, restoredLocations, h(manifest), {
        assessment: f.anchor,
      }),
    ),
  );
  writeJSON(path.join(f.root, "oracles", "unexpected.json"), {});
  assert.throws(
    () =>
      replayAssessment(manifest, locations, h(manifest), {
        assessment: f.anchor,
      }),
    /INPUT_SET_CHANGED/,
  );
});
test("control, identity and schema failures are terminal and stay unassessed without Fable fallback", async () => {
  for (const kind of ["control", "identity", "schema"]) {
    const f = fixture();
    await exported(f);
    const a = await reserved(f),
      r = response(f);
    if (kind === "control") r.controls.verdicts[0].label = "INVALID";
    if (kind === "identity") r.judge.model = "Fable 5.2";
    if (kind === "schema") r.submissions = [];
    const result = await submit(f, a, r);
    assert.equal(
      result.status,
      kind === "control" ? "CALIBRATION_FAILED" : "TERMINAL_REJECTED",
    );
    await assert.rejects(reserved(f), /ATTEMPT_NOT_PERMITTED/);
    const locations = [{ facility_nonce: f.nonce, root: f.root }],
      manifest = createAssessmentReplayManifest(f.worklist, locations),
      report = replayAssessment(manifest, locations, h(manifest), {
        assessment: f.anchor,
      });
    assert.equal(report.status, "INCOMPLETE");
    assert.equal(report.rows[0].verdicts, null);
  }
});
test("only format or confirmed no-response failures retry, three reservations exhaust permanently", async () => {
  const f = fixture();
  await exported(f);
  for (let i = 1; i <= 3; i++) {
    const a = await reserved(f);
    assert.equal(a.ordinal, i);
    const result = await submit(f, a, "{ truncated");
    assert.equal(
      result.status,
      i === 3 ? "ATTEMPTS_EXHAUSTED" : "RETRY_ELIGIBLE",
    );
  }
  await assert.rejects(reserved(f), /ATTEMPT_NOT_PERMITTED/);
  const g = fixture();
  await exported(g);
  const a = await reserved(g);
  await lease(g.root, async (c) =>
    assert.throws(
      () =>
        assessmentNoResponse(
          g.root,
          c,
          g.id,
          a.attempt_id,
          { ...g.ui, in_flight: true },
          g.anchor,
        ),
      /UNCONFIRMED/,
    ),
  );
  await lease(g.root, async (c) =>
    assert.equal(
      assessmentNoResponse(
        g.root,
        c,
        g.id,
        a.attempt_id,
        {
          ...g.ui,
          confirmed_no_response: true,
          in_flight: false,
          failure_kind: "CONFIRMED_TRANSPORT_NO_RESPONSE",
        },
        g.anchor,
      ).status,
      "RETRY_ELIGIBLE",
    ),
  );
  assert.equal((await reserved(g)).ordinal, 2);
});
test("selection duplicates, source drift, changed anchors and unaccepted Fable reassessment are rejected", async () => {
  const f = fixture(),
    dupe = structuredClone(f.worklist);
  dupe.rows.push(dupe.rows[0]);
  assert.throws(() => validateAssessmentWorklist(dupe), /DUPLICATE/);
  const bad = structuredClone(f.anchor);
  bad.entries[0].request_sha256 = "0".repeat(64);
  await lease(f.root, async (c) =>
    assert.throws(
      () =>
        exportAssessment(
          f.root,
          c,
          f.worklist,
          f.history,
          f.id,
          f.anchorRelative,
          bad,
          proof,
          observed,
        ),
      /ANCHOR_CHANGED/,
    ),
  );
  const parent = await lease(f.root, async (c) =>
    exportGradeBatch(f.root, [f.run], c),
  );
  const reassess: any = structuredClone(f.worklist);
  reassess.new_batches[0].parent_batch_id = parent.batch_id;
  assert.throws(
    () => buildAssessment(f.root, reassess, f.history, f.id, f.anchorRelative),
    /ACCEPTED_FABLE_PARENT_REQUIRED/,
  );
  writeJSON(path.join(f.root, "oracles", f.run + "-sealed-v3.json"), {
    ...f.packet,
    extra: true,
  });
  assert.throws(
    () =>
      buildAssessment(f.root, f.worklist, f.history, f.id, f.anchorRelative),
    /SOURCE_CHANGED/,
  );
});
test("public Opus variant binds its exact identity and requires independent public controls", () => {
  const payload = {
      version: "secretary-public-qa-opus-variant-v1",
      judge: { model: "Opus 5.5", effort: "Extra" },
      questions: [{ id: "q", gradable: true }],
    },
    packet = {
      packet_id: "p",
      payload,
      payload_sha256: sha(JSON.stringify(payload)),
    };
  const r = {
    packet_id: "p",
    payload_sha256: packet.payload_sha256,
    judge: payload.judge,
    controls: [{ id: "c", label: "yes", rationale: "fixture" }],
    verdicts: [{ id: "q", label: "yes", rationale: "fixture" }],
  };
  assert.equal(validatePublicGrade(packet, { c: "yes" }, r).status, "PASS");
  assert.throws(
    () =>
      validatePublicGrade(
        packet,
        { c: "yes" },
        { ...r, judge: { model: "Fable 5.2", effort: "Extra" } },
      ),
    /IDENTITY/,
  );
  assert.equal(validatePublicGrade(packet, { c: "no" }, r).status, "FAIL");
});

test("read-only assessment guard recognizes positive PID reuse and rejects ambiguous identity", () => {
  const script = `import importlib.util, json, sys
spec=importlib.util.spec_from_file_location('guard',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
r={'pid':42,'pgid':42,'machine':'host','boot':'boot','start':'Sat Nov 14 17:05:07 2026','token':'owned'}
h={'machine':'host','boot':'boot'}
l={'pgid':42,'start':'Tue Nov 17 01:05:24 2026','command':'unrelated-system-service'}
assert m.classify(r,'RUNNING',h,l)=='RUNNING'
assert m.classify(r,'UNCONFIRMED',h,l)=='STOPPED_REUSED_IDENTITY'
for host,live in [({'machine':'other','boot':'boot'},l),({'machine':'host','boot':'other'},l),(h,{**l,'start':r['start']}),(h,{**l,'start':'invalid'}),(h,{**l,'command':'worker --run owned'}),(h,{**l,'pgid':99}),(h,None)]:
 assert m.classify(r,'UNCONFIRMED',host,live)=='UNCONFIRMED'
assert m.classify({**r,'pgid':99},'UNCONFIRMED',h,l)=='UNCONFIRMED'
print('PASS')`;
  assert.equal(
    execFileSync(
      "python3",
      [
        "-c",
        script,
        path.join(
          repository,
          "test_case/online/benchmark/assessment-process.py",
        ),
      ],
      { encoding: "utf8" },
    ).trim(),
    "PASS",
  );
});

test("assessment proof remains required with an injected anchor, and source changes block sends", async () => {
  const f = fixture();
  await lease(f.root, async (c) =>
    assert.throws(
      () =>
        exportAssessment(
          f.root,
          c,
          f.worklist,
          f.history,
          f.id,
          f.anchorRelative,
          f.anchor,
        ),
      /EXECUTION_PROOF/,
    ),
  );
  await exported(f);
  await lease(f.root, async (c) =>
    assert.throws(
      () =>
        reserveAssessment(f.root, c, f.id, f.ui, proof, f.anchor, {
          ...observed,
          tracked_tree_clean: false,
        }),
      /WORKTREE_CHANGED/,
    ),
  );
  const a = await lease(f.root, async (c) =>
    reserveAssessment(f.root, c, f.id, f.ui, proof, f.anchor, observed),
  );
  await lease(f.root, async (c) =>
    assert.throws(
      () =>
        sendAssessment(f.root, c, f.id, a.attempt_id, f.anchor, {
          ...observed,
          head: "c".repeat(40),
        }),
      /REVIEWED_HEAD/,
    ),
  );
});

test("accepted raw-response or receipt tampering is detected before report use", async () => {
  const f = fixture();
  await exported(f);
  const a = await reserved(f);
  await submit(f, a, response(f));
  const original = path.join(
    f.root,
    "oracles/assessments",
    f.id,
    "attempts",
    a.attempt_id,
    "original.txt",
  );
  fs.appendFileSync(original, "changed");
  assert.throws(
    () => readAssessmentResult(f.root, f.id, f.anchor),
    /COMMITTED_FILE_CHANGED/,
  );
});
