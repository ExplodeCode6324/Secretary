import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  requireThat,
  sha,
  repository,
  noLinks,
  deploymentGuard,
} from "./io.ts";
import {
  gradeJSONBytes,
  readOwnedGradeFile,
  readOwnedGradeJSON,
  requireExistingGradeFacility,
} from "./grading-transaction.ts";
import { resolveGradeReceipt } from "./grading-batch.ts";
import { validateMigrationReceiptBinding } from "./grading-attempt.ts";
import {
  assessmentDirectory,
  readAssessmentResult,
  validateAssessmentWorklist,
  verifyAssessmentFiles,
} from "./assessment.ts";

const sorted = (xs: string[]) => xs.sort();
function filesBelow(root: string, prefix: string): string[] {
  const base = path.join(root, prefix);
  noLinks(base);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).flatMap((e) => {
    requireThat(!e.isSymbolicLink(), "GRADE_SYMLINK_FORBIDDEN");
    const name = prefix + "/" + e.name;
    if (e.isDirectory()) return filesBelow(root, name);
    requireThat(e.isFile(), "GRADE_FILE_TYPE_INVALID");
    return [name];
  });
}
function replayNames(root: string) {
  return sorted(
    [
      "facility.json",
      ...filesBelow(root, "oracles"),
      ...filesBelow(root, "runs"),
      ...filesBelow(root, "reports"),
      ...filesBelow(root, "campaign"),
    ].filter((n) => !n.endsWith(".lock")),
  );
}
function rootsMap(locations: any[]) {
  requireThat(
    Array.isArray(locations) && locations.length > 0,
    "ASSESSMENT_LOCATIONS_REQUIRED",
  );
  const map = new Map<string, string>();
  for (const row of locations) {
    requireThat(typeof row.root === "string", "ASSESSMENT_ROOT_REQUIRED");
    deploymentGuard(repository, row.root);
    requireThat(
      requireExistingGradeFacility(row.root).nonce === row.facility_nonce &&
        !map.has(row.facility_nonce),
      "ASSESSMENT_FACILITY_MISMATCH",
    );
    map.set(row.facility_nonce, row.root);
  }
  return map;
}
/** This inventory is private. It contains no file contents or credential values. */
export function createAssessmentReplayManifest(
  worklist: any,
  locations: any[],
) {
  validateAssessmentWorklist(worklist);
  const roots = rootsMap(locations);
  requireThat(
    new Set(worklist.rows.map((r: any) => r.facility_nonce)).size ===
      roots.size,
    "ASSESSMENT_ROOT_SET_MISMATCH",
  );
  const codeNames = execFileSync(
    "git",
    [
      "ls-files",
      "test_case/online/benchmark",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "docs/fix/evidence",
    ],
    { cwd: repository, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const code = sorted(codeNames).map((relative) => {
    const file = path.join(repository, relative);
    noLinks(file);
    return { relative, sha256: sha(fs.readFileSync(file)) };
  });
  return {
    version: "secretary-opus-replay-inputs-v1",
    code_head: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim(),
    code,
    worklist,
    worklist_sha256: sha(gradeJSONBytes(worklist)),
    facilities: [...roots]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([facility_nonce, root]) => ({
        facility_nonce,
        files: replayNames(root).map((relative) => {
          const b = readOwnedGradeFile(root, relative);
          return { relative, bytes: b.length, sha256: sha(b) };
        }),
      })),
  };
}
/** Verify the entire frozen input set before running either chain reader. */
export function replayAssessment(
  manifest: any,
  locations: any[],
  expectedHash: string,
  anchors?: { assessment?: any; migration?: any },
) {
  requireThat(
    sha(gradeJSONBytes(manifest)) === expectedHash &&
      manifest.version === "secretary-opus-replay-inputs-v1",
    "ASSESSMENT_REPLAY_MANIFEST_CHANGED",
  );
  const roots = rootsMap(locations),
    worklist = validateAssessmentWorklist(manifest.worklist);
  requireThat(
    sha(gradeJSONBytes(worklist)) === manifest.worklist_sha256 &&
      manifest.facilities.length === roots.size,
    "ASSESSMENT_REPLAY_WORKLIST_CHANGED",
  );
  requireThat(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim() === manifest.code_head,
    "ASSESSMENT_REPLAY_CODE_CHANGED",
  );
  for (const f of manifest.code) {
    requireThat(
      typeof f.relative === "string" &&
        !path.isAbsolute(f.relative) &&
        f.relative
          .split("/")
          .every((x: string) => x && x !== ".." && x !== "."),
      "ASSESSMENT_CODE_PATH_INVALID",
    );
    const file = path.join(repository, f.relative);
    noLinks(file);
    requireThat(
      sha(fs.readFileSync(file)) === f.sha256,
      "ASSESSMENT_REPLAY_CODE_CHANGED",
    );
  }
  for (const f of manifest.facilities) {
    const root = roots.get(f.facility_nonce);
    requireThat(root, "ASSESSMENT_REPLAY_ROOT_MISSING");
    requireThat(
      JSON.stringify(replayNames(root)) ===
        JSON.stringify(f.files.map((x: any) => x.relative)),
      "ASSESSMENT_REPLAY_INPUT_SET_CHANGED",
    );
    verifyAssessmentFiles(root, f.files);
  }
  const cache = new Map<string, ReturnType<typeof readAssessmentResult>>(),
    rows: any[] = [];
  for (const row of worklist.rows) {
    const root = roots.get(row.facility_nonce);
    requireThat(root, "ASSESSMENT_REPLAY_ROOT_MISSING");
    const packetName = `oracles/${row.run}-sealed-v3.json`,
      sourceName = `oracles/${row.run}-grade-packet.json`,
      runName = `runs/${row.run}.json`;
    requireThat(
      sha(readOwnedGradeFile(root, packetName)) === row.packet_file_sha256 &&
        sha(readOwnedGradeFile(root, sourceName)) === row.source_file_sha256 &&
        sha(readOwnedGradeFile(root, runName)) === row.run_file_sha256,
      "ASSESSMENT_SOURCE_CHANGED",
    );
    const packet = readOwnedGradeJSON(root, packetName),
      original = readOwnedGradeJSON(root, sourceName),
      run = readOwnedGradeJSON(root, runName);
    requireThat(
      packet.packet_id === row.packet_id &&
        packet.payload_sha256 === sha(JSON.stringify(packet.payload)) &&
        row.metadata.model === run.config.model &&
        row.metadata.profile === run.config.profile &&
        row.metadata.case_id === run.config.case_id &&
        row.metadata.family === original.episode.family &&
        row.metadata.protocol_version ===
          packet.payload.disposition.protocol_version,
      "ASSESSMENT_METADATA_CHANGED",
    );
    const eligible = packet.payload.assertions.some((a: any) =>
      a.allowed_labels?.some((l: string) => l !== "UNRESOLVED"),
    );
    requireThat(
      (row.selection.kind === "HOST_ONLY") === !eligible,
      "ASSESSMENT_ELIGIBILITY_CHANGED",
    );
    let submission: any = null,
      controls: any = null,
      status = "HOST_ONLY_EXCLUDED",
      provenance: any = { kind: "HOST_ONLY" };
    if (row.selection.kind === "ASSESSMENT") {
      const id = row.selection.assessment_id,
        key = row.facility_nonce + "/" + id;
      if (!cache.has(key))
        cache.set(key, readAssessmentResult(root, id, anchors?.assessment));
      const result = cache.get(key)!;
      status = result.status;
      requireThat(
        result.privateData.mapping.some(
          (m: any) => m.run === row.run && m.packet_id === row.packet_id,
        ),
        "ASSESSMENT_RECEIPT_RUN_MISMATCH",
      );
      if (result.accepted) {
        submission = result.accepted.submission.submissions.find(
          (s: any) => s.packet_id === row.packet_id,
        );
        controls = result.accepted.controls;
      }
      provenance = {
        kind: "ASSESSMENT",
        assessment_id: id,
        request_sha256: result.record.request_sha256,
        receipt: result.accepted
          ? assessmentDirectory(id) + "/accepted.json"
          : null,
        source_file_sha256: result.accepted?.source_file_sha256 ?? null,
        judge_policy: "opus-5.5-extra-migration-v1",
        grading_envelope_version: result.record.batch.payload.version,
      };
    } else if (row.selection.kind === "MIGRATION") {
      requireThat(
        /^oracles\/[a-f0-9-]{36}-verdict-[a-f0-9-]{36}\.json$/.test(
          row.selection.receipt_file,
        ) &&
          row.selection.receipt_file.startsWith(`oracles/${row.run}-verdict-`),
        "ASSESSMENT_RECEIPT_RUN_MISMATCH",
      );
      const bytes = readOwnedGradeFile(root, row.selection.receipt_file);
      requireThat(
        sha(bytes) === row.selection.receipt_sha256,
        "ASSESSMENT_RECEIPT_CHANGED",
      );
      const receipt = JSON.parse(bytes.toString());
      const {
        received_at,
        qualification,
        source_sha256,
        source_file_sha256,
        calibration,
        ...raw
      } = receipt;
      requireThat(
        source_sha256 === sha(JSON.stringify(raw)),
        "GRADE_RECEIPT_CHANGED",
      );
      const resolved = resolveGradeReceipt(
        root,
        receipt,
        raw,
        [packet],
        anchors?.migration,
      );
      requireThat(
        resolved.judge_policy === "opus-5.5-extra-migration-v1" &&
          resolved.controls.status === "PASS" &&
          raw.packet_id === row.packet_id,
        "ASSESSMENT_OPUS_RECEIPT_REQUIRED",
      );
      validateMigrationReceiptBinding(
        root,
        readOwnedGradeJSON(root, "oracles/" + calibration.receipt_file),
        path.basename(row.selection.receipt_file),
        anchors?.migration,
      );
      status = "ACCEPTED";
      submission = raw;
      controls = resolved.controls;
      provenance = {
        kind: "MIGRATION",
        receipt: row.selection.receipt_file,
        source_file_sha256,
        judge_policy: resolved.judge_policy,
        grading_envelope_version: resolved.grading_envelope_version,
      };
    }
    rows.push({
      facility_nonce: row.facility_nonce,
      run: row.run,
      ...row.metadata,
      packet_id: row.packet_id,
      status,
      eligible,
      provenance,
      source_packet_sha256: row.packet_file_sha256,
      source_artifact_sha256: row.source_file_sha256,
      assertion_coverage: packet.payload.assertions.map((a: any) => ({
        assertion_id: a.assertion_id,
        allowed_labels: a.allowed_labels,
        host_coverage: a.host_coverage,
      })),
      controls,
      verdicts: submission?.verdicts ?? null,
      notes: submission?.notes ?? [],
      driver_failure: original.infrastructure_failure ?? null,
      human_qualification: "NOT_EVALUATED_NOT_A_BENCHMARK_DELIVERY_GATE",
    });
  }
  const groups = new Map<string, any>();
  for (const row of rows) {
    const dims = {
      model: row.model,
      family: row.family,
      profile: row.profile,
      case_id: row.case_id,
      protocol_version: row.protocol_version,
      cohort: row.cohort,
      source_kind: row.provenance.kind,
    };
    const key = JSON.stringify(dims);
    if (!groups.has(key))
      groups.set(key, {
        ...dims,
        runs: [],
        eligible: 0,
        assessed: 0,
        unassessed: 0,
        host_only: 0,
        assertions: {},
      });
    const g = groups.get(key);
    g.runs.push(row.run);
    g.eligible += Number(row.eligible);
    g.assessed += Number(row.status === "ACCEPTED");
    g.unassessed += Number(row.eligible && row.status !== "ACCEPTED");
    g.host_only += Number(!row.eligible);
    for (const v of row.verdicts ?? []) {
      g.assertions[v.assertion_id] ??= { PASS: 0, FAIL: 0, UNRESOLVED: 0 };
      g.assertions[v.assertion_id][v.label]++;
    }
  }
  // A concurrent append cannot silently enter a report whose manifest omitted it.
  for (const f of manifest.facilities) {
    const root = roots.get(f.facility_nonce)!;
    requireThat(
      JSON.stringify(replayNames(root)) ===
        JSON.stringify(f.files.map((x: any) => x.relative)),
      "ASSESSMENT_REPLAY_INPUT_SET_CHANGED",
    );
    verifyAssessmentFiles(root, f.files);
  }
  const assessed = rows.filter((r) => r.status === "ACCEPTED").length,
    eligible = rows.filter((r) => r.eligible).length;
  return {
    version: "secretary-opus-selected-report-v1",
    status: assessed === eligible ? "COMPLETE_ADVISORY" : "INCOMPLETE",
    replay_input_sha256: expectedHash,
    worklist_sha256: manifest.worklist_sha256,
    code_head: manifest.code_head,
    coverage_only: {
      original: rows.length,
      eligible,
      assessed,
      host_only: rows.length - eligible,
      unassessed: eligible - assessed,
    },
    rows,
    groups: [...groups.values()],
    qualification: "NOT_APPLICABLE_TO_BENCHMARK_DELIVERY",
    limitations: [
      "Frozen accepted-input replay is deterministic; new LLM or SUT execution is not guaranteed deterministic.",
      "One Opus contract does not prove judge stability, independence, or universal semantic correctness. Human S1/S2 qualification remains pending and is not a harness delivery gate.",
      "No performance pooling across cohorts, families, models, profiles, protocols or provenance. Coverage totals are not accuracy.",
      "Partial external-effect observability, frozen historical World host-marker gaps, omitted cold-context paths, development exposure, correlated small samples and imperfect blinding remain limits.",
      "Public Opus QA variant is NOT_EXERCISED and NOT_CALIBRATED; official public accuracy remains NOT_TESTED.",
      "Independent effect/no-shell receipts remain authoritative evidence; judge rationales cannot override them.",
      "Replay inputs are local and private and must be retained, or restored and replay-verified before releasing archived originals.",
    ],
  };
}
