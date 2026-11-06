import type {
  AuthorizationRequest,
  Execution,
  Feedback,
  Operation,
} from "./contracts.ts";
import { Store, base, now } from "./store.ts";
import { stableID, terminal } from "./execution-utils.ts";

/** Builds, but does not commit, the outbox fact so its producer can commit atomically. */
export function taskFeedback(
  store: Store,
  e: Execution,
  kind: Feedback["kind"],
  summary: string,
  detail: Feedback["detail_ref"],
  resultID: string | null = null,
  decisionID: string | null = null,
  authorizationID?: string,
) {
  const existing = store
    .indexed<Feedback>("Feedback", "execution_id", [e.id])
    .find((f) =>
      kind === "UNKNOWN"
        ? f.kind === "UNKNOWN"
        : authorizationID
          ? f.authorization_id === authorizationID
          : resultID
            ? f.result_id === resultID
            : decisionID
              ? f.decision_request_id === decisionID
              : false,
    );
  if (existing) return { record: existing, fresh: false };
  const key =
    authorizationID ??
    resultID ??
    decisionID ??
    (kind === "UNKNOWN" ? e.id : undefined);
  const record: Feedback = {
    ...base(key ? stableID(`task-feedback:${kind}:${key}`) : undefined),
    schema_version: 1,
    record_type: "Feedback",
    scope_id: e.scope_id ?? null,
    task_id: e.task_id,
    execution_id: e.id,
    state: "QUEUED",
    kind,
    summary,
    detail_ref: detail,
    result_id: resultID,
    decision_request_id: decisionID,
    input_id: null,
    created_at: now(),
    ...(authorizationID ? { authorization_id: authorizationID } : {}),
  };
  return { record, fresh: true };
}
export function authorizationFeedback(store: Store, a: AuthorizationRequest) {
  const e = a.scope.execution_id
    ? store.find<Execution>("Execution", a.scope.execution_id)
    : undefined;
  if (!e || e.task_id !== a.scope.task_id) return undefined;
  return taskFeedback(
    store,
    e,
    "AUTHORIZATION_REQUIRED",
    "Task requests Master authorization; Main may coordinate but cannot approve",
    a.display_ref,
    null,
    null,
    a.id,
  );
}
export function authorizationActionable(store: Store, id: string) {
  const a = store.find<AuthorizationRequest>("AuthorizationRequest", id);
  if (!a || a.state !== "PENDING" || (a.expires_at && a.expires_at <= now()))
    return false;
  const op = store.find<Operation>("Operation", a.operation_id);
  const e = a.scope.execution_id
    ? store.find<Execution>("Execution", a.scope.execution_id)
    : undefined;
  return (
    !!e &&
    !!op &&
    op.state === "WAIT_AUTH" &&
    op.authorization_id === a.id &&
    op.scope.execution_id === e.id &&
    e.task_id === a.scope.task_id &&
    !terminal(e) &&
    !e.cancel_requested
  );
}
