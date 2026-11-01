import { Ajv2020 } from "ajv/dist/2020.js";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { checkpoint, saveContext } from "./context.ts";
import type {
  Checkpoint,
  DecisionRequest,
  Dispatch,
  Execution,
  Feedback,
  ModelCall,
  Operation,
  ProgramRegistration,
  TaskPlan,
  TaskResult,
} from "./contracts.ts";
import { scopeOf, stableID, terminal } from "./execution-utils.ts";
import { Agent, type AgentMessage, type StreamFn } from "./model.ts";
import type { SchedulerContext } from "./scheduler-context.ts";
import { base, hash, id, now, revise, type Stored } from "./store.ts";
import { EXECUTOR_SYSTEM, executionPrompt } from "./task-prompt.ts";
import { durableStream } from "./transport.ts";

type ExecutionRunnerContext = Pick<
  SchedulerContext,
  | "applyShell"
  | "applyWrite"
  | "auth"
  | "closed"
  | "conditions"
  | "execute"
  | "feedback"
  | "finish"
  | "model"
  | "processStopped"
  | "program"
  | "promptMaterials"
  | "proposalFor"
  | "rootFor"
  | "running"
  | "safePath"
  | "scopes"
  | "setState"
  | "settleUnknownExecution"
  | "store"
  | "stream"
  | "tools"
>;

export function setState(
  this: ExecutionRunnerContext,
  eid: string,
  state: Execution["state"],
  patch: Partial<Execution> = {},
) {
  const e = this.store.get<Execution>("Execution", eid);
  this.store.commit([
    revise(e, { ...patch, state, owner_epoch: this.store.epoch }),
  ]);
}

export async function run(this: ExecutionRunnerContext, eid: string) {
  if (
    this.running.has(eid) ||
    this.closed ||
    this.running.size >= Number(process.env.SECRETARY_MAX_WORKERS ?? 2)
  )
    return;
  const current = this.store.get<Execution>("Execution", eid);
  if (
    !["READY", "WAIT_AUTH"].includes(current.state) ||
    this.store.get<TaskPlan>("TaskPlan", current.task_id).state !== "ACTIVE"
  )
    return;
  if (
    current.state === "WAIT_AUTH" &&
    this.store
      .all<Operation>("Operation")
      .some((o) => o.scope.execution_id === eid && o.state === "WAIT_AUTH")
  )
    return;
  let reason: string | null;
  try {
    reason = this.scopes.dispatchReason(current);
    this.rootFor(current);
  } catch (error) {
    reason = (error as Error).message;
  }
  if (reason) {
    this.setState(eid, "WAIT_PRECONDITION", {
      condition_results: [
        ...this.conditions(current),
        {
          condition_id: stableID(eid + ":scope"),
          status: "NOT_MET",
          checked_at: now(),
          evidence: [],
          reason,
        },
      ],
    });
    return;
  }
  this.setState(eid, "DISPATCHING", {
    started_at: current.started_at ?? now(),
  });
  const entry: {
    agent?: Agent;
    child?: ChildProcess;
    promise: Promise<void>;
  } = { promise: Promise.resolve() };
  this.running.set(eid, entry);
  entry.promise = this.execute(
    eid,
    entry,
    current.state === "WAIT_AUTH" || current.waiting_request_ids.length > 0,
  )
    .catch((error) => {
      const e = this.store.get<Execution>("Execution", eid);
      const inflight = this.store
        .all<Operation>("Operation")
        .filter(
          (o) =>
            o.scope.execution_id === eid &&
            ["DISPATCHED", "RESULT_UNKNOWN"].includes(o.state),
        );
      if (inflight.length) {
        for (const op of inflight)
          if (op.state === "DISPATCHED")
            this.auth.finish(op.id, { error: String(error) }, "UNKNOWN");
        this.setState(eid, "RESULT_UNKNOWN", {
          unknown_operation_ids: inflight.map((o) => o.id),
        });
        this.feedback(
          eid,
          "UNKNOWN",
          "Effect could not be confirmed",
          this.store.put({ error: String(error) }),
        );
      } else if (
        !terminal(e) &&
        !["WAIT_DECISION", "RESULT_UNKNOWN"].includes(e.state)
      )
        this.finish(eid, "FAILED", { error: String(error) });
    })
    .finally(() => {
      this.running.delete(eid);
      this.settleUnknownExecution(eid);
    });
  await entry.promise;
}

