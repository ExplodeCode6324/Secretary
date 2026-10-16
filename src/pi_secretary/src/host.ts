import { presentedNotification } from "./notification-service.ts";
import { Wakeups, wakeupArguments } from "./wakeups.ts";
import { isTimerMessage } from "./input-origin.ts";
import { readLog } from "./memory-search.ts";
import {
  proposeWorld,
  readWorld,
  recoveredWorldProposal,
} from "./world-memory.ts";
import { inputMessage, selectInputProjection } from "./input-projection.ts";
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
import {
  enqueueExtractions,
  drainExtractions,
  restoreExtractions,
  retryExtractions,
} from "./memory-extraction.ts";
import { maintenanceRetryAt, retryNow } from "./model-retry.ts";
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
  ModelCall,
  MemoryExtractionJob,
  Notification,
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
      [
        input,
        ...(producer === "MASTER" &&
        this.session.state === "RECOVERY_BLOCKED" &&
        this.session.model_blocked_call
          ? [
              revise(this.session, {
                state: "IDLE",
                recovery_error: null,
                model_blocked_call: null,
                model_retry_generation:
                  (this.session.model_retry_generation ?? 0) + 1,
              }),
            ]
          : []),
      ],
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
      revise(this.session, {
        state: "IDLE",
        recovery_error: null,
        model_blocked_call: null,
        model_retry_generation: (this.session.model_retry_generation ?? 0) + 1,
      }),
    ]);
    return this.drain();
  }
  drain() {
    if (this.settingsBlocked()) return this.active ?? Promise.resolve();
    if (["RECOVERY_BLOCKED", "CAPACITY_BLOCKED"].includes(this.session.state))
      return Promise.resolve();
    if (this.active) return this.active;
    this.active = (async () => {
      await this.maintenance;
      await this.run();
      if (!this.closing && !this.settingsBlocked()) await this.extractPending();
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
    if (name === "schedule_wakeup" || name === "cancel_wakeup")
      args = wakeupArguments(name, args);
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
          if (call.name === "memory_propose_change" && this.world) {
            const recovered = recoveredWorldProposal(this.world, stableID(key));
            if (recovered) {
              this.store.commit(
                [],
                [
                  this.store.event(
                    "main.tool.result",
                    { key, result: result(recovered) },
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
          }
        if (
          !log &&
          (call.name === "schedule_wakeup" || call.name === "cancel_wakeup")
        ) {
          const recovered = this.wakeups.recovered(
            call.name,
            stableID(key),
            call.arguments,
          );
          if (recovered) {
            this.store.commit(
              [],
              [
                this.store.event(
                  "main.tool.result",
                  { key, result: result(recovered) },
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
              systemPrompt:
                composeInstructions(settings.content) +
                this.scheduler.scopes.promptContext(),
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
          messages.push(...batch.map((i) => inputMessage(this.store, i)));
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
              generation: this.session.model_retry_generation ?? 0,
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
            await this.world?.memorySearch?.catchUp();
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
        const text =
          String(error) +
          (String(error).includes("CAPACITY_BLOCKED") &&
          this.world?.memorySearch?.state !== "ready"
            ? "; INPUT_EXIT_DISABLED: searchable PostgreSQL projection is not ready"
            : "");
        const failedID = text.match(
          /MODEL_TRANSPORT_(?:TRANSIENT|PERMANENT):([a-f0-9-]{36}):/,
        )?.[1];
        const failed = failedID
          ? this.store.find<ModelCall>("ModelCall", failedID)
          : undefined;
        this.store.commit(
          [
            revise(this.session, {
              state: text.includes("CAPACITY_BLOCKED")
                ? "CAPACITY_BLOCKED"
                : "RECOVERY_BLOCKED",
              recovery_error: text,
              model_blocked_call:
                failed?.scope.session_id === this.sessionID ? failed.id : null,
            }),
          ],
          [this.store.event("host.blocked", { error: text })],
        );
        if (failed) this.notifyFailure("model:" + failed.logical_key, text);
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
      const message = inputMessage(this.store, input);
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
    return result({
      ...this.scheduler.propose(args.goal, call, this.sessionID, {
        scopeID: args.scope_id,
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
          "Choose scope_id when the request clearly belongs to an available scope; ask Master when uncertain. Conversation and pure explanations do not need tasks. Only Master manages scopes. Submit new AGENT task by default; PROGRAM only with a registered program_id. For revisions of existing work, use reuse_task_id and its latest ended parent_execution_id; query tasks when identity or requirements are unclear. Reuse inherits omitted/null constraints, acceptance, deadline and executor; explicit arrays replace that field, so preserve unchanged requirements. goal is this round's complete goal. No at/interval on reuse. Independent deliverables use a new task. Scheduler generates the executor packet. Include all relevant constraints and materials. Use null for unspecified optional fields; do not invent program IDs, dates or deadlines.",
        parameters: Type.Object({
          scope_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
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
        name: "memory_search",
        label: "Search historical memory",
        description:
          "Search durable historical input, final replies, task summaries and notifications. Use it when past details are absent from context; cite event_id and read source slices as needed. Filters are optional; default searches all history. Unavailable/partial/timeout is not evidence of absence.",
        parameters: Type.Object({
          query: Type.String({ minLength: 1, maxLength: 256 }),
          from: Type.Optional(Type.String()),
          to: Type.Optional(Type.String()),
          kinds: Type.Optional(
            Type.Array(
              Type.Union([
                Type.Literal("input"),
                Type.Literal("reply"),
                Type.Literal("task"),
                Type.Literal("notification"),
              ]),
            ),
          ),
          scope_id: Type.Optional(Type.String()),
          task_id: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        }),
        execute: async (_call, args) =>
          this.memoryToolResult(
            this.world
              ? await this.world.memorySearch.search(args)
              : { status: "not_configured", hits: [] },
          ),
      }),
      tool({
        name: "memory_read",
        label: "Read memory",
        description:
          "Read working memory, original event text slices, or paginated World facts. Log offsets/lengths are Unicode code points; follow next_offset for full text. World subject accepts ID, name or alias; ambiguity returns candidates. Provide only one non-null subject or legacy subject_id selector. Use predicate and cursor to reach facts beyond the first page.",
        parameters: Type.Object({
          source: Type.Union([
            Type.Literal("world"),
            Type.Literal("consciousness"),
            Type.Literal("log"),
          ]),
          subject_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          subject: Type.Optional(Type.String()),
          predicate: Type.Optional(Type.String()),
          cursor: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          event_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
          length: Type.Optional(Type.Integer({ minimum: 1, maximum: 4000 })),
        }),
        execute: async (_call, args) => {
          if (args.source === "world") {
            if (!this.world)
              throw Error("WORLD_UNAVAILABLE: PostgreSQL not configured");
            if (args.subject !== undefined && args.subject_id != null)
              throw Error(
                "SELECTOR_CONFLICT: use only one World subject selector",
              );
            return this.memoryToolResult(
              await readWorld(this.world, {
                subject: args.subject ?? args.subject_id,
                predicate: args.predicate,
                cursor: args.cursor,
                limit: args.limit,
              }),
            );
          }
          if (args.source === "consciousness") {
            const { input_projection_ref: _receipt, ...memory } = this.memory();
            const { input_projection_ref: _diagnostic, ...maintenance } =
              this.memoryStatus();
            return this.memoryToolResult({ ...memory, maintenance });
          }
          return this.memoryToolResult(
            readLog(this.store, args.event_id, args.offset, args.length),
          );
        },
      }),
      tool({
        name: "memory_propose_change",
        label: "Propose World Model change",
        description:
          "Propose ASSERT, CORRECT or RETRACT facts using subject ID/name/alias and predicate key. ENTITY values use an entity selector. Correction/retraction requires target_fact_id. source_event_ids must reference real evidence; source_note is explanation only. Source registration and fact changes require owner authorization; use Settings to create missing entities.",
        parameters: Type.Object({
          intent: Type.Union([
            Type.Literal("ASSERT"),
            Type.Literal("CORRECT"),
            Type.Literal("RETRACT"),
          ]),
          subject: Type.String(),
          predicate: Type.String(),
          value: Type.Optional(Type.Unknown()),
          valid_from: Type.Optional(Type.String()),
          target_fact_id: Type.Optional(Type.String()),
          source_event_ids: Type.Optional(
            Type.Array(Type.String(), { maxItems: 20 }),
          ),
          source_note: Type.Optional(Type.String({ maxLength: 2000 })),
        }),
        execute: async (call, args) => {
          if (!this.world) throw Error("WORLD_UNAVAILABLE");
          const inputs = new Set(
            this.store
              .all<Input>("Input")
              .filter((i) => i.loop_id === loopID && i.producer === "MASTER")
              .map((i) => i.id),
          );
          const events = this.store.logs
            .filter(
              (e) =>
                e.event_type === "input.accepted" &&
                inputs.has(this.store.read<Input>(e.payload).id),
            )
            .map((e) => e.event_id);
          return result(
            await proposeWorld(
              this.world,
              { session_id: this.sessionID, task_id: null, execution_id: null },
              args,
              call,
              events,
            ),
          );
        },
      }),
      tool({
        name: "schedule_wakeup",
        label: "Schedule main-session wakeup",
        description:
          "Remind this session at a future ISO time with timezone. No execution agent.",
        parameters: Type.Object(
          { at: Type.String(), note: Type.String() },
          { additionalProperties: false },
        ),
        execute: async (call, args) => {
          const inputs = new Set(
            this.store
              .all<Input>("Input")
              .filter((i) => i.loop_id === loopID)
              .map((i) => i.id),
          );
          const sources = this.store.logs
            .filter(
              (e) =>
                e.event_type === "input.accepted" &&
                inputs.has(this.store.read<Input>(e.payload).id),
            )
            .map((e) => e.event_id);
          return result(this.wakeups.schedule(call, args, sources));
        },
      }),
      tool({
        name: "cancel_wakeup",
        label: "Cancel main-session wakeup",
        description: "Cancel PENDING only; return state.",
        parameters: Type.Object(
          { timer_id: Type.String() },
          { additionalProperties: false },
        ),
        execute: async (call, args) =>
          result(this.wakeups.cancel(args.timer_id, call)),
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
  private memoryToolResult(value: unknown) {
    const budget = requestBudget(
      this.model,
      this.agent?.state.messages ?? this.history(),
    );
    const remaining = Math.max(
      0,
      budget.usable_input_tokens - budget.estimated_tokens - 512,
    );
    const payload = structuredClone(value) as Record<string, any>;
    const fits = () =>
      Buffer.byteLength(JSON.stringify(payload)) + 256 <= remaining;
    while (!fits()) {
      if (
        typeof payload.body === "string" &&
        Array.from(payload.body).length > 32
      ) {
        payload.body = Array.from(payload.body)
          .slice(0, Math.floor(Array.from(payload.body).length / 2))
          .join("");
        payload.next_offset = payload.offset + Array.from(payload.body).length;
        payload.truncated = true;
      } else if (Array.isArray(payload.hits) && payload.hits.length > 1) {
        payload.hits.pop();
        payload.truncated = true;
      } else if (
        payload.hits?.length === 1 &&
        Array.from(payload.hits[0].snippet as string).length > 32
      ) {
        payload.hits[0].snippet = Array.from(payload.hits[0].snippet as string)
          .slice(
            0,
            Math.floor(
              Array.from(payload.hits[0].snippet as string).length / 2,
            ),
          )
          .join("");
        payload.truncated = true;
      } else
        return result({
          status: "tool_result_capacity",
          reason:
            "Reduce length or limit; current request has no room for this memory result.",
        });
    }
    return result(payload);
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
    if (this.pendingSummary()) return this.summaryDue();
    if (!turns.length) return false;
    const jobs = this.store
      .all<CompactionJob>("CompactionJob")
      .filter(
        (j) =>
          j.session_id === this.sessionID && j.mode !== "CONTEXT_COMPACTION",
      );
    if (this.pendingSummary()) return this.summaryDue();
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
    const extractionDue = this.store
      .all<MemoryExtractionJob>("MemoryExtractionJob")
      .some(
        (j) =>
          j.session_id === this.sessionID &&
          !j.merged &&
          (j.state !== "FAILED" ||
            (!!j.next_attempt_at &&
              Date.parse(j.next_attempt_at) <= retryNow(this.store))),
      );
    if (!this.memoryDue() && !pressure && !extractionDue) return;
    if (this.pendingSummary() && !this.summaryDue() && !extractionDue) return;
    void this.compact(false);
  }
  compact(reset = true) {
    if (this.settingsBlocked())
      return Promise.reject(Error("SETTINGS_APPLICATION_IN_PROGRESS"));
    if (this.maintenance) return this.maintenance;
    if (reset) {
      const pending = this.pendingSummary();
      if (pending && pending.state === "FAILED")
        this.store.commit([
          revise(pending, {
            state: "SUMMARIZING",
            retry_round: 0,
            retry_generation: (pending.retry_generation ?? 0) + 1,
            next_attempt_at: null,
          }),
        ]);
    }
    const active = this.active;
    if (this.memory().pending_raw_refs.length > 1 && this.fullMemoryRefresh)
      return (async () => {
        await active;
        await this.fullMemoryRefresh!();
      })();
    this.maintenance = (async () => {
      await active;
      await this.maintain();
      await this.extractPending();
      await this.world?.memorySearch?.catchUp();
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
      searchReady:
        this.world?.memorySearch?.state === "ready" &&
        this.world.memorySearch.indexedSequence >= this.store.sequence,
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
          ...(candidate.inputProjectionRef
            ? { input_projection_ref: candidate.inputProjectionRef }
            : {}),
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
      pending = this.pendingSummary();
    if (pending && !this.summaryDue(pending)) return;
    const sourceRef = pending?.source_refs[0] ?? cs.pending_raw_refs[0];
    const sourceEnd = pending?.source_end_sequence ?? this.completedSequence();
    if (!sourceRef || sourceEnd <= (cs.covered_event_sequence ?? 0)) return;
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
    let job: CompactionJob = pending
      ? revise(pending, {
          state: "SUMMARIZING",
          base_revision: cs.revision,
          retry_round:
            pending.state === "FAILED"
              ? (pending.retry_round ?? 0) + 1
              : (pending.retry_round ?? 0),
          next_attempt_at: null,
        })
      : {
          retry_round: 0,
          retry_generation: 0,
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
      const saved = job.progress_ref
        ? this.store.read<{
            plan: SummaryPlan;
            candidate: SummaryCandidate;
            commitments?: ReturnType<typeof migrateCommitments>;
          }>(job.progress_ref)
        : null;
      const plan =
        saved?.plan ??
        createSummaryPlan({
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
                  l.event_type === "notification.presented" &&
                  l.sequence <= sourceEnd,
              )
              .map((l) => {
                const n = presentedNotification(this.store, l);
                return n?.session_id === this.sessionID
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
      const commitmentsBefore = saved?.commitments ?? migrateCommitments(cs);
      const candidate = await runSummary({
        store: this.store,
        model: this.model,
        stream: this.stream,
        sessionID: this.sessionID,
        loopID: job.id,
        consciousnessRevision: cs.revision,
        refs: [sourceRef, evidence],
        plan,
        commitments: commitmentsBefore,
        round: job.retry_round ?? 0,
        generation: job.retry_generation ?? 0,
        candidate: saved?.candidate ?? { items: cs.items, completed: 0 },
        checkpoint: (candidate) => {
          job = revise(this.store.get<CompactionJob>("CompactionJob", job.id), {
            progress_ref: this.store.put({
              plan,
              candidate,
              commitments: commitmentsBefore,
            }),
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
            max_attempts: 4,
          });
        },
      });
      const items = candidate.items;
      enqueueExtractions({
        store: this.store,
        sessionID: this.sessionID,
        loopID: job.id,
        taskRefs: items[0]?.task_refs ?? [],
        source: null,
        completeMessages: delta.flatMap((l) => {
          const m = this.store.read<AgentMessage>(l.payload);
          return (m.role === "user" || m.role === "assistant") &&
            !isTimerMessage(this.store, m)
            ? [{ id: l.event_id, role: m.role, text: contentText(m.content) }]
            : [];
        }),
      });
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
            next_attempt_at: maintenanceRetryAt(
              this.store,
              latest.retry_round ?? 0,
              error,
            ),
          }),
        ],
        [
          this.store.event("consciousness.failed", {
            job_id: job.id,
            error: String(error),
          }),
        ],
      );
      const failed = this.store.get<CompactionJob>("CompactionJob", job.id);
      if (!failed.next_attempt_at)
        this.notifyFailure(
          `summary:${job.id}:${job.retry_generation ?? 0}`,
          String(error),
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
  retryExtractions(requestID: string) {
    return retryExtractions(this.store, this.sessionID, requestID);
  }
  extractPending() {
    if (this.extraction) return this.extraction;
    this.extraction = drainExtractions({
      store: this.store,
      model: this.model,
      stream: this.stream,
      sessionID: this.sessionID,
    }).finally(() => {
      this.extraction = undefined;
    });
    return this.extraction;
  }
  private notifyFailure(key: string, message: string) {
    const recordID = stableID("model-maintenance-failure:" + key);
    if (this.store.find("Notification", recordID)) return;
    const n: Notification = {
      schema_version: 1,
      record_type: "Notification",
      ...base(recordID),
      state: "QUEUED",
      session_id: this.sessionID,
      channel: "local-ui",
      message: this.store.put(message, "text/plain"),
      delivery_key: recordID,
      receipt: null,
      requested_at: now(),
    };
    this.store.commit(
      [n],
      [
        this.store.event("notification.queued", n, {
          session_id: this.sessionID,
          task_id: null,
          execution_id: null,
        }),
      ],
    );
  }
  private pendingSummary() {
    const start = this.memory().covered_event_sequence ?? 0;
    return this.store
      .all<CompactionJob>("CompactionJob")
      .findLast(
        (j) =>
          j.session_id === this.sessionID &&
          j.mode === "WORKING_MEMORY" &&
          (j.source_start_sequence ?? 0) === start &&
          ["FAILED", "SUMMARIZING"].includes(j.state),
      );
  }
  private summaryDue(job = this.pendingSummary()) {
    return (
      !!job &&
      (job.state === "SUMMARIZING" ||
        (!!job.next_attempt_at &&
          Date.parse(job.next_attempt_at) <= retryNow(this.store)))
    );
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
      extraction_pending_count: this.store
        .all<MemoryExtractionJob>("MemoryExtractionJob")
        .filter(
          (j) =>
            j.session_id === this.sessionID &&
            !j.merged &&
            (j.state !== "FAILED" || j.next_attempt_at !== null),
        ).length,
      extraction_failed_count: this.store
        .all<MemoryExtractionJob>("MemoryExtractionJob")
        .filter(
          (j) =>
            j.session_id === this.sessionID &&
            j.state === "FAILED" &&
            !j.next_attempt_at,
        ).length,
      extraction: this.store
        .all<MemoryExtractionJob>("MemoryExtractionJob")
        .filter((j) => j.session_id === this.sessionID && !j.merged)
        .map((j) => ({
          id: j.id,
          state: j.state,
          round: j.round,
          next_attempt_at: j.next_attempt_at,
          error: j.error,
        })),
      next_attempt_at: latest?.next_attempt_at ?? null,
      retry_round: latest?.retry_round ?? 0,
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
      input_projection_ref: cs.input_projection_ref ?? null,
      input_exit:
        this.world?.memorySearch?.state === "ready" &&
        this.world.memorySearch.indexedSequence >= this.store.sequence
          ? "available"
          : "disabled_search_not_ready",
      search: this.world?.memorySearch?.status() ?? {
        status: "not_configured",
      },
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
    await this.extraction;
  }
  prepareSettingsInputs(
    applicationID: string,
    source: import("./settings-memory.ts").SettingsSource,
    messages: AgentMessage[],
    content: string,
  ) {
    const agent = new Agent({
      initialState: {
        model: this.model,
        systemPrompt:
          composeInstructions(content) + this.scheduler.scopes.promptContext(),
        tools: this.tools(id()),
      },
      streamFn: this.stream,
    });
    const system = agent.state.messages[0];
    const selected = selectInputProjection({
      store: this.store,
      consciousness: this.memory(),
      messages: [system, ...messages],
      model: this.model,
      protectedFromIndex: messages.length + 1,
      searchReady:
        this.world?.memorySearch?.state === "ready" &&
        this.world.memorySearch.indexedSequence >= this.store.sequence,
      pending: { id: applicationID, source },
    });
    return { ...selected, messages: selected.messages.slice(1) };
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
        systemPrompt:
          composeInstructions(content) + this.scheduler.scopes.promptContext(),
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
    await this.active;
    await this.maintenance;
    await this.extraction;
  }
}
