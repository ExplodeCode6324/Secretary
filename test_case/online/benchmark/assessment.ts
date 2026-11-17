import { execFileSync } from "node:child_process";
import { assertCampaignClosed } from "./campaign.ts";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertLease,
  type LeaseContext,
  requireThat,
  sha,
  readJSON,
  repository,
  binary,
  cleanEnvironment,
} from "./io.ts";
import {
  legacyGradeBatchPayload,
  validateGradeBatch,
} from "./grading-batch.ts";
import { graderControls } from "./grader-controls.ts";
import { readGradeSubmissionBytes } from "./grading.ts";
import {
  deriveMigrationPayload,
  publicMigrationRequest,
  migrationPolicy,
  normalizeMigrationResponse,
  assertNoReservedGradeMetadata,
} from "./grading-migration.ts";
import { loadGradeBatch } from "./grading-migration-store.ts";
import {
  assertGradeStore,
  commitGradeFiles,
  gradeJSONBytes,
  gradeUUID,
  readOwnedGradeFile,
  readOwnedGradeJSON,
  requireExistingGradeFacility,
  type GradeOutput,
} from "./grading-transaction.ts";
import {
  assertReviewedMigrationHead,
  readMigrationExecutionState,
  migrationWrapper,
  evidenceOutputs,
  attemptResponseJournals,
} from "./grading-attempt.ts";

/** Historical PID reuse is resolved only by a positive later identity. No signal. */
export function assertAssessmentStopped(root: string) {
  assertCampaignClosed(root);
  for (const name of fs
    .readdirSync(path.join(root, "runs"))
    .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))) {
    const run = readOwnedGradeJSON(root, "runs/" + name);
    requireThat(
      ["STOPPED", "RETIRED", "CLEANED"].includes(run.state),
      "GRADE_BATCH_REQUIRES_STOPPED_RUNS",
    );
    if (!run.process) continue;
    let status = "UNCONFIRMED";
    try {
      status = JSON.parse(
        execFileSync(
          binary("python3"),
          [
            path.join(
              repository,
              "test_case/online/benchmark/assessment-process.py",
            ),
          ],
          {
            input: JSON.stringify(run.process),
            encoding: "utf8",
            env: cleanEnvironment("/tmp"),
            timeout: 5000,
          },
        ),
      ).status;
    } catch {
      /* preserve uncertainty */
    }
    requireThat(
      ["STOPPED", "STOPPED_REUSED_IDENTITY"].includes(status),
      "GRADE_BATCH_REQUIRES_STOPPED_RUNS",
    );
  }
}

