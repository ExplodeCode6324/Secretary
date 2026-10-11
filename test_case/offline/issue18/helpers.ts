import type { App } from "../../../src/pi_secretary/src/app.ts";
import { base, id, now } from "../../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  Operation,
} from "../../../src/pi_secretary/src/contracts.ts";
export function interrupted(
  app: App,
  action = "shell.run",
  resource = "/synthetic/project",
  stopped = true,
) {
  const task = app.scheduler.propose(
    "Synthetic interrupted task",
    id(),
    app.host.sessionID,
  );
  const e: Execution = {
    schema_version: 1,
    record_type: "Execution",
    ...base(),
    task_id: task.id,
    state: "RESULT_UNKNOWN",
    retention_state: "HOT",
    occurrence_key: id(),
    plan_revision: task.revision,
    proposal_ref: task.proposal_ref,
    attempt_id: null,
    owner_epoch: app.store.epoch,
    waiting_request_ids: [],
    condition_results: [],
    continuation_of: null,
    pending_followup_ids: [],
    cancel_requested: false,
    started_at: now(),
    ended_at: null,
    last_activity_at: now(),
    retire_after_seconds: 172800,
    result_id: null,
    checkpoint_id: null,
    unknown_operation_ids: [],
  };
  const op: Operation = {
    schema_version: 1,
    record_type: "Operation",
    ...base(),
    scope: { session_id: null, task_id: task.id, execution_id: e.id },
    state: "RESULT_UNKNOWN",
    action: {
      action,
      resource,
      parameters_ref: app.store.put({}),
      parameters_hash: app.store.put({}).sha256,
      expected_resource_revision: null,
      intent_id: id(),
    },
    authorization_id: null,
    rule_id: null,
    rule_revision: null,
    owner_epoch: app.store.epoch,
    attempt_id: null,
    retry_of: null,
    receipt: app.store.put({ initial: "interrupted" }),
    effect: "UNKNOWN",
    error: null,
    ...(action === "file.write"
      ? {}
      : {
          process: {
            token: id(),
            state: stopped ? ("STOPPED" as const) : ("UNCONFIRMED" as const),
          },
        }),
  };
  e.unknown_operation_ids = [op.id];
  app.store.commit([e, op]);
  return { e, op };
}
