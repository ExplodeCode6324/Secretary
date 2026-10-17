import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ConditionResult,
  Execution,
  Input,
  Operation,
  Session,
  TaskPlan,
  TaskProposal,
} from "./contracts.ts";
import { terminal } from "./execution-utils.ts";
import type { SchedulerContext } from "./scheduler-context.ts";
import { base, hash, now, revise, type Stored } from "./store.ts";

type TaskTriggersContext = Pick<
  SchedulerContext,
  | "assertAccess"
  | "cancel"
  | "closed"
  | "conditions"
  | "finish"
  | "initialize"
  | "processCheckAt"
  | "processWork"
  | "proposalFor"
  | "ready"
  | "recoverProcesses"
  | "removePending"
  | "reportMissed"
  | "requestStatus"
  | "run"
  | "running"
  | "safePath"
  | "scopes"
  | "setState"
  | "settingsBlocked"
  | "store"
  | "validateWorkspace"
  | "workspace"
>;

export function removePending(
  this: TaskTriggersContext,
  taskID: string,
  requestID: string,
  reason: string,
  executionID?: string,
) {
  const p = this.store.get<TaskPlan>("TaskPlan", taskID);
  const item = p.pending_requests?.find((r) => r.request_id === requestID);
  if (!item) return;
  // Parent association is also recoverable from pending_followup_ids when an object is damaged.
  const records: Stored[] = [
    revise(p, {
      pending_requests: p.pending_requests!.filter(
        (r) => r.request_id !== requestID,
      ),
    }),
  ];
  for (const parent of this.store
    .all<Execution>("Execution")
    .filter(
      (e) =>
        e.pending_followup_ids.includes(requestID) ||
        (p.trigger.kind === "IMMEDIATE" &&
          e.pending_followup_ids.includes(taskID)),
    )) {
    const ids = parent.pending_followup_ids.filter(
      (v) => v !== requestID && v !== taskID,
    );
    if (
      executionID &&
      !terminal(this.store.get<Execution>("Execution", executionID))
    )
      ids.push(executionID);
    records.push(
      revise(parent, {
        pending_followup_ids: [...new Set(ids)],
        last_activity_at: now(),
      }),
    );
  }
  this.store.commit(records, [
    this.store.event("task.request.removed", {
      request_id: requestID,
      task_id: taskID,
      reason,
    }),
  ]);
}

export function cancelRequest(
  this: TaskTriggersContext,
  requestID: string,
  sessionID: string,
) {
  const status = this.requestStatus(requestID);
  if (!status) throw Error("REQUEST_NOT_FOUND");
  if (!status.occurrence_key) throw Error("REQUEST_NOT_IMMEDIATE");
  const p = this.store.get<TaskPlan>("TaskPlan", status.task_id);
  this.assertAccess(p, sessionID);
  if (status.execution_id) {
    this.cancel(status.execution_id);
    return;
  }
  this.removePending(p.id, requestID, "MASTER_CANCELLED");
}

export function initialize(this: TaskTriggersContext, taskID: string) {
  const p = this.store.get<TaskPlan>("TaskPlan", taskID);
  if (!["INITIALIZING", "INIT_FAILED"].includes(p.state)) return;
  try {
    const dir = path.join(this.workspace, taskID);
    if (!p.scope_id || this.scopes.get(p.scope_id).kind !== "DIRECTORY")
      fs.mkdirSync(path.join(dir, "work"), { recursive: true });
    fs.mkdirSync(path.join(dir, "executions"), { recursive: true });
    const manifest = path.join(dir, "workspace.json");
    if (
      fs.existsSync(manifest) &&
      JSON.parse(fs.readFileSync(manifest, "utf8")).task_id !== taskID
    )
      throw Error("WORKSPACE_OWNER");
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        schema_version: 1,
        task_id: taskID,
        created_at: now(),
      }),
    );
    const fd = fs.openSync(manifest, "r");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    this.store.commit(
      [revise(p, { state: "ACTIVE", initialization_error: null })],
      [this.store.event("task.initialized", { task_id: taskID })],
    );
  } catch (error) {
    this.store.commit([
      revise(p, {
        state: "INIT_FAILED",
        initialization_error: String(error),
      }),
    ]);
  }
}

export function reportMissed(
  this: TaskTriggersContext,
  plan: TaskPlan,
  due: string,
) {
  const event = this.store.event("trigger.missed", {
    task_id: plan.id,
    due,
    policy: "REPORT_ONLY",
  });
  const session = this.store.all<Session>("Session")[0];
  if (!session) {
    this.store.commit([plan], [event]);
    return;
  }
  const text =
    "Missed scheduled trigger: " + this.store.bytes(event.payload).toString();
  const input: Input = {
    ...base(),
    record_type: "Input",
    schema_version: 1,
    session_id: session.id,
    dedupe_key: event.event_id,
    producer: "SCHEDULER",
    state: "ACCEPTED",
    payload: this.store.put(text, "text/plain"),
    loop_id: null,
    received_at: now(),
    feedback_id: null,
  };
  this.store.commit(
    [plan, input],
    [
      event,
      this.store.event(
        "input.accepted",
        input,
        { session_id: session.id, task_id: null, execution_id: null },
        "SCHEDULER",
      ),
    ],
    {
      request: event.event_id,
      hash: hash(JSON.stringify({ text, producer: "SCHEDULER" })),
      value: input.id,
    },
  );
}

