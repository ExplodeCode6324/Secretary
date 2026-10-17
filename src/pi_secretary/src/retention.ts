import type {
  ArchiveManifest,
  Execution,
  Feedback,
  TaskResult,
} from "./contracts.ts";
import { scopeOf, terminal } from "./execution-utils.ts";
import type { SchedulerContext } from "./scheduler-context.ts";
import { base, now, revise } from "./store.ts";

type RetentionContext = Pick<SchedulerContext, "store">;

export function detail(this: RetentionContext, eid: string) {
  const e = this.store.get<Execution>("Execution", eid);
  if (e.retention_state === "RETIRED")
    return {
      status: "RETIRED",
      archive: this.store
        .all<ArchiveManifest>("ArchiveManifest")
        .find((a) => a.execution_id === eid),
    };
  return {
    execution: e,
    result: e.result_id
      ? this.store.get<TaskResult>("TaskResult", e.result_id)
      : null,
    detail: e.result_id
      ? this.store.read(
          this.store.get<TaskResult>("TaskResult", e.result_id).detail_ref,
        )
      : null,
  };
}

export function viewed(this: RetentionContext, eid: string) {
  const e = this.store.get<Execution>("Execution", eid);
  if (e.retention_state === "RETIRED") return;
  this.store.commit([
    revise(e, { last_activity_at: now(), retention_state: "HOT" }),
  ]);
}

export function retire(this: RetentionContext, at = Date.now()) {
  for (const e of this.store.indexed<Execution>(
    "Execution",
    "retention_state",
    ["RETIRED"],
    true,
  )) {
    if (
      !terminal(e) ||
      e.retention_state === "RETIRED" ||
      e.waiting_request_ids.length ||
      e.unknown_operation_ids.length ||
      e.pending_followup_ids.length ||
      this.store
        .indexed<Feedback>("Feedback", "execution_id", [e.id])
        .some((f) => f.execution_id === e.id && f.state !== "HANDLED") ||
      at - Math.max(Date.parse(e.ended_at!), Date.parse(e.last_activity_at)) <
        e.retire_after_seconds * 1000
    )
      continue;
    const records = this.store.executionEvents(e.id);
    for (const l of records) this.store.bytes(l.payload);
    const result = this.store.get<TaskResult>("TaskResult", e.result_id!);
    this.store.bytes(result.detail_ref);
    const m: ArchiveManifest = {
      schema_version: 1,
      record_type: "ArchiveManifest",
      ...base(),
      task_id: e.task_id,
      execution_id: e.id,
      log_event_ids: records.map((r) => r.event_id),
      objects: [result.detail_ref, ...records.map((l) => l.payload)],
      verified_at: now(),
      retired_at: now(),
    };
    this.store.commit(
      [m, revise(e, { retention_state: "RETIRED" })],
      [this.store.event("archive.verified", m, scopeOf(e))],
    );
  }
}
