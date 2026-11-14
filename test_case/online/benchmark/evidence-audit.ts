import fs from "node:fs";
import path from "node:path";
import type { Run } from "./domain.ts";
import { snapshot } from "./snapshot.ts";
import {
  read,
  readJSON,
  requireThat,
  processStatus,
  sha,
  writeJSON,
} from "./io.ts";

/** Actual task request transcripts, including tool results; no model self-report. */
export function capturedReads(run: Run, relativePath: string) {
  const file = path.join(run.evidence, "live-contexts.jsonl");
  if (!fs.existsSync(file)) return [];
  const found = new Map<string, unknown>();
  for (const line of read(file).toString().trim().split("\n").filter(Boolean)) {
    const capture = JSON.parse(line);
    if (capture.role !== "task") continue;
    requireThat(
      sha(JSON.stringify(capture.context)) === capture.context_sha256,
      "CAPTURED_CONTEXT_HASH_MISMATCH",
    );
    const messages = capture.context.messages ?? [];
    for (const message of messages) {
      if (message.role !== "assistant" || !Array.isArray(message.content))
        continue;
      for (const call of message.content) {
        if (
          call.type !== "toolCall" ||
          call.name !== "read" ||
          typeof call.arguments?.path !== "string" ||
          path.posix.normalize(call.arguments.path) !== relativePath
        )
          continue;
        const result = messages.find(
          (m: any) =>
            m.role === "toolResult" &&
            m.toolCallId === call.id &&
            m.toolName === "read" &&
            m.isError !== true,
        );
        if (result)
          found.set(call.id, {
            call,
            result,
            request_context_sha256: capture.context_sha256,
            at: capture.at,
          });
      }
    }
  }
  return [...found.values()];
}

export function maintenanceEvidence(
  transactions: { records: any[] }[],
  records: any[],
) {
  const types = ["CompactionJob", "MemoryExtractionJob", "ModelCall"];
  const failures = transactions.flatMap((t, i) =>
    t.records
      .filter(
        (r) =>
          types.includes(r.record_type) &&
          ["FAILED", "INTERRUPTED"].includes(r.state),
      )
      .map((r) => ({
        sequence: i + 1,
        record_type: r.record_type,
        id: r.id,
        revision: r.revision,
        at: r.updated_at,
        state: r.state,
        validation_errors: r.validation_errors ?? [],
        error: r.error ?? null,
        next_attempt_at: r.next_attempt_at ?? null,
        retry_at: r.retry_at ?? null,
      })),
  );
  const jobs = records.filter((r) =>
    ["CompactionJob", "MemoryExtractionJob"].includes(r.record_type),
  );
  const pending = jobs.filter(
    (r) => !["COMMITTED", "SUCCEEDED", "STALE"].includes(r.state),
  );
  return {
    status: !jobs.length
      ? "NOT_TESTED"
      : pending.length
        ? "INCOMPLETE"
        : failures.length
          ? "COMPLETE_WITH_RETAINED_FAILURES"
          : "COMPLETE",
    current_jobs: jobs,
    unresolved_job_ids: pending.map((r) => r.id),
    first_failure: failures[0] ?? null,
    failure_history: failures,
    qualification:
      "Job completion is mechanical evidence, not semantic memory correctness.",
  };
}

/** Read-only reconstruction. Never open Store or advance recovery just to inspect a run. */
export function auditEpisode(run: Run) {
  requireThat(
    ["STOPPED", "RETIRED"].includes(run.state) &&
      (!run.process || processStatus(run.process) === "STOPPED"),
    "AUDIT_REQUIRES_STOPPED_RUN",
  );
  const core = path.join(run.active, "core"),
    state = snapshot(core);
  const operations = state.records
    .filter((r) => r.record_type === "Operation")
    .map((r: any) => ({
      record: r,
      parameters: JSON.parse(
        read(path.join(core, r.action.parameters_ref.path)).toString(),
      ),
      receipt: r.receipt
        ? JSON.parse(read(path.join(core, r.receipt.path)).toString())
        : null,
      history: state.operationHistory.get(r.id),
    }));
  const driverFile = path.join(run.evidence, "driver-inputs.jsonl");
  const driver = fs.existsSync(driverFile)
    ? read(driverFile)
        .toString()
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s))
    : [];
  const sends = fs
    .readdirSync(run.evidence)
    .filter((n) => /^send-[a-f0-9-]+\.json$/.test(n))
    .map((n) => ({ file: n, ...readJSON(path.join(run.evidence, n)) }));
  const probes = driver
    .filter((s) => s.probe)
    .map((s) => {
      const next = driver.find((t) => t.index > s.index);
      return {
        step: s.index,
        reminder: s.reminder,
        request_id: s.request_id,
        at: s.at,
        requests: sends
          .filter((r) => r.at >= s.at && (!next || r.at < next.at))
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((r) => {
            const serialized = JSON.stringify(r.payload),
              bytes = Buffer.byteLength(serialized);
            return {
              file: r.file,
              at: r.at,
              attribution: r.attribution,
              bytes,
              payload_sha256: sha(serialized),
              opaque_provider_state_present: serialized.includes(
                '"encrypted_content"',
              ),
              payload: bytes <= 400_000 ? r.payload : null,
              limitation:
                bytes <= 400_000
                  ? "Inspect the actual MAIN probe request; the interval may also include maintenance. Opaque provider state prevents an absence proof."
                  : "Oversize payload retained in original artifact; no absence proof from this projection.",
            };
          }),
      };
    });
  const audit = {
    version: "secretary-memory-audit-v2",
    run: run.id,
    journal_digest: state.digest,
    sequence: state.sequence,
    maintenance: maintenanceEvidence(state.transactions, state.records),
    operations,
    probe_intervals: probes,
    evidence_complete: {
      journal: true,
      referenced_cas: true,
      all_external_effects: false,
    },
    limitations: [
      "Only the journal/CAS chain and captured owned effects are validated. Absence of all possible effects is not inferred.",
      "Each source assertion still needs independent semantic adjudication.",
    ],
  };
  const file = path.join(
    run.evidence,
    "audit-" + sha(JSON.stringify(audit)) + ".json",
  );
  if (!fs.existsSync(file)) writeJSON(file, audit);
  return { file, audit };
}
