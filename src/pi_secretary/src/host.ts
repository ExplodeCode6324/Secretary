import { projectContext, buildCompaction } from "./context-projection.ts";
import { assertRequestBudget, requestBudget, budgetConfig } from "./budget.ts";
import {
  createSummaryPlan,
  runSummary,
  SUMMARY_POLICY,
  type SummaryPlan,
  type SummaryCandidate,
} from "./summary.ts";
import { activitiesFor } from "./activity.ts";
import { contentText } from "@earendil-works/pi-ai";
import { extractNewCommitments } from "./memory-extraction.ts";
import {
  listExtractionRecoveryGroups,
  recoverExtractionOnce,
  type RecoveryBinding,
} from "./memory-extraction-recovery.ts";
import {
  compactionRecoverySource,
  commitRecoveredCompaction,
} from "./host-memory-recovery.ts";
import { migrateCommitments, reconcileCommitments } from "./memory.ts";
import { Type } from "typebox";
import {
  Agent,
  tool,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
} from "./model.ts";
import type { Model, Api } from "@earendil-works/pi-ai";
import { Store, base, id, now, hash, revise, type Stored } from "./store.ts";
import { Scheduler, stableID } from "./scheduler.ts";
import { World } from "./world.ts";
import { Previews } from "./preview.ts";
import { durableStream } from "./transport.ts";
import { saveContext } from "./context.ts";
import type {
  Session,
  Execution,
  TaskResult,
  TaskPlan,
  TaskProposal,
  Input,
  Context,
  Consciousness,
  Feedback,
  CompactionJob,
  Notification,
  WorldChange,
  WorldCatalogChange,
  MainPromptSnapshot,
} from "./contracts.ts";
import {
  BASE_SYSTEM,
  composeInstructions,
  getInstructions,
} from "./instructions.ts";