export function tick(this: TaskTriggersContext, at = Date.now()) {
  if (this.settingsBlocked()) return;
  if (this.closed) return;
  if (!this.processWork && at >= this.processCheckAt) {
    this.processCheckAt = at + 5000;
    if (
      this.store
        .indexed<Operation>(
          "Operation",
          "process.state",
          [undefined, "STOPPED"],
          true,
        )
        .some(
          (o) =>
            o.process &&
            o.process.state !== "STOPPED" &&
            !this.running.has(o.scope.execution_id ?? ""),
        )
    ) {
      this.processWork = this.recoverProcesses().finally(() => {
        this.processWork = undefined;
      });
    }
  }
  const plans = new Map(
    this.store
      .indexed<TaskPlan>("TaskPlan", "state", ["CLOSED"], true)
      .map((p) => [p.id, p]),
  );
  for (const p of this.store.indexed<TaskPlan>(
    "TaskPlan",
    "pending_requests.length",
    [undefined, 0],
    true,
  ))
    plans.set(p.id, p);
  for (let p of plans.values()) {
    // Repair duplicate queue representations before busy checks, including active executions.
    for (const item of p.pending_requests ?? []) {
      const existing = this.store
        .indexed<Execution>("Execution", "task_occurrence", [
          JSON.stringify([p.id, item.occurrence_key]),
        ])
        .find(
          (e) => e.task_id === p.id && e.occurrence_key === item.occurrence_key,
        );
      if (existing)
        this.removePending(p.id, item.request_id, "consumed", existing.id);
    }
    p = this.store.get<TaskPlan>("TaskPlan", p.id);
    if (p.state === "CLOSED") {
      for (const item of p.pending_requests ?? [])
        this.removePending(p.id, item.request_id, "PLAN_UNAVAILABLE");
      continue;
    }
    if (p.state === "INITIALIZING" || p.state === "INIT_FAILED") {
      this.initialize(p.id);
      continue;
    }
    const request = p.pending_requests?.[0];
    if (
      p.state !== "ACTIVE" ||
      (!request &&
        !p.pending_occurrences.length &&
        (!p.next_due_at || Date.parse(p.next_due_at) > at)) ||
      (request && Date.parse(request.due_at) > at)
    )
      continue;
    if (
      this.store
        .indexed<Execution>(
          "Execution",
          "state",
          ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"],
          true,
        )
        .some((e) => e.task_id === p.id)
    ) {
      if (
        p.trigger.kind === "INTERVAL" &&
        p.next_due_at &&
        Date.parse(p.next_due_at) <= at &&
        p.trigger.overlap_policy === "QUEUE"
      ) {
        this.store.commit([
          revise(p, {
            pending_occurrences: [
              ...new Set([...p.pending_occurrences, p.next_due_at]),
            ],
            next_due_at: new Date(
              Date.parse(p.next_due_at) + p.trigger.interval_seconds! * 1000,
            ).toISOString(),
          }),
        ]);
      }
      continue;
    }
    const queued = !request && p.pending_occurrences.length > 0;
    const due =
      request?.due_at ?? (queued ? p.pending_occurrences[0] : p.next_due_at!);
    const key =
      request?.occurrence_key ??
      (p.trigger.kind === "IMMEDIATE" ? "once" : due);
    if (
      this.store.indexed<Execution>("Execution", "task_occurrence", [
        JSON.stringify([p.id, key]),
      ]).length
    ) {
      this.store.commit([
        revise(p, {
          pending_occurrences: queued
            ? p.pending_occurrences.slice(1)
            : p.pending_occurrences,
          next_due_at: queued
            ? p.next_due_at
            : p.trigger.kind === "INTERVAL"
              ? new Date(
                  Date.parse(due) + p.trigger.interval_seconds! * 1000,
                ).toISOString()
              : null,
        }),
      ]);
      continue;
    }
    // Do not silently catch up missed periodic windows after restart.
    if (
      !request &&
      !queued &&
      p.trigger.kind === "INTERVAL" &&
      at - Date.parse(due) > (p.trigger.interval_seconds ?? 0) * 1000
    ) {
      const nextDue = new Date(
        Date.parse(due) +
          (Math.floor(
            (at - Date.parse(due)) / ((p.trigger.interval_seconds ?? 1) * 1000),
          ) +
            1) *
            (p.trigger.interval_seconds ?? 1) *
            1000,
      ).toISOString();
      this.reportMissed(revise(p, { next_due_at: nextDue }), due);
      continue;
    }
    const proposalRef = request?.proposal_ref ?? p.proposal_ref;
    let proposal: TaskProposal;
    try {
      proposal = this.store.read<TaskProposal>(proposalRef);
      if (proposal.reuse_task_id) this.validateWorkspace(p);
      for (const ref of proposal.context_refs) this.store.bytes(ref);
    } catch (error) {
      if (!request) throw error;
      this.removePending(p.id, request.request_id, String(error));
      continue;
    }
    const e: Execution = {
      schema_version: 1,
      record_type: "Execution",
      ...base(),
      scope_id: p.scope_id ?? null,
      workspace_binding: this.scopes.binding(
        p.scope_id ?? null,
        path.join(this.workspace, p.id, "work"),
      ),
      task_id: p.id,
      state: "CREATED",
      retention_state: "HOT",
      occurrence_key: key,
      plan_revision: p.revision,
      proposal_ref: proposalRef,
      attempt_id: null,
      owner_epoch: this.store.epoch,
      waiting_request_ids: [],
      condition_results: [],
      continuation_of: proposal.parent_execution_id,
      pending_followup_ids: [],
      cancel_requested: false,
      started_at: null,
      ended_at: null,
      last_activity_at: now(),
      retire_after_seconds: 172800,
      result_id: null,
      checkpoint_id: null,
      unknown_operation_ids: [],
    };
    const records: Stored[] = [
      e,
      revise(p, {
        active_execution_ids: [...p.active_execution_ids, e.id],
        pending_requests: request
          ? (p.pending_requests ?? []).filter(
              (r) => r.request_id !== request.request_id,
            )
          : p.pending_requests,
        pending_occurrences: queued
          ? p.pending_occurrences.slice(1)
          : p.pending_occurrences,
        next_due_at: request
          ? p.next_due_at
          : queued
            ? p.next_due_at
            : p.trigger.kind === "INTERVAL"
              ? new Date(
                  Date.parse(due) + (p.trigger.interval_seconds ?? 1) * 1000,
                ).toISOString()
              : null,
      }),
    ];
    if (e.continuation_of) {
      const prev = this.store.get<Execution>("Execution", e.continuation_of);
      records.push(
        revise(prev, {
          pending_followup_ids: [
            ...prev.pending_followup_ids.filter(
              (v) =>
                v !== (proposal.reuse_task_id ? request!.request_id : p.id),
            ),
            e.id,
          ],
          last_activity_at: now(),
        }),
      );
    }
    this.store.commit(records);
    this.setState(e.id, "WAIT_PRECONDITION");
    this.ready(e.id);
  }
  for (let e of this.store.indexed<Execution>(
    "Execution",
    "state",
    ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"],
    true,
  )) {
    const plan = this.proposalFor(e);
    if (e.state === "CREATED") {
      this.setState(e.id, "WAIT_PRECONDITION");
      this.ready(e.id);
      continue;
    }
    if (plan.deadline && Date.parse(plan.deadline) <= at && !terminal(e)) {
      if (this.running.has(e.id)) this.cancel(e.id);
      else if (e.state !== "RESULT_UNKNOWN")
        this.finish(e.id, "EXPIRED", { reason: "Explicit deadline passed" });
      continue;
    }
    if (e.state === "WAIT_PRECONDITION") {
      this.ready(e.id);
      e = this.store.get<Execution>("Execution", e.id);
    }
    if (e.state === "READY" || e.state === "WAIT_AUTH") void this.run(e.id);
  }
}