export const assessmentVersion = "secretary-opus-assessment-v1";
export const worklistVersion = "secretary-opus-assessment-worklist-v1";
const hash = (v: unknown) => sha(gradeJSONBytes(v));
const output = (name: string, value: unknown): GradeOutput => ({
  name,
  content: gradeJSONBytes(value),
});
export const assessmentDirectory = (id: string) => {
  requireThat(gradeUUID(id), "ASSESSMENT_ID_INVALID");
  return `oracles/assessments/${id}`;
};
export function validateAssessmentWorklist(w: any) {
  requireThat(
    w?.version === worklistVersion &&
      gradeUUID(w.cohort_id) &&
      Array.isArray(w.new_batches) &&
      w.new_batches.length > 0 &&
      Array.isArray(w.rows) &&
      w.rows.length > 0,
    "ASSESSMENT_WORKLIST_INVALID",
  );
  const keys = w.rows.map((r: any) => `${r.facility_nonce}/${r.run}`);
  requireThat(
    new Set(keys).size === keys.length &&
      new Set(w.new_batches.map((b: any) => b.assessment_id)).size ===
        w.new_batches.length,
    "ASSESSMENT_SELECTION_DUPLICATE",
  );
  for (const r of w.rows)
    requireThat(
      gradeUUID(r.facility_nonce) &&
        gradeUUID(r.run) &&
        gradeUUID(r.packet_id) &&
        ["ASSESSMENT", "MIGRATION", "HOST_ONLY"].includes(r.selection?.kind) &&
        typeof r.metadata?.cohort === "string",
      "ASSESSMENT_SELECTION_INVALID",
    );
  const selected: string[] = [];
  for (const b of w.new_batches) {
    requireThat(
      gradeUUID(b.assessment_id) &&
        gradeUUID(b.facility_nonce) &&
        Array.isArray(b.runs) &&
        b.runs.length > 0 &&
        b.runs.every(gradeUUID),
      "ASSESSMENT_BATCH_INVALID",
    );
    const rows = w.rows.filter(
      (r: any) =>
        r.selection.kind === "ASSESSMENT" &&
        r.selection.assessment_id === b.assessment_id,
    );
    requireThat(
      JSON.stringify(rows.map((r: any) => r.run)) === JSON.stringify(b.runs) &&
        rows.every((r: any) => r.facility_nonce === b.facility_nonce),
      "ASSESSMENT_BATCH_SELECTION_MISMATCH",
    );
    selected.push(...rows.map((r: any) => `${r.facility_nonce}/${r.run}`));
  }
  requireThat(
    selected.length ===
      w.rows.filter((r: any) => r.selection.kind === "ASSESSMENT").length &&
      new Set(selected).size === selected.length,
    "ASSESSMENT_SELECTION_MISSING",
  );
  return w;
}
export function verifyAssessmentFiles(root: string, files: any[]) {
  requireThat(
    Array.isArray(files) &&
      new Set(files.map((f) => f.relative)).size === files.length,
    "ASSESSMENT_INVENTORY_INVALID",
  );
  for (const f of files) {
    const bytes = readOwnedGradeFile(root, f.relative);
    requireThat(
      bytes.length === f.bytes && sha(bytes) === f.sha256,
      "ASSESSMENT_SOURCE_CHANGED",
    );
  }
}
function fileBinding(root: string, relative: string) {
  const b = readOwnedGradeFile(root, relative);
  return { relative, bytes: b.length, sha256: sha(b) };
}
/** Pure shared contract step; eligibility and publication belong to the caller. */
export function assessmentContract(parent: any, privateData: any, id: string) {
  const payload = deriveMigrationPayload(parent);
  const batch = {
    batch_id: id,
    payload_sha256: sha(JSON.stringify(payload)),
    private_data_sha256: sha(JSON.stringify(privateData)),
    payload,
  };
  return { batch, request: publicMigrationRequest(batch) };
}
/** No writes: the public contract is exactly the already accepted Opus derivation. */
export function buildAssessment(
  root: string,
  worklist: any,
  history: any,
  id: string,
  anchorRelative: string,
  readonlyReplay = false,
) {
  validateAssessmentWorklist(worklist);
  assertGradeStore(root);
  if (!readonlyReplay) assertAssessmentStopped(root);
  requireThat(
    /^docs\/fix\/evidence\/[a-zA-Z0-9_.-]+\.json$/.test(anchorRelative),
    "ASSESSMENT_ANCHOR_PATH_INVALID",
  );
  const nonce = requireExistingGradeFacility(root).nonce;
  const spec = worklist.new_batches.find((b: any) => b.assessment_id === id);
  requireThat(
    spec && spec.facility_nonce === nonce,
    "ASSESSMENT_FACILITY_MISMATCH",
  );
  const historical = history.files.filter(
    (f: any) => f.facility_nonce === nonce,
  );
  requireThat(
    historical.some((f: any) => f.relative === "facility.json"),
    "ASSESSMENT_HISTORY_MISSING",
  );
  verifyAssessmentFiles(root, historical);
  const sources = new Set<string>(["facility.json"]);
  const packets = spec.runs.map((run: string) => {
    const name = `oracles/${run}-sealed-v3.json`;
    sources.add(name);
    sources.add(`oracles/${run}-grade-packet.json`);
    sources.add(`runs/${run}.json`);
    const p = readOwnedGradeJSON(root, name),
      row = worklist.rows.find(
        (r: any) => r.run === run && r.facility_nonce === nonce,
      );
    requireThat(
      row.packet_id === p.packet_id &&
        row.packet_file_sha256 === sha(readOwnedGradeFile(root, name)) &&
        row.source_file_sha256 ===
          sha(readOwnedGradeFile(root, `oracles/${run}-grade-packet.json`)) &&
        row.run_file_sha256 ===
          sha(readOwnedGradeFile(root, `runs/${run}.json`)),
      "ASSESSMENT_SOURCE_CHANGED",
    );
    return p;
  });
  const assessmentRoot = path.join(root, "oracles/assessments");
  if (fs.existsSync(assessmentRoot))
    for (const other of fs.readdirSync(assessmentRoot)) {
      if (other === id) continue;
      const prior = readOwnedGradeJSON(
        root,
        assessmentDirectory(other) + "/private.json",
      );
      requireThat(
        !prior.mapping.some((m: any) => spec.runs.includes(m.run)),
        "ASSESSMENT_RUN_ALREADY_RESERVED",
      );
    }
  if (!spec.parent_batch_id)
    for (const name of fs.readdirSync(path.join(root, "oracles"))) {
      requireThat(
        !spec.runs.some((run: string) => name.startsWith(run + "-verdict-")),
        "ASSESSMENT_FRESH_RUN_ALREADY_GRADED",
      );
    }
  let parent: any, privateData: any;
  if (spec.parent_batch_id) {
    const old = loadGradeBatch(root, spec.parent_batch_id);
    requireThat(
      old.policy === "fable-5.2-extra-v3",
      "ASSESSMENT_PARENT_NOT_FABLE",
    );
    parent = old.batch;
    privateData = old.privateData;
    requireThat(
      JSON.stringify(privateData.mapping) ===
        JSON.stringify(
          spec.runs.map((run: string, i: number) => ({
            run,
            packet_id: packets[i].packet_id,
          })),
        ),
      "ASSESSMENT_PARENT_MAPPING_CHANGED",
    );
    sources.add(`oracles/grade-batch-${spec.parent_batch_id}.json`);
    sources.add(`oracles/grade-batch-${spec.parent_batch_id}-private.json`);
    let accepted = 0;
    for (const name of fs
      .readdirSync(path.join(root, "oracles"))
      .filter((n) => /^grade-batch-receipt-[a-f0-9-]{36}\.json$/.test(n))) {
      const receipt = readOwnedGradeJSON(root, "oracles/" + name);
      if (receipt.submission?.batch_id !== spec.parent_batch_id) continue;
      sources.add("oracles/" + name);
      requireThat(
        receipt.source_sha256 === sha(JSON.stringify(receipt.submission)) &&
          receipt.batch_payload_sha256 === parent.payload_sha256 &&
          receipt.private_data_sha256 === parent.private_data_sha256,
        "ASSESSMENT_PARENT_RECEIPT_CHANGED",
      );
      if (
        validateGradeBatch(parent, privateData, receipt.submission, old.policy)
          .status === "PASS"
      )
        accepted++;
    }
    requireThat(accepted === 1, "ASSESSMENT_ACCEPTED_FABLE_PARENT_REQUIRED");
  } else {
    const payload = legacyGradeBatchPayload(packets);
    parent = { payload, payload_sha256: sha(JSON.stringify(payload)) };
    privateData = {
      expected: graderControls().expected,
      mapping: spec.runs.map((run: string, i: number) => ({
        run,
        packet_id: packets[i].packet_id,
      })),
    };
  }
  const { batch, request } = assessmentContract(parent, privateData, id);
  const prefix = assessmentDirectory(id);
  const record = {
    version: assessmentVersion,
    assessment_id: id,
    facility_nonce: nonce,
    mode: spec.parent_batch_id ? "HISTORICAL_FABLE_REASSESSMENT" : "FRESH_OPUS",
    anchor_relative: anchorRelative,
    worklist_sha256: hash(worklist),
    history_sha256: hash(history),
    source_files: [...sources].sort().map((n) => fileBinding(root, n)),
    batch,
    request_sha256: sha(request),
    wrapper_sha256: sha(migrationWrapper),
  };
  const outputs = [
    output(prefix + "/record.json", record),
    output(prefix + "/private.json", privateData),
    output(prefix + "/worklist.json", worklist),
    output(prefix + "/history.json", history),
    { name: prefix + "/request.txt", content: Buffer.from(request) },
  ];
  const h = sha("assessment-export-v1|" + id).slice(0, 32),
    tx = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  const preparation = {
    version: "secretary-grading-commit-v1",
    transaction_id: tx,
    operation: "OPUS_ASSESSMENT_EXPORT",
    files: outputs.map((f) => ({
      name: f.name,
      bytes: f.content.length,
      sha256: sha(f.content),
    })),
    parent_child: null,
  };
  return {
    record,
    privateData,
    request,
    outputs,
    transaction_id: tx,
    preparation_sha256: hash(preparation),
  };
}
function assessmentAnchor(record: any, supplied?: any) {
  const anchor =
    supplied ?? readJSON(path.join(repository, record.anchor_relative));
  requireThat(
    anchor.version === "secretary-opus-assessment-anchor-v1" &&
      anchor.worklist_sha256 === record.worklist_sha256 &&
      anchor.history_sha256 === record.history_sha256,
    "ASSESSMENT_ANCHOR_CHANGED",
  );
  const rows = anchor.entries.filter(
    (e: any) => e.assessment_id === record.assessment_id,
  );
  requireThat(
    rows.length === 1 &&
      rows[0].record_sha256 === hash(record) &&
      rows[0].request_sha256 === record.request_sha256,
    "ASSESSMENT_ANCHOR_CHANGED",
  );
  return rows[0];
}
export function exportAssessment(
  root: string,
  context: LeaseContext,
  worklist: any,
  history: any,
  id: string,
  anchorRelative: string,
  suppliedAnchor?: any,
  proof?: any,
  observed = readMigrationExecutionState(),
) {
  assertLease(context, root);
  proofCheck(proof, observed);
  const p = buildAssessment(root, worklist, history, id, anchorRelative);
  const entry = assessmentAnchor(p.record, suppliedAnchor);
  requireThat(
    entry.preparation_sha256 === p.preparation_sha256,
    "ASSESSMENT_PREPARATION_CHANGED",
  );
  commitGradeFiles(
    root,
    context,
    "OPUS_ASSESSMENT_EXPORT",
    p.outputs,
    null,
    p.transaction_id,
    p.preparation_sha256,
  );
  return {
    assessment_id: id,
    request: path.join(root, assessmentDirectory(id), "request.txt"),
    request_sha256: p.record.request_sha256,
  };
}
export function loadAssessment(root: string, id: string, suppliedAnchor?: any) {
  const commits = assertGradeStore(root),
    prefix = assessmentDirectory(id);
  const record = readOwnedGradeJSON(root, prefix + "/record.json"),
    worklist = readOwnedGradeJSON(root, prefix + "/worklist.json"),
    history = readOwnedGradeJSON(root, prefix + "/history.json");
  requireThat(
    record.version === assessmentVersion && record.assessment_id === id,
    "ASSESSMENT_RECORD_INVALID",
  );
  const p = buildAssessment(
      root,
      worklist,
      history,
      id,
      record.anchor_relative,
      true,
    ),
    entry = assessmentAnchor(record, suppliedAnchor);
  requireThat(
    JSON.stringify(record) === JSON.stringify(p.record) &&
      entry.preparation_sha256 === p.preparation_sha256,
    "ASSESSMENT_DERIVATION_CHANGED",
  );
  for (const f of p.outputs)
    requireThat(
      commits.get(f.name)?.transaction_id === p.transaction_id &&
        readOwnedGradeFile(root, f.name).equals(f.content),
      "ASSESSMENT_EXPORT_COMMIT_MISSING",
    );
  return { ...p, prefix };
}
function proofCheck(proof: any, observed = readMigrationExecutionState()) {
  requireThat(
    proof?.version === "secretary-assessment-execution-proof-v1",
    "ASSESSMENT_EXECUTION_PROOF_REQUIRED",
  );
  return assertReviewedMigrationHead(
    { ...proof, version: "secretary-migration-execution-approval-v1" },
    observed,
  );
}
function records(root: string, prefix: string) {
  const dir = path.join(root, prefix, "attempts");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .map((id) => {
      requireThat(gradeUUID(id), "ASSESSMENT_ATTEMPT_INVALID");
      const base = prefix + "/attempts/" + id,
        reservation = readOwnedGradeJSON(root, base + "/reservation.json");
      const outcome = fs.existsSync(path.join(root, base, "outcome.json"))
        ? readOwnedGradeJSON(root, base + "/outcome.json")
        : null;
      return { id, base, reservation, outcome };
    })
    .sort((a, b) => a.reservation.ordinal - b.reservation.ordinal);
}
/** Quarantined attempts remain consumed. An uncertain interrupted attempt pauses. */
function quarantinedAssessment(root: string, prefix: string) {
  const base = path.join(root, "oracles/.grading-quarantine");
  if (!fs.existsSync(base)) return false;
  return fs.readdirSync(base).some((id) => {
    const r = readOwnedGradeJSON(
      root,
      `oracles/.grading-quarantine/${id}/reconciliation.json`,
    );
    return (
      r.original === null ||
      r.original?.files?.some((f: any) => f.name.startsWith(prefix + "/"))
    );
  });
}
export function assessmentCoverage(
  root: string,
  id: string,
  suppliedAnchor?: any,
) {
  const { prefix } = loadAssessment(root, id, suppliedAnchor);
  if (quarantinedAssessment(root, prefix))
    return { status: "INTERRUPTED_PAUSED", reservations: null };
  const all = records(root, prefix);
  requireThat(
    all.length <= 3 &&
      all.every(
        (r, i) =>
          r.reservation.ordinal === i + 1 && r.reservation.assessment_id === id,
      ),
    "ASSESSMENT_ATTEMPT_SEQUENCE_INVALID",
  );
  const last = all.at(-1);
  return {
    status:
      last?.outcome?.status ?? (last ? "IN_FLIGHT_OR_UNCERTAIN" : "NOT_SENT"),
    reservations: all.length,
  };
}
export function reserveAssessment(
  root: string,
  context: LeaseContext,
  id: string,
  ui: any,
  proof: any,
  suppliedAnchor?: any,
  observed = readMigrationExecutionState(),
) {
  assertLease(context, root);
  assertAssessmentStopped(root);
  const p = loadAssessment(root, id, suppliedAnchor);
  proofCheck(proof, observed);
  const state = assessmentCoverage(root, id, suppliedAnchor);
  requireThat(
    ["NOT_SENT", "RETRY_ELIGIBLE"].includes(state.status) &&
      state.reservations !== null &&
      state.reservations < 3,
    "ASSESSMENT_ATTEMPT_NOT_PERMITTED",
  );
  requireThat(
    ui?.model === "Opus 5.5" &&
      ui.effort === "Extra" &&
      ui.mode === "Manual" &&
      ui.incognito === true &&
      /^https:\/\/claude\.ai\/(?:chat\/[a-zA-Z0-9-]+|new)(?:\?incognito)?$/.test(
        ui.session_url,
      ),
    "GRADE_UI_SELECTION_REQUIRED",
  );
  const attempt = randomUUID(),
    base = p.prefix + "/attempts/" + attempt,
    evidence = evidenceOutputs(root, base + "/ui", ui);
  const reservation = {
    version: "secretary-assessment-attempt-v1",
    attempt_id: attempt,
    assessment_id: id,
    ordinal: state.reservations + 1,
    request_sha256: p.record.request_sha256,
    wrapper_sha256: sha(migrationWrapper),
    proof,
    ui: { ...ui, files: evidence.references },
    at: new Date().toISOString(),
  };
  commitGradeFiles(root, context, "ASSESSMENT_RESERVATION", [
    ...evidence.outputs,
    output(base + "/reservation.json", reservation),
  ]);
  return reservation;
}
function loadAttempt(root: string, id: string, attempt: string, anchor?: any) {
  const p = loadAssessment(root, id, anchor);
  requireThat(gradeUUID(attempt), "ASSESSMENT_ATTEMPT_INVALID");
  requireThat(
    !quarantinedAssessment(root, p.prefix),
    "ASSESSMENT_INTERRUPTED_PAUSED",
  );
  const row = records(root, p.prefix).find((r) => r.id === attempt);
  requireThat(row, "ASSESSMENT_ATTEMPT_MISSING");
  requireThat(
    row.reservation.assessment_id === id &&
      row.reservation.attempt_id === attempt &&
      row.reservation.request_sha256 === p.record.request_sha256 &&
      row.reservation.wrapper_sha256 === sha(migrationWrapper),
    "ASSESSMENT_ATTEMPT_CHANGED",
  );
  return { ...p, ...row };
}
export function sendAssessment(
  root: string,
  context: LeaseContext,
  id: string,
  attempt: string,
  anchor?: any,
  observed = readMigrationExecutionState(),
) {
  assertLease(context, root);
  assertAssessmentStopped(root);
  const p = loadAttempt(root, id, attempt, anchor);
  proofCheck(p.reservation.proof, observed);
  requireThat(!p.outcome, "ASSESSMENT_ATTEMPT_FINALIZED");
  const sent = {
    assessment_id: id,
    attempt_id: attempt,
    request_sha256: p.record.request_sha256,
    at: new Date().toISOString(),
  };
  commitGradeFiles(root, context, "ASSESSMENT_SEND", [
    output(p.base + "/send.json", sent),
  ]);
  return sent;
}
export function assessmentNoResponse(
  root: string,
  context: LeaseContext,
  id: string,
  attempt: string,
  observation: any,
  anchor?: any,
) {
  assertLease(context, root);
  assertAssessmentStopped(root);
  const p = loadAttempt(root, id, attempt, anchor);
  requireThat(
    !p.outcome &&
      fs.existsSync(path.join(root, p.base, "send.json")) &&
      !fs.existsSync(path.join(root, p.base, "original.txt")) &&
      observation?.confirmed_no_response === true &&
      observation.in_flight === false &&
      observation.failure_kind === "CONFIRMED_TRANSPORT_NO_RESPONSE",
    "ASSESSMENT_NO_RESPONSE_UNCONFIRMED",
  );
  requireThat(
    attemptResponseJournals(root, p.base).files.length === 0,
    "ASSESSMENT_RESPONSE_ALREADY_CAPTURED",
  );
  const e = evidenceOutputs(root, p.base + "/no-response", observation);
  const result = {
    status: p.reservation.ordinal < 3 ? "RETRY_ELIGIBLE" : "ATTEMPTS_EXHAUSTED",
    error: "CONFIRMED_TRANSPORT_NO_RESPONSE",
    attempt_id: attempt,
    assessment_id: id,
    at: new Date().toISOString(),
  };
  commitGradeFiles(root, context, "ASSESSMENT_NO_RESPONSE", [
    ...e.outputs,
    output(p.base + "/outcome.json", result),
  ]);
  return result;
}
export function importAssessment(
  root: string,
  context: LeaseContext,
  id: string,
  attempt: string,
  file: string,
  observation: any,
  anchor?: any,
) {
  assertLease(context, root);
  assertAssessmentStopped(root);
  const p = loadAttempt(root, id, attempt, anchor);
  requireThat(
    !p.outcome && fs.existsSync(path.join(root, p.base, "send.json")),
    "ASSESSMENT_IMPORT_NOT_PERMITTED",
  );
  requireThat(
    observation?.copy_matches_display === true &&
      observation.in_flight === false &&
      (observation.completed === true ||
        observation.confirmed_transport_truncation === true),
    "GRADE_EXTRACTION_UNCERTAIN",
  );
  const bytes = readGradeSubmissionBytes(root, file),
    normalized = normalizeMigrationResponse(bytes.toString()),
    originalName = p.base + "/original.txt";
  for (const prior of attemptResponseJournals(root, p.base).files.filter(
    (f) => f.name === originalName,
  ))
    requireThat(
      prior.sha256 === sha(bytes) && prior.bytes === bytes.length,
      "GRADE_EXACT_RESPONSE_REIMPORT_REQUIRED",
    );
  if (fs.existsSync(path.join(root, originalName)))
    requireThat(
      readOwnedGradeFile(root, originalName).equals(bytes),
      "GRADE_EXACT_RESPONSE_REIMPORT_REQUIRED",
    );
  else {
    const evidence = evidenceOutputs(root, p.base + "/response", observation);
    commitGradeFiles(root, context, "ASSESSMENT_RESPONSE_CAPTURE", [
      ...evidence.outputs,
      { name: originalName, content: bytes },
      {
        name: p.base + "/normalized.json",
        content: Buffer.from(normalized.text),
      },
      output(p.base + "/extraction.json", {
        source_sha256: sha(bytes),
        normalized_sha256: sha(normalized.text),
        transformation: normalized.transformation,
        observation: { ...observation, files: evidence.references },
      }),
    ]);
  }
  let raw: any,
    controls: any,
    error: string | null = null,
    status = "ACCEPTED";
  try {
    raw = JSON.parse(normalized.text);
  } catch {
    status =
      p.reservation.ordinal < 3 ? "RETRY_ELIGIBLE" : "ATTEMPTS_EXHAUSTED";
    error = "INVALID_GRADE_SUBMISSION_JSON";
  }
  if (raw !== undefined) {
    try {
      assertNoReservedGradeMetadata(raw);
      controls = validateGradeBatch(
        p.record.batch,
        p.privateData,
        raw,
        migrationPolicy,
      );
      if (controls.status !== "PASS") {
        status = "CALIBRATION_FAILED";
        error = "GRADE_CONTROLS_FAILED";
      }
    } catch (e) {
      status = "TERMINAL_REJECTED";
      error = e instanceof Error ? e.message : "GRADE_SCHEMA_REJECTED";
    }
  }
  const outcome = {
    version: "secretary-assessment-outcome-v1",
    assessment_id: id,
    attempt_id: attempt,
    status,
    error,
    source_file_sha256: sha(bytes),
    normalized_sha256: sha(normalized.text),
    at: new Date().toISOString(),
  };
  const outputs = [output(p.base + "/outcome.json", outcome)];
  if (status === "ACCEPTED")
    outputs.push(
      output(p.prefix + "/accepted.json", {
        assessment_id: id,
        attempt_id: attempt,
        submission: raw,
        controls,
        source_file_sha256: sha(bytes),
        normalized_sha256: sha(normalized.text),
        qualification: "ADVISORY_NOT_HUMAN_QUALIFIED",
      }),
    );
  commitGradeFiles(root, context, "ASSESSMENT_OUTCOME", outputs);
  return outcome;
}
export function readAssessmentResult(root: string, id: string, anchor?: any) {
  const p = loadAssessment(root, id, anchor),
    state = assessmentCoverage(root, id, anchor);
  if (state.status !== "ACCEPTED")
    return {
      ...state,
      record: p.record,
      privateData: p.privateData,
      accepted: null,
    };
  const accepted = readOwnedGradeJSON(root, p.prefix + "/accepted.json"),
    a = loadAttempt(root, id, accepted.attempt_id, anchor);
  const original = readOwnedGradeFile(root, a.base + "/original.txt"),
    normalized = normalizeMigrationResponse(original.toString()).text;
  requireThat(
    accepted.assessment_id === id &&
      accepted.source_file_sha256 === sha(original) &&
      accepted.normalized_sha256 === sha(normalized) &&
      JSON.stringify(JSON.parse(normalized)) ===
        JSON.stringify(accepted.submission) &&
      a.outcome?.status === "ACCEPTED" &&
      a.outcome.source_file_sha256 === sha(original),
    "ASSESSMENT_RECEIPT_CHANGED",
  );
  const commits = assertGradeStore(root);
  requireThat(
    !!commits.get(p.prefix + "/accepted.json")?.transaction_id &&
      commits.get(p.prefix + "/accepted.json")?.transaction_id ===
        commits.get(a.base + "/outcome.json")?.transaction_id,
    "ASSESSMENT_IMPORT_COMMIT_MISSING",
  );
  const controls = validateGradeBatch(
    p.record.batch,
    p.privateData,
    accepted.submission,
    migrationPolicy,
  );
  requireThat(
    controls.status === "PASS" &&
      JSON.stringify(controls) === JSON.stringify(accepted.controls),
    "ASSESSMENT_CALIBRATION_CHANGED",
  );
  return { ...state, record: p.record, privateData: p.privateData, accepted };
}

