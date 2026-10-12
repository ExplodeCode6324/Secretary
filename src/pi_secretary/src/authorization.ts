import fs from "node:fs";
import path from "node:path";
import { Scopes, relativePath } from "./scopes.ts";
import {
  readonlyShell,
  simpleCommand,
  type ShellExecution,
} from "./shell-policy.ts";
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
    expectedResourceRevision: string | null = null,
  ): Operation {
    const ref = this.store.put(params);
    let retryOf: string | null = null;
    let existing = this.store
      .all<Operation>("Operation")
      .find((o) => o.action.intent_id === intent);
    while (existing) {
      if (
        (existing.action.parameters_hash !== ref.sha256 &&
          !(
            action === "shell.run" &&
            retryable(existing) &&
            sameShellInput(
              this.store.read(existing.action.parameters_ref),
              params,
            )
          )) ||
        existing.action.action !== action ||
        existing.action.resource !== resource
      )
        throw Error("INTENT_CONFLICT");
      if (!retryable(existing)) return existing;
      retryOf = existing.id;
      intent = idForRetry(intent, existing.id);
      existing = this.store
        .all<Operation>("Operation")
        .find((o) => o.action.intent_id === intent);
    }
    if (
      this.store
        .all<Operation>("Operation")
        .some(
          (o) =>
            o.state === "RESULT_UNKNOWN" &&
            (["shell.run", "program.run"].includes(action) && scope.execution_id
              ? ["shell.run", "program.run"].includes(o.action.action) &&
                o.scope.execution_id === scope.execution_id
              : o.action.action === action && o.action.resource === resource),
        )
    )
      throw Error(
        "RELATED_EFFECT_UNKNOWN: verify before creating another operation",
      );
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
        expected_resource_revision: expectedResourceRevision,
        intent_id: intent,
      },
      authorization_id: null,
      rule_id: null,
      rule_revision: null,
      owner_epoch: this.store.epoch,
      attempt_id: scope.execution_id
        ? this.store.get<Execution>("Execution", scope.execution_id).attempt_id
        : null,
      retry_of: retryOf,
      receipt: null,
      effect: "NOT_STARTED",
      error: null,
    };
    const prepared = this.store.event("operation.prepared", op, scope);
    const rule = this.match(op);
    if (rule) {
      const ready: Operation = {
        ...op,
        state: "AUTHORIZED",
        rule_id: rule.id,
        rule_revision: rule.revision,
      };
      this.store.commit([ready], [prepared]);
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
    const waiting: Operation = {
      ...op,
      state: "WAIT_AUTH",
      authorization_id: auth.id,
    };
    this.store.commit(
      [waiting, auth],
      [prepared, this.store.event("authorization.requested", auth, scope)],
    );
    return waiting;
  }
  root(op: Operation) {
    if (!op.scope.execution_id) throw Error("EXECUTION_REQUIRED");
    const e = this.store.get<Execution>("Execution", op.scope.execution_id);
    return new Scopes(this.store).rootFor(
      e,
      path.join(this.store.dir, "workspaces", e.task_id, "work"),
    );
  }
  private createRule(
    action: string,
    resource: string,
    constraints: unknown,
    expiresAt: string | null = null,
    validFrom = now(),
  ) {
    if (
      !["file.write", "shell.run", "program.run", "world.change"].includes(
        action,
      )
    )
      throw Error("UNREGISTERED_ACTION");
    if (
      !Number.isFinite(Date.parse(validFrom)) ||
      (expiresAt !== null &&
        (!Number.isFinite(Date.parse(expiresAt)) ||
          Date.parse(expiresAt) <= Math.max(Date.now(), Date.parse(validFrom))))
    )
      throw Error("INVALID_RULE_TIME");
    const c = constraints as RuleConstraints;
    if (!c || !this.validConstraints(action, c))
      throw Error("INVALID_RULE_CONSTRAINTS");
    if (
      ["file-prefix", "command-prefix"].includes(c.kind ?? "") &&
      !path.isAbsolute(resource)
    )
      throw Error("INVALID_PATH");
    const r: AuthorizationRule = {
      schema_version: 1,
      record_type: "AuthorizationRule",
      ...base(),
      state: "ENABLED",
      actions: [action],
      resource_prefixes: [resource],
      parameter_constraints: this.store.put(c),
      valid_from: validFrom,
      expires_at: expiresAt,
      created_by: "MASTER_UI",
      confirmation_ref: this.store.put({
        action,
        resource,
        constraints: c,
        confirmed_at: now(),
      }),
    };
    return r;
  }
  private validConstraints(action: string, c: RuleConstraints) {
    if (!c || typeof c !== "object" || Array.isArray(c)) return false;
    if (
      Object.keys(c).length === 1 &&
      typeof c.parameter_hash === "string" &&
      /^[a-f0-9]{64}$/.test(c.parameter_hash)
    )
      return true;
    if (action === "file.write" && c.kind === "file-prefix")
      return Object.keys(c).length === 1;
    if (action === "shell.run" && c.kind === "command-prefix")
      return (
        Object.keys(c).length === 2 &&
        Array.isArray(c.command_prefix) &&
        c.command_prefix.length > 0 &&
        c.command_prefix.every((t) => typeof t === "string" && t.length > 0)
      );
    return (
      action === "program.run" &&
      c.kind === "program" &&
      typeof c.program_id === "string" &&
      Object.keys(c).length === 2
    );
  }
  rule(
    action: string,
    resource: string,
    parameters: unknown,
    constraints?: unknown,
    expiresAt: string | null = null,
    validFrom?: string,
  ) {
    const r = this.createRule(
      action,
      resource,
      constraints ?? { parameter_hash: this.store.put(parameters).sha256 },
      expiresAt,
      validFrom,
    );
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
  private matches(r: AuthorizationRule, op: Operation) {
    if (
      r.state !== "ENABLED" ||
      !r.actions.includes(op.action.action) ||
      Date.parse(r.valid_from) > Date.now() ||
      (r.expires_at && Date.parse(r.expires_at) <= Date.now()) ||
      !r.resource_prefixes.some(
        (p) =>
          op.action.resource === p ||
          op.action.resource.startsWith(p.endsWith("/") ? p : p + "/"),
      )
    )
      return false;
    const c = this.store.read<RuleConstraints>(r.parameter_constraints);
    if (!this.validConstraints(op.action.action, c)) return false;
    if (c.parameter_hash) return c.parameter_hash === op.action.parameters_hash;
    const params = this.store.read<{
      command?: string;
      program_id?: string;
      cwd?: string;
    }>(op.action.parameters_ref);
    if (c.kind === "file-prefix") return true;
    if (c.kind === "program") return c.program_id === params.program_id;
    const argv = simpleCommand(params.command ?? "", true);
    return (
      !!argv &&
      params.cwd === op.action.resource &&
      c.command_prefix!.every((t, i) => argv[i] === t)
    );
  }
  builtin(op: Operation): { id: string; revision: number } | undefined {
    try {
      const root = this.root(op);
      const params = this.store.read<{
        path?: string;
        command?: string;
        cwd?: string;
        execution?: ShellExecution;
      }>(op.action.parameters_ref);
      if (
        op.action.action === "file.write" &&
        params.path &&
        relativePath(root, params.path) === op.action.resource
      ) {
        const e = this.store.get<Execution>(
          "Execution",
          op.scope.execution_id!,
        );
        const scope = e.scope_id
          ? new Scopes(this.store).get(e.scope_id)
          : null;
        if (
          e.workspace_binding?.kind !== "DIRECTORY" ||
          (scope?.default_write ?? "allow") === "allow"
        )
          return { id: "builtin:workspace-write", revision: 1 };
      }
      if (
        op.action.action === "shell.run" &&
        params.cwd === root &&
        op.action.resource === root &&
        params.execution
      ) {
        const execution = readonlyShell(root, params.command ?? "");
        if (
          execution &&
          JSON.stringify(execution) === JSON.stringify(params.execution)
        )
          return { id: "builtin:readonly-shell", revision: 1 };
      }
    } catch {
      /* Unsafe or missing execution roots cannot grant permission. */
    }
  }
  private match(op: Operation) {
    return (
      this.store
        .all<AuthorizationRule>("AuthorizationRule")
        .sort((a, b) => a.id.localeCompare(b.id))
        .find((r) => this.matches(r, op)) ?? this.builtin(op)
    );
  }
  shellParameters(
    scope: Scope,
    command: string,
    timeout: number,
    cwd: string,
    intent?: string,
  ) {
    let prior = intent
      ? this.store
          .all<Operation>("Operation")
          .find((o) => o.action.intent_id === intent)
      : undefined;
    if (prior) {
      for (;;) {
        const successor = this.store
          .all<Operation>("Operation")
          .find((o) => o.retry_of === prior!.id);
        if (!successor) break;
        prior = successor;
      }
      const saved = this.store.read<{
        command: string;
        timeout: number;
        cwd: string;
        execution?: ShellExecution;
      }>(prior.action.parameters_ref);
      if (
        saved.command !== command ||
        saved.cwd !== cwd ||
        saved.timeout !== timeout
      )
        throw Error("INTENT_CONFLICT");
      if (!retryable(prior)) return saved;
    }
    const params = { command, timeout, cwd };
    // User rules retain the shell execution semantics used for a one-shot grant.
    const ref = this.store.put(params);
    const probe = {
      action: {
        action: "shell.run",
        resource: cwd,
        parameters_ref: ref,
        parameters_hash: ref.sha256,
      },
      scope,
    } as Operation;
    if (
      this.store
        .all<AuthorizationRule>("AuthorizationRule")
        .some((r) => this.matches(r, probe))
    )
      return params;
    const execution = readonlyShell(cwd, command);
    return execution ? { ...params, execution } : params;
  }
  remember(op: Operation, value: NonNullable<ApprovalCommand["remember"]>) {
    const root = this.root(op);
    const params = this.store.read<{ command?: string; path?: string }>(
      op.action.parameters_ref,
    );
    if (op.action.action === "shell.run" && "prefix_tokens" in value) {
      const tokens = simpleCommand(params.command ?? "", true);
      if (
        !tokens ||
        !Number.isInteger(value.prefix_tokens) ||
        value.prefix_tokens < 1 ||
        value.prefix_tokens > tokens.length
      )
        throw Error("INVALID_REMEMBER");
      return this.createRule(
        "shell.run",
        root,
        {
          kind: "command-prefix",
          command_prefix: tokens.slice(0, value.prefix_tokens),
        },
        value.expires_at,
      );
    }
    if (
      op.action.action === "file.write" &&
      "path_prefix" in value &&
      params.path
    ) {
      const directory = relativePath(root, value.path_prefix, true);
      const target = relativePath(root, params.path);
      if (fs.existsSync(directory) && !fs.statSync(directory).isDirectory())
        throw Error("INVALID_REMEMBER");
      if (
        target !== op.action.resource ||
        !target.startsWith(directory + path.sep)
      )
        throw Error("INVALID_REMEMBER");
      return this.createRule(
        "file.write",
        directory,
        { kind: "file-prefix" },
        value.expires_at,
      );
    }
    throw Error("INVALID_REMEMBER");
  }
  rememberContext(op: Operation) {
    if (
      !op.scope.execution_id ||
      !["file.write", "shell.run"].includes(op.action.action)
    )
      return null;
    try {
      const params = this.store.read<{ command?: string; path?: string }>(
        op.action.parameters_ref,
      );
      return {
        root: this.root(op),
        action: op.action.action,
        path: params.path ?? null,
        tokens: params.command ? simpleCommand(params.command, true) : null,
      };
    } catch {
      return null;
    }
  }
  rulesView() {
    const dispatches = new Map<
      string,
      { rule_id: string | null; time: string }
    >();
    for (const event of this.store.logs) {
      if (event.event_type !== "operation.dispatched") continue;
      const op = this.store.read<Operation>(event.payload);
      if (!dispatches.has(op.id))
        dispatches.set(op.id, { rule_id: op.rule_id, time: event.occurred_at });
    }
    const stats = (id: string) => {
      const matched = [...dispatches.values()].filter((o) => o.rule_id === id);
      return {
        match_count: matched.length,
        last_matched_at:
          matched
            .map((o) => o.time)
            .sort()
            .at(-1) ?? null,
      };
    };
    return {
      items: this.store
        .all<AuthorizationRule>("AuthorizationRule")
        .map((r) => ({
          ...r,
          constraints: this.store.read(r.parameter_constraints),
          ...stats(r.id),
        })),
      builtin_policies: [
        "builtin:workspace-write",
        "builtin:readonly-shell",
      ].map((id) => ({
        id,
        revision: 1,
        ...stats(id),
        description: id.endsWith("workspace-write")
          ? "Execution root writes; DIRECTORY default_write=ask disables this policy only"
          : "Fixed simple command and option allowlist; direct argv; execution root paths",
      })),
    };
  }
  // Called only by the independently authenticated UI route, never registered as an Agent tool.
  decide(cmd: ApprovalCommand) {
    shape(cmd);
    if (cmd.remember && cmd.decision !== "APPROVE")
      throw Error("INVALID_REMEMBER");
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
    const op = this.store.get<Operation>("Operation", a.operation_id);
    const remembered = cmd.remember ? this.remember(op, cmd.remember) : null;
    const updated = revise(a, {
      ...(remembered ? { remembered_rule_id: remembered.id } : {}),
      state: next(
        "Authorization",
        a.state,
        event,
      ) as AuthorizationRequest["state"],
      decision_id: cmd.request_id,
      decided_at: now(),
      decided_by: "MASTER_UI",
    });
    const changed = revise(op, {
      state: cmd.decision === "APPROVE" ? "AUTHORIZED" : "CANCELLED",
    });
    this.store.commit(
      [updated, changed, ...(remembered ? [remembered] : [])],
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
    if (op.owner_epoch !== this.store.epoch) throw Error("STALE_OWNER");
    if (op.scope.execution_id) {
      const execution = this.store.get<Execution>(
        "Execution",
        op.scope.execution_id,
      );
      if (op.attempt_id !== execution.attempt_id) throw Error("STALE_ATTEMPT");
      if (
        execution.cancel_requested ||
        !["RUNNING", "READY", "WAIT_AUTH", "DISPATCHING"].includes(
          execution.state,
        )
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
      const rule = op.rule_id?.startsWith("builtin:")
        ? this.builtin(op)
        : this.store.find<AuthorizationRule>("AuthorizationRule", op.rule_id!);
      if (
        !rule ||
        rule.id !== op.rule_id ||
        rule.revision !== op.rule_revision ||
        ("actions" in rule && !this.matches(rule as AuthorizationRule, op))
      ) {
        this.store.commit(
          [revise(op, { state: "CANCELLED", error: "RULE_CHANGED" })],
          [
            this.store.event(
              "operation.cancelled",
              { operation_id: op.id, reason: "RULE_CHANGED" },
              op.scope,
            ),
          ],
        );
        throw Error("RULE_CHANGED");
      }
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
  // Only for the same idempotent World batch, after its locked receipt lookup proved no commit.
  resumeWorldDispatch(operationID: string) {
    const op = this.store.get<Operation>("Operation", operationID);
    if (
      op.action.action !== "world.change" ||
      !["DISPATCHED", "RESULT_UNKNOWN"].includes(op.state)
    )
      throw Error("NOT_WORLD_DISPATCH");
    if (op.scope.execution_id) {
      const execution = this.store.get<Execution>(
        "Execution",
        op.scope.execution_id,
      );
      if (
        execution.cancel_requested ||
        execution.attempt_id !== op.attempt_id ||
        !["RUNNING", "READY", "WAIT_AUTH", "DISPATCHING"].includes(
          execution.state,
        )
      )
        throw Error("EXECUTION_NOT_ACTIVE");
    }
    this.store.bytes(op.action.parameters_ref);
    if (op.action.parameters_ref.sha256 !== op.action.parameters_hash)
      throw Error("PARAMETER_CHANGED");
    if (op.authorization_id) {
      const grant = this.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        op.authorization_id,
      );
      if (
        grant.state !== "CONSUMED" ||
        JSON.stringify(grant.action) !== JSON.stringify(op.action) ||
        (grant.expires_at && Date.parse(grant.expires_at) <= Date.now())
      )
        throw Error("GRANT_INVALID");
    } else {
      const rule = this.match(op);
      if (!rule || rule.id !== op.rule_id || rule.revision !== op.rule_revision)
        throw Error("RULE_CHANGED");
    }
    const next = revise(op, {
      state: "DISPATCHED",
      owner_epoch: this.store.epoch,
    });
    this.store.commit(
      [next],
      [
        this.store.event(
          "world.dispatch_reconciled",
          { operation_id: op.id, receipt_absent: true },
          op.scope,
        ),
      ],
    );
    return next;
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
  resolve(
    operationID: string,
    expectedRevision: number,
    outcome: "APPLIED" | "NOT_APPLIED" | "PARTIAL" | "UNVERIFIED",
    note: string,
  ) {
    const op = this.store.get<Operation>("Operation", operationID);
    if (op.revision !== expectedRevision) throw Error("REVISION_CONFLICT");
    if (op.state !== "RESULT_UNKNOWN") throw Error("OPERATION_NOT_UNKNOWN");
    const receipt = this.store.put({
      outcome,
      resolved_by: "MASTER_UI",
      note,
      resolved_at: now(),
      original_receipt: op.receipt,
    });
    const resolved = revise(op, {
      state:
        outcome === "APPLIED" ? ("SUCCEEDED" as const) : ("FAILED" as const),
      effect: outcome === "UNVERIFIED" ? ("UNKNOWN" as const) : outcome,
      receipt,
      ...(!op.process && ["shell.run", "program.run"].includes(op.action.action)
        ? { process: { token: op.id, state: "UNCONFIRMED" as const } }
        : {}),
    });
    this.store.commit(
      [resolved],
      [this.store.event("operation.resolved", resolved, op.scope, "MASTER_UI")],
    );
    return resolved;
  }
  recover() {
    for (const op of this.store.all<Operation>("Operation")) {
      if (
        ["PREPARED", "WAIT_AUTH", "AUTHORIZED"].includes(op.state) &&
        op.effect === "NOT_STARTED"
      ) {
        this.store.commit(
          [revise(op, { owner_epoch: this.store.epoch })],
          [
            this.store.event(
              "operation.owner_rebound",
              {
                operation_id: op.id,
                previous_epoch: op.owner_epoch,
                owner_epoch: this.store.epoch,
              },
              op.scope,
            ),
          ],
        );
      }
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
}

type RuleConstraints = {
  parameter_hash?: string;
  kind?: string;
  command_prefix?: string[];
  program_id?: string;
};
function idForRetry(baseIntent: string, previous: string) {
  const h = hash(baseIntent + ":retry:" + previous);
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-4" +
    h.slice(13, 16) +
    "-8" +
    h.slice(17, 20) +
    "-" +
    h.slice(20, 32)
  );
}

function retryable(op: Operation) {
  return (
    op.state === "CANCELLED" &&
    op.effect === "NOT_STARTED" &&
    op.error === "RULE_CHANGED" &&
    !op.process
  );
}
function sameShellInput(a: unknown, b: unknown) {
  const strip = (v: unknown) => {
    const { execution: _, ...input } = v as Record<string, unknown>;
    return input;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