export function ready(this: TaskTriggersContext, eid: string) {
  const e = this.store.get<Execution>("Execution", eid),
    p = this.store.get<TaskPlan>("TaskPlan", e.task_id);
  const checks = this.conditions(e);
  this.store.commit([
    revise(e, {
      condition_results: checks,
      state: checks.every((c) => c.status === "MET")
        ? "READY"
        : "WAIT_PRECONDITION",
    }),
  ]);
}

export function conditions(
  this: TaskTriggersContext,
  e: Execution,
): ConditionResult[] {
  const p = this.store.get<TaskPlan>("TaskPlan", e.task_id);
  return this.proposalFor(e).preconditions.map((c) => {
    let met = false;
    try {
      if (c.kind === "EXECUTION_SUCCEEDED")
        met =
          this.store.get<Execution>("Execution", c.target).state ===
          "SUCCEEDED";
      else if (c.kind === "RESOURCE_PRESENT")
        met = fs.existsSync(this.safePath(e, c.target));
      else if (c.kind === "DEVICE_AVAILABLE") met = c.target === "local";
    } catch {}
    return {
      condition_id: c.condition_id,
      status: met ? "MET" : "NOT_MET",
      checked_at: now(),
      evidence: [],
      reason: met ? null : "Registered precondition not met",
    };
  });
}