export async function execute(
  this: ExecutionRunnerContext,
  eid: string,
  entry: { agent?: Agent; child?: ChildProcess },
  resumeAuth = false,
) {
  let e = this.store.get<Execution>("Execution", eid);
  const baseline = this.store.get<TaskPlan>("TaskPlan", e.task_id);
  const effective = this.proposalFor(e);
  const p = {
    ...baseline,
    executor: effective.executor,
    safety_rule_id: effective.safety_rule_id,
  };
  if (e.state !== "DISPATCHING" || p.state !== "ACTIVE") return;
  if (resumeAuth) {
    const ops = this.store
      .all<Operation>("Operation")
      .filter((o) => o.scope.execution_id === eid);
    if (ops.some((o) => o.state === "WAIT_AUTH")) return;
    if (ops.some((o) => o.state === "CANCELLED")) {
      this.finish(eid, "FAILED", {
        reason: "Authorization rejected/revoked",
        failure_code: "CANCELLED_OPERATION_ON_RESUME",
        cancelled_operation_ids: ops
          .filter((o) => o.state === "CANCELLED")
          .map((o) => o.id),
      });
      return;
    }
    if (ops.some((o) => o.state === "RESULT_UNKNOWN")) {
      this.setState(eid, "RESULT_UNKNOWN");
      return;
    }
    for (const o of ops.filter(
      (o) => o.state === "AUTHORIZED" && o.action.action === "file.write",
    ))
      await this.applyWrite(o);
    for (const o of ops.filter(
      (o) => o.state === "AUTHORIZED" && o.action.action === "shell.run",
    )) {
      await this.applyShell(o, entry);
      if (
        this.store.get<Execution>("Execution", eid).state === "RESULT_UNKNOWN"
      )
        return;
    }
    this.setState(eid, "READY", { waiting_request_ids: [] });
    e = this.store.get<Execution>("Execution", eid);
  }
  if (e.cancel_requested) {
    this.finish(eid, "CANCELLED", { reason: "Cancelled before dispatch" });
    return;
  }
  const attempt = id();
  const dispatch: Dispatch = {
    schema_version: 1,
    record_type: "Dispatch",
    ...base(),
    task_id: p.id,
    execution_id: e.id,
    attempt_id: attempt,
    owner_epoch: this.store.epoch,
    plan_revision: p.revision,
    executor: p.executor,
    workspace: e.workspace_binding ? this.rootFor(e) : p.id + "/work",
    resume_checkpoint_id: e.checkpoint_id,
    operation_ids: [],
    issued_at: now(),
  };
  if (p.executor.kind === "PROGRAM") {
    const pr = this.store.get<ProgramRegistration>(
      "ProgramRegistration",
      p.executor.program_id!,
    );
    if (
      pr.state !== "ENABLED" ||
      pr.revision !== p.executor.program_revision ||
      hash(fs.readFileSync(pr.entrypoint)) !== pr.code_digest
    )
      throw Error("PROGRAM_CHANGED");
    if (
      !new Ajv2020().validate(
        this.store.read<object>(pr.parameters_schema),
        p.executor.parameters,
      )
    )
      throw Error("INVALID_PROGRAM_PARAMETERS");
    const op = this.auth.prepare(
      scopeOf(e),
      "program.run",
      pr.id,
      {
        program_id: pr.id,
        revision: pr.revision,
        code_digest: pr.code_digest,
        entrypoint: pr.entrypoint,
        capability: pr.description,
        parameters: p.executor.parameters,
        workspace: dispatch.workspace,
      },
      stableID(eid + ":program"),
    );
    if (op.state === "WAIT_AUTH") {
      this.setState(eid, "WAIT_AUTH", {
        waiting_request_ids: [op.authorization_id!],
      });
      return;
    }
    if (op.state !== "AUTHORIZED") throw Error("PROGRAM_NOT_DISPATCHABLE");
    this.auth.dispatch(op.id, [
      dispatch,
      revise(e, {
        state: "DISPATCHING",
        attempt_id: attempt,
        started_at: e.started_at ?? now(),
      }),
    ]);
    this.setState(eid, "RUNNING");
    await this.program(eid, pr, p.executor.parameters, op.id, entry);
    return;
  }
  this.store.commit([
    dispatch,
    revise(e, {
      state: "DISPATCHING",
      attempt_id: attempt,
      started_at: e.started_at ?? now(),
    }),
  ]);
  this.setState(eid, "RUNNING");
  const saved = e.checkpoint_id
    ? this.store.get<Checkpoint>("Checkpoint", e.checkpoint_id)
    : null;
  if (
    saved &&
    (saved.adapter_version !== "pi-0.87.0" ||
      saved.provider_profile !== this.model.id)
  )
    throw Error("INCOMPATIBLE_CONTEXT");
  const recoveryCall = e.recovery_call_id
    ? this.store.get<ModelCall>("ModelCall", e.recovery_call_id)
    : null;
  const recoveryRequest = recoveryCall
    ? this.store.read<Parameters<StreamFn>[1]>(recoveryCall.request)
    : null;
  const messages = recoveryRequest
    ? (recoveryRequest.messages as AgentMessage[])
    : saved?.raw_context
      ? this.store.read<AgentMessage[]>(saved.raw_context)
      : [];
  const agent = new Agent({
    initialState: {
      model: this.model,
      systemPrompt: EXECUTOR_SYSTEM,
      messages,
      tools: this.tools(e),
    },
    streamFn: durableStream(this.store, this.stream, scopeOf(e), eid, "TASK", {
      resumeCallID: recoveryCall?.id,
      onPrepared: (call) => {
        const current = this.store.get<Execution>("Execution", eid);
        if (current.recovery_call_id) {
          const { recovery_call_id: _, ...cleared } = current;
          this.store.commit([revise(cleared, {})]);
        }
      },
    }),
    toolExecution: "sequential",
  });
  agent.finishTurn = () => {
    const current = this.store.get<Execution>("Execution", eid);
    if (current.state !== "RUNNING") return { action: "end" };
  };
  entry.agent = agent;
  agent.subscribe((event) => {
    if (event.type === "message_end") {
      const cp = checkpoint(this.store, agent, e.task_id, eid);
      const current = this.store.get<Execution>("Execution", eid);
      this.store.commit(
        [revise(current, { checkpoint_id: cp.id })],
        [
          this.store.event(
            "agent.message",
            event.message,
            scopeOf(e),
            "EXECUTOR",
          ),
        ],
      );
    }
  });
  agent.prepareRequest = () => {
    saveContext(
      this.store,
      agent.state.messages,
      scopeOf(e),
      "TASK",
      this.model.id,
      eid,
      this.model.contextWindow,
    );
  };
  const proposal = this.proposalFor(e);
  const packet = executionPrompt(
    proposal,
    e,
    this.promptMaterials(proposal),
    {
      resumed: !!saved,
      operations: this.store
        .all<Operation>("Operation")
        .filter((o) => o.scope.execution_id === eid)
        .map((o) => ({
          id: o.id,
          state: o.state,
          action: o.action,
          receipt: o.receipt ? this.store.read(o.receipt) : null,
        })),
      decisions: this.store
        .all<DecisionRequest>("DecisionRequest")
        .filter((d) => d.execution_id === eid && d.state === "ANSWERED"),
    },
    this.scopes.packet(e, this.rootFor(e)),
  );
  this.store.commit(
    [],
    [
      this.store.event(
        "agent.dispatch_prompt",
        { protocol: "secretary.agent-task.v1", prompt: packet },
        scopeOf(e),
      ),
    ],
  );
  if (recoveryRequest) await agent.continue();
  else await agent.prompt(packet);
  e = this.store.get<Execution>("Execution", eid);
  if (["WAIT_AUTH", "WAIT_DECISION", "RESULT_UNKNOWN"].includes(e.state))
    return;
  if (e.cancel_requested) {
    this.finish(eid, "CANCELLED", { messages: agent.state.messages });
    return;
  }
  if (!terminal(e))
    this.finish(eid, "FAILED", {
      messages: agent.state.messages,
      error: agent.state.errorMessage ?? "MISSING_STRUCTURED_RESULT",
    });
}

