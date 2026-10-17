import type {
  DecisionRequest,
  Execution,
  Feedback,
  ModelCall,
  Notification,
  Operation,
  TaskPlan,
  TaskResult,
} from "./contracts.ts";
import { scopeOf, stableID, terminal } from "./execution-utils.ts";
import { persistStop, stopProcess } from "./process-control.ts";
import type { SchedulerContext } from "./scheduler-context.ts";
import { processStopped as scopeProcessesStopped } from "./scopes.ts";
import { base, id, now, revise } from "./store.ts";

type ExecutionRecoveryContext = Pick<
  SchedulerContext,
  | "feedback"
  | "finish"
  | "processNotice"
  | "processStopped"
  | "proposalFor"
  | "recoverProcesses"
  | "reportMissed"
  | "running"
  | "setState"
  | "settleUnknownExecution"
  | "stopChild"
  | "store"
>;

export function processStopped(
  this: ExecutionRecoveryContext,
  eid: string,
): boolean {
  return scopeProcessesStopped(this.store, eid);
}

export function settleUnknownExecution(
  this: ExecutionRecoveryContext,
  eid: string,
) {
  const e = this.store.get<Execution>("Execution", eid);
  if (e.state !== "RESULT_UNKNOWN" || this.running.has(eid)) return;
  const operations = this.store
    .indexed<Operation>("Operation", "scope.execution_id", [eid])
    .filter((o) => o.scope.execution_id === eid);
  const unknown = operations
    .filter((o) => o.state === "RESULT_UNKNOWN")
    .map((o) => o.id);
  if (JSON.stringify(unknown) !== JSON.stringify(e.unknown_operation_ids))
    this.store.commit([revise(e, { unknown_operation_ids: unknown })]);
  if (unknown.length || !this.processStopped(eid)) return;
  this.finish(eid, "FAILED", {
    reason:
      "Execution interrupted; results resolved or verified. Continue with a follow-up task.",
    resolutions: operations
      .filter((o) => o.receipt)
      .map((o) => ({
        operation_id: o.id,
        state: o.state,
        effect: o.effect,
        receipt: this.store.read(o.receipt!),
      })),
  });
}

export function processNotice(this: ExecutionRecoveryContext, op: Operation) {
  const key = stableID(op.id + ":process-stop-unconfirmed");
  if (
    this.store
      .all<Notification>("Notification")
      .some((n) => n.delivery_key === key)
  )
    return;
  const proposal = this.proposalFor(
    this.store.get<Execution>("Execution", op.scope.execution_id!),
  );
  this.store.commit([
    {
      schema_version: 1,
      record_type: "Notification",
      ...base(),
      state: "QUEUED",
      session_id: proposal.session_id,
      channel: "local-ui",
      message: this.store.put({
        text: "Execution process stop could not be confirmed; inspect and stop the original process group before continuing.",
        execution_id: op.scope.execution_id,
        operation_id: op.id,
      }),
      delivery_key: key,
      receipt: null,
      requested_at: now(),
    },
  ]);
}

export function answer(
  this: ExecutionRecoveryContext,
  did: string,
  answer: unknown,
  requestID = id(),
  actor: "MAIN" | "MASTER" = "MAIN",
) {
  const d = this.store.get<DecisionRequest>("DecisionRequest", did);
  if (
    answer == null ||
    (typeof answer === "string" && !answer.trim()) ||
    (typeof answer === "object" && !Object.keys(answer).length)
  )
    throw Error("EMPTY_DECISION");
  if (d.answer_request_id === requestID) {
    if (
      JSON.stringify(d.answer) !== JSON.stringify({ value: answer }) ||
      d.answered_by !== actor
    )
      throw Error("REQUEST_CONFLICT");
    return;
  }
  if (d.state !== "OPEN") throw Error("DECISION_NOT_OPEN");
  if (d.deadline && Date.parse(d.deadline) <= Date.now())
    throw Error("DECISION_EXPIRED");
  const e = this.store.get<Execution>("Execution", d.execution_id);
  if (e.state !== "WAIT_DECISION") throw Error("DECISION_STALE");
  this.store.commit(
    [
      revise(d, {
        state: "ANSWERED",
        answer: { value: answer },
        answered_by: actor,
        answer_request_id: requestID,
      }),
      revise(e, { state: "READY", waiting_request_ids: [] }),
    ],
    [this.store.event("decision.answered", { id: did, answer }, scopeOf(e))],
  );
}

export function cancel(this: ExecutionRecoveryContext, eid: string) {
  const e = this.store.get<Execution>("Execution", eid);
  if (terminal(e)) return;
  if (this.running.has(eid)) {
    this.setState(eid, "CANCEL_REQUESTED", { cancel_requested: true });
    this.running.get(eid)?.agent?.abort();
    const child = this.running.get(eid)?.child;
    if (child) this.stopChild(child);
  } else if (e.state === "RESULT_UNKNOWN")
    this.store.commit([revise(e, { cancel_requested: true })]);
  else {
    this.store.commit([revise(e, { cancel_requested: true })]);
    this.finish(eid, "CANCELLED", { reason: "Cancelled before dispatch" });
  }
}

