import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Type } from "typebox";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createWriteTool } from "../../pi_resource/packages/agent/src/harness/tools/write.ts";
import { createReadTool } from "../../pi_resource/packages/agent/src/harness/tools/read.ts";
import { BACKGROUND_CONTEXT } from "../../pi_resource/packages/agent/src/harness/context.ts";
import { NodeExecutionEnv } from "../../pi_resource/packages/agent/src/harness/env/nodejs.ts";
import {
  Agent,
  tool,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
} from "./model.ts";
import type { Model, Api } from "@earendil-works/pi-ai";
import {
  Store,
  base,
  id,
  now,
  hash,
  revise,
  shape,
  type Stored,
} from "./store.ts";
import { Authorization } from "./authorization.ts";
import { durableStream } from "./transport.ts";
import { saveContext, checkpoint } from "./context.ts";
import type {
  TaskProposal,
  TaskPlan,
  Execution,
  Dispatch,
  TaskResult,
  Feedback,
  Operation,
  Checkpoint,
  ProgramRegistration,
  DecisionRequest,
  ArchiveManifest,
  SafetyRule,
  Scope,
  Precondition,
  ConditionResult,
} from "./contracts.ts";
export const stableID = (text: string) => {
  const h = hash(text);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export const scopeOf = (e: Execution): Scope => ({
  session_id: null,
  task_id: e.task_id,
  execution_id: e.id,
});
export const terminal = (e: Execution) =>
  ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(e.state);
const jsonTool = (value: unknown, terminate = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: undefined,
  terminate,
});
export class Scheduler {
  readonly workspace: string;
  private running = new Map<
    string,
    { agent?: Agent; child?: ChildProcess; promise: Promise<void> }
  >();
  private closed = false;
  constructor(
    readonly store: Store,
    readonly auth: Authorization,
    readonly model: Model<Api>,
    readonly stream: StreamFn,
  ) {
    this.workspace = path.join(store.dir, "workspaces");
    fs.mkdirSync(this.workspace, { recursive: true });
  }
  propose(
    goal: string,
    requestID = id(),
    sessionID: string,
    options: {
      programID?: string;
      at?: string;
      interval?: number;
      parent?: string;
      constraints?: string[];
      acceptance?: string[];
      deadline?: string;
      preconditions?: Precondition[];
    } = {},
  ): TaskPlan {
    if (!goal.trim()) throw Error("EMPTY_GOAL");
    const fingerprint = hash(JSON.stringify({ goal, options, sessionID }));
    const old = this.store.receipt<string>(requestID, fingerprint);
    if (old) return this.store.get<TaskPlan>("TaskPlan", old);
    if (options.at && !Number.isFinite(Date.parse(options.at)))
      throw Error("INVALID_TRIGGER");
    if (options.interval && options.interval < 1)
      throw Error("INVALID_INTERVAL");
    const program = options.programID
      ? this.store.get<ProgramRegistration>(
          "ProgramRegistration",
          options.programID,
        )
      : null;
    if (program && program.state !== "ENABLED") throw Error("PROGRAM_DISABLED");
    const safety: SafetyRule = {
      record_type: "SafetyRule",
      schema_version: 1,
      ...base(),
      created_by: "MAIN",
      max_known_failure_retries: 0,
      retryable_error_codes: [],
      require_no_effect_for_retry: true,
      stop_on_unknown: true,
      extra_checks: [],
    };
    const proposal: TaskProposal = {
      schema_version: 1,
      record_type: "TaskProposal",
      request_id: requestID,
      request_hash: fingerprint,
      submitted_at: now(),
      session_id: sessionID,
      goal,
      constraints: options.constraints ?? [],
      acceptance_criteria: options.acceptance ?? [
        "Return a saved, queryable result and evidence",
      ],
      trigger: {
        kind: options.at ? "AT" : options.interval ? "INTERVAL" : "IMMEDIATE",
        at: options.at ?? null,
        interval_seconds: options.interval ?? null,
        anchor_at: options.interval ? now() : null,
        timezone: "Etc/UTC",
        event_source: null,
        predicate_id: null,
        missed_policy: "REPORT_ONLY",
        overlap_policy: "QUEUE",
      },
      preconditions: options.preconditions ?? [],
      executor: program
        ? {
            kind: "PROGRAM",
            agent_profile: null,
            program_id: program.id,
            program_revision: program.revision,
            parameters: { goal },
          }
        : {
            kind: "AGENT",
            agent_profile: this.model.id,
            program_id: null,
            program_revision: null,
            parameters: {},
          },
      feedback_policy: {
        terminal: true,
        on_change: false,
        on_blocker: true,
        on_unknown: true,
        milestones: [],
      },
      deadline: options.deadline ?? null,
      context_refs: [],
      parent_execution_id: options.parent ?? null,
      safety_rule_id: safety.id,
      reuse_task_id: null,
    };
    shape(proposal);
    if (options.parent) {
      const parent = this.store.get<Execution>("Execution", options.parent);
      if (!terminal(parent) || parent.retention_state === "RETIRED")
        throw Error("PARENT_NOT_RESUMABLE");
    }
    const taskID = id();
    const plan: TaskPlan = {
      schema_version: 1,
      record_type: "TaskPlan",
      ...base(taskID),
      state: "INITIALIZING",
      proposal_request_id: requestID,
      proposal_ref: this.store.put(proposal),
      workspace: taskID,
      trigger: proposal.trigger,
      preconditions: proposal.preconditions,
      executor: proposal.executor,
      feedback_policy: proposal.feedback_policy,
      next_due_at: options.at ?? now(),
      pending_occurrences: [],
      active_execution_ids: [],
      deadline: proposal.deadline,
      safety_rule_id: safety.id,
      initialization_error: null,
    };
    this.store.commit(
      [safety, plan],
      [
        this.store.event(
          "task.proposed",
          proposal,
          { session_id: sessionID, task_id: taskID, execution_id: null },
          "MAIN",
        ),
      ],
      { request: requestID, hash: fingerprint, value: taskID },
    );
    this.initialize(taskID);
    return this.store.get<TaskPlan>("TaskPlan", taskID);
  }
  initialize(taskID: string) {
    const p = this.store.get<TaskPlan>("TaskPlan", taskID);
    if (!["INITIALIZING", "INIT_FAILED"].includes(p.state)) return;
    try {
      const dir = path.join(this.workspace, taskID);
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
  tick(at = Date.now()) {
    if (this.closed) return;
    for (const p of this.store.all<TaskPlan>("TaskPlan")) {
      if (p.state === "INITIALIZING" || p.state === "INIT_FAILED") {
        this.initialize(p.id);
        continue;
      }
      if (
        p.state !== "ACTIVE" ||
        !p.next_due_at ||
        Date.parse(p.next_due_at) > at
      )
        continue;
      if (
        p.active_execution_ids.some(
          (eid) => !terminal(this.store.get<Execution>("Execution", eid)),
        )
      )
        continue;
      const due = p.next_due_at;
      const key = p.trigger.kind === "IMMEDIATE" ? "once" : due;
      if (
        this.store
          .all<Execution>("Execution")
          .some((e) => e.task_id === p.id && e.occurrence_key === key)
      )
        continue;
      // Do not silently catch up missed periodic windows after restart.
      if (
        p.trigger.kind === "INTERVAL" &&
        at - Date.parse(due) > (p.trigger.interval_seconds ?? 0) * 1000
      ) {
        const nextDue = new Date(
          at + (p.trigger.interval_seconds ?? 1) * 1000,
        ).toISOString();
        this.store.commit(
          [revise(p, { next_due_at: nextDue })],
          [
            this.store.event("trigger.missed", {
              task_id: p.id,
              due,
              policy: "REPORT_ONLY",
            }),
          ],
        );
        continue;
      }
      const proposal = this.store.read<TaskProposal>(p.proposal_ref);
      const e: Execution = {
        schema_version: 1,
        record_type: "Execution",
        ...base(),
        task_id: p.id,
        state: "CREATED",
        retention_state: "HOT",
        occurrence_key: key,
        plan_revision: p.revision,
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
          next_due_at:
            p.trigger.kind === "INTERVAL"
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
            pending_followup_ids: [...prev.pending_followup_ids, e.id],
            last_activity_at: now(),
          }),
        );
      }
      this.store.commit(records);
      this.setState(e.id, "WAIT_PRECONDITION");
      this.ready(e.id);
    }
    for (const e of this.store.all<Execution>("Execution")) {
      const plan = this.store.get<TaskPlan>("TaskPlan", e.task_id);
      if (plan.deadline && Date.parse(plan.deadline) <= at && !terminal(e)) {
        if (this.running.has(e.id)) this.cancel(e.id);
        else if (e.state !== "RESULT_UNKNOWN")
          this.finish(e.id, "EXPIRED", { reason: "Explicit deadline passed" });
        continue;
      }
      if (e.state === "WAIT_PRECONDITION") this.ready(e.id);
      if (e.state === "READY" || e.state === "WAIT_AUTH") void this.run(e.id);
    }
  }
  ready(eid: string) {
    const e = this.store.get<Execution>("Execution", eid),
      p = this.store.get<TaskPlan>("TaskPlan", e.task_id);
    const checks: ConditionResult[] = p.preconditions.map((c) => {
      let met = false;
      try {
        if (c.kind === "EXECUTION_SUCCEEDED")
          met =
            this.store.get<Execution>("Execution", c.target).state ===
            "SUCCEEDED";
        else if (c.kind === "RESOURCE_PRESENT")
          met = fs.existsSync(this.safePath(e.task_id, c.target));
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
    this.store.commit([
      revise(e, {
        condition_results: checks,
        state: checks.every((c) => c.status === "MET")
          ? "READY"
          : "WAIT_PRECONDITION",
      }),
    ]);
  }
  private setState(
    eid: string,
    state: Execution["state"],
    patch: Partial<Execution> = {},
  ) {
    const e = this.store.get<Execution>("Execution", eid);
    this.store.commit([
      revise(e, { ...patch, state, owner_epoch: this.store.epoch }),
    ]);
  }
  async run(eid: string) {
    if (
      this.running.has(eid) ||
      this.closed ||
      this.running.size >= Number(process.env.SECRETARY_MAX_WORKERS ?? 2)
    )
      return;
    const entry: {
      agent?: Agent;
      child?: ChildProcess;
      promise: Promise<void>;
    } = { promise: Promise.resolve() };
    this.running.set(eid, entry);
    entry.promise = this.execute(eid, entry)
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
          !["WAIT_AUTH", "WAIT_DECISION", "RESULT_UNKNOWN"].includes(e.state)
        )
          this.finish(eid, "FAILED", { error: String(error) });
      })
      .finally(() => this.running.delete(eid));
    await entry.promise;
  }
  private async execute(
    eid: string,
    entry: { agent?: Agent; child?: ChildProcess },
  ) {
    let e = this.store.get<Execution>("Execution", eid);
    const p = this.store.get<TaskPlan>("TaskPlan", e.task_id);
    if (!["READY", "WAIT_AUTH"].includes(e.state) || p.state !== "ACTIVE")
      return;
    if (e.state === "WAIT_AUTH") {
      const ops = this.store
        .all<Operation>("Operation")
        .filter((o) => o.scope.execution_id === eid);
      if (ops.some((o) => o.state === "WAIT_AUTH")) return;
      if (ops.some((o) => o.state === "CANCELLED")) {
        this.finish(eid, "FAILED", {
          reason: "Authorization rejected/revoked",
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
      workspace: p.id + "/work",
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
    const messages = saved?.raw_context
      ? this.store.read<AgentMessage[]>(saved.raw_context)
      : [];
    const agent = new Agent({
      initialState: {
        model: this.model,
        systemPrompt:
          "TASK_EXECUTOR: Execute only the assigned task. Use workspace tools. Missing authorization or an unknown effect means STOP. Ordinary decisions must be requested. Report evidence and limitations.",
        messages,
        tools: this.tools(e),
      },
      streamFn: durableStream(this.store, this.stream, scopeOf(e), eid, "TASK"),
      toolExecution: "sequential",
    });
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
    const proposal = this.store.read<TaskProposal>(p.proposal_ref);
    await agent.prompt(
      saved
        ? "Continue the same task. Scheduler operation results: " +
            JSON.stringify(
              this.store
                .all<Operation>("Operation")
                .filter((o) => o.scope.execution_id === eid)
                .map((o) => ({ id: o.id, state: o.state, receipt: o.receipt })),
            ) +
            " Ordinary decisions: " +
            JSON.stringify(
              this.store
                .all<DecisionRequest>("DecisionRequest")
                .filter(
                  (d) => d.execution_id === eid && d.state === "ANSWERED",
                ),
            )
        : JSON.stringify({
            goal: proposal.goal,
            constraints: proposal.constraints,
            acceptance_criteria: proposal.acceptance_criteria,
          }),
    );
    e = this.store.get<Execution>("Execution", eid);
    if (["WAIT_AUTH", "WAIT_DECISION", "RESULT_UNKNOWN"].includes(e.state))
      return;
    if (e.cancel_requested) {
      this.finish(eid, "CANCELLED", { messages: agent.state.messages });
      return;
    }
    this.finish(eid, agent.state.errorMessage ? "FAILED" : "SUCCEEDED", {
      messages: agent.state.messages,
      error: agent.state.errorMessage ?? null,
    });
  }
  private safePath(task: string, relative: string) {
    if (
      !relative ||
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((p) => p === ".." || p === "")
    )
      throw Error("INVALID_PATH");
    const root = path.join(this.workspace, task, "work");
    const dest = path.resolve(root, relative);
    if (!dest.startsWith(root + path.sep)) throw Error("INVALID_PATH");
    let cur = root;
    for (const part of relative.split("/")) {
      cur = path.join(cur, part);
      if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink())
        throw Error("SYMLINK_REJECTED");
    }
    return dest;
  }
  private tools(e: Execution): AgentTool[] {
    const upstreamRead = createReadTool(),
      upstreamWrite = createWriteTool();
    const tools: AgentTool[] = [
      tool({
        name: "read",
        label: "Read workspace",
        description: upstreamRead.description,
        parameters: upstreamRead.parameters,
        execute: async (call, args) => {
          this.safePath(e.task_id, args.path);
          return upstreamRead.execute(
            call,
            args,
            () => {},
            {
              env: new NodeExecutionEnv({
                cwd: path.join(this.workspace, e.task_id, "work"),
              }),
            },
            invocation(call),
            BACKGROUND_CONTEXT,
          );
        },
      }),
      tool({
        name: "write",
        label: "Write with approval",
        description:
          upstreamWrite.description + " Requires Scheduler approval.",
        parameters: upstreamWrite.parameters,
        execute: async (_call, args) => {
          const resource = this.safePath(e.task_id, args.path);
          const intent = stableID(e.id + ":write:" + JSON.stringify(args));
          const op = this.auth.prepare(
            scopeOf(e),
            "file.write",
            resource,
            args,
            intent,
          );
          if (op.state === "SUCCEEDED")
            return jsonTool({ operation_id: op.id, state: op.state });
          if (op.state === "RESULT_UNKNOWN") {
            this.setState(e.id, "RESULT_UNKNOWN", {
              unknown_operation_ids: [op.id],
            });
            return jsonTool({ state: "RESULT_UNKNOWN" }, true);
          }
          if (op.state !== "AUTHORIZED") {
            this.setState(e.id, "WAIT_AUTH", {
              waiting_request_ids: op.authorization_id
                ? [op.authorization_id]
                : [],
            });
            return jsonTool({ operation_id: op.id, state: op.state }, true);
          }
          return jsonTool(await this.applyWrite(op));
        },
      }),
      tool({
        name: "request_decision",
        label: "Ask for work decision",
        description:
          "Ask an ordinary work decision. Does not request or grant authorization.",
        parameters: Type.Object({ question: Type.String() }),
        execute: async (_call, args) => {
          const d: DecisionRequest = {
            schema_version: 1,
            record_type: "DecisionRequest",
            ...base(),
            state: "OPEN",
            task_id: e.task_id,
            execution_id: e.id,
            question: args.question,
            options: [],
            impact: "Execution paused",
            materials: [],
            deadline: null,
            answer: null,
            answered_by: null,
            answer_request_id: null,
          };
          const current = this.store.get<Execution>("Execution", e.id);
          this.store.commit(
            [
              d,
              revise(current, {
                state: "WAIT_DECISION",
                waiting_request_ids: [d.id],
              }),
            ],
            [this.store.event("decision.requested", d, scopeOf(e))],
          );
          this.feedback(
            e.id,
            "DECISION_REQUIRED",
            args.question,
            this.store.put(d),
            null,
            d.id,
          );
          return jsonTool({ decision_id: d.id, state: "WAIT_DECISION" }, true);
        },
      }),
    ];
    return tools.map((t) => ({
      ...t,
      execute: async (call, args, signal, update) => {
        const current = this.store.get<Execution>("Execution", e.id);
        if (current.state !== "RUNNING" || current.cancel_requested)
          return jsonTool({ state: current.state, blocked: true }, true);
        return t.execute(call, args, signal, update);
      },
    }));
  }
  private async applyWrite(op: Operation) {
    const e = this.store.get<Execution>("Execution", op.scope.execution_id!);
    if (e.cancel_requested || terminal(e)) throw Error("EXECUTION_NOT_ACTIVE");
    const params = this.store.read<{ path: string; content: string }>(
      op.action.parameters_ref,
    );
    const target = this.safePath(e.task_id, params.path);
    if (target !== op.action.resource) throw Error("RESOURCE_CHANGED");
    this.auth.dispatch(op.id);
    try {
      const tool = createWriteTool();
      const result = await tool.execute(
        op.id,
        { ...params, path: target },
        () => {},
        {
          env: new NodeExecutionEnv({
            cwd: path.join(this.workspace, e.task_id, "work"),
          }),
        },
        invocation(op.id),
        BACKGROUND_CONTEXT,
      );
      const fd = fs.openSync(target, "r");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      const evidence = this.store.put(fs.readFileSync(target), "text/plain");
      return this.auth.finish(op.id, { result, evidence });
    } catch (error) {
      this.auth.finish(op.id, { error: String(error) }, "UNKNOWN");
      this.setState(e.id, "RESULT_UNKNOWN", { unknown_operation_ids: [op.id] });
      throw error;
    }
  }
  verifyWrite(operationID: string) {
    const op = this.store.get<Operation>("Operation", operationID);
    if (
      op.state !== "RESULT_UNKNOWN" ||
      op.action.action !== "file.write" ||
      !op.scope.execution_id
    )
      throw Error("NO_VERIFIER_FOR_OPERATION");
    const e = this.store.get<Execution>("Execution", op.scope.execution_id);
    const params = this.store.read<{ path: string; content: string }>(
      op.action.parameters_ref,
    );
    const target = this.safePath(e.task_id, params.path);
    if (
      target !== op.action.resource ||
      !fs.existsSync(target) ||
      hash(fs.readFileSync(target)) !== hash(params.content)
    )
      return { verified: false, state: "RESULT_UNKNOWN" };
    const evidence = this.store.put(fs.readFileSync(target), "text/plain");
    this.auth.finish(
      op.id,
      {
        verified_postcondition: "Exact requested file content is present",
        evidence,
      },
      "APPLIED",
    );
    if (
      !this.store
        .all<Operation>("Operation")
        .some(
          (o) => o.scope.execution_id === e.id && o.state === "RESULT_UNKNOWN",
        )
    ) {
      this.store.commit([
        revise(this.store.get<Execution>("Execution", e.id), {
          unknown_operation_ids: [],
        }),
      ]);
      this.finish(e.id, "FAILED", {
        reason:
          "Execution interrupted; file postcondition verified. Continue with a follow-up task.",
        evidence,
      });
    }
    return { verified: true, evidence };
  }
  registerProgram(entrypoint: string, name: string) {
    const absolute = path.resolve(entrypoint);
    const code = fs.readFileSync(absolute);
    const r: ProgramRegistration = {
      schema_version: 1,
      record_type: "ProgramRegistration",
      ...base(),
      state: "ENABLED",
      name,
      description:
        "Runs a manually reviewed Node script with the current user privileges; internal operations are authorized as a whole.",
      entrypoint: absolute,
      code_digest: hash(code),
      parameters_schema: this.store.put({
        type: "object",
        properties: { goal: { type: "string" } },
        required: ["goal"],
        additionalProperties: false,
      }),
      result_schema: this.store.put({
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      }),
      preconditions: [],
      operation_kinds: ["program.run"],
      supports_resume: false,
      maintained_by: "HUMAN",
      validation_ref: this.store.put({
        entrypoint: absolute,
        code_digest: hash(code),
        confirmed_at: now(),
      }),
    };
    this.store.commit(
      [r],
      [this.store.event("program.registered", r, undefined, "MASTER_UI")],
    );
    return r;
  }
  private async program(
    eid: string,
    program: ProgramRegistration,
    params: unknown,
    opID: string,
    entry: { child?: ChildProcess },
  ) {
    const e = this.store.get<Execution>("Execution", eid);
    const validator = new Ajv2020();
    if (
      !validator.validate(
        this.store.read<object>(program.parameters_schema),
        params,
      )
    )
      throw Error("INVALID_PROGRAM_PARAMETERS");
    const child = spawn(process.execPath, [program.entrypoint], {
      cwd: path.join(this.workspace, e.task_id, "work"),
      env: { PATH: process.env.PATH, LANG: "en_US.UTF-8" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    entry.child = child;
    let output = "",
      error = "";
    let overflow = false;
    child.stdout.on("data", (b) => {
      this.store.commit(
        [],
        [
          this.store.event(
            "program.stdout",
            this.store.put(Buffer.from(b), "text/plain"),
            scopeOf(e),
            "PROGRAM",
          ),
        ],
      );
      if (output.length + b.length > 4 * 1024 * 1024) {
        overflow = true;
        child.kill("SIGTERM");
      } else output += String(b);
    });
    child.stderr.on("data", (b) => {
      this.store.commit(
        [],
        [
          this.store.event(
            "program.stderr",
            this.store.put(Buffer.from(b), "text/plain"),
            scopeOf(e),
            "PROGRAM",
          ),
        ],
      );
      if (error.length < 4 * 1024 * 1024) error += String(b);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ execution_id: eid, parameters: params }));
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    try {
      if (code !== 0 || overflow) throw Error("PROGRAM_EFFECT_UNCONFIRMED");
      const result = JSON.parse(output);
      if (
        !validator.validate(
          this.store.read<object>(program.result_schema),
          result,
        )
      )
        throw Error("INVALID_PROGRAM_RESULT");
      this.auth.finish(opID, { result, stdout: output, stderr: error, code });
      this.finish(eid, "SUCCEEDED", result);
    } catch (err) {
      this.auth.finish(
        opID,
        { stdout: output, stderr: error, code, error: String(err) },
        "UNKNOWN",
      );
      this.setState(eid, "RESULT_UNKNOWN", { unknown_operation_ids: [opID] });
      this.feedback(
        eid,
        "UNKNOWN",
        "Program result unknown; no automatic retry",
        this.store.put({ stdout: output, stderr: error, code }),
      );
    }
  }
  finish(
    eid: string,
    state: "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED",
    detail: unknown,
  ) {
    const e = this.store.get<Execution>("Execution", eid);
    if (terminal(e)) return;
    const ref = this.store.put(detail);
    const r: TaskResult = {
      schema_version: 1,
      record_type: "TaskResult",
      ...base(),
      task_id: e.task_id,
      execution_id: eid,
      outcome: state,
      summary: `${state}: task ${e.task_id}`,
      limitations: ["Model output is not independent verification"],
      evidence: [ref],
      artifacts: [],
      detail_ref: ref,
      needs_action: state !== "SUCCEEDED",
      verified_by: "NOT_VERIFIED",
      observed_at: now(),
    };
    const changes: Stored[] = [
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
  feedback(
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
  detail(eid: string) {
    let e = this.store.get<Execution>("Execution", eid);
    if (e.retention_state === "RETIRED")
      return {
        status: "RETIRED",
        archive: this.store
          .all<ArchiveManifest>("ArchiveManifest")
          .find((a) => a.execution_id === eid),
      };
    e = revise(e, { last_activity_at: now(), retention_state: "HOT" });
    this.store.commit([e]);
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
  answer(did: string, answer: unknown, requestID = id()) {
    const d = this.store.get<DecisionRequest>("DecisionRequest", did);
    if (d.state !== "OPEN") throw Error("DECISION_NOT_OPEN");
    const e = this.store.get<Execution>("Execution", d.execution_id);
    if (e.state !== "WAIT_DECISION") throw Error("DECISION_STALE");
    this.store.commit(
      [
        revise(d, {
          state: "ANSWERED",
          answer: { value: answer },
          answered_by: "MAIN",
          answer_request_id: requestID,
        }),
        revise(e, { state: "READY", waiting_request_ids: [] }),
      ],
      [this.store.event("decision.answered", { id: did, answer }, scopeOf(e))],
    );
  }
  cancel(eid: string) {
    const e = this.store.get<Execution>("Execution", eid);
    if (terminal(e)) return;
    if (this.running.has(eid)) {
      this.setState(eid, "CANCEL_REQUESTED", { cancel_requested: true });
      this.running.get(eid)?.agent?.abort();
      this.running.get(eid)?.child?.kill("SIGTERM");
    } else if (e.state === "RESULT_UNKNOWN")
      this.store.commit([revise(e, { cancel_requested: true })]);
    else {
      this.store.commit([revise(e, { cancel_requested: true })]);
      this.finish(eid, "CANCELLED", { reason: "Cancelled before dispatch" });
    }
  }
  retire(at = Date.now()) {
    for (const e of this.store.all<Execution>("Execution")) {
      if (
        !terminal(e) ||
        e.retention_state === "RETIRED" ||
        e.waiting_request_ids.length ||
        e.unknown_operation_ids.length ||
        e.pending_followup_ids.length ||
        this.store
          .all<Feedback>("Feedback")
          .some((f) => f.execution_id === e.id && f.state !== "HANDLED") ||
        at - Math.max(Date.parse(e.ended_at!), Date.parse(e.last_activity_at)) <
          e.retire_after_seconds * 1000
      )
        continue;
      const records = this.store.logs.filter(
        (l) => l.scope.execution_id === e.id,
      );
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
  recover() {
    for (const p of this.store.all<TaskPlan>("TaskPlan"))
      if (
        p.state === "ACTIVE" &&
        p.trigger.kind === "AT" &&
        p.next_due_at &&
        Date.parse(p.next_due_at) < Date.now()
      ) {
        this.store.commit(
          [revise(p, { state: "PAUSED", next_due_at: null })],
          [
            this.store.event("trigger.missed", {
              task_id: p.id,
              due: p.next_due_at,
              policy: "REPORT_ONLY",
            }),
          ],
        );
      }
    for (const e of this.store.all<Execution>("Execution")) {
      if (["RUNNING", "DISPATCHING", "CANCEL_REQUESTED"].includes(e.state)) {
        this.setState(e.id, "RESULT_UNKNOWN", {
          unknown_operation_ids: this.store
            .all<Operation>("Operation")
            .filter(
              (o) =>
                o.scope.execution_id === e.id && o.state === "RESULT_UNKNOWN",
            )
            .map((o) => o.id),
        });
        this.feedback(
          e.id,
          "UNKNOWN",
          "Execution interrupted; verify before resuming",
          this.store.put({ execution_id: e.id, reason: "restart" }),
        );
      }
      if (
        terminal(e) &&
        e.result_id &&
        !this.store
          .all<Feedback>("Feedback")
          .some((f) => f.result_id === e.result_id)
      ) {
        const r = this.store.get<TaskResult>("TaskResult", e.result_id);
        this.feedback(e.id, "RESULT", r.summary, r.detail_ref, r.id);
      }
    }
  }
  async idle() {
    await Promise.all([...this.running.values()].map((r) => r.promise));
  }
  async close() {
    this.closed = true;
    for (const [eid, r] of this.running) {
      this.cancel(eid);
      r.agent?.abort();
      r.child?.kill("SIGTERM");
    }
    await this.idle();
  }
}

function invocation(value: string) {
  return {
    invocationId: value,
    operationId: value,
    turnId: value,
    getMemo: async () => undefined,
    setMemo: async () => {
      throw Error("This adapter does not support replay memos");
    },
  };
}
