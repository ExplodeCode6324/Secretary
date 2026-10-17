import type { Api, Model } from "@earendil-works/pi-ai";
import type { ChildProcess } from "node:child_process";
import type { Authorization } from "./authorization.ts";
import type * as effects from "./effects.ts";
import type * as executionRecovery from "./execution-recovery.ts";
import type * as executionRunner from "./execution-runner.ts";
import type * as executorTools from "./executor-tools.ts";
import type { Agent, StreamFn } from "./model.ts";
import type * as retention from "./retention.ts";
import type { Scopes } from "./scopes.ts";
import type { Store } from "./store.ts";
import type * as taskPlanning from "./task-planning.ts";
import type * as taskTriggers from "./task-triggers.ts";

/** Shared dependency types. Runtime state remains on the Scheduler instance. */
export interface SchedulerContext {
  propose: OmitThisParameter<typeof taskPlanning.propose>;
  model: Model<Api>;
  scopes: Scopes;
  store: Store;
  workspace: string;
  closed: boolean;
  processCheckAt: number;
  processWork?: Promise<void> | undefined;
  running: Map<
    string,
    { agent?: Agent; child?: ChildProcess; promise: Promise<void> }
  >;
  settingsBlocked: () => boolean;
  auth: Authorization;
  stream: StreamFn;
  assertAccess: OmitThisParameter<typeof taskPlanning.assertAccess>;
  continueTask: OmitThisParameter<typeof taskPlanning.continueTask>;
  initialize: OmitThisParameter<typeof taskTriggers.initialize>;
  proposalFor: OmitThisParameter<typeof taskPlanning.proposalFor>;
  sourceRefs: OmitThisParameter<typeof taskPlanning.sourceRefs>;
  safePath: OmitThisParameter<typeof effects.safePath>;
  validateWorkspace: OmitThisParameter<typeof taskPlanning.validateWorkspace>;
  continuationParent: OmitThisParameter<typeof taskPlanning.continuationParent>;
  detail: OmitThisParameter<typeof retention.detail>;
  requestStatus: OmitThisParameter<typeof taskPlanning.requestStatus>;
  cancel: OmitThisParameter<typeof executionRecovery.cancel>;
  removePending: OmitThisParameter<typeof taskTriggers.removePending>;
  finish: OmitThisParameter<typeof executionRunner.finish>;
  ready: OmitThisParameter<typeof taskTriggers.ready>;
  recoverProcesses: OmitThisParameter<
    typeof executionRecovery.recoverProcesses
  >;
  reportMissed: OmitThisParameter<typeof taskTriggers.reportMissed>;
  run: OmitThisParameter<typeof executionRunner.run>;
  setState: OmitThisParameter<typeof executionRunner.setState>;
  conditions: OmitThisParameter<typeof taskTriggers.conditions>;
  execute: OmitThisParameter<typeof executionRunner.execute>;
  feedback: OmitThisParameter<typeof executionRunner.feedback>;
  rootFor: OmitThisParameter<typeof effects.rootFor>;
  settleUnknownExecution: OmitThisParameter<
    typeof executionRecovery.settleUnknownExecution
  >;
  applyShell: OmitThisParameter<typeof effects.applyShell>;
  applyWrite: OmitThisParameter<typeof effects.applyWrite>;
  program: OmitThisParameter<typeof effects.program>;
  promptMaterials: OmitThisParameter<typeof taskPlanning.promptMaterials>;
  tools: OmitThisParameter<typeof executorTools.tools>;
  processStopped: OmitThisParameter<typeof executionRecovery.processStopped>;
  fileRevision: OmitThisParameter<typeof effects.fileRevision>;
  stopChild: OmitThisParameter<typeof effects.stopChild>;
  processNotice: OmitThisParameter<typeof executionRecovery.processNotice>;
}
