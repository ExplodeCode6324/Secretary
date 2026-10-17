import { contentText } from "@earendil-works/pi-ai";
import { budgetConfig, requestBudget } from "./budget.ts";
import { saveContext } from "./context.ts";
import type {
  Consciousness,
  Context,
  Feedback,
  Input,
  MainPromptSnapshot,
  ModelCall,
} from "./contracts.ts";
import { stableID } from "./execution-utils.ts";
import type { HostContext } from "./host-context.ts";
import { inputMessage } from "./input-projection.ts";
import {
  BASE_SYSTEM,
  composeInstructions,
  getInstructions,
} from "./instructions.ts";
import { result } from "./main-tool-result.ts";
import { Agent, type AgentMessage } from "./model.ts";
import { base, hash, id, now, revise, type Stored } from "./store.ts";
import { durableStream } from "./transport.ts";
import { wakeupArguments } from "./wakeups.ts";
import { recoveredWorldProposal } from "./world-memory.ts";

type MainLoopContext = Pick<
  HostContext,
  | "accept"
  | "active"
  | "agent"
  | "closing"
  | "crop"
  | "deliverFeedback"
  | "drain"
  | "extractPending"
  | "finish"
  | "history"
  | "maintain"
  | "maintenance"
  | "memory"
  | "memoryDue"
  | "missedOffset"
  | "model"
  | "notifyFailure"
  | "previews"
  | "project"
  | "proposeTask"
  | "recordInputMessages"
  | "recoverTools"
  | "run"
  | "scheduler"
  | "session"
  | "sessionID"
  | "settingsBlocked"
  | "store"
  | "stream"
  | "toolKey"
  | "tools"
  | "wakeups"
  | "world"
>;

export function accept(
  this: MainLoopContext,
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

export function deliverFeedback(this: MainLoopContext) {
  const missed = this.store.events("trigger.missed");
  while (this.missedOffset < missed.length) {
    const log = missed[this.missedOffset];
    this.accept(
      "Missed scheduled trigger: " + this.store.bytes(log.payload).toString(),
      log.event_id,
      "SCHEDULER",
    );
    this.missedOffset++;
  }
  for (const f of this.store.indexed<Feedback>("Feedback", "state", [
    "QUEUED",
  ])) {
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

export function resume(this: MainLoopContext) {
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

export function drain(this: MainLoopContext) {
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

export function toolKey(
  this: MainLoopContext,
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

export function recoverTools(
  this: MainLoopContext,
  messages: AgentMessage[],
  loopID: string,
) {
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
          call.arguments as Parameters<HostContext["proposeTask"]>[0],
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

export async function run(this: MainLoopContext) {
  while (!this.closing && !this.settingsBlocked()) {
    // A queued manual maintenance waits on this run. Yield between completed
    // batches instead of awaiting it here (which would wait on ourselves).
    if (this.maintenance) return;
    this.deliverFeedback();
    if (this.memoryDue()) await this.maintain();
    let s = this.session;
    const pending = this.store
      .indexed<Input>("Input", "state", ["HANDLED"], true)
      .filter((i) => i.session_id === this.sessionID);
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
        hash(contentText(systemMessage.content)) !== snapshot.system_prompt_hash
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

export function recordInputMessages(
  this: MainLoopContext,
  batch: Input[],
  loopID: string,
) {
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

export function finish(this: MainLoopContext, batch: Input[]) {
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
  const cs = this.store.get<Consciousness>("Consciousness", s.consciousness_id);
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
