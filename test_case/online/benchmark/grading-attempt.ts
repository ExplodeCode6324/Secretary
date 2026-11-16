import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  assertLease,
  deploymentGuard,
  inside,
  lease,
  type LeaseContext,
  repository,
  requireThat,
  sha,
} from "./io.ts";
import { readGradeSubmissionBytes, judgeMatchesPolicy } from "./grading.ts";
import { validateGradeBatch } from "./grading-batch.ts";
import {
  loadGradeBatch,
  loadMigrationBundle,
  assertGradingStopped,
} from "./grading-migration-store.ts";
import {
  migrationDirectory,
  migrationPolicy,
  publicMigrationRequest,
  normalizeMigrationResponse,
  assertNoReservedGradeMetadata,
} from "./grading-migration.ts";
import {
  assertGradeStore,
  commitGradeFiles,
  gradeJSONBytes,
  readOwnedGradeJSON,
  readOwnedGradeFile,
  requireExistingGradeFacility,
  gradeUUID,
  type GradeOutput,
} from "./grading-transaction.ts";

export const migrationWrapper =
  "Grade the attached frozen batch using only its evidence and rubric. No tools, code, web, repository or other-chat reference. Return the exact JSON schema for all 63 controls and every sample. Do not reveal or infer any private expected-answer key.";
const errorName = (e: unknown) =>
  e instanceof Error ? e.message : "GRADE_IMPORT_REJECTED";
const jsonOutput = (name: string, value: unknown): GradeOutput => ({
  name,
  content: gradeJSONBytes(value),
});
const attemptPrefix = (batch: any) =>
  path.posix.dirname(batch.migration.manifest_file) +
  `/attempts/${batch.batch_id}`;

/** Actual exports/dispatch require recorded exact-HEAD review and CI. This is an
 * operator attestation, not a claim that local strings verify GitHub or Claude. */
export type MigrationExecutionState = {
  head: string;
  tracked_tree_clean: boolean;
};
export function readMigrationExecutionState(): MigrationExecutionState {
  return {
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim(),
    tracked_tree_clean: !execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      { cwd: repository, encoding: "utf8" },
    ).trim(),
  };
}
export function assertReviewedMigrationHead(
  proof: any,
  observed = readMigrationExecutionState(),
) {
  requireThat(
    proof?.version === "secretary-migration-execution-approval-v1" &&
      proof.head === observed.head &&
      proof.review_status === "PASS" &&
      proof.ci_status === "PASS" &&
      typeof proof.review_sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(proof.review_sha256) &&
      typeof proof.ci_url === "string" &&
      proof.ci_url.startsWith(
        "https://github.com/ExplodeCode6324/Secretary/actions/runs/",
      ),
    "MIGRATION_REVIEWED_HEAD_REQUIRED",
  );
  requireThat(
    observed.tracked_tree_clean,
    "MIGRATION_TRACKED_WORKTREE_CHANGED",
  );
  return observed.head;
}

/** No nested facility locks: all six exports are checked one facility at a time,
 * then the same immutable snapshot is published locally and rechecked per send. */
