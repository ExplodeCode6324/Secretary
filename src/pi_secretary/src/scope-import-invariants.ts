import { isDeepStrictEqual as equal } from "node:util";
import type { Store, Stored } from "./store.ts";
import type {
  JournalTransaction,
  Operation,
  AuthorizationRequest,
  ScopeImportParameters,
  Input,
} from "./contracts.ts";
import {
  checkImport,
  importedScope,
  importNotice,
  importResultKey,
  importScopeID,
} from "./scope-import.ts";
import { stableID } from "./execution-utils.ts";

/** Historical replay checks the frame, never today's filesystem or withdrawal state. */
export function validateScopeImportFrame(
  store: Store,
  txn: JournalTransaction,
  staged: Stored[],
  replay: boolean,
) {
  const events = txn.log_records;
  const validNotice = (input: Input, op: Operation, result: unknown) =>
    input.id === stableID(importResultKey(op.id)) &&
    input.dedupe_key === importResultKey(op.id) &&
    input.session_id === op.scope.session_id &&
    input.producer === "ENVIRONMENT" &&
    input.state === "ACCEPTED" &&
    input.loop_id === null &&
    input.feedback_id === null &&
    // Replay validates durable structure, never regenerates versioned content
    // or writes to CAS using today's notice wording/serialization.
    (replay ||
      equal(input, importNotice(store, op, result, input.received_at)));
  const hasEvent = (type: string, value: unknown, op: Operation) =>
    events.some(
      (e) =>
        e.event_type === type &&
        e.actor === "HOST" &&
        equal(e.scope, op.scope) &&
        equal(store.read(e.payload), value),
    );
  for (const r of staged) {
    if (r.record_type !== "Operation" || r.action.action !== "scope.import")
      continue;
    const old = store.find<Operation>("Operation", r.id);
    if (
      !old ||
      !["SUCCEEDED", "CANCELLED"].includes(r.state) ||
      old.state === r.state
    )
      continue;
    if (
      !equal(old.action, r.action) ||
      !equal(old.scope, r.scope) ||
      r.authorization_id !== old.authorization_id
    )
      throw Error("SCOPE_OPERATION_CHANGED");
    const a = store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      old.authorization_id!,
    );
    const next = staged.find(
      (v): v is AuthorizationRequest =>
        v.record_type === "AuthorizationRequest" && v.id === a.id,
    );
    // Owner rejection/revocation is an existing authenticated decision transaction;
    // its deterministic notification is reconciled on startup and every pump.
    if (
      r.state === "CANCELLED" &&
      !r.receipt &&
      events.some(
        (e) =>
          e.event_type === "authorization.decided" && e.actor === "MASTER_UI",
      )
    )
      continue;
    if (
      !r.receipt ||
      !next ||
      !equal(a.scope, old.scope) ||
      r.rule_id ||
      r.rule_revision
    )
      throw Error("SCOPE_GRANT_NOT_ATOMIC");
    const {
      revision: _ar,
      updated_at: _at,
      state: _as,
      consumed_at: _ac,
      ...before
    } = a;
    const {
      revision: _nr,
      updated_at: _nt,
      state: _ns,
      consumed_at: _nc,
      ...after
    } = next;
    if (!equal(before, after)) throw Error("SCOPE_GRANT_CHANGED");
    const result = store.read<any>(r.receipt);
    const input = staged.find(
      (v): v is Input =>
        v.record_type === "Input" && v.id === stableID(importResultKey(r.id)),
    );
    if (
      !input ||
      !validNotice(input, r, result) ||
      !hasEvent("input.accepted", input, r)
    )
      throw Error("SCOPE_RESULT_NOT_ATOMIC");
    if (r.state === "SUCCEEDED") {
      if (old.state !== "AUTHORIZED" || old.owner_epoch !== txn.owner_epoch)
        throw Error("STALE_OWNER");
      if (
        !equal(a.action, old.action) ||
        old.action.parameters_hash !== old.action.parameters_ref.sha256 ||
        a.state !== "APPROVED" ||
        next.state !== "CONSUMED" ||
        next.consumed_at !== result.applied_at ||
        r.effect !== "APPLIED" ||
        !a.expires_at ||
        Date.parse(a.expires_at) <= Date.parse(txn.committed_at)
      )
        throw Error("SCOPE_GRANT_NOT_ATOMIC");
      const params = store.read<ScopeImportParameters>(r.action.parameters_ref);
      const actual = staged.find((v) => v.record_type === "Scope");
      const scopeID = importScopeID(r.id);
      if (
        staged.length !== 4 ||
        !actual ||
        actual.id !== scopeID ||
        actual.revision !== 1 ||
        store.find("Scope", scopeID) ||
        result.status !== "SUCCEEDED" ||
        result.operation_id !== r.id ||
        result.scope_id !== scopeID ||
        result.actor !== "HOST" ||
        (!replay &&
          !equal(actual, importedScope(r, params, result.applied_at))) ||
        (!replay &&
          !equal(result, {
            status: "SUCCEEDED",
            operation_id: r.id,
            scope_id: scopeID,
            applied_at: actual.updated_at,
            actor: "HOST",
          })) ||
        !hasEvent("operation.journal_applied", r, r) ||
        !hasEvent(
          "scope.imported",
          {
            scope: actual,
            operation_id: r.id,
            source_event_ids: params.source_event_ids,
          },
          r,
        )
      )
        throw Error("SCOPE_APPLY_BUNDLE_REQUIRED");
      if (!replay) checkImport(store, params, old);
    } else {
      if (
        staged.length !== 3 ||
        !["WAIT_AUTH", "AUTHORIZED"].includes(old.state) ||
        !["PENDING", "APPROVED"].includes(a.state) ||
        !["REVOKED", "EXPIRED"].includes(next.state) ||
        next.consumed_at !== a.consumed_at ||
        r.effect !== "NOT_STARTED" ||
        !r.error ||
        (next.state === "EXPIRED" &&
          (!a.expires_at ||
            Date.parse(a.expires_at) > Date.parse(txn.committed_at))) ||
        result.operation_id !== r.id ||
        result.actor !== "HOST" ||
        result.status !== (next.state === "EXPIRED" ? "EXPIRED" : "FAILED") ||
        (!replay &&
          !equal(result, {
            status: next.state === "EXPIRED" ? "EXPIRED" : "FAILED",
            operation_id: r.id,
            reason: r.error,
            actor: "HOST",
          })) ||
        !hasEvent("scope.import_failed", result, r)
      )
        throw Error("SCOPE_FAILURE_NOT_ATOMIC");
    }
  }
  // Notification-only repairs must reference a terminal import and its actual result.
  for (const input of staged) {
    if (
      input.record_type !== "Input" ||
      input.producer !== "ENVIRONMENT" ||
      !input.dedupe_key.startsWith("scope-import-result:") ||
      store.find("Input", input.id)
    )
      continue;
    const opID = input.dedupe_key.slice("scope-import-result:".length);
    const op =
      staged.find(
        (v): v is Operation => v.record_type === "Operation" && v.id === opID,
      ) ?? store.find<Operation>("Operation", opID);
    if (
      !op ||
      op.action.action !== "scope.import" ||
      !["SUCCEEDED", "CANCELLED"].includes(op.state)
    )
      throw Error("SCOPE_RESULT_WITHOUT_TERMINAL");
    const grant = store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      op.authorization_id!,
    );
    const result = op.receipt
      ? store.read(op.receipt)
      : {
          status: grant.state,
          reason: op.error ?? "Owner " + grant.state.toLowerCase(),
          actor: grant.decided_by ?? "HOST",
        };
    if (
      !validNotice(input, op, result) ||
      !hasEvent("input.accepted", input, op)
    )
      throw Error("SCOPE_RESULT_MISMATCH");
  }
}