const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: undefined,
});
export class Host {
  readonly previews = new Previews();
  sessionID: string;
  private active?: Promise<void>;
  memoryRecoveryBusy = false;
  private recoveryDone?: Promise<void>;
  extractionRuntimeHash?: string;
  settingsRecoveryCheck?: (ownerID: string) => void;
  settingsRecoveryCommit?: (ownerID: string) => Promise<void>;
  settingsBlocked: () => boolean = () => false;
  fullMemoryRefresh?: () => Promise<void>;
  private agent?: Agent;
  private closing = false;
  private maintenance?: Promise<void>;
  private pressureCache?: { key: string; pressured: boolean };
  private capacityAttemptKey?: string;
  constructor(
    readonly store: Store,
    readonly scheduler: Scheduler,
    readonly model: Model<Api>,
    readonly stream: StreamFn,
    readonly world?: World,
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
    for (const job of store.all<CompactionJob>("CompactionJob")) {
      if (job.state === "SUMMARIZING")
        store.commit(
          [
            revise(job, {
              state: "FAILED",
              validation_errors: ["PROCESS_INTERRUPTED"],
            }),
          ],
          [
            store.event("consciousness.failed", {
              job_id: job.id,
              error: "PROCESS_INTERRUPTED",
            }),
          ],
        );
    }
    const old = store.all<Session>("Session")[0];
    if (old) {
      this.sessionID = old.id;
      store.commit([
        revise(old, {
          state: "IDLE",
          owner_epoch: store.epoch,
          recovery_error: null,
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
  }
  get session() {
    return this.store.get<Session>("Session", this.sessionID);
  }
  accept(
    text: string,
    requestID = id(),
    producer: Input["producer"] = "MASTER",
  ) {
    if (!text.trim() || Buffer.byteLength(text) > 1024 * 1024)
      throw Error("INVALID_INPUT");
    const digest = hash(JSON.stringify({ text, producer }));
    const old = this.store.receipt<string>(requestID, digest);
    if (old) return this.store.get<Input>("Input", old);
    const input: Input = {
      schema_version: 1,
      record_type: "Input",
      ...base(),
      session_id: this.sessionID,
      dedupe_key: requestID,
      producer,
      state: "ACCEPTED",
      payload: this.store.put(text, "text/plain"),
      loop_id: null,
      received_at: now(),
      feedback_id: null,
    };
    this.store.commit(
      [input],
      [
        this.store.event(
          "input.accepted",
          input,
          { session_id: this.sessionID, task_id: null, execution_id: null },
          producer === "MASTER" ? "MASTER_UI" : "SCHEDULER",
        ),
      ],
      { request: requestID, hash: digest, value: input.id },
    );
    return input;
  }
  deliverFeedback() {
    for (const log of this.store.logs.filter(
      (l) => l.event_type === "trigger.missed",
    ))
      this.accept(
        "Missed scheduled trigger: " + this.store.bytes(log.payload).toString(),
        log.event_id,
        "SCHEDULER",
      );
    for (const f of this.store
      .all<Feedback>("Feedback")
      .filter((f) => f.state === "QUEUED")) {
      this.store.bytes(f.detail_ref);
      const i: Input = {
        schema_version: 1,
        record_type: "Input",
        ...base(),
        session_id: this.sessionID,
        dedupe_key: f.id,
        producer: "SCHEDULER",
        state: "ACCEPTED",
        payload: this.store.put(
          JSON.stringify({
            summary: f.summary,
            feedback_kind: f.kind,
            execution_id: f.execution_id,
            detail_ref: f.detail_ref,
            decision_request_id: f.decision_request_id,
          }),
          "text/plain",
        ),
        loop_id: null,
        received_at: now(),
        feedback_id: f.id,
      };
      this.store.commit(
        [i, revise(f, { state: "DELIVERED", input_id: i.id })],
        [
          this.store.event(
            "feedback.delivered",
            f,
            {
              session_id: this.sessionID,
              task_id: f.task_id,
              execution_id: null,
            },
            "SCHEDULER",
          ),
        ],
      );
    }
  }
  resume() {
    this.store.commit([
      revise(this.session, { state: "IDLE", recovery_error: null }),
    ]);
    return this.drain();
  }
  drain() {
    if (this.memoryRecoveryBusy || this.settingsBlocked())
      return this.active ?? Promise.resolve();
    if (["RECOVERY_BLOCKED", "CAPACITY_BLOCKED"].includes(this.session.state))
      return Promise.resolve();
    if (this.active) return this.active;
    this.active = (async () => {
      await this.maintenance;
      await this.run();
    })().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
  previewContext(): AgentMessage[] {
    return this.history();
  }
  private history(): AgentMessage[] {
    const s = this.session;
    if (!s.last_context_id) return [];
    const c = this.store.get<Context>("Context", s.last_context_id);
    if (
      c.adapter_version !== "pi-0.87.0" ||
      c.provider_profile !== this.model.id
    )
      throw Error("INCOMPATIBLE_CONTEXT");
    let messages = this.store.read<AgentMessage[]>(c.raw_context);
    const cs = this.store.get<Consciousness>(
      "Consciousness",
      s.consciousness_id,
    );
    if (cs.last_job_id && cs.maintenance_version !== 3) {
      const job = this.store.get<CompactionJob>(
        "CompactionJob",
        cs.last_job_id,
      );
      const covered = this.store.read<AgentMessage[]>(job.source_refs[0]);
      if (
        hash(JSON.stringify(messages.slice(0, covered.length))) ===
        job.source_refs[0].sha256
      ) {
        const inputHashes = new Set(
          this.store
            .all<Input>("Input")
            .filter((i) => i.session_id === this.sessionID)
            .map((i) => i.payload.sha256),
        );
        messages = [
          {
            role: "user",
            content:
              "Working memory (source history remains queryable): " +
              JSON.stringify({
                revision: cs.revision,
                items: cs.items,
                commitments: migrateCommitments(cs),
              }),
            timestamp: Date.now(),
          },
          // Model summaries cannot certify that explicit input constraints survived.
          // Keep original user/input messages verbatim in the next model context.
          ...covered.filter(
            (m) =>
              m.role === "user" &&
              inputHashes.has(hash(contentText(m.content))),
          ),
          ...messages.slice(covered.length),
        ];
      }
    }
    return this.project(messages);
  }
  private toolKey(
    loopID: string,
    messageIndex: number,
    call: string,
    name: string,
    args: unknown,
  ) {
    return `${loopID}:${messageIndex}:${call}:${name}:${hash(JSON.stringify(args))}`;
  }
  private recoverTools(messages: AgentMessage[], loopID: string) {
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      let end = index + 1;
      while (end < messages.length && messages[end].role !== "assistant") end++;
      const results = new Set(
        messages
          .slice(index + 1, end)
          .filter((m) => m.role === "toolResult")
          .map((m) => m.toolCallId),
      );
      for (const call of message.content.filter((c) => c.type === "toolCall")) {
        if (results.has(call.id)) continue;
        const key = this.toolKey(
          loopID,
          index,
          call.id,
          call.name,
          call.arguments,
        );
        let log = this.store.logs.find(
          (l) =>
            l.event_type === "main.tool.result" &&
            this.store.read<{ key: string }>(l.payload).key === key,
        );
        // Scheduler acceptance and Host tool-result are distinct journal commits.
        // Reconcile only a proven durable proposal receipt, never replay arbitrary effects.
        if (
          !log &&
          call.name === "task_propose" &&
          this.store.hasReceipt(stableID(key))
        ) {
          const value = this.proposeTask(
            call.arguments as Parameters<Host["proposeTask"]>[0],
            stableID(key),
          );
          this.store.commit(
            [],
            [
              this.store.event(
                "main.tool.result",
                { key, result: value },
                {
                  session_id: this.sessionID,
                  task_id: null,
                  execution_id: null,
                },
                "MAIN",
              ),
            ],
          );
          log = this.store.logs.at(-1)!;
        }
        if (!log)
          throw Error(
            "RECOVERY_BLOCKED: pending tool result requires reconciliation",
          );
        const value = this.store.read<{ result: ReturnType<typeof result> }>(
          log.payload,
        ).result;
        messages.splice(end++, 0, {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: value.content,
          isError: false,
          timestamp: Date.now(),
        });
      }
    }
    return messages;
  }
  private async run() {
    while (!this.closing && !this.settingsBlocked()) {
      // A queued manual maintenance waits on this run. Yield between completed
      // batches instead of awaiting it here (which would wait on ourselves).
      if (this.maintenance) return;
      this.deliverFeedback();
      if (this.memoryDue()) await this.maintain();
      let s = this.session;
      const pending = this.store
        .all<Input>("Input")
        .filter(
          (i) => i.session_id === this.sessionID && i.state !== "HANDLED",
        );
      if (!pending.length) return;
      let batch = pending.filter((i) => i.state === "CLAIMED");
      const recovering = batch.length > 0;
      const loopID = recovering ? batch[0].loop_id! : id();
      if (!batch.length) batch = pending.filter((i) => i.state === "ACCEPTED");
      const savedContext = s.last_context_id
        ? this.store.get<Context>("Context", s.last_context_id)
        : null;
      let snapshot = this.store.find<MainPromptSnapshot>(
        "MainPromptSnapshot",
        loopID,
      );
      const newSnapshots: MainPromptSnapshot[] = [];
      if (!snapshot) {
        const legacyMessages =
          recovering && savedContext?.loop_id === loopID
            ? this.store.read<AgentMessage[]>(savedContext.raw_context)
            : [];
        const legacySystem = legacyMessages.find((m) => m.role === "system");
        const settings = getInstructions(this.store);
        const systemMessage =
          legacySystem ??
          new Agent({
            streamFn: this.stream,
            initialState: {
              model: this.model,
              systemPrompt: composeInstructions(settings.content),
              tools: this.tools(loopID),
            },
          }).state.messages[0];
        if (systemMessage.role !== "system")
          throw Error("SYSTEM_MESSAGE_MISSING");
        snapshot = {
          schema_version: 1,
          record_type: "MainPromptSnapshot",
          ...base(loopID),
          session_id: this.sessionID,
          settings_application_id:
            this.store.get<Consciousness>("Consciousness", s.consciousness_id)
              .settings_application_id ?? null,
          base_prompt_version: legacySystem ? "legacy" : hash(BASE_SYSTEM),
          instructions_revision: legacySystem ? 0 : settings.revision,
          system_prompt_hash: hash(contentText(systemMessage.content)),
          system_message: this.store.put(systemMessage),
        };
        newSnapshots.push(snapshot);
      }
      this.store.commit([
        ...newSnapshots,
        ...batch.map((i) => revise(i, { state: "CLAIMED", loop_id: loopID })),
        revise(s, {
          state: "RUNNING",
          active_loop_id: loopID,
          claimed_input_ids: batch.map((i) => i.id),
        }),
      ]);
      try {
        const savedForLoop = this.session.last_context_id
          ? this.store.get<Context>("Context", this.session.last_context_id)
              .loop_id === loopID
          : false;
        const replaying = recovering && savedForLoop;
        let messages = replaying
          ? this.store.read<AgentMessage[]>(
              this.store.get<Context>("Context", this.session.last_context_id!)
                .raw_context,
            )
          : this.history();
        const systemMessage = this.store.read<AgentMessage>(
          snapshot.system_message,
        );
        if (
          systemMessage.role !== "system" ||
          hash(contentText(systemMessage.content)) !==
            snapshot.system_prompt_hash
        )
          throw Error("PROMPT_SNAPSHOT_CORRUPT");
        if (!replaying)
          messages = [
            systemMessage,
            ...messages.filter((m) => m.role !== "system"),
          ];
        else if (
          messages[0]?.role !== "system" ||
          hash(contentText(messages[0].content)) !== snapshot.system_prompt_hash
        )
          throw Error("PROMPT_CHECKPOINT_MISMATCH");
        if (replaying) {
          const last = messages.at(-1);
          if (
            last?.role === "assistant" &&
            ["error", "aborted"].includes(last.stopReason)
          )
            messages = messages.slice(0, -1);
          messages = this.recoverTools(messages, loopID);
        }
        // Persist the entire claimed batch before any per-message event can be observed.
        if (!replaying) {
          messages.push(
            ...batch.map((i) => ({
              role: "user" as const,
              content: this.store.bytes(i.payload).toString(),
              timestamp: Date.parse(i.received_at),
            })),
          );
        }
        const protectedFromIndex = replaying
          ? (savedContext?.protected_from_index ?? 0)
          : messages.length - batch.length;
        let displayCallID: string | undefined;
        const agent = new Agent({
          initialState: {
            model: this.model,
            messages,
            tools: this.tools(loopID),
          },
          streamFn: durableStream(
            this.store,
            this.stream,
            { session_id: this.sessionID, task_id: null, execution_id: null },
            loopID,
            "MAIN",
            {
              activityPhase: batch.some((i) => i.producer === "SCHEDULER")
                ? "正在整理回复"
                : undefined,
              requestMetadata: () => ({
                sourceContextID: this.session.last_context_id,
                compactionJobID: this.memory().context_compaction?.job_id,
                consciousnessRevision: this.memory().revision,
              }),
              observe: (update) => {
                if (update.type === "start") displayCallID = update.id;
                this.previews.update(update);
              },
            },
          ),
          toolExecution: "sequential",
        });
        if (!replaying) {
          const c = saveContext(
            this.store,
            agent.state.messages,
            { session_id: this.sessionID, task_id: null, execution_id: null },
            "MAIN",
            this.model.id,
            loopID,
            this.model.contextWindow,
            { protectedFromIndex },
          );
          this.store.commit([revise(this.session, { last_context_id: c.id })]);
        }
        // The checkpoint may have committed just before a process interruption.
        // Repair missing input events on replay before completing or sending a request.
        this.recordInputMessages(batch, loopID);
        this.agent = agent;
        agent.subscribe((event) => {
          if (event.type === "message_end") {
            const c = saveContext(
              this.store,
              agent.state.messages,
              { session_id: this.sessionID, task_id: null, execution_id: null },
              "MAIN",
              this.model.id,
              loopID,
              this.model.contextWindow,
              { protectedFromIndex },
            );
            this.store.commit(
              [revise(this.session, { last_context_id: c.id })],
              [
                this.store.event(
                  "main.message",
                  event.message.role === "assistant"
                    ? { ...event.message, display_call_id: displayCallID }
                    : event.message,
                  {
                    session_id: this.sessionID,
                    task_id: null,
                    execution_id: null,
                  },
                  "MAIN",
                ),
              ],
            );
          }
        });
        agent.prepareRequest = async () => {
          const checkpoint = saveContext(
            this.store,
            agent.state.messages,
            { session_id: this.sessionID, task_id: null, execution_id: null },
            "MAIN",
            this.model.id,
            loopID,
            this.model.contextWindow,
            { protectedFromIndex },
          );
          this.store.commit([
            revise(this.session, { last_context_id: checkpoint.id }),
          ]);
          let projected = this.project(agent.state.messages);
          const beforeBudget = requestBudget(this.model, projected);
          if (
            beforeBudget.occupancy >= budgetConfig().normal &&
            protectedFromIndex > 0
          ) {
            this.store.commit(
              [],
              [
                this.store.event("context.maintenance_decision", {
                  source_context_id: checkpoint.id,
                  band:
                    beforeBudget.occupancy >= budgetConfig().forced
                      ? "FORCED"
                      : "NORMAL",
                  budget: beforeBudget,
                }),
              ],
            );
            await this.maintain(true);
            projected = this.crop(agent.state.messages, protectedFromIndex);
          }
          return {
            context: { messages: [...projected], tools: agent.state.tools },
          };
        };
        const last = messages.at(-1);
        if (
          replaying &&
          last?.role === "assistant" &&
          last.stopReason === "stop"
        ) {
          this.finish(batch);
          continue;
        }
        await agent.continue();
        if (agent.state.errorMessage) throw Error(agent.state.errorMessage);
        this.finish(batch);
      } catch (error) {
        const text = String(error);
        this.store.commit(
          [
            revise(this.session, {
              state: text.includes("CAPACITY_BLOCKED")
                ? "CAPACITY_BLOCKED"
                : "RECOVERY_BLOCKED",
              recovery_error: text,
            }),
          ],
          [this.store.event("host.blocked", { error: text })],
        );
        return;
      } finally {
        this.agent = undefined;
      }
    }
  }
  private recordInputMessages(batch: Input[], loopID: string) {
    const scope = {
      session_id: this.sessionID,
      task_id: null,
      execution_id: null,
    };
    const firstCheckpoint = this.store.logs.find(
      (event) =>
        event.event_type === "model.context" &&
        event.scope.session_id === this.sessionID &&
        this.store.read<Context>(event.payload).loop_id === loopID,
    );
    const legacy = this.store.logs.filter(
      (event) =>
        event.event_type === "main.message" &&
        event.scope.session_id === this.sessionID &&
        event.sequence > (firstCheckpoint?.sequence ?? Infinity),
    );
    const used = new Set<string>();
    for (const input of batch) {
      const eventID = stableID("main.input.message:" + input.id);
      const message: AgentMessage = {
        role: "user",
        content: this.store.bytes(input.payload).toString(),
        timestamp: Date.parse(input.received_at),
      };
      const previous = legacy.find((event) => {
        if (used.has(event.event_id)) return false;
        if (event.event_id === eventID) return true;
        // Pre-fix events used random IDs. Match each original occurrence once;
        // identical text in two Inputs must never collapse into a single source.
        const saved = this.store.read<AgentMessage>(event.payload);
        return (
          saved.role === "user" &&
          saved.timestamp === message.timestamp &&
          contentText(saved.content) === message.content
        );
      });
      if (previous) {
        used.add(previous.event_id);
        continue;
      }
      const event = this.store.event("main.message", message, scope, "MAIN");
      event.event_id = eventID;
      this.store.commit([], [event]);
    }
  }
  private finish(batch: Input[]) {
    const changes: Stored[] = batch.map((i) =>
      revise(this.store.get<Input>("Input", i.id), { state: "HANDLED" }),
    );
    for (const i of batch)
      if (i.feedback_id) {
        const f = this.store.get<Feedback>("Feedback", i.feedback_id);
        changes.push(revise(f, { state: "HANDLED" }));
      }
    const s = this.session;
    changes.push(
      revise(s, {
        state: "IDLE",
        active_loop_id: null,
        claimed_input_ids: [],
        recovery_error: null,
      }),
    );
    const cs = this.store.get<Consciousness>(
      "Consciousness",
      s.consciousness_id,
    );
    if (s.last_context_id) {
      const c = this.store.get<Context>("Context", s.last_context_id);
      changes.push(revise(cs, { pending_raw_refs: [c.raw_context] }));
    }
    this.store.commit(changes, [
      this.store.event(
        "input.handled",
        { inputs: batch.map((i) => i.id) },
        { session_id: this.sessionID, task_id: null, execution_id: null },
      ),
    ]);
  }
  private proposeTask(
    args: {
      goal: string;
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
    return result({
      ...this.scheduler.propose(args.goal, call, this.sessionID, {
        reuse: args.reuse_task_id ?? undefined,
        programID: args.program_id ?? undefined,
        at: args.at ?? undefined,
        interval: args.interval_seconds ?? undefined,
        parent: args.parent_execution_id ?? undefined,
        materials: args.materials ?? undefined,
        constraints: args.constraints ?? undefined,
        acceptance: args.acceptance_criteria ?? undefined,
        deadline: args.deadline ?? undefined,
      }),
      acceptance: this.scheduler.requestStatus(call),
    });
  }
  private tools(loopID: string): AgentTool[] {
    const wrap = (tools: AgentTool[]) =>
      tools.map(
        (t) =>
          ({
            ...t,
            execute: async (
              call: string,
              args: never,
              signal?: AbortSignal,
            ) => {
              const claimed = this.store
                .all<Input>("Input")
                .filter((i) => i.loop_id === loopID);
              const uncertainFeedback = claimed.some(
                (i) =>
                  i.feedback_id &&
                  this.store.get<Feedback>("Feedback", i.feedback_id).kind ===
                    "UNKNOWN",
              );
              if (
                t.name === "task_propose" &&
                uncertainFeedback &&
                !claimed.some((i) => i.producer === "MASTER")
              )
                throw Error(
                  "UNKNOWN_EFFECT_STOP: query evidence and notify Master; no autonomous replacement or verification task from this uncertain feedback. Wait for Master instructions.",
                );
              const messageIndex =
                this.agent?.state.messages.findLastIndex(
                  (m) => m.role === "assistant",
                ) ?? -1;
              const key = this.toolKey(
                loopID,
                messageIndex,
                call,
                t.name,
                args,
              );
              const previous = this.store.logs.find(
                (l) =>
                  l.event_type === "main.tool.result" &&
                  this.store.read<{ key: string }>(l.payload).key === key,
              );
              if (previous)
                return this.store.read<{ result: ReturnType<typeof result> }>(
                  previous.payload,
                ).result;
              const value = await activitiesFor(this.store).tool(
                "tool:" + hash(key),
                {
                  session_id: this.sessionID,
                  task_id: null,
                  execution_id: null,
                },
                t.name,
                args,
                () => t.execute(stableID(key), args, signal),
                { loop_id: loopID },
              );
              this.store.commit(
                [],
                [
                  this.store.event(
                    "main.tool.result",
                    { key, result: value },
                    {
                      session_id: this.sessionID,
                      task_id: null,
                      execution_id: null,
                    },
                    "MAIN",
                  ),
                ],
              );
              return value;
            },
          }) as AgentTool,
      );
    return wrap([
      tool({
        name: "task_propose",
        label: "Propose task",
        description:
          "Submit new AGENT task by default; PROGRAM only with a registered program_id. For revisions of existing work, use reuse_task_id and its latest ended parent_execution_id; query tasks when identity or requirements are unclear. Reuse inherits omitted/null constraints, acceptance, deadline and executor; explicit arrays replace that field, so preserve unchanged requirements. goal is this round's complete goal. No at/interval on reuse. Independent deliverables use a new task. Scheduler generates the executor packet. Include all relevant constraints and materials. Use null for unspecified optional fields; do not invent program IDs, dates or deadlines.",
        parameters: Type.Object({
          goal: Type.String(),
          reuse_task_id: Type.Optional(
            Type.Union([Type.String(), Type.Null()]),
          ),
          materials: Type.Optional(
            Type.Union([Type.Array(Type.String()), Type.Null()]),
          ),
          program_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          interval_seconds: Type.Optional(
            Type.Union([Type.Number(), Type.Null()]),
          ),
          parent_execution_id: Type.Optional(
            Type.Union([Type.String(), Type.Null()]),
          ),
          constraints: Type.Optional(
            Type.Union([Type.Array(Type.String()), Type.Null()]),
          ),
          acceptance_criteria: Type.Optional(
            Type.Union([Type.Array(Type.String()), Type.Null()]),
          ),
          deadline: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        }),
        execute: async (call, args) => this.proposeTask(args, call),
      }),
      tool({
        name: "task_query",
        label: "Query tasks",
        description:
          "Discover tasks with readable goals and continuation eligibility, read task baseline/latest requirements and results by task_id, or exact execution details by execution_id. Supply at most one ID.",
        parameters: Type.Object({
          task_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          execution_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        }),
        execute: async (_call, args) =>
          result(
            this.scheduler.query(
              this.sessionID,
              args.task_id,
              args.execution_id,
            ),
          ),
      }),
      tool({
        name: "task_control",
        label: "Control tasks",
        description:
          "Cancel execution, cancel_request using the accepted request_id (also cancels its execution if dispatched), or answer ordinary decision. Cannot approve authorization.",
        parameters: Type.Object({
          action: Type.Union([
            Type.Literal("cancel"),
            Type.Literal("cancel_request"),
            Type.Literal("answer"),
          ]),
          id: Type.String(),
          answer: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        }),
        execute: async (call, args) => {
          if (args.action === "cancel_request")
            this.scheduler.cancelRequest(args.id, this.sessionID);
          else if (args.action === "cancel") this.scheduler.cancel(args.id);
          else this.scheduler.answer(args.id, args.answer, call);
          return result({ accepted: true });
        },
      }),
      tool({
        name: "memory_read",
        label: "Read memory",
        description: "Read working memory, logs or World Model.",
        parameters: Type.Object({
          source: Type.Union([
            Type.Literal("world"),
            Type.Literal("consciousness"),
            Type.Literal("log"),
          ]),
          subject_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          event_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        }),
        execute: async (_call, args) => {
          if (args.source === "world") {
            if (!this.world)
              throw Error("WORLD_UNAVAILABLE: PostgreSQL not configured");
            return result(await this.world.read(args.subject_id ?? null));
          }
          if (args.source === "consciousness")
            return result({
              ...this.store.get<Consciousness>(
                "Consciousness",
                this.session.consciousness_id,
              ),
              maintenance: this.memoryStatus(),
            });
          return result(
            args.event_id
              ? this.store.logs
                  .filter((e) => e.event_id === args.event_id)
                  .map((e) => ({
                    event: e,
                    original: this.store.bytes(e.payload).toString(),
                  }))
              : this.store.logs.slice(-30),
          );
        },
      }),
      tool({
        name: "memory_propose_change",
        label: "Propose World Model change",
        description:
          "Submit a schema-valid WorldChange or WorldCatalogChange JSON. Backend authorization is mandatory.",
        parameters: Type.Object({ change_json: Type.String() }),
        execute: async (_call, args) => {
          if (!this.world) throw Error("WORLD_UNAVAILABLE");
          const change = JSON.parse(args.change_json) as
            WorldChange | WorldCatalogChange;
          return result(
            this.world.propose(change, {
              session_id: this.sessionID,
              task_id: null,
              execution_id: null,
            }),
          );
        },
      }),
      tool({
        name: "MasterInteract",
        label: "Notify Master",
        description:
          "Save a normal notification to Master. Does not grant authorization.",
        parameters: Type.Object({ message: Type.String() }),
        execute: async (call, args) => {
          const n: Notification = {
            schema_version: 1,
            record_type: "Notification",
            ...base(),
            state: "QUEUED",
            session_id: this.sessionID,
            channel: "local-ui",
            message: this.store.put(args.message, "text/plain"),
            delivery_key: call,
            receipt: null,
            requested_at: now(),
          };
          this.store.commit(
            [n],
            [
              this.store.event(
                "notification.queued",
                n,
                {
                  session_id: this.sessionID,
                  task_id: null,
                  execution_id: null,
                },
                "MAIN",
              ),
            ],
          );
          return result({ notification_id: n.id });
        },
      }),
    ]);
  }
  private memory() {
    return this.store.get<Consciousness>(
      "Consciousness",
      this.session.consciousness_id,
    );
  }
  private completedSequence() {
    return (
      this.store.logs
        .filter(
          (l) =>
            l.scope.session_id === this.sessionID &&
            l.event_type === "input.handled",
        )
        .at(-1)?.sequence ?? 0
    );
  }
  private memoryDue() {
    if (
      this.settingsBlocked() ||
      this.session.state !== "IDLE" ||
      this.maintenance
    )
      return false;
    const cs = this.memory(),
      start = cs.covered_event_sequence ?? 0;
    const turns = this.store.logs.filter(
      (l) =>
        l.scope.session_id === this.sessionID &&
        l.event_type === "input.handled" &&
        l.sequence > start,
    );
    if (!turns.length) return false;
    const jobs = this.store
      .all<CompactionJob>("CompactionJob")
      .filter(
        (j) =>
          j.session_id === this.sessionID && j.mode !== "CONTEXT_COMPACTION",
      );
    // A later message must not silently replay an already failed prefix.
    if (
      jobs.some(
        (j) =>
          j.state === "FAILED" &&
          (j.source_start_sequence ?? 0) === start &&
          j.policy_id === SUMMARY_POLICY,
      )
    )
      return false;
    const critical = this.store.logs.some(
      (l) =>
        l.scope.session_id === this.sessionID &&
        l.sequence > start &&
        l.sequence <= this.completedSequence() &&
        l.event_type === "feedback.delivered",
    );
    const last = jobs.at(-1);
    if (
      !critical &&
      last &&
      Date.now() - Date.parse(last.updated_at) <
        Number(process.env.SECRETARY_MEMORY_MIN_INTERVAL_SECONDS ?? 120) * 1000
    )
      return false;
    const oldest = turns[0].occurred_at;
    return (
      critical ||
      turns.length >= Number(process.env.SECRETARY_MEMORY_UPDATE_TURNS ?? 8) ||
      (!!oldest &&
        Date.now() - Date.parse(oldest) >=
          Number(process.env.SECRETARY_MEMORY_UPDATE_SECONDS ?? 60) * 1000)
    );
  }
  private pressureKey() {
    return `${this.session.last_context_id}:${this.memory().revision}:${JSON.stringify(budgetConfig())}`;
  }
  maintainIfNeeded() {
    if (this.memoryRecoveryBusy) return;
    if (this.active || this.maintenance || this.settingsBlocked()) return;
    const key = this.pressureKey();
    if (this.pressureCache?.key !== key)
      this.pressureCache = {
        key,
        pressured:
          !!this.session.last_context_id &&
          requestBudget(this.model, this.history()).occupancy >=
            budgetConfig().normal,
      };
    const pressure =
      this.pressureCache.pressured && this.capacityAttemptKey !== key;
    if (!this.memoryDue() && !pressure) return;
    const cs = this.memory();
    if (
      this.store
        .all<CompactionJob>("CompactionJob")
        .some(
          (j) =>
            j.session_id === this.sessionID &&
            j.state === "FAILED" &&
            (j.source_start_sequence ?? 0) ===
              (cs.covered_event_sequence ?? 0) &&
            j.policy_id === SUMMARY_POLICY,
        )
    )
      return;
    void this.compact();
  }
  compact() {
    if (this.memoryRecoveryBusy)
      return Promise.reject(Error("MEMORY_RECOVERY_IN_PROGRESS"));
    if (this.settingsBlocked())
      return Promise.reject(Error("SETTINGS_APPLICATION_IN_PROGRESS"));
    if (this.maintenance) return this.maintenance;
    const active = this.active;
    if (this.memory().pending_raw_refs.length > 1 && this.fullMemoryRefresh)
      return (async () => {
        await active;
        await this.fullMemoryRefresh!();
      })();
    this.maintenance = (async () => {
      await active;
      await this.maintain();
      if (this.session.last_context_id) {
        const c = this.store.get<Context>(
          "Context",
          this.session.last_context_id,
        );
        const messages = this.store.read<AgentMessage[]>(c.raw_context);
        const eligible = this.session.active_loop_id
          ? (c.protected_from_index ?? 0)
          : messages.length;
        if (
          requestBudget(this.model, this.project(messages)).occupancy >=
          budgetConfig().normal
        )
          this.crop(messages, eligible);
      }
    })().finally(() => {
      try {
        // Explicit maintenance may remove a capacity block, but never a recovery block.
        // Revalidate complete queued input material, not only the historical projection.
        if (this.session.state === "CAPACITY_BLOCKED") {
          const next = this.history();
          if (!this.session.active_loop_id)
            next.push(
              ...this.store
                .all<Input>("Input")
                .filter(
                  (i) =>
                    i.session_id === this.sessionID && i.state === "ACCEPTED",
                )
                .map((i) => ({
                  role: "user" as const,
                  content: this.store.bytes(i.payload).toString(),
                  timestamp: Date.parse(i.received_at),
                })),
            );
          try {
            assertRequestBudget(this.model, next, {
              tools: this.tools(this.session.active_loop_id ?? id()),
            });
            this.store.commit([
              revise(this.session, { state: "IDLE", recovery_error: null }),
            ]);
          } catch {
            /* Keep the explicit block and original evidence. */
          }
        }
        this.capacityAttemptKey = this.pressureKey();
      } finally {
        this.maintenance = undefined;
      }
    });
    return this.maintenance;
  }
  private project(messages: AgentMessage[]): AgentMessage[] {
    return projectContext({
      store: this.store,
      sessionID: this.sessionID,
      consciousness: this.memory(),
      messages,
    });
  }
  private crop(original: AgentMessage[], eligible: number): AgentMessage[] {
    const cs = this.memory();
    const candidate = buildCompaction({
      store: this.store,
      sessionID: this.sessionID,
      consciousness: { ...cs, revision: cs.revision + 1 },
      messages: original,
      protectedFromIndex: eligible,
      model: this.model,
    });
    if (!candidate) return this.project(original);
    const sourceRef = this.store.put(candidate.source),
      messagesRef = this.store.put(candidate.replacement);
    if (
      cs.context_compaction?.source_ref.sha256 === sourceRef.sha256 &&
      cs.context_compaction.messages_ref.sha256 === messagesRef.sha256
    )
      return this.project(original);
    const before = requestBudget(this.model, this.project(original)),
      after = requestBudget(this.model, candidate.projected);
    if (after.estimated_tokens >= before.estimated_tokens)
      return this.project(original);
    const job: CompactionJob = {
      schema_version: 1,
      record_type: "CompactionJob",
      ...base(),
      session_id: this.sessionID,
      state: "COMMITTED",
      base_revision: cs.revision,
      source_refs: [sourceRef],
      source_event_ids: [],
      covered_event_ids: [],
      candidate_ref: messagesRef,
      validation_errors: [],
      mode: "CONTEXT_COMPACTION",
      policy_id: before.policy_id,
      source_end_sequence: cs.covered_event_sequence ?? 0,
      target_reached: candidate.targetReached,
    };
    this.store.commit(
      [
        job,
        revise(cs, {
          context_compaction: {
            job_id: job.id,
            source_ref: sourceRef,
            messages_ref: messagesRef,
            source_end_sequence: cs.covered_event_sequence ?? 0,
          },
        }),
      ],
      [
        this.store.event("context.compacted", {
          job_id: job.id,
          before,
          after,
          target_reached: candidate.targetReached,
          reason: candidate.targetReached
            ? "TARGET_REACHED"
            : "PRESERVED_INPUT_OR_ACTIVE_PROTOCOL_EXCEEDS_TARGET",
        }),
      ],
    );
    return this.project(original);
  }
  private async maintain(inLoop = false) {
    const session = this.session;
    if (
      (!inLoop && !["IDLE", "CAPACITY_BLOCKED"].includes(session.state)) ||
      !session.last_context_id
    )
      return;
    const cs = this.memory(),
      sourceRef = cs.pending_raw_refs[0],
      sourceEnd = this.completedSequence();
    if (!sourceRef || sourceEnd <= (cs.covered_event_sequence ?? 0)) return;
    if (
      inLoop &&
      this.store
        .all<CompactionJob>("CompactionJob")
        .some(
          (j) =>
            j.session_id === this.sessionID &&
            j.state === "FAILED" &&
            (j.source_start_sequence ?? 0) ===
              (cs.covered_event_sequence ?? 0) &&
            j.policy_id === SUMMARY_POLICY,
        )
    )
      return;
    const delta = this.store.logs.filter(
      (l) =>
        l.scope.session_id === this.sessionID &&
        l.event_type === "main.message" &&
        l.sequence > (cs.covered_event_sequence ?? 0) &&
        l.sequence <= sourceEnd,
    );
    const sources = delta.map((l) => l.event_id);
    const evidence = this.store.put(
      delta.map((l) => this.store.read<AgentMessage>(l.payload)),
    );
    let job: CompactionJob = {
      schema_version: 1,
      record_type: "CompactionJob",
      ...base(),
      state: "SUMMARIZING",
      session_id: this.sessionID,
      base_revision: cs.revision,
      source_event_ids: sources,
      source_refs: [sourceRef, evidence],
      candidate_ref: null,
      covered_event_ids: [],
      validation_errors: [],
      memory_version: 2,
      attempt: 1,
      source_start_sequence: cs.covered_event_sequence ?? 0,
      source_end_sequence: sourceEnd,
      mode: "WORKING_MEMORY",
      policy_id: SUMMARY_POLICY,
    };
    this.store.commit(
      [job],
      [
        this.store.event("consciousness.started", {
          job_id: job.id,
          base_revision: cs.revision,
          source_end_sequence: sourceEnd,
        }),
      ],
    );
    const activity = activitiesFor(this.store),
      activityID = "compaction:" + job.id;
    activity.start(
      activityID,
      { session_id: this.sessionID, task_id: null, execution_id: null },
      "compaction",
      "正在更新工作记忆",
    );
    const runtimeTasks = () =>
      this.store
        .all<Execution>("Execution")
        .filter((e) => {
          const plan = this.store.find<TaskPlan>("TaskPlan", e.task_id);
          return (
            !!plan &&
            this.store.read<TaskProposal>(e.proposal_ref ?? plan.proposal_ref)
              .session_id === this.sessionID
          );
        })
        .map((e) => ({
          execution_id: e.id,
          task_id: e.task_id,
          state: e.state,
          updated_at: e.updated_at,
          result: e.result_id
            ? this.store.get<TaskResult>("TaskResult", e.result_id).summary
            : null,
        }));
    const tasks = runtimeTasks();
    try {
      const plan = createSummaryPlan({
        model: this.model,
        items: cs.items,
        commitments: migrateCommitments(cs),
        sources: delta.map((l) => ({
          id: l.event_id,
          text: JSON.stringify({
            event_id: l.event_id,
            sequence: l.sequence,
            source_ref: l.payload,
            message: this.store.read(l.payload),
          }),
        })),
        extra: {
          runtime_tasks: tasks,
          source_end_sequence: sourceEnd,
          delivered_notifications: this.store.logs
            .filter(
              (l) =>
                l.event_type === "notification.result" &&
                l.sequence <= sourceEnd,
            )
            .map((l) => {
              const n = this.store.read<Notification>(l.payload);
              return n.session_id === this.sessionID
                ? {
                    event_id: l.event_id,
                    state: n.state,
                    message: this.store.bytes(n.message).toString(),
                  }
                : null;
            })
            .filter(Boolean)
            .slice(-12),
        },
      });
      // A successful summary remains reusable if the separate extraction stage failed.
      const previous = this.store
        .all<CompactionJob>("CompactionJob")
        .filter(
          (j) =>
            j.id !== job.id &&
            j.session_id === this.sessionID &&
            j.base_revision === cs.revision &&
            j.source_end_sequence === sourceEnd &&
            j.policy_id === SUMMARY_POLICY &&
            j.progress_ref,
        )
        .at(-1);
      const progress = previous?.progress_ref
        ? this.store.read<{ plan: SummaryPlan; candidate: SummaryCandidate }>(
            previous.progress_ref,
          )
        : null;
      const reusable =
        progress &&
        progress.plan.source_hash === plan.source_hash &&
        progress.candidate.completed === progress.plan.chunks.length &&
        JSON.stringify(progress.plan.extra) === JSON.stringify(plan.extra)
          ? progress.candidate
          : null;
      const candidate = await runSummary({
        store: this.store,
        model: this.model,
        stream: this.stream,
        sessionID: this.sessionID,
        loopID: job.id,
        consciousnessRevision: cs.revision,
        refs: [sourceRef, evidence],
        plan,
        commitments: migrateCommitments(cs),
        candidate: reusable ?? { items: cs.items, completed: 0 },
        checkpoint: (candidate) => {
          job = revise(this.store.get<CompactionJob>("CompactionJob", job.id), {
            progress_ref: this.store.put({ plan, candidate }),
          });
          this.store.commit([job]);
        },
        progress: (index, attempt, error) => {
          job = revise(this.store.get<CompactionJob>("CompactionJob", job.id), {
            attempt,
            validation_errors: error
              ? [...job.validation_errors, error]
              : job.validation_errors,
          });
          this.store.commit(
            [job],
            [
              this.store.event(
                attempt > 1 ? "consciousness.retry" : "consciousness.segment",
                {
                  job_id: job.id,
                  segment: index,
                  attempt,
                  previous_error: error,
                },
              ),
            ],
          );
          activity.step(activityID, "正在更新工作记忆", {
            attempt,
            max_attempts: 2,
          });
        },
      });
      const items = candidate.items;
      const quotes = await extractNewCommitments({
        store: this.store,
        model: this.model,
        stream: this.stream,
        sessionID: this.sessionID,
        loopID: job.id,
        consciousnessRevision: cs.revision,
        runtimeConfigHash: this.extractionRuntimeHash,
        source: null,
        existing: migrateCommitments(cs),
        completeMessages: delta.flatMap((l) => {
          const m = this.store.read<AgentMessage>(l.payload);
          return m.role === "user" || m.role === "assistant"
            ? [{ id: l.event_id, role: m.role, text: contentText(m.content) }]
            : [];
        }),
      });
      if (items.length) items[0].unfulfilled_commitments = quotes;
      const current = this.memory(),
        latest = this.store.get<CompactionJob>("CompactionJob", job.id);
      if (
        current.revision !== cs.revision ||
        JSON.stringify(runtimeTasks()) !== JSON.stringify(tasks)
      ) {
        this.store.commit(
          [revise(latest, { state: "STALE" })],
          [this.store.event("consciousness.stale", { job_id: job.id })],
        );
        return;
      }
      const commitments = reconcileCommitments(
        this.store,
        cs,
        items,
        evidence,
        candidate.resolutions ?? [],
        sourceEnd,
        {
          owner_type: "CompactionJob",
          owner_id: job.id,
          source_event_ids: sources,
          source_end_sequence: sourceEnd,
        },
      );
      items.forEach((item) => {
        item.unfulfilled_commitments = [];
      });
      this.store.commit(
        [
          revise(current, {
            items,
            commitments,
            covered_event_ids: sources,
            pending_raw_refs: [sourceRef],
            last_job_id: job.id,
            covered_event_sequence: sourceEnd,
            maintenance_version: 3,
            memory_source_ref: sourceRef,
            memory_updated_at: now(),
          }),
          revise(latest, {
            state: "COMMITTED",
            candidate_ref: this.store.put({ items, commitments }),
            covered_event_ids: sources,
          }),
        ],
        [
          this.store.event("consciousness.committed", {
            job_id: job.id,
            source_end_sequence: sourceEnd,
          }),
        ],
      );
    } catch (error) {
      const latest = this.store.get<CompactionJob>("CompactionJob", job.id);
      this.store.commit(
        [
          revise(latest, {
            state: "FAILED",
            validation_errors: [...latest.validation_errors, String(error)],
          }),
        ],
        [
          this.store.event("consciousness.failed", {
            job_id: job.id,
            error: String(error),
          }),
        ],
      );
    } finally {
      activity.end(
        activityID,
        this.store.get<CompactionJob>("CompactionJob", job.id).state ===
          "COMMITTED"
          ? "succeeded"
          : "failed",
      );
    }
  }
  private extractionRecoveryOptions() {
    return {
      store: this.store,
      model: this.model,
      sessionID: this.sessionID,
      consciousnessRevision: this.memory().revision,
      runtimeConfigHash: this.extractionRuntimeHash,
    };
  }
  private checkRecoveryGroup(group: { loop_id: string; attempt_id: string }) {
    this.checkRecoveryOwner(group.loop_id);
    const currentOwner =
      this.store.find<CompactionJob>("CompactionJob", group.loop_id) ??
      this.store.get<import("./contracts.ts").SettingsApplication>(
        "SettingsApplication",
        group.loop_id,
      );
    let frozenOwner: typeof currentOwner | undefined;
    let foundOriginal = false;
    for (const frame of this.store.projectionFrames) {
      for (const mutation of frame.mutations)
        if (
          mutation.object_type === currentOwner.record_type &&
          mutation.object_id === currentOwner.id
        )
          frozenOwner = this.store.read<typeof currentOwner>(mutation.snapshot);
      if (
        frame.log_records.some((event) => {
          if (
            event.event_type !== "memory.extraction.started" ||
            event.scope.session_id !== this.sessionID
          )
            return false;
          const value = this.store.read<{
            loop_id?: string;
            parent_attempt_id?: string | null;
          }>(event.payload);
          return value.loop_id === group.loop_id && !value.parent_attempt_id;
        })
      ) {
        foundOriginal = true;
        break;
      }
    }
    if (!foundOriginal || !frozenOwner)
      throw Error("RECOVERY_FROZEN_OWNER_UNAVAILABLE");
    const fields =
      currentOwner.record_type === "CompactionJob"
        ? [
            "session_id",
            "base_revision",
            "source_refs",
            "source_event_ids",
            "source_start_sequence",
            "source_end_sequence",
            "mode",
            "policy_id",
            "progress_ref",
          ]
        : [
            "session_id",
            "source_ref",
            "payload_ref",
            "request_hash",
            "runtime_settings_hash",
          ];
    for (const field of fields)
      if (
        JSON.stringify(
          (currentOwner as unknown as Record<string, unknown>)[field],
        ) !==
        JSON.stringify(
          (frozenOwner as unknown as Record<string, unknown>)[field],
        )
      )
        throw Error("RECOVERY_FROZEN_OWNER_MISMATCH: " + field);
    const start = this.store.logs.findLast(
      (e) =>
        e.event_type === "memory.extraction.started" &&
        e.scope.session_id === this.sessionID &&
        this.store.read<{ attempt_id?: string }>(e.payload).attempt_id ===
          group.attempt_id,
    );
    const attempt = start
      ? this.store.read<{ source_ref?: import("./contracts.ts").ObjectRef }>(
          start.payload,
        )
      : null;
    if (!attempt?.source_ref)
      throw Error("RECOVERY_SOURCE_EVIDENCE_UNAVAILABLE");
    const source = this.store.read<unknown>(attempt.source_ref);
    if (!Array.isArray(source) || !source.length)
      throw Error("RECOVERY_OWNER_SOURCE_MISMATCH");
    const job = this.store.find<CompactionJob>("CompactionJob", group.loop_id);
    let messages: { id: string; role?: string; text: string }[];
    if (job) {
      messages = job.source_event_ids.flatMap((eventID) => {
        const event = this.store.logs.find(
          (e) =>
            e.event_id === eventID &&
            e.scope.session_id === this.sessionID &&
            e.event_type === "main.message",
        );
        if (!event) throw Error("RECOVERY_OWNER_SOURCE_MISMATCH");
        const m = this.store.read<AgentMessage>(event.payload);
        return m.role === "user" || m.role === "assistant"
          ? [{ id: eventID, role: m.role, text: contentText(m.content) }]
          : [];
      });
    } else {
      const a = this.store.get<import("./contracts.ts").SettingsApplication>(
        "SettingsApplication",
        group.loop_id,
      );
      if (!a.source_ref) throw Error("RECOVERY_SOURCE_EVIDENCE_UNAVAILABLE");
      messages = this.store.read<import("./settings-memory.ts").SettingsSource>(
        a.source_ref,
      ).extraction_messages;
    }
    let previous = -1;
    for (const entry of source) {
      const index = messages.findIndex(
        (m, index) =>
          index > previous &&
          m.id === entry.id &&
          m.role === entry.role &&
          m.text === entry.text,
      );
      if (index < 0) throw Error("RECOVERY_OWNER_SOURCE_MISMATCH");
      previous = index;
    }
  }
  private checkRecoveryOwner(ownerID: string) {
    if (this.store.find("CompactionJob", ownerID))
      compactionRecoverySource(this, ownerID);
    else if (
      this.store.find("SettingsApplication", ownerID) &&
      this.settingsRecoveryCheck
    )
      this.settingsRecoveryCheck(ownerID);
    else throw Error("RECOVERY_OWNER_UNAVAILABLE");
  }
  memoryRecoveryPreflight(groupKey?: string) {
    return listExtractionRecoveryGroups(this.extractionRecoveryOptions())
      .filter((g) => !groupKey || g.group_key === groupKey)
      .map((g) => {
        const event = this.store.logs.findLast(
          (e) =>
            e.event_type === "memory.extraction.started" &&
            this.store.read<{ attempt_id?: string }>(e.payload).attempt_id ===
              g.attempt_id,
        );
        let sources: {
          id: string;
          role: string | null;
          sequence: number | null;
        }[] = [];
        if (event) {
          const saved = this.store.read<{
            source_ref?: import("./contracts.ts").ObjectRef;
          }>(event.payload);
          if (saved.source_ref) {
            const source = this.store.read<unknown>(saved.source_ref);
            if (Array.isArray(source))
              sources = source.map((m: { id?: string; role?: string }) => ({
                id: String(m.id ?? ""),
                role: m.role ?? null,
                sequence:
                  this.store.logs.find((e) => e.event_id === m.id)?.sequence ??
                  null,
              }));
          }
        }
        const view = { ...g, source_count: sources.length, sources };
        try {
          this.checkRecoveryGroup(g);
          return view;
        } catch (error) {
          return {
            ...view,
            status: "BLOCKED" as const,
            reason: String(error),
            binding: null,
          };
        }
      });
  }
  async recoverMemory(request: RecoveryBinding & { request_id: string }) {
    if (
      !request ||
      typeof request !== "object" ||
      ![
        "request_id",
        "group_key",
        "attempt_id",
        "policy",
        "implementation_version",
        "config_hash",
        "source_hash",
      ].every(
        (key) =>
          typeof (request as unknown as Record<string, unknown>)[key] ===
            "string" &&
          String((request as unknown as Record<string, unknown>)[key]).length >
            0,
      ) ||
      ![
        request.model_call_id,
        request.model_request_hash,
        request.actual_payload_hash,
      ].every((value) => value === null || typeof value === "string") ||
      !Number.isSafeInteger(request.expected_revision)
    )
      throw Error("INVALID_RECOVERY_REQUEST");
    if (
      this.memoryRecoveryBusy ||
      this.active ||
      this.maintenance ||
      this.closing
    )
      throw Error("MEMORY_RECOVERY_BUSY");
    this.memoryRecoveryBusy = true;
    let completeRecovery!: () => void;
    this.recoveryDone = new Promise<void>((resolve) => {
      completeRecovery = resolve;
    });
    try {
      const groups = listExtractionRecoveryGroups(
        this.extractionRecoveryOptions(),
      );
      const group = groups.find((g) => g.group_key === request.group_key);
      if (!group) throw Error("RECOVERY_GROUP_NOT_FOUND");
      this.checkRecoveryGroup(group);
      const ownerCommitted =
        this.store.find<CompactionJob>("CompactionJob", group.loop_id)
          ?.state === "COMMITTED" ||
        this.store.find<import("./contracts.ts").SettingsApplication>(
          "SettingsApplication",
          group.loop_id,
        )?.state === "APPLIED";
      const result = await recoverExtractionOnce({
        ...this.extractionRecoveryOptions(),
        stream: this.stream,
        request,
      });
      if (result.status !== "SUCCEEDED") return result;
      try {
        const finalCheck = listExtractionRecoveryGroups(
          this.extractionRecoveryOptions(),
        ).find((g) => g.group_key === request.group_key);
        if (!ownerCommitted && (!finalCheck || finalCheck.status === "BLOCKED"))
          throw Error(
            "EXTRACTION_RECOVERY_BLOCKED: " +
              (finalCheck?.reason ?? "GROUP_MISSING"),
          );
        this.checkRecoveryGroup(group);
        if (this.store.find("CompactionJob", group.loop_id))
          await commitRecoveredCompaction(this, group.loop_id);
        else await this.settingsRecoveryCommit!(group.loop_id);
        return { ...result, owner_id: group.loop_id, owner_committed: true };
      } catch (error) {
        return {
          ...result,
          status: "BLOCKED" as const,
          owner_id: group.loop_id,
          owner_committed: false,
          reason: String(error),
        };
      }
    } finally {
      this.memoryRecoveryBusy = false;
      completeRecovery();
      this.recoveryDone = undefined;
    }
  }
  memoryStatus() {
    const cs = this.store.get<Consciousness>(
      "Consciousness",
      this.session.consciousness_id,
    );
    const jobs = this.store
      .all<CompactionJob>("CompactionJob")
      .filter((j) => j.session_id === this.sessionID);
    const latest = jobs.at(-1);
    const successful = jobs.filter((j) => j.state === "COMMITTED").at(-1);
    const activation = cs.settings_application_id
      ? this.store.find("SettingsApplication", cs.settings_application_id)
      : undefined;
    const activationNewer =
      activation && (!latest || activation.updated_at > latest.updated_at);
    return {
      revision: cs.revision,
      maintenance_mode: latest?.mode ?? "WORKING_MEMORY",
      compaction_target_reached:
        jobs.filter((j) => j.mode === "CONTEXT_COMPACTION").at(-1)
          ?.target_reached ?? null,
      state: activationNewer
        ? "SETTINGS_APPLIED"
        : (latest?.state ?? "NOT_NEEDED"),
      last_success_at:
        activation &&
        (!successful || activation.updated_at > successful.updated_at)
          ? activation.updated_at
          : (successful?.updated_at ?? null),
      pending_source_bytes: cs.pending_raw_refs.reduce(
        (n, r) => n + r.bytes,
        0,
      ),
      attempt: latest?.attempt ?? 0,
      errors: latest?.validation_errors ?? [],
      commitments: migrateCommitments(cs),
      covered_event_sequence: cs.covered_event_sequence ?? null,
    };
  }
  resolveMemoryCommitment(
    commitmentID: string,
    state: "COMPLETED" | "CANCELLED",
    note: string,
  ) {
    if (this.settingsBlocked()) throw Error("SETTINGS_APPLICATION_IN_PROGRESS");
    if (!note.trim()) throw Error("RESOLUTION_NOTE_REQUIRED");
    const cs = this.store.get<Consciousness>(
      "Consciousness",
      this.session.consciousness_id,
    );
    const commitments = migrateCommitments(cs);
    const commitment = commitments.find((c) => c.id === commitmentID);
    if (!commitment || commitment.state !== "OPEN")
      throw Error("OPEN_COMMITMENT_NOT_FOUND");
    const event = this.store.event(
      "consciousness.master_resolved",
      { commitment_id: commitmentID, state, note },
      { session_id: this.sessionID, task_id: null, execution_id: null },
      "MASTER_UI",
    );
    commitment.state = state;
    commitment.resolution_event_ids = [event.event_id];
    this.store.commit([revise(cs, { commitments })], [event]);
  }

  async settingsIdle() {
    await this.active;
    await this.maintenance;
  }
  prepareSettingsContext(
    applicationID: string,
    content: string,
    instructionsRevision: number,
    messages: AgentMessage[],
    memoryRevision: number,
  ) {
    const loopID = id();
    const agent = new Agent({
      streamFn: this.stream,
      initialState: {
        model: this.model,
        systemPrompt: composeInstructions(content),
        tools: this.tools(loopID),
      },
    });
    const system = agent.state.messages[0];
    if (system.role !== "system") throw Error("SYSTEM_MESSAGE_MISSING");
    const snapshot: MainPromptSnapshot = {
      schema_version: 1,
      record_type: "MainPromptSnapshot",
      ...base(loopID),
      session_id: this.sessionID,
      base_prompt_version: hash(BASE_SYSTEM),
      instructions_revision: instructionsRevision,
      system_prompt_hash: hash(contentText(system.content)),
      system_message: this.store.put(system),
      settings_application_id: applicationID,
    };
    assertRequestBudget(this.model, [system, ...messages]);
    this.store.commit([snapshot]);
    return saveContext(
      this.store,
      [system, ...messages],
      { session_id: this.sessionID, task_id: null, execution_id: null },
      "MAIN",
      this.model.id,
      loopID,
      this.model.contextWindow,
      { consciousnessRevision: memoryRevision, inputIDs: [] },
    );
  }

  async close() {
    this.closing = true;
    this.agent?.abort();
    await this.recoveryDone;
    await this.active;
    await this.maintenance;
  }
}