export async function prepareMigrationReady(
  roots: string[],
  proof: any,
  trustedAnchor?: any,
  inspectExecution = readMigrationExecutionState,
) {
  const head = assertReviewedMigrationHead(proof, inspectExecution());
  requireThat(
    roots.length === 3 && new Set(roots).size === 3,
    "MIGRATION_READY_ROOTS_INVALID",
  );
  const rows: any[] = [];
  let manifest: any;
  for (const root of roots) {
    deploymentGuard(repository, root);
    requireExistingGradeFacility(root);
    await lease(root, async (context) => {
      assertGradingStopped(root);
      assertGradeStore(root);
      const nonce = requireExistingGradeFacility(root).nonce;
      for (const name of fs.readdirSync(path.join(root, "oracles"))) {
        if (!/^grade-batch-[a-f0-9-]{36}\.json$/.test(name)) continue;
        const value = readOwnedGradeJSON(root, "oracles/" + name);
        if (!value.migration) continue;
        const { batch } = loadGradeBatch(root, value.batch_id, trustedAnchor);
        const b = loadMigrationBundle(
          root,
          batch.migration.manifest_file,
          trustedAnchor,
        );
        if (manifest)
          requireThat(
            JSON.stringify(manifest) === JSON.stringify(b.manifest),
            "MIGRATION_READY_COHORT_MISMATCH",
          );
        manifest = b.manifest;
        const e = manifest.entries.find(
          (e: any) => e.child_batch_id === batch.batch_id,
        );
        const request_file = `${migrationDirectory(manifest)}/requests/judge-migration-request-${batch.batch_id}.txt`;
        const bytes = readOwnedGradeFile(root, request_file);
        requireThat(
          bytes.equals(Buffer.from(publicMigrationRequest(batch))),
          "MIGRATION_REQUEST_CHANGED",
        );
        rows.push({
          ordinal: e.ordinal,
          facility_nonce: nonce,
          child_batch_id: batch.batch_id,
          child_payload_sha256: batch.payload_sha256,
          request_file,
          request_sha256: sha(bytes),
        });
      }
      assertLease(context, root);
    });
  }
  rows.sort((a, b) => a.ordinal - b.ordinal);
  requireThat(
    manifest &&
      rows.length === 6 &&
      rows.every(
        (r, i) =>
          r.ordinal === i + 10 &&
          r.child_batch_id === manifest.entries[i].child_batch_id,
      ),
    "MIGRATION_ALL_SIX_REQUIRED",
  );
  const ready = {
    version: "secretary-judge-migration-ready-v1",
    head,
    manifest_sha256: sha(gradeJSONBytes(manifest)),
    history_inventory_sha256: manifest.history_inventory_sha256,
    rows,
    proof,
  };
  for (const root of roots)
    await lease(root, async (context) => {
      assertGradingStopped(root);
      for (const r of rows.filter(
        (r) => r.facility_nonce === requireExistingGradeFacility(root).nonce,
      ))
        loadGradeBatch(root, r.child_batch_id, trustedAnchor);
      const name = migrationDirectory(manifest) + "/ready.json";
      if (fs.existsSync(path.join(root, name)))
        requireThat(
          readOwnedGradeFile(root, name).equals(gradeJSONBytes(ready)),
          "MIGRATION_READY_CHANGED",
        );
      else
        commitGradeFiles(root, context, "MIGRATION_READY", [
          jsonOutput(name, ready),
        ]);
    });
  for (const root of roots)
    await lease(root, async (context) => {
      assertGradingStopped(root);
      assertGradeStore(root);
      assertLease(context, root);
      requireThat(
        readOwnedGradeFile(
          root,
          migrationDirectory(manifest) + "/ready.json",
        ).equals(gradeJSONBytes(ready)),
        "MIGRATION_READY_CHANGED",
      );
    });
  return ready;
}
function verifyReady(root: string, batch: any, trustedAnchor?: any) {
  const { manifest } = loadMigrationBundle(
    root,
    batch.migration.manifest_file,
    trustedAnchor,
  );
  requireThat(
    fs.existsSync(path.join(root, migrationDirectory(manifest), "ready.json")),
    "MIGRATION_READY_MISSING",
  );
  const ready = readOwnedGradeJSON(
    root,
    migrationDirectory(manifest) + "/ready.json",
  );
  requireThat(
    ready.version === "secretary-judge-migration-ready-v1" &&
      ready.manifest_sha256 === sha(gradeJSONBytes(manifest)) &&
      ready.history_inventory_sha256 === manifest.history_inventory_sha256 &&
      ready.rows?.length === 6 &&
      ready.rows.every(
        (r: any, i: number) =>
          r.ordinal === i + 10 &&
          r.child_batch_id === manifest.entries[i].child_batch_id &&
          r.facility_nonce === manifest.entries[i].facility_nonce &&
          r.child_payload_sha256 === manifest.entries[i].child_payload_sha256,
      ),
    "MIGRATION_READY_CHANGED",
  );
  const row = ready.rows.find((r: any) => r.child_batch_id === batch.batch_id);
  requireThat(
    row?.request_file ===
      `${migrationDirectory(manifest)}/requests/judge-migration-request-${batch.batch_id}.txt`,
    "MIGRATION_READY_REQUEST_INVALID",
  );
  const request = readOwnedGradeFile(root, row.request_file);
  requireThat(
    request.equals(Buffer.from(publicMigrationRequest(batch))) &&
      sha(request) === row.request_sha256,
    "MIGRATION_REQUEST_CHANGED",
  );
  return { ready, row };
}
/** Quarantining an interrupted reservation never refunds its ordinal. */
function reservedRecords(root: string, batch: any) {
  const prefix = attemptPrefix(batch),
    records = new Map<string, { ordinal: number; quarantined: boolean }>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      requireThat(!item.isSymbolicLink(), "GRADE_SYMLINK_FORBIDDEN");
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.name === "prepare.json") {
        const relative = path.relative(root, file),
          p = readOwnedGradeJSON(root, relative);
        for (const f of p.files ?? []) {
          const suffix = f.name.startsWith(prefix + "/")
            ? f.name.slice(prefix.length + 1)
            : "";
          if (
            !suffix.endsWith("/reservation.json") ||
            !gradeUUID(suffix.split("/")[0])
          )
            continue;
          const id = suffix.split("/")[0],
            meta = p.parent_child;
          requireThat(
            p.operation === "MIGRATION_ATTEMPT_RESERVATION" &&
              meta?.attempt_id === id &&
              meta.child_batch_id === batch.batch_id &&
              Number.isInteger(meta.ordinal) &&
              meta.ordinal >= 1 &&
              meta.ordinal <= 3,
            "GRADE_RESERVATION_JOURNAL_INVALID",
          );
          const q =
            /^oracles\/\.grading-quarantine\/([a-f0-9-]{36})\/transaction\/prepare\.json$/.exec(
              relative,
            );
          if (q) {
            const receipt = readOwnedGradeJSON(
              root,
              `oracles/.grading-quarantine/${q[1]}/reconciliation.json`,
            );
            requireThat(
              receipt.transaction_id === p.transaction_id &&
                JSON.stringify(receipt.original) === JSON.stringify(p) &&
                receipt.action === "QUARANTINE_ONLY_NO_MODEL_RETRY",
              "GRADE_RESERVATION_RECONCILIATION_INVALID",
            );
          }
          requireThat(!records.has(id), "GRADE_RESERVATION_DUPLICATE");
          records.set(id, { ordinal: meta.ordinal, quarantined: !!q });
        }
      }
    }
  };
  walk(path.join(root, "oracles/.grading-transactions"));
  walk(path.join(root, "oracles/.grading-quarantine"));
  return records;
}
export function migrationAttemptCoverage(root: string, batch: any) {
  const prefix = attemptPrefix(batch),
    reserved = reservedRecords(root, batch);
  if (!reserved.size)
    return { status: "NOT_SENT", reservations: 0, consumed_not_sent: 0 };
  let consumed = 0;
  const records = [...reserved]
    .map(([id, meta]) => {
      const name = `${prefix}/${id}/reservation.json`,
        out = `${prefix}/${id}/outcome.json`;
      const reservation = fs.existsSync(path.join(root, name))
        ? readOwnedGradeJSON(root, name)
        : null;
      if (!reservation && meta.quarantined) {
        requireThat(
          !fs.existsSync(path.join(root, prefix, id, "send-intent.json")) &&
            !fs.existsSync(path.join(root, prefix, id, "original.txt")),
          "GRADE_RECONCILED_RESERVATION_WAS_SENT",
        );
        consumed++;
        return { ordinal: meta.ordinal, status: "RECONCILED_NOT_SENT" };
      }
      requireThat(
        !reservation || reservation.ordinal === meta.ordinal,
        "GRADE_ATTEMPT_ORDINAL_INVALID",
      );
      return {
        ordinal: meta.ordinal,
        status:
          reservation && fs.existsSync(path.join(root, out))
            ? readOwnedGradeJSON(root, out).status
            : "ATTEMPT_OUTCOME_UNCERTAIN",
      };
    })
    .sort((a, b) => a.ordinal - b.ordinal);
  requireThat(
    records.every((r, i) => r.ordinal === i + 1),
    "GRADE_ATTEMPT_ORDINAL_INVALID",
  );
  if (records.some((r) => r.status === "ATTEMPT_OUTCOME_UNCERTAIN"))
    return {
      status: "ATTEMPT_OUTCOME_UNCERTAIN",
      reservations: reserved.size,
      consumed_not_sent: consumed,
    };
  const last = records.at(-1)!.status,
    retry = ["RETRY_ELIGIBLE", "RECONCILED_NOT_SENT"].includes(last);
  return {
    status: retry
      ? reserved.size >= 3
        ? "ATTEMPTS_EXHAUSTED_PAUSED"
        : "RETRY_ELIGIBLE"
      : last,
    reservations: reserved.size,
    consumed_not_sent: consumed,
  };
}
function evidenceOutputs(root: string, prefix: string, evidence: any) {
  requireThat(
    evidence && Array.isArray(evidence.files) && evidence.files.length > 0,
    "GRADE_UI_EVIDENCE_REQUIRED",
  );
  const outputs: GradeOutput[] = [],
    references: any[] = [];
  for (let i = 0; i < evidence.files.length; i++) {
    const source = path.resolve(evidence.files[i]);
    const base = inside(path.join(root, "oracles"), source)
      ? root
      : path.join(repository, ".local/reviews");
    requireThat(inside(base, source), "GRADE_EVIDENCE_OUTSIDE_APPROVED_SOURCE");
    const b = readOwnedGradeFile(base, path.relative(base, source));
    requireThat(
      b.length > 0 && b.length <= 16_000_000,
      "GRADE_EVIDENCE_SIZE_INVALID",
    );
    const name = `${prefix}/evidence-${i}${path.extname(evidence.files[i])}`;
    requireThat(
      /\.(json|txt|png|jpg|jpeg)$/i.test(name),
      "GRADE_EVIDENCE_TYPE_INVALID",
    );
    outputs.push({ name, content: b });
    references.push({ file: name, sha256: sha(b), bytes: b.length });
  }
  return { outputs, references };
}
export function reserveMigrationAttempt(
  root: string,
  context: LeaseContext,
  childID: string,
  ui: any,
  trustedAnchor?: any,
  inspectExecution = readMigrationExecutionState,
) {
  assertLease(context, root);
  assertGradingStopped(root);
  const { batch, policy } = loadGradeBatch(root, childID, trustedAnchor);
  requireThat(policy === migrationPolicy, "GRADE_CHILD_REQUIRED");
  const { ready, row } = verifyReady(root, batch, trustedAnchor);
  assertReviewedMigrationHead(ready.proof, inspectExecution());
  const coverage = migrationAttemptCoverage(root, batch);
  requireThat(
    ["NOT_SENT", "RETRY_ELIGIBLE"].includes(coverage.status) &&
      coverage.reservations < 3,
    "GRADE_ATTEMPT_NOT_PERMITTED",
  );
  requireThat(
    ui.model === "Opus 5.5" &&
      ui.effort === "Extra" &&
      ui.mode === "Manual" &&
      ui.incognito === true &&
      typeof ui.session_url === "string" &&
      /^https:\/\/claude\.ai\/(?:chat\/[a-zA-Z0-9-]+|new)(?:\?incognito)?$/.test(
        ui.session_url,
      ),
    "GRADE_UI_SELECTION_REQUIRED",
  );
  const id = randomUUID(),
    prefix = `${attemptPrefix(batch)}/${id}`,
    evidence = evidenceOutputs(root, prefix, ui);
  const reservation = {
    version: "secretary-judge-migration-attempt-v1",
    attempt_id: id,
    child_batch_id: childID,
    ordinal: coverage.reservations + 1,
    request_file: row.request_file,
    request_sha256: row.request_sha256,
    wrapper_sha256: sha(migrationWrapper),
    ui_evidence: {
      session_url: ui.session_url,
      model: ui.model,
      effort: ui.effort,
      mode: ui.mode,
      incognito: ui.incognito,
      files: evidence.references,
    },
    prepared_at: new Date().toISOString(),
  };
  commitGradeFiles(
    root,
    context,
    "MIGRATION_ATTEMPT_RESERVATION",
    [
      ...evidence.outputs,
      jsonOutput(prefix + "/reservation.json", reservation),
    ],
    { attempt_id: id, child_batch_id: childID, ordinal: reservation.ordinal },
  );
  return reservation;
}
function loadAttempt(root: string, attemptID: string, trustedAnchor?: any) {
  requireThat(gradeUUID(attemptID), "GRADE_ATTEMPT_ID_INVALID");
  assertGradeStore(root);
  const matches: any[] = [];
  for (const name of fs.readdirSync(path.join(root, "oracles"))) {
    if (!/^grade-batch-[a-f0-9-]{36}\.json$/.test(name)) continue;
    const value = readOwnedGradeJSON(root, "oracles/" + name);
    if (!value.migration) continue;
    const prefix = `${attemptPrefix(value)}/${attemptID}`;
    if (fs.existsSync(path.join(root, prefix, "reservation.json")))
      matches.push({
        prefix,
        ...loadGradeBatch(root, value.batch_id, trustedAnchor),
      });
  }
  requireThat(matches.length === 1, "GRADE_ATTEMPT_MISSING_OR_AMBIGUOUS");
  const selected = matches[0],
    reservation = readOwnedGradeJSON(
      root,
      selected.prefix + "/reservation.json",
    );
  requireThat(
    reservation.attempt_id === attemptID &&
      reservation.child_batch_id === selected.batch.batch_id &&
      reservation.request_sha256 ===
        sha(publicMigrationRequest(selected.batch)) &&
      reservation.wrapper_sha256 === sha(migrationWrapper),
    "GRADE_ATTEMPT_CHANGED",
  );
  return { ...selected, reservation };
}
export function recordMigrationSend(
  root: string,
  context: LeaseContext,
  attemptID: string,
  trustedAnchor?: any,
  inspectExecution = readMigrationExecutionState,
) {
  assertLease(context, root);
  assertGradingStopped(root);
  const { batch, prefix, reservation } = loadAttempt(
    root,
    attemptID,
    trustedAnchor,
  );
  const { ready } = verifyReady(root, batch, trustedAnchor);
  assertReviewedMigrationHead(ready.proof, inspectExecution());
  requireThat(
    !fs.existsSync(path.join(root, prefix, "original.txt")),
    "GRADE_ATTEMPT_ALREADY_RESPONDED",
  );
  const value = {
    version: "secretary-judge-migration-send-intent-v1",
    attempt_id: attemptID,
    child_batch_id: batch.batch_id,
    request_sha256: reservation.request_sha256,
    wrapper_sha256: reservation.wrapper_sha256,
    at: new Date().toISOString(),
  };
  commitGradeFiles(root, context, "MIGRATION_SEND_INTENT", [
    jsonOutput(prefix + "/send-intent.json", value),
  ]);
  return value;
}
/** Preserve response identity across quarantine, not merely at live paths. */
function attemptResponseJournals(root: string, prefix: string) {
  const names = new Set(
    ["original.txt", "terminal.json", "outcome.json"].map(
      (n) => prefix + "/" + n,
    ),
  );
  const files: Array<{ name: string; bytes: number; sha256: string }> = [];
  const unboundQuarantines: number[] = [];
  const scan = (base: string, quarantined: boolean) => {
    const dir = path.join(root, base);
    if (!fs.existsSync(dir)) return;
    for (const id of fs.readdirSync(dir)) {
      requireThat(gradeUUID(id), "GRADE_RESPONSE_JOURNAL_INVALID");
      const name =
        base + "/" + id + (quarantined ? "/transaction" : "") + "/prepare.json";
      let reconciliation: any;
      if (quarantined) {
        reconciliation = readOwnedGradeJSON(
          root,
          base + "/" + id + "/reconciliation.json",
        );
        requireThat(
          reconciliation.quarantine_id === id &&
            reconciliation.action === "QUARANTINE_ONLY_NO_MODEL_RETRY",
          "GRADE_RESPONSE_RECONCILIATION_INVALID",
        );
        if (reconciliation.original === null) {
          const at = Date.parse(reconciliation.at);
          requireThat(
            !fs.existsSync(path.join(root, name)) &&
              Number.isFinite(at) &&
              reconciliation.incomplete_preparation?.transaction_id ===
                reconciliation.transaction_id,
            "GRADE_RESPONSE_RECONCILIATION_INVALID",
          );
          unboundQuarantines.push(at);
          continue;
        }
      }
      const journal = readOwnedGradeJSON(root, name);
      if (quarantined)
        requireThat(
          reconciliation.transaction_id === journal.transaction_id &&
            JSON.stringify(reconciliation.original) === JSON.stringify(journal),
          "GRADE_RESPONSE_RECONCILIATION_INVALID",
        );
      const matched = (journal.files ?? []).filter((f: any) =>
        names.has(f.name),
      );
      if (!matched.length) continue;
      requireThat(
        journal.version === "secretary-grading-commit-v1" &&
          gradeUUID(journal.transaction_id),
        "GRADE_RESPONSE_JOURNAL_INVALID",
      );
      for (const f of matched) {
        requireThat(
          Number.isInteger(f.bytes) &&
            f.bytes >= 0 &&
            /^[a-f0-9]{64}$/.test(f.sha256),
          "GRADE_RESPONSE_JOURNAL_INVALID",
        );
        files.push(f);
      }
    }
  };
  scan("oracles/.grading-transactions", false);
  scan("oracles/.grading-quarantine", true);
  return { files, unboundQuarantines };
}
/** A confirmed transport failure with no model text is not an invented response. */
export function recordMigrationNoResponse(
  root: string,
  context: LeaseContext,
  attemptID: string,
  observation: any,
  trustedAnchor?: any,
) {
  assertLease(context, root);
  assertGradingStopped(root);
  const { batch, prefix, reservation } = loadAttempt(
    root,
    attemptID,
    trustedAnchor,
  );
  requireThat(
    fs.existsSync(path.join(root, prefix, "send-intent.json")),
    "GRADE_SEND_INTENT_MISSING",
  );
  requireThat(
    !["original.txt", "terminal.json", "outcome.json"].some((n) =>
      fs.existsSync(path.join(root, prefix, n)),
    ),
    "GRADE_ATTEMPT_ALREADY_RESPONDED",
  );
  requireThat(
    observation?.confirmed_no_response === true &&
      observation.in_flight === false &&
      observation.failure_kind === "CONFIRMED_TRANSPORT_NO_RESPONSE" &&
      typeof observation.reason === "string" &&
      observation.reason.trim(),
    "GRADE_NO_RESPONSE_UNCONFIRMED",
  );
  const recorded = attemptResponseJournals(root, prefix);
  requireThat(
    recorded.files.length === 0,
    "GRADE_ATTEMPT_RESPONSE_ALREADY_RECORDED",
  );
  const sentAt = Date.parse(
    readOwnedGradeJSON(root, prefix + "/send-intent.json").at,
  );
  requireThat(
    Number.isFinite(sentAt) &&
      !recorded.unboundQuarantines.some((at) => at >= sentAt),
    "GRADE_NO_RESPONSE_UNBOUND_QUARANTINE",
  );
  const evidence = evidenceOutputs(root, prefix + "/no-response", observation);
  const outcome = {
    version: "secretary-judge-migration-outcome-v1",
    attempt_id: attemptID,
    child_batch_id: batch.batch_id,
    source_file_sha256: null,
    status:
      reservation.ordinal >= 3 ? "ATTEMPTS_EXHAUSTED_PAUSED" : "RETRY_ELIGIBLE",
    error: "CONFIRMED_TRANSPORT_NO_RESPONSE",
    evidence: evidence.references,
    reason: observation.reason,
    confirmed_no_response: true,
    in_flight: false,
    at: new Date().toISOString(),
  };
  commitGradeFiles(root, context, "MIGRATION_NO_RESPONSE", [
    ...evidence.outputs,
    jsonOutput(prefix + "/outcome.json", outcome),
  ]);
  return outcome;
}

