import type { Api, Model } from "@earendil-works/pi-ai";
import type * as contextAssembly from "./context-assembly.ts";
import type { Session } from "./contracts.ts";
import type * as mainLoop from "./main-loop.ts";
import type * as mainTools from "./main-tools.ts";
import type * as memoryMaintenance from "./memory-maintenance.ts";
import type * as memorySummary from "./memory-summary.ts";
import type { Agent, StreamFn } from "./model.ts";
import type { Previews } from "./preview.ts";
import type { Scheduler } from "./scheduler.ts";
import type { Store } from "./store.ts";
import type { Wakeups } from "./wakeups.ts";
import type { World } from "./world.ts";

/** Shared dependency types. Runtime state remains on the Host instance. */
export interface HostContext {
  session: Session;
  sessionID: string;
  store: Store;
  missedOffset: number;
  active?: Promise<void> | undefined;
  closing: boolean;
  maintenance?: Promise<void> | undefined;
  settingsBlocked: () => boolean;
  wakeups: Wakeups;
  world?: World | undefined;
  agent?: Agent | undefined;
  model: Model<Api>;
  previews: Previews;
  scheduler: Scheduler;
  stream: StreamFn;
  capacityAttemptKey?: string | undefined;
  pressureCache?: { key: string; pressured: boolean } | undefined;
  fullMemoryRefresh?: (() => Promise<void>) | undefined;
  extraction?: Promise<void> | undefined;
  accept: OmitThisParameter<typeof mainLoop.accept>;
  drain: OmitThisParameter<typeof mainLoop.drain>;
  extractPending: OmitThisParameter<typeof memoryMaintenance.extractPending>;
  run: OmitThisParameter<typeof mainLoop.run>;
  proposeTask: OmitThisParameter<typeof mainTools.proposeTask>;
  toolKey: OmitThisParameter<typeof mainLoop.toolKey>;
  crop: OmitThisParameter<typeof contextAssembly.crop>;
  deliverFeedback: OmitThisParameter<typeof mainLoop.deliverFeedback>;
  finish: OmitThisParameter<typeof mainLoop.finish>;
  history: OmitThisParameter<typeof contextAssembly.history>;
  maintain: OmitThisParameter<typeof memorySummary.maintain>;
  memory: OmitThisParameter<typeof memoryMaintenance.memory>;
  memoryDue: OmitThisParameter<typeof memoryMaintenance.memoryDue>;
  notifyFailure: OmitThisParameter<typeof memorySummary.notifyFailure>;
  project: OmitThisParameter<typeof contextAssembly.project>;
  recordInputMessages: OmitThisParameter<typeof mainLoop.recordInputMessages>;
  recoverTools: OmitThisParameter<typeof mainLoop.recoverTools>;
  tools: OmitThisParameter<typeof mainTools.tools>;
  memoryStatus: OmitThisParameter<typeof memoryMaintenance.memoryStatus>;
  memoryToolResult: OmitThisParameter<typeof mainTools.memoryToolResult>;
  completedSequence: OmitThisParameter<
    typeof memoryMaintenance.completedSequence
  >;
  pendingSummary: OmitThisParameter<typeof memorySummary.pendingSummary>;
  summaryDue: OmitThisParameter<typeof memorySummary.summaryDue>;
  compact: OmitThisParameter<typeof memoryMaintenance.compact>;
  pressureKey: OmitThisParameter<typeof memoryMaintenance.pressureKey>;
}
