import { hash, type Store } from "./store.ts";
import { toolPhase, type Activity, type ActivitySnapshot } from "./activity.ts";
import type {
  Context,
  ModelCall,
  Execution,
  TaskPlan,
  TaskProposal,
  SettingsApplication,
  CompactionJob,
  OperationLogRecord,
  Scope,
  Operation,
} from "./contracts.ts";

export type HistoricalActivity = Activity & {
  order: number;
  source: "durable" | "live";
  timing_known: boolean;
  anchor_id?: string;
  steps: { phase: string; at: string }[];
};
type Association = {
  loop: string;
  call: string;
  order: number;
  session: string | null;
  execution: string | null;
  anchor?: string;
  index: number;
};
const registries = new WeakMap<Store, ActivityHistory>();
export function activityHistoryFor(store: Store) {
  let history = registries.get(store);
  if (!history) {
    history = new ActivityHistory(store);
    registries.set(store, history);
  }
  history.sync();
  return history;
}
const terminal = (state: string) =>
  [
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "EXPIRED",
    "APPLIED",
    "COMMITTED",
  ].includes(state);
export function finishedPhase(phase: string, status: Activity["status"]) {
  if (status === "succeeded") return phase.replace(/^正在/, "已");
  return phase;
}

// Read model: only validated Store references, never chat-text inference or execution.
export class ActivityHistory {
  private position = 0;
  private rows = new Map<string, HistoricalActivity>();
  private contexts = new Map<
    string,
    Pick<
      Context,
      | "loop_id"
      | "call_id"
      | "input_ids"
      | "purpose"
      | "session_id"
      | "execution_id"
    > & { index: number }
  >();
  private latestContext = new Map<string, string>();
  private calls = new Map<string, Association>();
  private tools = new Map<string, string>();
  private legacyTools = new Map<string, string>();
  private inputEvents = new Map<string, string>();
  private messageOrders = new Map<string, number>();
  private tasks = new Map<string, string>();
  private programs = new Set<string>();
  private operations = new Map<string, { state: string; at: string }>();
  private operationTools = new Map<string, Set<string>>();
  private ordered = new Map<string, string[]>();
  private listeners = new Set<(row: HistoricalActivity) => void>();
  // Internal read projections consume immutable replacements, never mutate these rows.
  observe(listener: (row: HistoricalActivity) => void) {
    for (const row of this.rows.values()) listener(row);
    this.listeners.add(listener);
  }
  constructor(private store: Store) {}
  private put(row: HistoricalActivity) {
    const old = this.rows.get(row.id);
    if (old) {
      row.order = old.order;
      row.anchor_id ??= old.anchor_id;
      row.steps = old.steps;
      if (old.phase !== row.phase || old.status !== row.status)
        row.steps = [
          ...old.steps,
          { phase: row.phase, at: row.last_progress_at },
        ].slice(-12);
    }
    this.rows.set(row.id, row);
    for (const listener of this.listeners) listener(row);
    if (!old) {
      const session =
        row.session_id ??
        (row.execution_id
          ? this.rows.get("task:" + row.execution_id)?.session_id
          : null);
      if (session) {
        const ids = this.ordered.get(session) ?? [];
        // Ascending index: ordinary new rows append; late child rows use binary insertion.
        let lo = 0,
          hi = ids.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (this.rows.get(ids[mid])!.order <= row.order) lo = mid + 1;
          else hi = mid;
        }
        ids.splice(lo, 0, row.id);
        this.ordered.set(session, ids);
      }
    }
  }
  private base(
    id: string,
    kind: string,
    scope: Scope,
    at: string,
    order: number,
  ): HistoricalActivity {
    return {
      id,
      kind,
      scope: scope.execution_id
        ? "background"
        : ["settings", "compaction"].includes(kind)
          ? "maintenance"
          : "main",
      session_id: scope.session_id,
      execution_id: scope.execution_id,
      parent_id: scope.execution_id ? "task:" + scope.execution_id : null,
      phase: "结果未记录",
      status: "interrupted",
      started_at: at,
      ended_at: at,
      last_progress_at: at,
      version: this.position,
      actions: [],
      order,
      source: "durable",
      timing_known: false,
      steps: [],
    };
  }
  sync() {
    for (
      ;
      this.position < this.store.projectionFrames.length;
      this.position++
    ) {
      const frame = this.store.projectionFrames[this.position];
      const order = frame.sequence * 1000;
      for (const [index, change] of frame.mutations.entries()) {
        const recordOrder =
          order + ((index + 1) / (frame.mutations.length + 1)) * 100;
        if (change.object_type === "Context") {
          const c = this.store.read<Context>(change.snapshot);
          this.contexts.set(c.id, {
            loop_id: c.loop_id,
            call_id: c.call_id,
            input_ids: c.input_ids,
            purpose: c.purpose,
            session_id: c.session_id,
            execution_id: c.execution_id,
            index: c.messages.length - 1,
          });
          this.latestContext.set(c.execution_id ?? c.session_id ?? "", c.id);
        } else if (change.object_type === "TaskPlan") {
          const p = this.store.read<TaskPlan>(change.snapshot);
          this.tasks.set(
            p.id,
            this.store.read<TaskProposal>(p.proposal_ref).session_id,
          );
          if (p.executor.kind === "PROGRAM") this.programs.add(p.id);
        } else if (change.object_type === "ModelCall") {
          this.model(this.store.read<ModelCall>(change.snapshot), recordOrder);
        } else if (change.object_type === "Execution") {
          this.execution(
            this.store.read<Execution>(change.snapshot),
            recordOrder,
          );
        } else if (change.object_type === "Operation") {
          const op = this.store.read<Operation>(change.snapshot);
          this.operations.set(op.id, { state: op.state, at: op.updated_at });
          if (op.scope.task_id && this.programs.has(op.scope.task_id)) {
            const operationID = "operation:" + op.id;
            if (!this.rows.has(operationID))
              this.put(
                this.base(
                  operationID,
                  "operation",
                  op.scope,
                  op.updated_at,
                  recordOrder,
                ),
              );
            this.operationResult(operationID, op.state, op.updated_at);
          }
          for (const id of this.operationTools.get(op.id) ?? [])
            this.operationResult(id, op.state, op.updated_at);
        } else if (
          change.object_type === "SettingsApplication" ||
          change.object_type === "CompactionJob"
        ) {
          this.maintenance(
            this.store.read<SettingsApplication | CompactionJob>(
              change.snapshot,
            ),
            recordOrder,
          );
        }
      }
      for (const [index, event] of frame.log_records.entries())
        this.event(
          event,
          order + 500 + (index / (frame.log_records.length + 1)) * 100,
        );
    }
  }
  private model(c: ModelCall, order: number) {
    const context = this.contexts.get(c.context_id);
    if (!context) return;
    let association = this.calls.get(c.id);
    if (!association) {
      association = {
        loop: context.loop_id,
        call: c.id,
        order,
        session: c.scope.session_id,
        execution: c.scope.execution_id,
        anchor: this.inputEvents.get(context.input_ids.at(-1) ?? ""),
        index: context.index + 1,
      };
      this.calls.set(c.id, association);
    }
    const row = this.base(
      "model:" + c.id,
      context.purpose === "COMPACTION" ? "compaction" : "model",
      c.scope,
      c.started_at ?? c.updated_at,
      association.order,
    );
    row.call_id = c.id;
    row.loop_id = context.loop_id;
    row.anchor_id = association.anchor;
    row.parent_id = c.scope.execution_id
      ? "task:" + c.scope.execution_id
      : context.purpose === "COMPACTION"
        ? (this.store.find("SettingsApplication", context.loop_id)
            ? "settings:"
            : "compaction:") + context.loop_id
        : null;
    row.status =
      c.state === "RESPONSE_SAVED"
        ? "succeeded"
        : c.state === "FAILED"
          ? "failed"
          : "interrupted";
    row.phase =
      c.state === "RESPONSE_SAVED"
        ? context.purpose === "COMPACTION"
          ? "已完成记忆处理调用"
          : "本次思考已结束"
        : c.state === "FAILED"
          ? "模型调用失败"
          : "模型调用结果未记录";
    row.ended_at = c.completed_at ?? c.updated_at;
    row.last_progress_at = c.updated_at;
    row.timing_known = !!c.started_at && !!c.completed_at;
    this.put(row);
    if (c.response) {
      const response = this.store.read<{
        content?: {
          type: string;
          id: string;
          name: string;
          arguments: unknown;
        }[];
      }>(c.response);
      let index = 0;
      for (const part of response.content ?? [])
        if (part.type === "toolCall") {
          const legacyKey = `${context.loop_id}:${association.index}:${part.id}:${part.name}:${hash(JSON.stringify(part.arguments))}`;
          const toolID =
            "tool:" +
            (c.scope.execution_id
              ? context.loop_id + ":" + part.id
              : hash(legacyKey));
          this.tools.set(
            (c.scope.execution_id ?? c.scope.session_id) + ":" + part.id,
            toolID,
          );
          this.legacyTools.set(legacyKey, toolID);
          if (!this.rows.has(toolID)) {
            const tool = this.base(
              toolID,
              "tool",
              c.scope,
              c.completed_at ?? c.updated_at,
              association.order +
                200 +
                (index++ / ((response.content?.length ?? 0) + 1)) * 100,
            );
            tool.phase =
              toolPhase(part.name, part.arguments).replace(/^正在/, "已请求") +
              " · 结果未记录";
            tool.loop_id = context.loop_id;
            tool.call_id = c.id;
            tool.anchor_id = c.id;
            this.put(tool);
          }
        }
    }
  }
  private execution(e: Execution, order: number) {
    const session = this.tasks.get(e.task_id) ?? null;
    const row = this.base(
      "task:" + e.id,
      "task",
      { session_id: session, task_id: e.task_id, execution_id: e.id },
      e.started_at ?? e.updated_at,
      order,
    );
    const old = this.rows.get(row.id);
    row.started_at = e.started_at ?? old?.started_at ?? e.updated_at;
    row.parent_id = null;
    row.actions = [
      e.state === "WAIT_AUTH"
        ? "authorization"
        : e.state === "WAIT_DECISION"
          ? "decisions"
          : "tasks",
    ];
    row.status =
      e.state === "SUCCEEDED"
        ? "succeeded"
        : e.state === "FAILED"
          ? "failed"
          : e.state === "CANCELLED"
            ? "cancelled"
            : e.state === "EXPIRED"
              ? "interrupted"
              : "waiting";
    row.phase =
      (
        {
          SUCCEEDED: "任务已完成",
          FAILED: "任务处理失败",
          CANCELLED: "任务已取消",
          EXPIRED: "任务已过期",
          WAIT_AUTH: "等待 Master 授权",
          WAIT_DECISION: "等待 Master 决定",
          RESULT_UNKNOWN: "操作结果未知，等待核对",
          RUNNING: "任务状态待同步",
          DISPATCHING: "任务状态待同步",
        } as Record<string, string>
      )[e.state] ?? "任务等待执行";
    row.ended_at = terminal(e.state) ? (e.ended_at ?? e.updated_at) : null;
    row.last_progress_at = e.updated_at;
    row.timing_known = !!e.started_at;
    this.put(row);
  }
  private maintenance(r: SettingsApplication | CompactionJob, order: number) {
    const kind =
      r.record_type === "SettingsApplication" ? "settings" : "compaction";
    const row = this.base(
      kind + ":" + r.id,
      kind,
      { session_id: r.session_id, execution_id: null, task_id: null },
      r.updated_at,
      order,
    );
    row.started_at = this.rows.get(row.id)?.started_at ?? r.updated_at;
    row.phase =
      (
        {
          QUEUED: "等待应用配置",
          SUMMARIZING: "上下文整理",
          COMMITTING: "设置提交",
          REBUILDING: "上下文重建",
          APPLIED: "配置已应用",
          COMMITTED: "上下文已压缩",
          FAILED: "处理失败",
          STALE: "整理结果已过期",
          BLOCKED: "设置结果待核对",
        } as Record<string, string>
      )[r.state] ?? "维护状态待核对";
    if (r.record_type === "CompactionJob") {
      const label =
        r.mode === "WORKING_MEMORY"
          ? "工作记忆"
          : r.mode === "CONTEXT_COMPACTION"
            ? "上下文"
            : "旧式记忆整理";
      row.phase =
        r.state === "COMMITTED"
          ? label + (r.mode === "CONTEXT_COMPACTION" ? "已压缩" : "已更新")
          : r.state === "SUMMARIZING"
            ? "正在更新" + label
            : r.state === "FAILED"
              ? label + "处理失败"
              : row.phase;
    }
    const done = terminal(r.state) || r.state === "STALE";
    row.status =
      r.state === "FAILED" ? "failed" : done ? "succeeded" : "waiting";
    row.ended_at = done ? r.updated_at : null;
    row.actions = [kind === "settings" ? "settings" : "status"];
    row.timing_known = true;
    this.put(row);
  }
  private event(e: OperationLogRecord, order: number) {
    if (
      [
        "input.accepted",
        "main.message",
        "feedback.delivered",
        "notification.queued",
      ].includes(e.event_type)
    )
      this.messageOrders.set(e.event_id, order);
    if (e.event_type === "input.accepted") {
      const input = this.store.read<{ id: string }>(e.payload);
      this.inputEvents.set(input.id, e.event_id);
    }
    if (["main.message", "agent.message"].includes(e.event_type)) {
      const m = this.store.read<{
        role: string;
        toolCallId?: string;
        isError?: boolean;
        display_call_id?: string;
        content?: {
          type: string;
          id: string;
          name: string;
          arguments: unknown;
        }[];
      }>(e.payload);
      if (m.role === "assistant" && m.display_call_id) {
        const association = this.calls.get(m.display_call_id);
        if (association)
          this.messageOrders.set(e.event_id, association.order + 100);
      }
      if (m.role === "toolResult" && m.toolCallId) {
        const id = this.tools.get(
          (e.scope.execution_id ?? e.scope.session_id) + ":" + m.toolCallId,
        );
        if (id) this.result(id, m, e.occurred_at);
      }
    } else if (e.event_type === "main.tool.result") {
      const r = this.store.read<{ key: string; result: { isError?: boolean } }>(
        e.payload,
      );
      const id = this.legacyTools.get(r.key);
      if (id) this.result(id, r.result, e.occurred_at);
    }
  }
  private result(id: string, value: unknown, at: string) {
    const old = this.rows.get(id);
    if (!old || ["succeeded", "failed"].includes(old.status)) return;
    const result = value as {
      isError?: boolean;
      content?: { type: string; text?: string }[];
    };
    const error = result?.isError === true;
    try {
      const text = result?.content?.find((c) => c.type === "text")?.text;
      const data = text ? JSON.parse(text) : null;
      if (typeof data?.operation_id === "string") {
        const linked =
          this.operationTools.get(data.operation_id) ?? new Set<string>();
        linked.add(id);
        this.operationTools.set(data.operation_id, linked);
        const op = this.operations.get(data.operation_id);
        if (op) {
          this.operationResult(id, op.state, op.at);
          return;
        }
      }
      if (
        ["WAIT_AUTH", "WAIT_DECISION", "RESULT_UNKNOWN"].includes(data?.state)
      ) {
        this.operationResult(id, data.state, at);
        return;
      }
    } catch {
      /* Non-JSON tool output carries no extra lifecycle authority. */
    }
    const phase = old.phase
      .replace(/ · 结果未记录$/, "")
      .replace(/^已请求/, error ? "执行失败：" : "已");
    this.put({
      ...old,
      phase,
      status: error ? "failed" : "succeeded",
      ended_at: at,
      last_progress_at: at,
      version: this.position,
    });
  }
  private operationResult(id: string, state: string, at: string) {
    const old = this.rows.get(id);
    if (!old) return;
    const status: Activity["status"] =
      state === "SUCCEEDED"
        ? "succeeded"
        : state === "FAILED"
          ? "failed"
          : state === "CANCELLED"
            ? "cancelled"
            : "waiting";
    const phase =
      (
        {
          SUCCEEDED: "操作已完成",
          FAILED: "操作执行失败",
          CANCELLED: "操作已取消",
          WAIT_AUTH: "等待 Master 授权",
          WAIT_DECISION: "等待 Master 决定",
          RESULT_UNKNOWN: "操作结果未知，等待核对",
          DISPATCHED: "操作已分发，结果待核对",
          AUTHORIZED: "操作已授权，等待执行",
          PREPARED: "操作已准备",
        } as Record<string, string>
      )[state] ?? "操作状态待核对";
    this.put({
      ...old,
      status,
      phase,
      ended_at: status === "waiting" ? null : at,
      last_progress_at: at,
      version: this.position,
      actions:
        state === "WAIT_AUTH"
          ? ["authorization"]
          : state === "WAIT_DECISION"
            ? ["decisions"]
            : old.actions,
    });
  }
  messageOrder(event: string) {
    return this.messageOrders.get(event);
  }
  taskSession(id: string) {
    return this.tasks.get(id);
  }
  sessionFor(row: HistoricalActivity) {
    return (
      row.session_id ??
      (row.execution_id
        ? this.rows.get("task:" + row.execution_id)?.session_id
        : null)
    );
  }
  sessionTasks(session: string) {
    return [...this.tasks].filter(([, s]) => s === session).map(([id]) => id);
  }
  updates(snapshot: ActivitySnapshot) {
    return [...new Set(snapshot.recent.map((a) => a.id))].flatMap((id) => {
      const row = this.rows.get(id);
      return row ? [structuredClone(row)] : [];
    });
  }
  selected(session: string, ids: unknown) {
    if (
      !Array.isArray(ids) ||
      ids.length > 50 ||
      ids.some((id) => typeof id !== "string" || id.length > 256)
    )
      throw Error("INVALID_ACTIVITY_IDS");
    return ids.flatMap((id) => {
      const row = this.rows.get(id);
      return row && this.belongs(row, session) ? [structuredClone(row)] : [];
    });
  }
  private belongs(row: HistoricalActivity, session: string) {
    if (row.session_id === session) return true;
    if (!row.execution_id) return false;
    return this.rows.get("task:" + row.execution_id)?.session_id === session;
  }
  page(session: string, cursor?: string, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw Error("INVALID_ACTIVITY_LIMIT");
    let before = Infinity,
      upper = this.store.sequence;
    if (cursor) {
      try {
        const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (
          value.session !== session ||
          !Number.isFinite(value.before) ||
          !Number.isSafeInteger(value.upper) ||
          value.upper > this.store.sequence ||
          value.upper < 0
        )
          throw Error();
        before = value.before;
        upper = value.upper;
      } catch {
        throw Error("INVALID_ACTIVITY_CURSOR");
      }
    }
    const selected: HistoricalActivity[] = [];
    const ids = this.ordered.get(session) ?? [];
    const boundary = Math.min(before, (upper + 1) * 1000);
    let lo = 0,
      hi = ids.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.rows.get(ids[mid])!.order < boundary) lo = mid + 1;
      else hi = mid;
    }
    for (let index = lo - 1; index >= 0 && selected.length <= limit; index--) {
      const row = this.rows.get(ids[index])!;
      if (this.belongs(row, session)) selected.push(row);
    }
    const more = selected.length > limit;
    const items = selected.slice(0, limit);
    return {
      items: structuredClone(items),
      next_cursor: more
        ? Buffer.from(
            JSON.stringify({ session, upper, before: items.at(-1)!.order }),
          ).toString("base64url")
        : null,
      store_revision: this.store.sequence,
      upper,
      coverage: "已保存的结构化活动；旧工具可能缺少精确耗时",
    };
  }
  live(snapshot: ActivitySnapshot) {
    return snapshot.activities.map((a): HistoricalActivity => {
      const old = this.rows.get(a.id);
      const association = a.call_id ? this.calls.get(a.call_id) : undefined;
      return {
        ...old,
        ...a,
        order:
          old?.order ?? association?.order ?? this.store.sequence * 1000 + 900,
        source: "live",
        timing_known: true,
        steps: old?.steps ?? [],
        anchor_id: old?.anchor_id ?? association?.anchor,
      };
    });
  }
}