/** Identity and denominators are checked before any semantic/rubric decision. */
export function validateMigrationIdentity(batch: any, raw: any) {
  requireThat(
    raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      raw.batch_id === batch.batch_id &&
      raw.payload_sha256 === batch.payload_sha256 &&
      judgeMatchesPolicy(raw.judge, migrationPolicy),
    "GRADE_BATCH_IDENTITY_MISMATCH",
  );
  requireThat(
    Array.isArray(raw.submissions) &&
      raw.submissions.length === batch.payload.packets.length &&
      new Set(raw.submissions.map((s: any) => s?.packet_id)).size ===
        batch.payload.packets.length,
    "GRADE_BATCH_DENOMINATOR_MISMATCH",
  );
  for (const p of batch.payload.packets) {
    const s = raw.submissions.find((s: any) => s?.packet_id === p.packet_id);
    requireThat(
      s &&
        s.payload_sha256 === p.payload_sha256 &&
        judgeMatchesPolicy(s.judge, migrationPolicy),
      "GRADE_BATCH_SAMPLE_MISMATCH",
    );
    const ids = p.payload.assertions.map((a: any) => a.assertion_id);
    requireThat(
      Array.isArray(s.verdicts) &&
        s.verdicts.length === ids.length &&
        new Set(s.verdicts.map((v: any) => v?.assertion_id)).size ===
          ids.length &&
        s.verdicts.every((v: any) => ids.includes(v?.assertion_id)),
      "GRADE_DENOMINATOR_MISMATCH",
    );
  }
  const ids = batch.payload.controls.controls.map((c: any) => c.id);
  requireThat(
    Array.isArray(raw.controls?.verdicts) &&
      raw.controls.verdicts.length === 63 &&
      new Set(raw.controls.verdicts.map((v: any) => v?.id)).size === 63 &&
      raw.controls.verdicts.every((v: any) => ids.includes(v?.id)),
    "GRADE_CONTROL_DENOMINATOR_MISMATCH",
  );
}
export function importMigrationResponse(
  root: string,
  context: LeaseContext,
  attemptID: string,
  file: string,
  observation: any,
  trustedAnchor?: any,
) {
  assertLease(context, root);
  assertGradingStopped(root);
  const { batch, privateData, prefix, reservation } = loadAttempt(
    root,
    attemptID,
    trustedAnchor,
  );
  requireThat(
    fs.existsSync(path.join(root, prefix, "send-intent.json")),
    "GRADE_SEND_INTENT_MISSING",
  );
  requireThat(
    !fs.existsSync(path.join(root, prefix, "outcome.json")),
    "GRADE_ATTEMPT_FINALIZED",
  );
  requireThat(
    observation?.copy_matches_display === true &&
      observation.in_flight === false &&
      (observation.completed === true ||
        observation.confirmed_transport_truncation === true),
    "GRADE_EXTRACTION_UNCERTAIN",
  );
  const bytes = readGradeSubmissionBytes(root, file),
    hash = sha(bytes),
    normalized = normalizeMigrationResponse(bytes.toString());
  const originalName = prefix + "/original.txt";
  const recorded = attemptResponseJournals(root, prefix);
  for (const previous of recorded.files.filter((f) => f.name === originalName))
    requireThat(
      previous.bytes === bytes.length && previous.sha256 === hash,
      "GRADE_EXACT_RESPONSE_REIMPORT_REQUIRED",
    );
  if (fs.existsSync(path.join(root, originalName)))
    requireThat(
      readOwnedGradeFile(root, originalName).equals(bytes),
      "GRADE_EXACT_RESPONSE_REIMPORT_REQUIRED",
    );
  else {
    const evidence = evidenceOutputs(root, prefix + "/response", observation);
    commitGradeFiles(root, context, "MIGRATION_RESPONSE_CAPTURE", [
      ...evidence.outputs,
      { name: originalName, content: bytes },
      {
        name: prefix + "/normalized.json",
        content: Buffer.from(normalized.text),
      },
      jsonOutput(prefix + "/extraction.json", {
        attempt_id: attemptID,
        child_batch_id: batch.batch_id,
        source_file_sha256: hash,
        normalized_sha256: sha(normalized.text),
        transformation: normalized.transformation,
        observation: {
          completed: observation.completed === true,
          confirmed_transport_truncation:
            observation.confirmed_transport_truncation === true,
          copy_matches_display: true,
          in_flight: false,
          evidence: evidence.references,
        },
      }),
    ]);
  }
  const outcome = (
    status: string,
    error: string | null,
    extra: GradeOutput[] = [],
  ) => {
    const value = {
      version: "secretary-judge-migration-outcome-v1",
      attempt_id: attemptID,
      child_batch_id: batch.batch_id,
      source_file_sha256: hash,
      status,
      error,
      at: new Date().toISOString(),
    };
    commitGradeFiles(root, context, "MIGRATION_ATTEMPT_OUTCOME", [
      ...extra,
      jsonOutput(prefix + "/outcome.json", value),
    ]);
    return value;
  };
  let raw: any;
  try {
    raw = JSON.parse(normalized.text);
  } catch {
    return outcome(
      reservation.ordinal >= 3 ? "ATTEMPTS_EXHAUSTED_PAUSED" : "RETRY_ELIGIBLE",
      "INVALID_GRADE_SUBMISSION_JSON",
    );
  }
  try {
    validateMigrationIdentity(batch, raw);
  } catch (e) {
    return outcome("TERMINAL_REJECTED_NOT_COUNTED", errorName(e));
  }
  const terminalName = prefix + "/terminal.json";
  if (!fs.existsSync(path.join(root, terminalName)))
    commitGradeFiles(root, context, "MIGRATION_TERMINAL_RESPONSE", [
      jsonOutput(terminalName, {
        version: "secretary-judge-migration-terminal-v1",
        attempt_id: attemptID,
        child_batch_id: batch.batch_id,
        source_file_sha256: hash,
        normalized_sha256: sha(normalized.text),
        status: "MODEL_SUBMISSION_TERMINAL",
      }),
    ]);
  else
    requireThat(
      readOwnedGradeJSON(root, terminalName).source_file_sha256 === hash,
      "GRADE_TERMINAL_RESPONSE_CHANGED",
    );
  let controls: any;
  try {
    assertNoReservedGradeMetadata(raw);
    controls = validateGradeBatch(batch, privateData, raw, migrationPolicy);
  } catch (e) {
    return outcome("TERMINAL_REJECTED_NOT_COUNTED", errorName(e));
  }
  try {
    for (const name of fs.readdirSync(path.join(root, "oracles"))) {
      requireThat(
        !privateData.mapping.some((m: any) =>
          name.startsWith(m.run + "-verdict-"),
        ),
        "GRADE_RUN_ALREADY_GRADED",
      );
      if (/^grade-batch-receipt-[a-f0-9-]{36}\.json$/.test(name)) {
        const r = readOwnedGradeJSON(root, "oracles/" + name);
        requireThat(
          ![batch.batch_id, batch.migration.parent_batch_id].includes(
            r.submission?.batch_id,
          ),
          "GRADE_BATCH_ALREADY_IMPORTED",
        );
      }
    }
  } catch (e) {
    return outcome("TERMINAL_REJECTED_NOT_COUNTED", errorName(e));
  }
  const status =
    controls.status === "PASS"
      ? "ADVISORY_PENDING_HUMAN_REVIEW"
      : "CONTROL_INVALID";
  const qualification =
    status === "CONTROL_INVALID"
      ? "CONTROL_INVALID_EXCLUDED_FROM_COUNTS"
      : status;
  const receiptName = `grade-batch-receipt-${randomUUID()}.json`;
  const receipt = {
    submission: raw,
    batch_payload_sha256: batch.payload_sha256,
    private_data_sha256: batch.private_data_sha256,
    controls,
    received_at: new Date().toISOString(),
    source_sha256: sha(JSON.stringify(raw)),
    source_file_sha256: hash,
    qualification,
    attempt_id: attemptID,
    terminal_file: terminalName,
  };
  const outputs: GradeOutput[] = [
    jsonOutput("oracles/" + receiptName, receipt),
  ];
  for (const submission of raw.submissions) {
    const m = privateData.mapping.find(
      (m: any) => m.packet_id === submission.packet_id,
    );
    outputs.push(
      jsonOutput(`oracles/${m.run}-verdict-${randomUUID()}.json`, {
        ...submission,
        received_at: receipt.received_at,
        qualification,
        source_sha256: sha(JSON.stringify(submission)),
        source_file_sha256: hash,
        calibration: {
          batch_id: batch.batch_id,
          receipt_file: receiptName,
          receipt_sha256: sha(JSON.stringify(receipt)),
        },
      }),
    );
  }
  return outcome(status, null, outputs);
}