/** Build a fresh single-batch worklist without persisting a legacy batch. */
export function planFreshAssessment(
  root: string,
  runs: string[],
  cohort: string,
  anchorRelative: string,
) {
  assertAssessmentStopped(root);
  requireThat(
    Array.isArray(runs) &&
      runs.length > 0 &&
      runs.every(gradeUUID) &&
      new Set(runs).size === runs.length &&
      typeof cohort === "string" &&
      /^[A-Z][A-Z0-9_]{0,79}$/.test(cohort),
    "ASSESSMENT_FRESH_PLAN_INVALID",
  );
  const nonce = requireExistingGradeFacility(root).nonce,
    id = randomUUID();
  const rows = runs.map((run) => {
    const packet = readOwnedGradeJSON(root, `oracles/${run}-sealed-v3.json`),
      source = readOwnedGradeJSON(root, `oracles/${run}-grade-packet.json`),
      record = readOwnedGradeJSON(root, `runs/${run}.json`);
    requireThat(
      packet.payload.assertions.some((a: any) =>
        a.allowed_labels?.some((l: string) => l !== "UNRESOLVED"),
      ),
      "ASSESSMENT_HOST_ONLY_NOT_SENDABLE",
    );
    return {
      facility_nonce: nonce,
      run,
      packet_id: packet.packet_id,
      packet_file_sha256: sha(
        readOwnedGradeFile(root, `oracles/${run}-sealed-v3.json`),
      ),
      source_file_sha256: sha(
        readOwnedGradeFile(root, `oracles/${run}-grade-packet.json`),
      ),
      run_file_sha256: sha(readOwnedGradeFile(root, `runs/${run}.json`)),
      metadata: {
        lineage: record.lineage,
        model: record.config.model,
        profile: record.config.profile,
        case_id: record.config.case_id,
        family: source.episode.family,
        cohort,
        protocol_version: packet.payload.disposition.protocol_version,
      },
      selection: { kind: "ASSESSMENT", assessment_id: id },
    };
  });
  const worklist = {
    version: worklistVersion,
    cohort_id: randomUUID(),
    new_batches: [{ assessment_id: id, facility_nonce: nonce, runs }],
    rows,
  };
  const names = new Set<string>([
    "facility.json",
    ...runs.flatMap((run) => [
      `runs/${run}.json`,
      `oracles/${run}-sealed-v3.json`,
      `oracles/${run}-grade-packet.json`,
    ]),
  ]);
  const history = {
    version: "secretary-assessment-history-inventory-v1",
    files: [...names].sort().map((relative) => ({
      facility_nonce: nonce,
      ...fileBinding(root, relative),
    })),
  };
  buildAssessment(root, worklist, history, id, anchorRelative);
  return { worklist, history, anchor_relative: anchorRelative };
}