export async function recoverProcesses(
  this: ExecutionRecoveryContext,
  startup = false,
) {
  const executions = new Map<string, Operation[]>();
  for (const op of startup
    ? this.store.all<Operation>("Operation")
    : this.store.indexed<Operation>(
        "Operation",
        "process.state",
        [undefined, "STOPPED"],
        true,
      )) {
    if (
      !op.scope.execution_id ||
      this.running.has(op.scope.execution_id) ||
      !["shell.run", "program.run"].includes(op.action.action)
    )
      continue;
    const operations = executions.get(op.scope.execution_id) ?? [];
    operations.push(op);
    executions.set(op.scope.execution_id, operations);
    if (op.process && op.process.state !== "STOPPED")
      persistStop(this.store, op.id, await stopProcess(op.process));
  }
  // Probe each process first, then reconcile each execution only once.
  for (const [eid, operations] of executions) {
    if (!this.processStopped(eid)) {
      for (const previous of operations) {
        const op = this.store.get<Operation>("Operation", previous.id);
        if (
          op.process
            ? op.process.state !== "STOPPED"
            : ["RESULT_UNKNOWN", "DISPATCHED"].includes(op.state)
        )
          this.processNotice(op);
      }
    } else this.settleUnknownExecution(eid);
  }
}

export async function recover(this: ExecutionRecoveryContext) {
  await this.recoverProcesses(true);
  for (const e of this.store.all<Execution>("Execution")) {
    if (!e.proposal_ref)
      this.store.commit([
        revise(e, {
          proposal_ref: this.store.taskPlanAt(e.task_id, e.plan_revision)
            .proposal_ref,
        }),
      ]);
    if (e.state === "CREATED") this.setState(e.id, "WAIT_PRECONDITION");
  }
  for (const p of this.store.all<TaskPlan>("TaskPlan"))
    if (
      p.state === "ACTIVE" &&
      p.trigger.kind === "AT" &&
      p.next_due_at &&
      Date.parse(p.next_due_at) < Date.now()
    ) {
      this.reportMissed(
        revise(p, { state: "PAUSED", next_due_at: null }),
        p.next_due_at,
      );
    }
  for (const d of this.store.all<DecisionRequest>("DecisionRequest")) {
    if (
      d.state === "OPEN" &&
      this.store.get<Execution>("Execution", d.execution_id).state ===
        "WAIT_DECISION" &&
      !this.store
        .indexed<Feedback>("Feedback", "execution_id", [d.execution_id])
        .some((f) => f.decision_request_id === d.id)
    )
      this.feedback(
        d.execution_id,
        "DECISION_REQUIRED",
        d.question,
        this.store.put(d),
        null,
        d.id,
      );
  }
  for (const e of this.store.all<Execution>("Execution")) {
    if (
      ["RUNNING", "DISPATCHING", "CANCEL_REQUESTED", "RESULT_UNKNOWN"].includes(
        e.state,
      )
    ) {
      const unknown = this.store
        .indexed<Operation>("Operation", "scope.execution_id", [e.id])
        .filter(
          (o) => o.scope.execution_id === e.id && o.state === "RESULT_UNKNOWN",
        )
        .map((o) => o.id);
      const call = this.store
        .indexed<ModelCall>("ModelCall", "scope.execution_id", [e.id])
        .filter((c) => c.scope.execution_id === e.id)
        .at(-1);
      if (
        e.state !== "RESULT_UNKNOWN" &&
        !e.cancel_requested &&
        !unknown.length &&
        this.processStopped(e.id) &&
        this.proposalFor(e).executor.kind === "AGENT" &&
        call?.logical_key
      ) {
        this.setState(e.id, "READY", {
          recovery_call_id: call.id,
          unknown_operation_ids: [],
        });
      } else {
        this.setState(e.id, "RESULT_UNKNOWN", {
          unknown_operation_ids: unknown,
        });
        this.settleUnknownExecution(e.id);
        if (
          this.store.get<Execution>("Execution", e.id).state ===
            "RESULT_UNKNOWN" &&
          !this.store
            .indexed<Feedback>("Feedback", "execution_id", [e.id])
            .some((f) => f.execution_id === e.id && f.kind === "UNKNOWN")
        )
          this.feedback(
            e.id,
            "UNKNOWN",
            "Execution interrupted; verify before resuming",
            this.store.put({ execution_id: e.id, reason: "restart" }),
          );
      }
    }
    if (
      terminal(e) &&
      e.result_id &&
      !this.store
        .indexed<Feedback>("Feedback", "execution_id", [e.id])
        .some((f) => f.result_id === e.result_id)
    ) {
      const r = this.store.get<TaskResult>("TaskResult", e.result_id);
      this.feedback(e.id, "RESULT", r.summary, r.detail_ref, r.id);
    }
  }
}
