import type { Api, Model } from "@earendil-works/pi-ai";
import * as contextAssembly from "./context-assembly.ts";
import type { Consciousness, Input, Session } from "./contracts.ts";
import type { HostContext } from "./host-context.ts";
import { getInstructions } from "./instructions.ts";
import * as mainLoop from "./main-loop.ts";
import * as mainTools from "./main-tools.ts";
import { restoreExtractions } from "./memory-extraction.ts";
import * as memoryMaintenance from "./memory-maintenance.ts";
import * as memorySummary from "./memory-summary.ts";
import {
  Agent,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
} from "./model.ts";
import { Previews } from "./preview.ts";
import type { Scheduler } from "./scheduler.ts";
import { Store, base, id, revise } from "./store.ts";
import { Wakeups } from "./wakeups.ts";
import { World } from "./world.ts";
export class Host {
  readonly wakeups: Wakeups;
  readonly previews = new Previews();
  sessionID: string;
  private active?: Promise<void>;
  settingsBlocked: () => boolean = () => false;
  fullMemoryRefresh?: () => Promise<void>;
  private agent?: Agent;
  private closing = false;
  private maintenance?: Promise<void>;
  private extraction?: Promise<void>;
  private pressureCache?: { key: string; pressured: boolean };
  private capacityAttemptKey?: string;
  constructor(
    readonly store: Store,
    readonly scheduler: Scheduler,
    readonly model: Model<Api>,
    readonly stream: StreamFn,
    readonly world?: World,
    clock: () => number = Date.now,
  ) {
    for (const key of [
      "SECRETARY_MEMORY_UPDATE_TURNS",
      "SECRETARY_MEMORY_UPDATE_SECONDS",
      "SECRETARY_MEMORY_MIN_INTERVAL_SECONDS",
    ]) {
      if (
        process.env[key] !== undefined &&
        (!Number.isSafeInteger(Number(process.env[key])) ||
          Number(process.env[key]) <= 0)
      )
        throw Error("BUDGET_CONFIG_INVALID: " + key);
    }
    if (
      process.env.SECRETARY_COMPACTION_BYTES !== undefined &&
      !store.logs.some(
        (l) => l.event_type === "runtime.deprecated_compaction_bytes",
      )
    )
      store.commit(
        [],
        [
          store.event("runtime.deprecated_compaction_bytes", {
            message:
              "SECRETARY_COMPACTION_BYTES is ignored; use request occupancy thresholds and memory update cadence.",
          }),
        ],
      );
    getInstructions(store);
    const old = store.all<Session>("Session")[0];
    if (old) {
      this.sessionID = old.id;
      store.commit([
        revise(old, {
          state: old.state === "RUNNING" ? "IDLE" : old.state,
          owner_epoch: store.epoch,
        }),
      ]);
    } else {
      const cs: Consciousness = {
        schema_version: 1,
        record_type: "Consciousness",
        ...base(),
        session_id: id(),
        items: [],
        pending_raw_refs: [],
        covered_event_ids: [],
        last_job_id: null,
      };
      this.sessionID = cs.session_id;
      const session: Session = {
        schema_version: 1,
        record_type: "Session",
        ...base(this.sessionID),
        state: "IDLE",
        owner_epoch: store.epoch,
        active_loop_id: null,
        claimed_input_ids: [],
        last_context_id: null,
        consciousness_id: cs.id,
        last_journal_seq: store.sequence,
        recovery_error: null,
      };
      store.commit([cs, session]);
    }
    restoreExtractions(store, this.sessionID);
    this.wakeups = new Wakeups(store, this.sessionID, clock);

    this.context = this.createContext();
  }
  get session() {
    return this.store.get<Session>("Session", this.sessionID);
  }
  accept(
    text: string,
    requestID = id(),
    producer: Input["producer"] = "MASTER",
  ) {
    return mainLoop.accept.call(this.context, text, requestID, producer);
  }
  private missedOffset = 0;
  deliverFeedback() {
    return mainLoop.deliverFeedback.call(this.context);
  }
  resume() {
    return mainLoop.resume.call(this.context);
  }
  drain() {
    return mainLoop.drain.call(this.context);
  }
  previewContext(): AgentMessage[] {
    return this.history();
  }
  private history(): AgentMessage[] {
    return contextAssembly.history.call(this.context);
  }
  private toolKey(
    loopID: string,
    messageIndex: number,
    call: string,
    name: string,
    args: unknown,
  ) {
    return mainLoop.toolKey.call(
      this.context,
      loopID,
      messageIndex,
      call,
      name,
      args,
    );
  }
  private recoverTools(messages: AgentMessage[], loopID: string) {
    return mainLoop.recoverTools.call(this.context, messages, loopID);
  }
  private async run() {
    return mainLoop.run.call(this.context);
  }
  private recordInputMessages(batch: Input[], loopID: string) {
    return mainLoop.recordInputMessages.call(this.context, batch, loopID);
  }
  private finish(batch: Input[]) {
    return mainLoop.finish.call(this.context, batch);
  }
  private proposeTask(
    args: {
      goal: string;
      scope_id?: string | null;
      reuse_task_id?: string | null;
      parent_execution_id?: string | null;
      program_id?: string | null;
      at?: string | null;
      interval_seconds?: number | null;
      materials?: string[] | null;
      constraints?: string[] | null;
      acceptance_criteria?: string[] | null;
      deadline?: string | null;
    },
    call: string,
  ) {
    return mainTools.proposeTask.call(this.context, args, call);
  }
  private tools(loopID: string): AgentTool[] {
    return mainTools.tools.call(this.context, loopID);
  }
  private memoryToolResult(value: unknown) {
    return mainTools.memoryToolResult.call(this.context, value);
  }
  private memory() {
    return memoryMaintenance.memory.call(this.context);
  }
  private completedSequence() {
    return memoryMaintenance.completedSequence.call(this.context);
  }
  private memoryDue() {
    return memoryMaintenance.memoryDue.call(this.context);
  }
  private pressureKey() {
    return memoryMaintenance.pressureKey.call(this.context);
  }
  maintainIfNeeded() {
    return memoryMaintenance.maintainIfNeeded.call(this.context);
  }
  compact(reset = true) {
    return memoryMaintenance.compact.call(this.context, reset);
  }
  private project(messages: AgentMessage[]): AgentMessage[] {
    return contextAssembly.project.call(this.context, messages);
  }
  private crop(original: AgentMessage[], eligible: number): AgentMessage[] {
    return contextAssembly.crop.call(this.context, original, eligible);
  }
  private async maintain(inLoop = false) {
    return memorySummary.maintain.call(this.context, inLoop);
  }
  retryExtractions(requestID: string) {
    return memoryMaintenance.retryExtractions.call(this.context, requestID);
  }
  extractPending() {
    return memoryMaintenance.extractPending.call(this.context);
  }
  private notifyFailure(key: string, message: string) {
    return memorySummary.notifyFailure.call(this.context, key, message);
  }
  private pendingSummary() {
    return memorySummary.pendingSummary.call(this.context);
  }
  private summaryDue(job = this.pendingSummary()) {
    return memorySummary.summaryDue.call(this.context, job);
  }
  memoryStatus() {
    return memoryMaintenance.memoryStatus.call(this.context);
  }
  resolveMemoryCommitment(
    commitmentID: string,
    state: "COMPLETED" | "CANCELLED",
    note: string,
  ) {
    return memoryMaintenance.resolveMemoryCommitment.call(
      this.context,
      commitmentID,
      state,
      note,
    );
  }

