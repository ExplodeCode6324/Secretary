import type { Api, Model } from "@earendil-works/pi-ai";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Authorization } from "./authorization.ts";
import type {
  ConditionResult,
  Execution,
  Feedback,
  Operation,
  Precondition,
  ProgramRegistration,
  TaskPlan,
  TaskProposal,
} from "./contracts.ts";
import * as effects from "./effects.ts";
import * as executionRecovery from "./execution-recovery.ts";
import * as executionRunner from "./execution-runner.ts";
import * as executorTools from "./executor-tools.ts";
import { Agent, type AgentTool, type StreamFn } from "./model.ts";
import * as retention from "./retention.ts";
import type { SchedulerContext } from "./scheduler-context.ts";
import { Scopes } from "./scopes.ts";
import { Store, id } from "./store.ts";
import * as taskPlanning from "./task-planning.ts";
import * as taskTriggers from "./task-triggers.ts";
export { scopeOf, stableID, terminal } from "./execution-utils.ts";
export class Scheduler {
  readonly workspace: string;
  readonly scopes: Scopes;
  private running = new Map<
    string,
    { agent?: Agent; child?: ChildProcess; promise: Promise<void> }
  >();
  private closed = false;
  private processWork?: Promise<void>;
  private processCheckAt = 0;
  settingsBlocked: () => boolean = () => false;
  constructor(
    readonly store: Store,
    readonly auth: Authorization,
    readonly model: Model<Api>,
    readonly stream: StreamFn,
  ) {
    this.scopes = new Scopes(store, (eid) => this.running.has(eid));
    this.workspace = path.join(store.dir, "workspaces");
    fs.mkdirSync(this.workspace, { recursive: true });
    this.workspace = fs.realpathSync(this.workspace);

    this.context = this.createContext();
  }
  propose(
    goal: string,
    requestID = id(),
    sessionID: string,
    options: {
      scopeID?: string | null;
      reuse?: string | null;
      programID?: string | null;
      at?: string | null;
      interval?: number | null;
      parent?: string | null;
      materials?: string[] | null;
      constraints?: string[] | null;
      acceptance?: string[] | null;
      deadline?: string | null;
      preconditions?: Precondition[] | null;
    } = {},
  ): TaskPlan {
    return taskPlanning.propose.call(
      this.context,
      goal,
      requestID,
      sessionID,
      options,
    );
  }
  proposalFor(e: Execution): TaskProposal {
    return taskPlanning.proposalFor.call(this.context, e);
  }
  private sourceRefs(proposal: TaskProposal) {
    return taskPlanning.sourceRefs.call(this.context, proposal);
  }
  private promptMaterials(proposal: TaskProposal) {
    return taskPlanning.promptMaterials.call(this.context, proposal);
  }
  private assertAccess(p: TaskPlan, sessionID: string) {
    return taskPlanning.assertAccess.call(this.context, p, sessionID);
  }
  private validateWorkspace(p: TaskPlan) {
    return taskPlanning.validateWorkspace.call(this.context, p);
  }
  private continuationParent(p: TaskPlan, parentID: string, sessionID: string) {
    return taskPlanning.continuationParent.call(
      this.context,
      p,
      parentID,
      sessionID,
    );
  }
  private continueTask(
    goal: string,
    requestID: string,
    sessionID: string,
    options: Parameters<Scheduler["propose"]>[3],
    fingerprint: string,
  ): TaskPlan {
    return taskPlanning.continueTask.call(
      this.context,
      goal,
      requestID,
      sessionID,
      options,
      fingerprint,
    );
  }
  requestStatus(requestID: string) {
    return taskPlanning.requestStatus.call(this.context, requestID);
  }
  private removePending(
    taskID: string,
    requestID: string,
    reason: string,
    executionID?: string,
  ) {
    return taskTriggers.removePending.call(
      this.context,
      taskID,
      requestID,
      reason,
      executionID,
    );
  }
  cancelRequest(requestID: string, sessionID: string) {
    return taskTriggers.cancelRequest.call(this.context, requestID, sessionID);
  }
  query(
    sessionID: string,
    taskID?: string | null,
    executionID?: string | null,
  ) {
    return taskPlanning.query.call(
      this.context,
      sessionID,
      taskID,
      executionID,
    );
  }
  continuationStatus(
    taskID: string,
    executionID: string | undefined,
    sessionID: string,
  ) {
    return taskPlanning.continuationStatus.call(
      this.context,
      taskID,
      executionID,
      sessionID,
    );
  }
  initialize(taskID: string) {
    return taskTriggers.initialize.call(this.context, taskID);
  }
  private reportMissed(plan: TaskPlan, due: string) {
    return taskTriggers.reportMissed.call(this.context, plan, due);
  }
  tick(at = Date.now()) {
    return taskTriggers.tick.call(this.context, at);
  }
  ready(eid: string) {
    return taskTriggers.ready.call(this.context, eid);
  }
  private conditions(e: Execution): ConditionResult[] {
    return taskTriggers.conditions.call(this.context, e);
  }
  private setState(
    eid: string,
    state: Execution["state"],
    patch: Partial<Execution> = {},
  ) {
    return executionRunner.setState.call(this.context, eid, state, patch);
  }
  run(eid: string) {
    return executionRunner.run.call(this.context, eid);
  }
  private execute(
    eid: string,
    entry: { agent?: Agent; child?: ChildProcess },
    resumeAuth = false,
  ) {
    return executionRunner.execute.call(this.context, eid, entry, resumeAuth);
  }
  rootFor(e: Execution) {
    return effects.rootFor.call(this.context, e);
  }
  private safePath(e: Execution, relative: string) {
    return effects.safePath.call(this.context, e, relative);
  }
  private tools(e: Execution): AgentTool[] {
    return executorTools.tools.call(this.context, e);
  }
  private applyShell(op: Operation, entry: { child?: ChildProcess }) {
    return effects.applyShell.call(this.context, op, entry);
  }
  private fileRevision(target: string): string {
    return effects.fileRevision.call(this.context, target);
  }
  private applyWrite(op: Operation) {
    return effects.applyWrite.call(this.context, op);
  }
  verifyWrite(operationID: string) {
    return effects.verifyWrite.call(this.context, operationID);
  }
  processStopped(eid: string): boolean {
    return executionRecovery.processStopped.call(this.context, eid);
  }
  settleUnknownExecution(eid: string) {
    return executionRecovery.settleUnknownExecution.call(this.context, eid);
  }
  private processNotice(op: Operation) {
    return executionRecovery.processNotice.call(this.context, op);
  }
  registerProgram(entrypoint: string, name: string) {
    return effects.registerProgram.call(this.context, entrypoint, name);
  }
  private program(
    eid: string,
    program: ProgramRegistration,
    params: unknown,
    opID: string,
    entry: { child?: ChildProcess },
  ) {
    return effects.program.call(
      this.context,
      eid,
      program,
      params,
      opID,
      entry,
    );
  }
  finish(
    eid: string,
    state: "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED",
    detail: unknown,
  ) {
    return executionRunner.finish.call(this.context, eid, state, detail);
  }
  feedback(
    eid: string,
    kind: Feedback["kind"],
    summary: string,
    ref: Feedback["detail_ref"],
    resultID: string | null = null,
    decisionID: string | null = null,
  ) {
    return executionRunner.feedback.call(
      this.context,
      eid,
      kind,
      summary,
      ref,
      resultID,
      decisionID,
    );
  }
  detail(eid: string) {
    return retention.detail.call(this.context, eid);
  }
  viewed(eid: string) {
    return retention.viewed.call(this.context, eid);
  }
  answer(
    did: string,
    answer: unknown,
    requestID = id(),
    actor: "MAIN" | "MASTER" = "MAIN",
  ) {
    return executionRecovery.answer.call(
      this.context,
      did,
      answer,
      requestID,
      actor,
    );
  }
  private stopChild(child: ChildProcess) {
    return effects.stopChild.call(this.context, child);
  }
  cancel(eid: string) {
    return executionRecovery.cancel.call(this.context, eid);
  }
  retire(at = Date.now()) {
    return retention.retire.call(this.context, at);
  }
  private recoverProcesses(startup = false) {
    return executionRecovery.recoverProcesses.call(this.context, startup);
  }
  recover() {
    return executionRecovery.recover.call(this.context);
  }
  async idle() {
    await Promise.all([...this.running.values()].map((r) => r.promise));
    await this.processWork;
  }
  async close() {
    this.closed = true;
    for (const [eid, r] of this.running) {
      this.cancel(eid);
      r.agent?.abort();
      if (r.child) this.stopChild(r.child);
    }
    await this.idle();
  }