export function finish(
  this: ExecutionRunnerContext,
  eid: string,
  state: "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED",
  detail: unknown,
) {
  const e = this.store.get<Execution>("Execution", eid);
  if (terminal(e)) return;
  if (!this.processStopped(eid)) {
    this.setState(eid, "RESULT_UNKNOWN");
    return;
  }
  const ref = this.store.put(detail);
  const agentDetail =
    this.proposalFor(e).executor.kind === "AGENT" ? detail : undefined;
  const structured = (
    agentDetail as {
      structured_result?: { summary: string; limitations: string[] };
    }
  )?.structured_result;
  const r: TaskResult = {
    schema_version: 1,
    record_type: "TaskResult",
    scope_id: e.scope_id ?? null,
    ...base(),
    task_id: e.task_id,
    execution_id: eid,
    outcome: state,
    summary: structured?.summary ?? `${state}: task ${e.task_id}`,
    limitations: [
      ...(structured?.limitations ?? []),
      "Model output is not independent verification",
    ],
    evidence: [ref],
    artifacts: (
      (
        agentDetail as {
          artifacts?: {
            path: string;
            content: TaskResult["evidence"][number];
          }[];
        }
      )?.artifacts ?? []
    ).map((a) => ({
      artifact_id: id(),
      name: path.basename(a.path),
      content: a.content,
      workspace_path: a.path,
      producing_operation_id:
        this.store
          .all<Operation>("Operation")
          .find(
            (o) =>
              o.scope.execution_id === eid &&
              o.state === "SUCCEEDED" &&
              o.action.resource === this.safePath(e, a.path),
          )?.id ?? null,
    })),
    detail_ref: ref,
    needs_action: state !== "SUCCEEDED",
    verified_by: "NOT_VERIFIED",
    observed_at: now(),
  };
  const changes: Stored[] = [
    ...this.store
      .all<DecisionRequest>("DecisionRequest")
      .filter((d) => d.execution_id === eid && d.state === "OPEN")
      .map((d) => revise(d, { state: "OBSOLETE" })),
    r,
    revise(e, {
      state,
      result_id: r.id,
      ended_at: now(),
      last_activity_at: now(),
      waiting_request_ids: [],
    }),
  ];
  if (e.continuation_of) {
    const parent = this.store.get<Execution>("Execution", e.continuation_of);
    changes.push(
      revise(parent, {
        pending_followup_ids: parent.pending_followup_ids.filter(
          (v) => v !== eid,
        ),
        last_activity_at: now(),
      }),
    );
  }
  this.store.commit(changes, [
    this.store.event("execution.finished", r, scopeOf(e)),
  ]);
  this.feedback(eid, "RESULT", r.summary, ref, r.id);
}

export function feedback(
  this: ExecutionRunnerContext,
  eid: string,
  kind: Feedback["kind"],
  summary: string,
  ref: Feedback["detail_ref"],
  resultID: string | null = null,
  decisionID: string | null = null,
) {
  const e = this.store.get<Execution>("Execution", eid);
  const f: Feedback = {
    schema_version: 1,
    record_type: "Feedback",
    scope_id: this.store.get<Execution>("Execution", eid).scope_id ?? null,
    ...base(),
    state: "QUEUED",
    task_id: e.task_id,
    execution_id: eid,
    kind,
    summary,
    detail_ref: ref,
    result_id: resultID,
    decision_request_id: decisionID,
    input_id: null,
    created_at: now(),
  };
  this.store.commit([f]);
  return f;
}
