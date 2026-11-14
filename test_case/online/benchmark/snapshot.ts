// Read-only preflight: never open Store or run recovery on an unvalidated checkpoint.
import fs from "node:fs";
import path from "node:path";
import { shape, type Stored } from "../../../src/pi_secretary/src/store.ts";
import type { Operation } from "../../../src/pi_secretary/src/contracts.ts";
import { readonlyShell } from "../../../src/pi_secretary/src/shell-policy.ts";

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
  const operationHistory = new Map<string, Operation[]>();
  const transactions: { records: Stored[]; events: any[] }[] = [];
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
    const changed: Stored[] = [];
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
      changed.push(record);
      if (record.record_type === "Operation")
        operationHistory.set(record.id, [
          ...(operationHistory.get(record.id) ?? []),
          record,
        ]);
      refs(record);
    }
    refs(tx.log_records);
    transactions.push({ records: changed, events: tx.log_records });
    sequence = tx.sequence;
    digest = frame.sha256;
  }
  return {
    records: [...records.values()],
    sequence,
    digest,
    casObjects: verified.size,
    operationHistory,
    transactions,
  };
}
export function restorePreflight(
  core: string,
  logicalCore: string,
  sink: any[] = [],
  live = false,
) {
  noLinks(logicalCore);
  const result = snapshot(core),
    work = path.join(logicalCore, "workspaces");
  const proof = live
    ? {
        history: result.operationHistory,
        transactions: result.transactions,
        value: (ref: any) =>
          JSON.parse(read(path.join(core, ref.path)).toString()),
      }
    : undefined;
  validateRestoredRecords(result.records, work, sink, proof);
  return result;
}
export function validateRestoredRecords(
  records: Stored[],
  work: string,
  sink: any[],
  proof?: RecoveryProof,
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
      if (proof) {
        validateLiveOperation(r, work, proof);
        continue;
      }
      if (["file.write", "shell.run"].includes(r.action.action))
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

export type RecoveryProof = {
  history: Map<string, Operation[]>;
  transactions: { records: Stored[]; events: any[] }[];
  value: (ref: any) => any;
};
export function recoveryClass(
  action: string,
  state: string,
  readonly = false,
): "A" | "T" | "W" | "U" | "X" {
  if (
    ![
      "PREPARED",
      "WAIT_AUTH",
      "AUTHORIZED",
      "DISPATCHED",
      "SUCCEEDED",
      "FAILED",
      "RESULT_UNKNOWN",
      "CANCELLED",
    ].includes(state)
  )
    return "X";
  if (action === "file.write")
    return ["DISPATCHED", "RESULT_UNKNOWN"].includes(state) ? "U" : "A";
  if (action === "shell.run" && readonly)
    return ["DISPATCHED", "RESULT_UNKNOWN"].includes(state) ? "X" : "A";
  if (
    !["shell.run", "world.change", "scope.import", "program.run"].includes(
      action,
    )
  )
    return "X";
  if (["FAILED", "CANCELLED"].includes(state)) return "T";
  return action === "world.change" && state === "SUCCEEDED" ? "W" : "X";
}
function validateLiveOperation(
  r: Operation,
  work: string,
  proof: RecoveryProof,
) {
  const kind = recoveryClass(
    r.action.action,
    r.state,
    r.rule_id === "builtin:readonly-shell",
  );
  requireThat(kind !== "X", "UNSUPPORTED_OPERATION_STATE");
  const history = proof.history.get(r.id);
  requireThat(
    history?.length && history.at(-1)?.revision === r.revision,
    "OPERATION_HISTORY_REQUIRED",
  );
  requireThat(
    r.action.parameters_hash === r.action.parameters_ref.sha256,
    "PARAMETER_CHANGED",
  );
  if (kind === "T") {
    requireThat(
      !history.some(
        (h) =>
          ["DISPATCHED", "SUCCEEDED", "RESULT_UNKNOWN"].includes(h.state) ||
          h.process ||
          !["NOT_STARTED", "NOT_APPLIED"].includes(h.effect),
      ),
      "TERMINAL_EFFECT_UNPROVEN",
    );
    requireThat(
      !r.process && ["NOT_STARTED", "NOT_APPLIED"].includes(r.effect),
      "TERMINAL_EFFECT_UNPROVEN",
    );
    const logged = proof.transactions.some(
      (tx) =>
        tx.records.some((v) => v.id === r.id && v.revision === r.revision) &&
        tx.events.some((e) => {
          const p = proof.value(e.payload);
          return (
            (e.event_type === "authorization.decided" &&
              p.result?.operation_id === r.id &&
              ["REJECT", "REVOKE"].includes(p.command?.decision)) ||
            (e.event_type === "operation.cancelled" &&
              p.operation_id === r.id) ||
            (e.event_type === "world.batch_failed" &&
              r.action.action === "world.change" &&
              r.state === "CANCELLED" &&
              r.effect === "NOT_STARTED" &&
              p.batch_id === r.action.intent_id &&
              proof.value(r.action.parameters_ref).batch_id === p.batch_id &&
              p.actor === "HOST" &&
              ["EXPIRED", "REVOKED"].includes(p.reason) &&
              !!r.receipt &&
              proof.value(r.receipt).status ===
                (p.reason === "EXPIRED" ? "EXPIRED" : "FAILED") &&
              proof.value(r.receipt).reason === p.error &&
              proof.value(r.receipt).actor === "HOST" &&
              tx.records.some(
                (a: any) =>
                  a.record_type === "AuthorizationRequest" &&
                  a.operation_id === r.id &&
                  a.state === p.reason,
              ))
          );
        }),
    );
    requireThat(logged, "TERMINAL_JOURNAL_PROOF_REQUIRED");
    return;
  }
  if (kind === "W") {
    requireThat(
      r.effect === "APPLIED" && r.receipt && !r.process,
      "WORLD_COMMIT_RECEIPT_REQUIRED",
    );
    const receipt = proof.value(r.receipt),
      parameters = proof.value(r.action.parameters_ref);
    requireThat(
      receipt.status === "COMMITTED" &&
        receipt.batch_id === parameters.batch_id &&
        parameters.batch_id === r.action.intent_id,
      "WORLD_COMMIT_MISMATCH",
    );
    const tx = proof.transactions.find((t) =>
      t.records.some((v) => v.id === r.id && v.revision === r.revision),
    );
    requireThat(
      tx &&
        tx.events.some(
          (e) =>
            e.event_type === "world.changed" &&
            JSON.stringify(proof.value(e.payload)) === JSON.stringify(receipt),
        ) &&
        tx.events.some(
          (e) =>
            e.event_type === "operation.journal_applied" &&
            proof.value(e.payload).id === r.id,
        ),
      "WORLD_COMMIT_JOURNAL_REQUIRED",
    );
    requireThat(
      Array.isArray(receipt.result_ids) &&
        receipt.result_ids.every((id: string) =>
          tx.records.some((v) => v.id === id),
        ),
      "WORLD_COMMIT_RECORDS_REQUIRED",
    );
    return;
  }
  requireThat(
    inside(work, r.action.resource) &&
      path.resolve(r.action.resource) === r.action.resource,
    "RESOURCE_OUTSIDE_SLOT",
  );
  noLinks(r.action.resource);
  const parameters = proof.value(r.action.parameters_ref);
  if (r.action.action === "file.write") {
    requireThat(
      typeof parameters.path === "string" && !path.isAbsolute(parameters.path),
      "FILE_PARAMETER_PATH_INVALID",
    );
    const owner = proof.transactions
      .flatMap((t) => t.records)
      .filter(
        (v: any) =>
          v.record_type === "Execution" && v.id === r.scope.execution_id,
      )
      .at(-1) as any;
    requireThat(
      owner?.workspace_binding?.root_path &&
        inside(work, owner.workspace_binding.root_path) &&
        path.resolve(owner.workspace_binding.root_path, parameters.path) ===
          r.action.resource,
      "FILE_PARAMETER_RESOURCE_MISMATCH",
    );
  }
  if (r.action.action === "shell.run") {
    const execution = readonlyShell(
      r.action.resource,
      parameters.command ?? "",
    );
    requireThat(
      parameters.cwd === r.action.resource &&
        execution &&
        JSON.stringify(execution.argv) ===
          JSON.stringify(parameters.execution?.argv) &&
        parameters.execution.policy_version === execution.policy_version,
      "READONLY_COMMAND_MISMATCH",
    );
  }
  if (["SUCCEEDED", "FAILED"].includes(r.state))
    requireThat(r.receipt, "OPERATION_RECEIPT_REQUIRED");
}