  private readonly context: SchedulerContext;

  private createContext(): SchedulerContext {
    const owner = this;
    return {
      propose: (...args) => this.propose(...args),
      get model() {
        return owner.model;
      },
      get scopes() {
        return owner.scopes;
      },
      get store() {
        return owner.store;
      },
      get workspace() {
        return owner.workspace;
      },
      get closed() {
        return owner.closed;
      },
      set closed(value) {
        owner.closed = value;
      },
      get processCheckAt() {
        return owner.processCheckAt;
      },
      set processCheckAt(value) {
        owner.processCheckAt = value;
      },
      get processWork() {
        return owner.processWork;
      },
      set processWork(value) {
        owner.processWork = value;
      },
      get running() {
        return owner.running;
      },
      set running(value) {
        owner.running = value;
      },
      get settingsBlocked() {
        return owner.settingsBlocked;
      },
      set settingsBlocked(value) {
        owner.settingsBlocked = value;
      },
      get auth() {
        return owner.auth;
      },
      get stream() {
        return owner.stream;
      },
      assertAccess: (...args) => this.assertAccess(...args),
      continueTask: (...args) => this.continueTask(...args),
      initialize: (...args) => this.initialize(...args),
      proposalFor: (...args) => this.proposalFor(...args),
      sourceRefs: (...args) => this.sourceRefs(...args),
      safePath: (...args) => this.safePath(...args),
      validateWorkspace: (...args) => this.validateWorkspace(...args),
      continuationParent: (...args) => this.continuationParent(...args),
      detail: (...args) => this.detail(...args),
      requestStatus: (...args) => this.requestStatus(...args),
      cancel: (...args) => this.cancel(...args),
      removePending: (...args) => this.removePending(...args),
      finish: (...args) => this.finish(...args),
      ready: (...args) => this.ready(...args),
      recoverProcesses: (...args) => this.recoverProcesses(...args),
      reportMissed: (...args) => this.reportMissed(...args),
      run: (...args) => this.run(...args),
      setState: (...args) => this.setState(...args),
      conditions: (...args) => this.conditions(...args),
      execute: (...args) => this.execute(...args),
      feedback: (...args) => this.feedback(...args),
      rootFor: (...args) => this.rootFor(...args),
      settleUnknownExecution: (...args) => this.settleUnknownExecution(...args),
      applyShell: (...args) => this.applyShell(...args),
      applyWrite: (...args) => this.applyWrite(...args),
      program: (...args) => this.program(...args),
      promptMaterials: (...args) => this.promptMaterials(...args),
      tools: (...args) => this.tools(...args),
      processStopped: (...args) => this.processStopped(...args),
      fileRevision: (...args) => this.fileRevision(...args),
      stopChild: (...args) => this.stopChild(...args),
      processNotice: (...args) => this.processNotice(...args),
    };
  }
}