  async settingsIdle() {
    await this.active;
    await this.maintenance;
    await this.extraction;
  }
  prepareSettingsInputs(
    applicationID: string,
    source: import("./settings-memory.ts").SettingsSource,
    messages: AgentMessage[],
    content: string,
  ) {
    return contextAssembly.prepareSettingsInputs.call(
      this.context,
      applicationID,
      source,
      messages,
      content,
    );
  }
  prepareSettingsContext(
    applicationID: string,
    content: string,
    instructionsRevision: number,
    messages: AgentMessage[],
    memoryRevision: number,
  ) {
    return contextAssembly.prepareSettingsContext.call(
      this.context,
      applicationID,
      content,
      instructionsRevision,
      messages,
      memoryRevision,
    );
  }

  async close() {
    this.closing = true;
    this.agent?.abort();
    await this.active;
    await this.maintenance;
    await this.extraction;
  }

  private readonly context: HostContext;

  private createContext(): HostContext {
    const owner = this;
    return {
      get session() {
        return owner.session;
      },
      get sessionID() {
        return owner.sessionID;
      },
      set sessionID(value) {
        owner.sessionID = value;
      },
      get store() {
        return owner.store;
      },
      get missedOffset() {
        return owner.missedOffset;
      },
      set missedOffset(value) {
        owner.missedOffset = value;
      },
      get active() {
        return owner.active;
      },
      set active(value) {
        owner.active = value;
      },
      get closing() {
        return owner.closing;
      },
      set closing(value) {
        owner.closing = value;
      },
      get maintenance() {
        return owner.maintenance;
      },
      set maintenance(value) {
        owner.maintenance = value;
      },
      get settingsBlocked() {
        return owner.settingsBlocked;
      },
      set settingsBlocked(value) {
        owner.settingsBlocked = value;
      },
      get wakeups() {
        return owner.wakeups;
      },
      get world() {
        return owner.world;
      },
      get agent() {
        return owner.agent;
      },
      set agent(value) {
        owner.agent = value;
      },
      get model() {
        return owner.model;
      },
      get previews() {
        return owner.previews;
      },
      get scheduler() {
        return owner.scheduler;
      },
      get stream() {
        return owner.stream;
      },
      get capacityAttemptKey() {
        return owner.capacityAttemptKey;
      },
      set capacityAttemptKey(value) {
        owner.capacityAttemptKey = value;
      },
      get pressureCache() {
        return owner.pressureCache;
      },
      set pressureCache(value) {
        owner.pressureCache = value;
      },
      get fullMemoryRefresh() {
        return owner.fullMemoryRefresh;
      },
      set fullMemoryRefresh(value) {
        owner.fullMemoryRefresh = value;
      },
      get extraction() {
        return owner.extraction;
      },
      set extraction(value) {
        owner.extraction = value;
      },
      accept: (...args) => this.accept(...args),
      drain: (...args) => this.drain(...args),
      extractPending: (...args) => this.extractPending(...args),
      run: (...args) => this.run(...args),
      proposeTask: (...args) => this.proposeTask(...args),
      toolKey: (...args) => this.toolKey(...args),
      crop: (...args) => this.crop(...args),
      deliverFeedback: (...args) => this.deliverFeedback(...args),
      finish: (...args) => this.finish(...args),
      history: (...args) => this.history(...args),
      maintain: (...args) => this.maintain(...args),
      memory: (...args) => this.memory(...args),
      memoryDue: (...args) => this.memoryDue(...args),
      notifyFailure: (...args) => this.notifyFailure(...args),
      project: (...args) => this.project(...args),
      recordInputMessages: (...args) => this.recordInputMessages(...args),
      recoverTools: (...args) => this.recoverTools(...args),
      tools: (...args) => this.tools(...args),
      memoryStatus: (...args) => this.memoryStatus(...args),
      memoryToolResult: (...args) => this.memoryToolResult(...args),
      completedSequence: (...args) => this.completedSequence(...args),
      pendingSummary: (...args) => this.pendingSummary(...args),
      summaryDue: (...args) => this.summaryDue(...args),
      compact: (...args) => this.compact(...args),
      pressureKey: (...args) => this.pressureKey(...args),
    };
  }
}
