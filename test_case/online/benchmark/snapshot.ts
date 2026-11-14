// Read-only preflight: never open Store or run recovery on an unvalidated checkpoint.
import fs from "node:fs";
import path from "node:path";
import { shape, type Stored } from "../../../src/pi_secretary/src/store.ts";

import {
  inside,
  noLinks,
  processStatus,
  read,
  requireThat,
  sha,
} from "./io.ts";

export function snapshot(core: string) {
  noLinks(core);
  const records = new Map<string, Stored>();
  const verified = new Set<string>();
  function refs(value: any): void {
    if (!value || typeof value !== "object") return;
    if (
      typeof value.sha256 === "string" &&
      typeof value.path === "string" &&
      typeof value.bytes === "number"
    ) {
      requireThat(
        /^[a-f0-9]{64}$/.test(value.sha256) &&
          value.path === "objects/" + value.sha256,
        "INVALID_CAS_REF",
      );
      const bytes = read(path.join(core, value.path));
      requireThat(
        bytes.length === value.bytes && sha(bytes) === value.sha256,
        "CORRUPT_CAS",
      );
      if (!verified.has(value.sha256)) {
        verified.add(value.sha256);
        if (String(value.media_type).includes("json"))
          refs(JSON.parse(bytes.toString()));
      }
      return;
    }
    for (const child of Object.values(value)) refs(child);
  }
  let sequence = 0,
    digest = "0".repeat(64);
  const journal = read(path.join(core, "journal.jsonl")).toString();
  requireThat(journal.endsWith("\n"), "PARTIAL_JOURNAL");
  for (const line of journal.trimEnd().split("\n")) {
    const frame = JSON.parse(line),
      bytes = Buffer.from(frame.payload_b64, "base64");
    requireThat(sha(bytes) === frame.sha256, "CORRUPT_FRAME");
    const tx = JSON.parse(bytes.toString());
    shape(tx);
    requireThat(
      tx.record_type === "JournalTransaction" &&
        tx.sequence === sequence + 1 &&
        tx.previous_digest === digest,
      "CORRUPT_CHAIN",
    );
    for (const mutation of tx.mutations) {
      refs(mutation.snapshot);
      const record = JSON.parse(
        read(path.join(core, mutation.snapshot.path)).toString(),
      );
      shape(record);
      const key = mutation.object_type + ":" + mutation.object_id;
      requireThat(
        record.record_type === mutation.object_type &&
          record.id === mutation.object_id &&
          mutation.expected_revision === (records.get(key)?.revision ?? 0) &&
          record.revision === mutation.new_revision &&
          mutation.new_revision === mutation.expected_revision + 1,
        "CORRUPT_REVISION",
      );
      records.set(key, record);
      refs(record);
    }
    refs(tx.log_records);
    sequence = tx.sequence;
    digest = frame.sha256;
  }
  return {
    records: [...records.values()],
    sequence,
    digest,
    casObjects: verified.size,
  };
}
export function restorePreflight(
  core: string,
  logicalCore: string,
  sink: any[] = [],
) {
  noLinks(logicalCore);
  const result = snapshot(core),
    work = path.join(logicalCore, "workspaces");
  validateRestoredRecords(result.records, work, sink);
  return result;
}
export function validateRestoredRecords(
  records: Stored[],
  work: string,
  sink: any[],
) {
  for (const r of records) {
    if (r.record_type === "Scope")
      requireThat(r.kind !== "DIRECTORY", "EXTERNAL_SCOPE_UNSUPPORTED");
    if (r.record_type === "ProgramRegistration")
      throw Error("PROGRAM_UNSUPPORTED");
    if (r.record_type === "AuthorizationRule")
      throw Error("CUSTOM_AUTHORIZATION_UNSUPPORTED");
    if (r.record_type === "Execution" && r.workspace_binding) {
      requireThat(
        r.workspace_binding.kind === "NONE" &&
          inside(work, r.workspace_binding.root_path) &&
          path.resolve(r.workspace_binding.root_path) ===
            r.workspace_binding.root_path,
        "WORKSPACE_OUTSIDE_SLOT",
      );
    }
    if (r.record_type === "Operation") {
      if (r.process)
        requireThat(
          (r.process.state === "STOPPED"
            ? "STOPPED"
            : processStatus(r.process)) === "STOPPED",
          "UNCONFIRMED_OPERATION_PROCESS",
        );
      if (r.action.action === "file.write")
        requireThat(
          inside(work, r.action.resource) &&
            path.resolve(r.action.resource) === r.action.resource,
          "RESOURCE_OUTSIDE_SLOT",
        );
      requireThat(
        !["program.run"].includes(r.action.action),
        "PROGRAM_UNSUPPORTED",
      );
      requireThat(
        r.action.action === "file.write" ||
          (r.action.action === "shell.run" &&
            r.rule_id === "builtin:readonly-shell"),
        "UNSUPPORTED_OPERATION_CAPABILITY",
      );
    }
    if (r.record_type === "PushTarget")
      requireThat(
        r.kind === "MACOS_NOTIFICATION" && r.endpoint === null,
        "UNSAFE_PUSH_TARGET",
      );
    if (r.record_type === "PushDispatch") {
      requireThat(r.state !== "SENDING", "AMBIGUOUS_PUSH_CHECKPOINT");
      const delivered = sink.filter((call) =>
        call.dispatches.some((d: any) => d.id === r.id),
      );
      for (const call of delivered) {
        const association = call.dispatches.filter((d: any) => d.id === r.id);
        requireThat(
          association.length === 1 &&
            association[0].batch === r.batch_id &&
            r.attempt_history.some((a) => a.id === association[0].attempt),
          "SINK_ATTEMPT_MISMATCH",
        );
      }
      requireThat(
        r.state === "DISPATCHED"
          ? delivered.length === 1
          : delivered.length === 0,
        "SINK_STORE_DISAGREEMENT",
      );
    }
  }
  for (const call of sink)
    for (const d of call.dispatches)
      requireThat(
        records.some(
          (r) =>
            r.record_type === "PushDispatch" &&
            r.id === d.id &&
            r.state === "DISPATCHED",
        ),
        "SINK_STORE_DISAGREEMENT",
      );
}