export function validateMigrationReceiptBinding(
  root: string,
  stored: any,
  verdictName?: string,
  trustedAnchor?: any,
) {
  const { batch, prefix } = loadAttempt(root, stored.attempt_id, trustedAnchor);
  requireThat(
    stored.submission.batch_id === batch.batch_id &&
      stored.terminal_file === prefix + "/terminal.json",
    "GRADE_RECEIPT_ATTEMPT_MISMATCH",
  );
  const terminal = readOwnedGradeJSON(root, prefix + "/terminal.json"),
    outcome = readOwnedGradeJSON(root, prefix + "/outcome.json");
  requireThat(
    terminal.source_file_sha256 === stored.source_file_sha256 &&
      outcome.source_file_sha256 === stored.source_file_sha256 &&
      ["ADVISORY_PENDING_HUMAN_REVIEW", "CONTROL_INVALID"].includes(
        outcome.status,
      ) &&
      sha(readOwnedGradeFile(root, prefix + "/original.txt")) ===
        stored.source_file_sha256 &&
      sha(
        normalizeMigrationResponse(
          readOwnedGradeFile(root, prefix + "/original.txt").toString(),
        ).text,
      ) === terminal.normalized_sha256,
    "GRADE_RECEIPT_RESPONSE_CHANGED",
  );
  const normalized = normalizeMigrationResponse(
    readOwnedGradeFile(root, prefix + "/original.txt").toString(),
  ).text;
  requireThat(
    JSON.stringify(JSON.parse(normalized)) ===
      JSON.stringify(stored.submission) &&
      outcome.status ===
        (stored.controls.status === "PASS"
          ? "ADVISORY_PENDING_HUMAN_REVIEW"
          : "CONTROL_INVALID"),
    "GRADE_RECEIPT_RESPONSE_CHANGED",
  );
  const commits = assertGradeStore(root),
    outcomeCommit = commits.get(prefix + "/outcome.json");
  const receiptEntry = [...commits].find(
    ([name]) =>
      /^oracles\/grade-batch-receipt-/.test(name) &&
      JSON.stringify(readOwnedGradeJSON(root, name)) === JSON.stringify(stored),
  );
  requireThat(
    receiptEntry &&
      receiptEntry[1] === outcomeCommit &&
      (!verdictName || commits.get("oracles/" + verdictName) === outcomeCommit),
    "GRADE_IMPORT_COMMIT_MISSING",
  );
}
