import { Type } from "typebox";
import { activitiesFor } from "./activity.ts";
import { requestBudget } from "./budget.ts";
import type { Feedback, Input, Notification } from "./contracts.ts";
import { stableID } from "./execution-utils.ts";
import type { HostContext } from "./host-context.ts";
import { result } from "./main-tool-result.ts";
import { readLog } from "./memory-search.ts";
import { tool, type AgentTool } from "./model.ts";
import { base, hash, now } from "./store.ts";
import { proposeWorld, readWorld } from "./world-memory.ts";

type MainToolsContext = Pick<
  HostContext,
  | "agent"
  | "history"
  | "memory"
  | "memoryStatus"
  | "memoryToolResult"
  | "model"
  | "proposeTask"
  | "scheduler"
  | "sessionID"
  | "store"
  | "toolKey"
  | "wakeups"
  | "world"
>;

export function proposeTask(
  this: MainToolsContext,
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

export function tools(this: MainToolsContext, loopID: string): AgentTool[] {
  const wrap = (tools: AgentTool[]) =>
    tools.map(
      (t) =>
        ({
          ...t,
          execute: async (call: string, args: never, signal?: AbortSignal) => {
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
            const key = this.toolKey(loopID, messageIndex, call, t.name, args);
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
        reuse_task_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
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
          this.scheduler.query(this.sessionID, args.task_id, args.execution_id),
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

export function memoryToolResult(this: MainToolsContext, value: unknown) {
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
          Math.floor(Array.from(payload.hits[0].snippet as string).length / 2),
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
