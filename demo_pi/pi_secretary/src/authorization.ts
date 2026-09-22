import {
  Store,
  base,
  id,
  now,
  hash,
  revise,
  next,
  shape,
  type Stored,
} from "./store.ts";
import type {
  Operation,
  AuthorizationRequest,
  AuthorizationRule,
  Scope,
  ApprovalCommand,
  Execution,
} from "./contracts.ts";

export class Authorization {
  constructor(readonly store: Store) {}
  prepare(
    scope: Scope,
    action: string,
    resource: string,
    params: unknown,
    intent = id(),
  ): Operation {
    if (
      this.store
        .all<Operation>("Operation")
        .some(
          (o) =>
            o.state === "RESULT_UNKNOWN" &&
            o.action.action === action &&
            o.action.resource === resource,
        )
    )
      throw Error(
        "RELATED_EFFECT_UNKNOWN: verify before creating another operation",
      );
    const ref = this.store.put(params);
    const existing = this.store
      .all<Operation>("Operation")
      .find((o) => o.action.intent_id === intent);
    if (existing) {
      if (
        existing.action.parameters_hash !== ref.sha256 ||
        existing.action.action !== action ||
        existing.action.resource !== resource
      )
        throw Error("INTENT_CONFLICT");
      return existing;
    }
    const op: Operation = {
      schema_version: 1,
      record_type: "Operation",
      ...base(),
      scope,
      state: "PREPARED",
      action: {
        action,
        resource,
        parameters_ref: ref,
        parameters_hash: ref.sha256,
        expected_resource_revision: null,
        intent_id: intent,
      },
      authorization_id: null,
      rule_id: null,
      rule_revision: null,
      owner_epoch: this.store.epoch,
      attempt_id: null,
      retry_of: null,
      receipt: null,
      effect: "NOT_STARTED",
      error: null,
    };
    this.store.commit(
      [op],
      [this.store.event("operation.prepared", op, scope)],
    );
    const rule = this.match(op);
    if (rule) {
      const ready = revise(op, {
        state: "AUTHORIZED",
        rule_id: rule.id,
        rule_revision: rule.revision,
      });
      this.store.commit([ready]);
      return ready;
    }
    const display = this.store.put({
      scope,
      action: op.action,
      parameters: params,
    });
    const auth: AuthorizationRequest = {
      schema_version: 1,
      record_type: "AuthorizationRequest",
      ...base(),
      state: "PENDING",
      operation_id: op.id,
      action: op.action,
      scope,
      display_ref: display,
      display_hash: display.sha256,
      expires_at: null,
      decision_id: null,
      decided_at: null,
      decided_by: null,
      consumed_at: null,
    };
    const waiting = revise(op, {
      state: "WAIT_AUTH",
      authorization_id: auth.id,
    });
    this.store.commit(
      [waiting, auth],
      [this.store.event("authorization.requested", auth, scope)],
    );
    return waiting;
  }
  rule(action: string, resource: string, parameters: unknown) {
    if (!["file.write", "program.run", "world.change"].includes(action))
      throw Error("UNREGISTERED_ACTION");
    const ref = this.store.put(parameters);
    const r: AuthorizationRule = {
      schema_version: 1,
      record_type: "AuthorizationRule",
      ...base(),
      state: "ENABLED",
      actions: [action],
      resource_prefixes: [resource],
      parameter_constraints: this.store.put({ parameter_hash: ref.sha256 }),
      valid_from: now(),
      expires_at: null,
      created_by: "MASTER_UI",
      confirmation_ref: this.store.put({
        action,
        resource,
        parameters,
        confirmed_at: now(),
      }),
    };
    this.store.commit(
      [r],
      [
        this.store.event(
          "authorization.rule_confirmed",
          r,
          undefined,
          "MASTER_UI",
        ),
      ],
    );
    return r;
  }
  private match(op: Operation) {
    return this.store
      .all<AuthorizationRule>("AuthorizationRule")
      .find(
        (r) =>
          r.state === "ENABLED" &&
          r.actions.includes(op.action.action) &&
          Date.parse(r.valid_from) <= Date.now() &&
          (!r.expires_at || Date.parse(r.expires_at) > Date.now()) &&
          r.resource_prefixes.some(
            (p) =>
              op.action.resource === p ||
              op.action.resource.startsWith(p.endsWith("/") ? p : p + "/"),
          ) &&
          this.store.read<{ parameter_hash?: string }>(r.parameter_constraints)
            .parameter_hash === op.action.parameters_hash,
      );
  }
  // Called only by the independently authenticated UI route, never registered as an Agent tool.
  decide(cmd: ApprovalCommand) {
    shape(cmd);
    const digest = hash(JSON.stringify(cmd));
    const duplicate = this.store.receipt<string>(cmd.request_id, digest);
    if (duplicate)
      return this.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        duplicate,
      );
    const a = this.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      cmd.authorization_id,
    );
    if (
      a.revision !== cmd.expected_revision ||
      a.display_hash !== cmd.display_hash
    )
      throw Error("APPROVAL_CONFLICT");
    if (a.expires_at && Date.parse(a.expires_at) <= Date.now())
      throw Error("APPROVAL_EXPIRED");
    const event =
      cmd.decision === "APPROVE"
        ? "approve"
        : cmd.decision === "REJECT"
          ? "reject"
          : "revoke";
    const updated = revise(a, {
      state: next(
        "Authorization",
        a.state,
        event,
      ) as AuthorizationRequest["state"],
      decision_id: cmd.request_id,
      decided_at: now(),
      decided_by: "MASTER_UI",
    });
    const op = this.store.get<Operation>("Operation", a.operation_id);
    const changed = revise(op, {
      state: cmd.decision === "APPROVE" ? "AUTHORIZED" : "CANCELLED",
    });
    this.store.commit(
      [updated, changed],
      [
        this.store.event(
          "authorization.decided",
          { command: cmd, result: updated },
          a.scope,
          "MASTER_UI",
        ),
      ],
      { request: cmd.request_id, hash: digest, value: a.id },
    );
    return updated;
  }
  dispatch(operationID: string, extra: Stored[] = []): Operation {
    const op = this.store.get<Operation>("Operation", operationID);
    if (op.state !== "AUTHORIZED") throw Error("NOT_AUTHORIZED");
    if (op.scope.execution_id) {
      const execution = this.store.get<Execution>(
        "Execution",
        op.scope.execution_id,
      );
      if (
        execution.cancel_requested ||
        !["RUNNING", "READY", "WAIT_AUTH"].includes(execution.state)
      )
        throw Error("EXECUTION_NOT_ACTIVE");
    }
    this.store.bytes(op.action.parameters_ref);
    if (op.action.parameters_ref.sha256 !== op.action.parameters_hash)
      throw Error("PARAMETER_CHANGED");
    const changes: Stored[] = [];
    if (op.authorization_id) {
      const a = this.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        op.authorization_id,
      );
      if (
        a.state !== "APPROVED" ||
        JSON.stringify(a.action) !== JSON.stringify(op.action) ||
        (a.expires_at && Date.parse(a.expires_at) <= Date.now())
      )
        throw Error("GRANT_INVALID");
      changes.push(revise(a, { state: "CONSUMED", consumed_at: now() }));
    } else {
      const rule = this.match(op);
      if (!rule || rule.id !== op.rule_id || rule.revision !== op.rule_revision)
        throw Error("RULE_CHANGED");
    }
    const dispatched = revise(op, {
      state: "DISPATCHED",
      owner_epoch: this.store.epoch,
    });
    this.store.commit(
      [...extra, ...changes, dispatched],
      [this.store.event("operation.dispatched", dispatched, op.scope)],
    );
    return dispatched;
  }
  finish(
    operationID: string,
    value: unknown,
    effect: Operation["effect"] = "APPLIED",
  ) {
    const o = this.store.get<Operation>("Operation", operationID);
    if (!["DISPATCHED", "RESULT_UNKNOWN"].includes(o.state))
      throw Error("OPERATION_NOT_IN_FLIGHT");
    const receipt = this.store.put(value);
    const state =
      effect === "UNKNOWN"
        ? "RESULT_UNKNOWN"
        : effect === "APPLIED"
          ? "SUCCEEDED"
          : "FAILED";
    const r = revise(o, { state, effect, receipt });
    this.store.commit([r], [this.store.event("operation.result", r, o.scope)]);
    return r;
  }
  recover() {
    for (const op of this.store.all<Operation>("Operation"))
      if (op.state === "DISPATCHED") {
        this.store.commit(
          [
            revise(op, {
              state: "RESULT_UNKNOWN",
              effect: "UNKNOWN",
              error: "Process ended without a durable effect receipt",
            }),
          ],
          [
            this.store.event(
              "operation.unknown",
              { operation_id: op.id },
              op.scope,
            ),
          ],
        );
      }
  }
}
