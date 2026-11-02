import type {
  Execution,
  FailureAction,
  FailureHandling,
  Feedback,
  Input,
  TaskPlan,
  TaskProposal,
  TaskResult,
} from "./contracts.ts";
import type { FailureDetail } from "./api/contracts.ts";
import { ApiError, canonical, revision } from "./api/protocol.ts";
import { base, hash, revise, type Store } from "./store.ts";
import { stableID, terminal } from "./execution-utils.ts";
import type { Scheduler } from "./scheduler.ts";
import { sourceRefs } from "./task-planning.ts";

export type FailureProposal = {
  goal?: string;
  reuse_task_id?: string | null;
  parent_execution_id?: string | null;
  failure_intent_id?: string | null;
  scope_id?: string | null;
  program_id?: string | null;
  at?: string | null;
  interval_seconds?: number | null;
  materials?: string[] | null;
  constraints?: string[] | null;
  acceptance_criteria?: string[] | null;
  deadline?: string | null;
};
type Target = {
  key: string;
  task: TaskPlan;
  execution?: Execution;
  sequence: number;
};
type ToolOutcome = { accepted: boolean; [key: string]: unknown };
const services = new WeakMap<Store, Failures>();
export function failuresFor(store: Store) {
  let service = services.get(store);
  if (!service) {
    service = new Failures(store);
    services.set(store, service);
  }
  return service;
}
export const executionFailureKey = (id: string) => "EXECUTION:" + id;
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One domain journal, no read-side writes. Shared immutable episode/receipt projection. */
export class Failures {
  private frame = 0;
  private init = new Map<string, number>();
  private states = new Map<string, string>();
  private success = new Map<string, number>();
  private owners = new Map<string, string>();
  private proposals = new Map<string, TaskProposal>();
  private receipts = new Map<
    string,
    { key: string; receipt: NonNullable<FailureHandling["tool_receipt"]> }
  >();
  constructor(readonly store: Store) {
    this.sync();
  }
  private sync() {
    for (; this.frame < this.store.projectionFrames.length; this.frame++) {
      const frame = this.store.projectionFrames[this.frame];
      for (const m of frame.mutations) {
        if (m.object_type === "TaskPlan") {
          const p = this.store.read<TaskPlan>(m.snapshot);
          if (
            p.state === "INIT_FAILED" &&
            this.states.get(p.id) !== "INIT_FAILED"
          )
            this.init.set(p.id, frame.sequence);
          this.states.set(p.id, p.state);
        } else if (m.object_type === "Execution") {
          const e = this.store.read<Execution>(m.snapshot);
          if (e.state === "SUCCEEDED" && !this.success.has(e.id))
            this.success.set(e.id, frame.sequence);
        } else if (m.object_type === "FailureHandling") {
          const f = this.store.read<FailureHandling>(m.snapshot);
          if (f.tool_receipt)
            this.receipts.set(f.tool_receipt.id, {
              key: f.failure_key,
              receipt: f.tool_receipt,
            });
        }
      }
    }
  }
  private proposal(ref: TaskPlan["proposal_ref"]) {
    let p = this.proposals.get(ref.sha256);
    if (!p) {
      p = this.store.read<TaskProposal>(ref);
      this.proposals.set(ref.sha256, p);
    }
    return p;
  }
  private owns(task: TaskPlan, sid: string) {
    let owner = this.owners.get(task.proposal_ref.sha256);
    if (!owner) {
      owner = this.proposal(task.proposal_ref).session_id;
      this.owners.set(task.proposal_ref.sha256, owner);
    }
    if (owner !== sid) throw new ApiError("NOT_FOUND", 404);
  }
  initKey(id: string) {
    this.sync();
    const seq = this.init.get(id);
    return seq ? `TASK_INIT:${id}:${seq}` : null;
  }
  private target(key: string, sid: string): Target {
    this.sync();
    const parts = key.split(":");
    if (parts[0] === "EXECUTION" && parts.length === 2) {
      const execution = this.store.find<Execution>("Execution", parts[1]);
      if (!execution || execution.state !== "FAILED")
        throw new ApiError("NOT_FOUND", 404);
      const task = this.store.get<TaskPlan>("TaskPlan", execution.task_id);
      this.owns(task, sid);
      return {
        key,
        task,
        execution,
        sequence: this.store.firstSequence("Execution", execution.id),
      };
    }
    if (
      parts[0] === "TASK_INIT" &&
      parts.length === 3 &&
      this.initKey(parts[1]) === key
    ) {
      const task = this.store.get<TaskPlan>("TaskPlan", parts[1]);
      this.owns(task, sid);
      return { key, task, sequence: Number(parts[2]) };
    }
    throw new ApiError("NOT_FOUND", 404);
  }
  private record(key: string) {
    return this.store.find<FailureHandling>(
      "FailureHandling",
      stableID("failure:" + key),
    );
  }
  private requirements(p: TaskProposal) {
    return hash(
      canonical({
        goal: p.goal,
        constraints: p.constraints,
        acceptance: p.acceptance_criteria,
        preconditions: p.preconditions,
        deadline: p.deadline,
        executor: p.executor,
        sources: [
          ...new Map(
            sourceRefs.call({ store: this.store }, p).map((r) => [r.sha256, r]),
          ).values(),
        ],
        scope_id: p.scope_id ?? null,
        safety: p.safety_rule_id,
      }),
    );
  }
  private linked(f: FailureHandling | undefined) {
    if (!f?.linked_request_id) return undefined;
    return this.store.indexed<Execution>("Execution", "task_occurrence", [
      JSON.stringify([f.task_id, f.linked_request_id]),
    ])[0];
  }
  private successfulSequence(
    f: FailureHandling | undefined,
    e: Execution | undefined,
  ) {
    if (
      !f ||
      !e ||
      e.state !== "SUCCEEDED" ||
      !e.result_id ||
      !e.proposal_ref ||
      e.continuation_of !== f.execution_id
    )
      return null;
    const r = this.store.find<TaskResult>("TaskResult", e.result_id);
    if (
      !r ||
      r.outcome !== "SUCCEEDED" ||
      r.execution_id !== e.id ||
      r.task_id !== f.task_id
    )
      return null;
    try {
      const p = this.proposal(e.proposal_ref);
      if (
        p.request_id !== f.linked_request_id ||
        p.parent_execution_id !== f.execution_id ||
        p.reuse_task_id !== f.task_id ||
        this.requirements(p) !== f.requirements_digest
      )
        return null;
      return Math.max(
        this.success.get(e.id) ?? Infinity,
        this.store.firstSequence("TaskResult", r.id),
      );
    } catch {
      return null;
    }
  }
  view(key: string, sid: string, scheduler?: Scheduler): FailureDetail {
    const t = this.target(key, sid),
      f = this.record(key),
      e = t.execution,
      linked = this.linked(f);
    const succeeded = this.successfulSequence(f, linked);
    const disposition: FailureDetail["disposition"] =
      succeeded != null &&
      Number.isFinite(succeeded) &&
      (!f?.dismissed_sequence || succeeded < f.dismissed_sequence)
        ? "REDO_SUCCEEDED"
        : f?.disposition === "DISMISSED"
          ? "DISMISSED"
          : "UNRESOLVED";
    let status: string = "UNRESOLVED",
      error = f?.error ?? null;
    if (f) {
      if (f.phase === "REQUESTED") {
        const input = this.store.find<Input>("Input", f.input_id);
        status =
          input?.state === "HANDLED"
            ? "NO_ACTION"
            : input?.state === "CLAIMED"
              ? "MAIN_PROCESSING"
              : "REQUESTED";
        if (status === "NO_ACTION") error ??= "MAIN_NO_ACTION";
      } else if (f.phase === "LINKED") {
        status = linked?.state ?? "QUEUED";
        if (linked && terminal(linked) && linked.state !== "SUCCEEDED")
          error = "REDO_" + linked.state;
        // Removed before dispatch: authoritative removal reason, never infer success.
        if (!linked) {
          const removed = this.store
            .events("task.request.removed")
            .findLast(
              (l) =>
                this.store.read<{ request_id: string }>(l.payload)
                  .request_id === f.linked_request_id,
            );
          if (removed) {
            status = "CANCELLED_OR_REJECTED";
            error = "REDO_REQUEST_REMOVED";
          }
        }
      } else status = f.phase;
    }
    if (disposition !== "UNRESOLVED") status = disposition;
    let blocker: string | null = !e ? "INITIALIZATION_HAS_NO_PARENT" : null;
    if (e && scheduler)
      blocker = scheduler.continuationStatus(t.task.id, e.id, sid).reason;
    if (e && !scheduler) {
      if (t.task.state !== "ACTIVE") blocker = "PLAN_NOT_ACTIVE";
      else if (e.retention_state === "RETIRED")
        blocker = "PARENT_NOT_RESUMABLE";
      else {
        const all = this.store.indexed<Execution>("Execution", "task_id", [
          t.task.id,
        ]);
        if (all.some((x) => !terminal(x)) || t.task.pending_requests?.length)
          blocker = "TASK_BUSY";
        else if (all.at(-1)?.id !== e.id) blocker = "PARENT_NOT_LATEST";
        else if (e.unknown_operation_ids.length)
          blocker = "UNRESOLVED_OPERATION";
      }
    }
    let deadline = t.task.deadline;
    if (e) {
      try {
        deadline = this.proposal(
          e.proposal_ref ?? t.task.proposal_ref,
        ).deadline;
      } catch {
        blocker ??= "PARENT_PROPOSAL_UNAVAILABLE";
      }
    }
    if (!blocker && deadline && Date.parse(deadline) < Date.now())
      blocker = "PINNED_DEADLINE_EXPIRED";
    const input = f ? this.store.find<Input>("Input", f.input_id) : undefined;
    const pending = !!input && !["HANDLED", "WITHDRAWN"].includes(input.state);
    const activeRedo =
      f?.phase === "LINKED" &&
      (!linked ? status === "QUEUED" : !terminal(linked));
    return {
      id: e?.id ?? t.task.id,
      failure_key: key,
      revision: String(f?.revision ?? 0),
      session_id: sid,
      task_id: t.task.id,
      execution_id: e?.id ?? null,
      result_id: e?.result_id ?? null,
      kind: e ? "EXECUTION" : "TASK_INIT",
      state: e?.state ?? t.task.state,
      retention_state: e?.retention_state ?? null,
      reason: e
        ? e.result_id
          ? (this.store.find<TaskResult>("TaskResult", e.result_id)?.summary ??
            "FAILURE_CAUSE_UNAVAILABLE")
          : "FAILURE_CAUSE_UNAVAILABLE"
        : t.task.initialization_error,
      disposition,
      status,
      error,
      intent_id: f?.intent_id ?? null,
      input_id: f?.input_id ?? null,
      linked_request_id: f?.linked_request_id ?? null,
      linked_execution_id: linked?.id ?? null,
      linked_result_id: linked?.result_id ?? null,
      continuation_blocker: blocker,
      redo_available:
        !!e && disposition === "UNRESOLVED" && !pending && !activeRedo,
      dismiss_available: disposition === "UNRESOLVED" && !pending,
    };
  }
  unresolved(e: Execution, sid: string) {
    if (e.state !== "FAILED") return false;
    const t = this.target(executionFailureKey(e.id), sid),
      f = this.record(t.key);
    if (f?.disposition === "DISMISSED") return false;
    const succeeded = this.successfulSequence(f, this.linked(f));
    return succeeded == null || !Number.isFinite(succeeded);
  }
  /** Validate before Input admission; caller commits the returned record WITH that Input. */
  prepare(action: FailureAction, sid: string, request: string, input: string) {
    const t = this.target(action.failure_key, sid),
      v = this.view(t.key, sid),
      old = this.record(t.key);
    if (revision(action.expected_revision, true) !== Number(v.revision))
      throw new ApiError("FAILURE_REVISION_CONFLICT", 409);
    if (v.disposition !== "UNRESOLVED")
      throw new ApiError("FAILURE_ALREADY_RESOLVED", 409);
    if (
      old &&
      !["HANDLED", "WITHDRAWN"].includes(
        this.store.get<Input>("Input", old.input_id).state,
      )
    )
      throw new ApiError("FAILURE_INTENT_PENDING", 409);
    if (action.action === "REDO" && !t.execution)
      throw new ApiError("INITIALIZATION_HAS_NO_PARENT", 409);
    if (action.action === "REDO" && !v.redo_available)
      throw new ApiError("FAILURE_REDO_PENDING", 409);
    const f: FailureHandling = {
      ...(old ? revise(old, {}) : base(stableID("failure:" + t.key))),
      schema_version: 1,
      record_type: "FailureHandling",
      failure_key: t.key,
      session_id: sid,
      task_id: t.task.id,
      execution_id: t.execution?.id ?? null,
      result_id: t.execution?.result_id ?? null,
      disposition: "UNRESOLVED",
      dismissed_sequence: null,
      intent_id: request,
      input_id: input,
      action: action.action,
      phase: "REQUESTED",
      error: null,
      linked_request_id:
        action.action === "DISMISS" ? (old?.linked_request_id ?? null) : null,
      requirements_digest:
        action.action === "DISMISS" ? (old?.requirements_digest ?? null) : null,
      tool_receipt: null,
    };
    return f;
  }
  inputContext(sid: string, loop: string) {
    const inputs = this.store
      .indexed<Input>("Input", "state", ["CLAIMED"])
      .filter((i) => i.session_id === sid && i.loop_id === loop);
    const bound = inputs.find((i) => i.failure_action);
    if (bound && (inputs.length !== 1 || bound.producer !== "MASTER"))
      throw Error("FAILURE_INPUT_CONTEXT_INVALID");
    return { inputs, bound };
  }
  isolatedFeedback(input: Input) {
    if (!input.feedback_id) return false;
    const f = this.store.find<Feedback>("Feedback", input.feedback_id);
    if (!f) return true;
    if (f.kind !== "RESULT") return false;
    const r = f.result_id
      ? this.store.find<TaskResult>("TaskResult", f.result_id)
      : undefined;
    return !r || ["FAILED", "CANCELLED"].includes(r.outcome);
  }
  guardProposal(sid: string, loop: string) {
    const { inputs, bound } = this.inputContext(sid, loop);
    if (
      !bound &&
      !inputs.some((i) => i.producer === "MASTER") &&
      inputs.some((i) => this.isolatedFeedback(i))
    )
      throw Error(
        "TERMINAL_FEEDBACK_STOP: report and wait for explicit Master work or failure intent",
      );
    return bound;
  }
  recovered(call: string, args: unknown, sid: string, loop: string) {
    this.sync();
    const old = this.receipts.get(call);
    if (!old) return undefined;
    const { bound } = this.inputContext(sid, loop);
    if (
      !bound ||
      bound.dedupe_key !== old.receipt.intent_id ||
      bound.failure_action?.failure_key !== old.key
    )
      throw Error("FAILURE_INPUT_CONTEXT_INVALID");
    if (old.receipt.fingerprint !== hash(canonical(args)))
      throw Error("REQUEST_CONFLICT");
    return old.receipt.result as ToolOutcome;
  }
  perform(
    sid: string,
    loop: string,
    call: string,
    tool: "task_propose" | "dismiss_failure",
    args: FailureProposal & { id?: string },
    scheduler: Scheduler,
  ): ToolOutcome {
    const replay = this.recovered(call, args, sid, loop);
    if (replay) return replay;
    const bound = this.guardProposal(sid, loop);
    if (!bound?.failure_action) throw Error("FAILURE_INPUT_CONTEXT_REQUIRED");
    const action = bound.failure_action,
      key = action.failure_key,
      f = this.record(key);
    if (
      !f ||
      f.intent_id !== bound.dedupe_key ||
      f.input_id !== bound.id ||
      f.session_id !== sid
    )
      throw Error("FAILURE_INTENT_STALE");
    // Distinct model call IDs for the same settled intent reuse its durable outcome.
    if (f.phase !== "REQUESTED" && f.tool_receipt?.intent_id === f.intent_id) {
      const outcome =
        f.tool_receipt.fingerprint === hash(canonical(args))
          ? (f.tool_receipt.result as ToolOutcome)
          : {
              accepted: false,
              error: "FAILURE_INTENT_ALREADY_HANDLED",
              failure_key: key,
            };
      this.store.commit([
        revise(f, {
          tool_receipt: {
            id: call,
            fingerprint: hash(canonical(args)),
            intent_id: f.intent_id,
            result: outcome,
          },
        }),
      ]);
      return outcome;
    }
    const fingerprint = hash(canonical(args));
    const settle = (patch: Partial<FailureHandling>, result: ToolOutcome) =>
      revise(f, {
        ...patch,
        tool_receipt: { id: call, fingerprint, intent_id: f.intent_id, result },
      });
    try {
      if (
        args.failure_intent_id != null &&
        args.failure_intent_id !== f.intent_id
      )
        throw Error("FAILURE_INTENT_MISMATCH");
      const target = this.target(key, sid),
        view = this.view(key, sid, scheduler);
      if (view.disposition !== "UNRESOLVED")
        throw Error("FAILURE_ALREADY_RESOLVED");
      if (tool === "dismiss_failure") {
        if (action.action !== "DISMISS" || args.id !== key)
          throw Error("FAILURE_ACTION_MISMATCH");
        const result = {
          accepted: true,
          failure_key: key,
          disposition: "DISMISSED",
        };
        this.store.commit([
          settle(
            {
              phase: "DISMISSED",
              error: null,
              disposition: "DISMISSED",
              dismissed_sequence: this.store.sequence + 1,
            },
            result,
          ),
        ]);
        return result;
      }
      if (action.action !== "REDO" || !target.execution)
        throw Error("FAILURE_ACTION_MISMATCH");
      if (
        args.reuse_task_id !== target.task.id ||
        args.parent_execution_id !== target.execution.id
      )
        throw Error("FAILURE_TARGET_MISMATCH");
      const original = this.proposal(
        target.execution.proposal_ref ?? target.task.proposal_ref,
      );
      const required: Record<string, unknown> = {
        goal: original.goal,
        scope_id: original.scope_id ?? null,
        program_id: original.executor.program_id,
        constraints: original.constraints,
        acceptance_criteria: original.acceptance_criteria,
        deadline: original.deadline,
      };
      for (const [k, v] of Object.entries(args)) {
        if (
          [
            "reuse_task_id",
            "parent_execution_id",
            "failure_intent_id",
          ].includes(k)
        )
          continue;
        if (v == null) continue;
        if (k === "materials" && Array.isArray(v) && v.length === 0) continue;
        if (!(k in required) || canonical(v) !== canonical(required[k]))
          throw Error("FAILURE_REQUIREMENTS_CHANGED:" + k);
      }
      const result = {
        accepted: true,
        failure_key: key,
        task_id: target.task.id,
        linked_request_id: call,
      };
      // continueTask's first mutation admits pending work. The handling link is in that same frame.
      this.store.withAdmission(
        () =>
          settle(
            {
              phase: "LINKED",
              error: null,
              linked_request_id: call,
              requirements_digest: this.requirements(original),
            },
            result,
          ),
        () => {
          scheduler.propose(original.goal, call, sid, {
            reuse: target.task.id,
            parent: target.execution!.id,
          });
        },
      );
      return result;
    } catch (e) {
      // A proven durable admission must never be replaced with a failure if subsequent reporting throws.
      const durable = this.record(key);
      if (durable?.tool_receipt?.id === call)
        return durable.tool_receipt.result as ToolOutcome;
      const result = { accepted: false, failure_key: key, error: err(e) };
      // Invalid arguments consume only this call, not the Master's intent.
      // Continuation refusals remain final; recovery replays every call receipt.
      const correctable =
        /^FAILURE_(INTENT_MISMATCH|ACTION_MISMATCH|TARGET_MISMATCH|REQUIREMENTS_CHANGED)(:|$)/.test(
          err(e),
        );
      this.store.commit([
        settle(
          { phase: correctable ? "REQUESTED" : "BLOCKED", error: err(e) },
          result,
        ),
      ]);
      return result;
    }
  }
}
