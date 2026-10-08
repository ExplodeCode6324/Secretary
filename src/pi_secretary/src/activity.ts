import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import type { App } from "./app.ts";
import type {
  Scope,
  Input,
  Execution,
  CompactionJob,
  TaskPlan,
  TaskProposal,
  AuthorizationRequest,
} from "./contracts.ts";

export type ActivityStatus =
  "running" | "waiting" | "succeeded" | "failed" | "interrupted" | "cancelled";
export type Progress = {
  current?: number;
  completed?: number;
  total?: number;
  attempt?: number;
  max_attempts?: number;
};
export type Activity = {
  id: string;
  parent_id: string | null;
  session_id: string | null;
  execution_id: string | null;
  scope: "main" | "maintenance" | "background";
  kind: string;
  phase: string;
  status: ActivityStatus;
  version: number;
  started_at: string;
  last_progress_at: string;
  ended_at: string | null;
  progress?: Progress;
  actions: ("settings" | "authorization" | "decisions" | "tasks" | "status")[];
  loop_id?: string;
  call_id?: string;
};
export type ActivitySnapshot = {
  server_instance_id: string;
  activity_revision: number;
  store_revision: number;
  observed_at: string;
  activities: Activity[];
  recent: Activity[];
  total: number;
  truncated: boolean;
  queue: {
    accepted: number;
    claimed: number;
    feedback: number;
    blocked: boolean;
  };
  background_counts: { running: number; waiting: number };
};
const registries = new WeakMap<Store, Activities>();
export function activitiesFor(store: Store) {
  let value = registries.get(store);
  if (!value) {
    value = new Activities();
    registries.set(store, value);
  }
  return value;
}
export function safeActivityReason(error: unknown) {
  const value = String(error);
  if (/TIMEOUT|Timeout|timed out/i.test(value)) return "请求超时";
  if (/ABORT|INTERRUPT/i.test(value)) return "处理已中断";
  if (/CONFLICT|REVISION/i.test(value)) return "数据版本已变化，请重新检查";
  if (/CAPACITY|CONTEXT.*LARGE/i.test(value)) return "上下文容量不足";
  if (/WORLD_UNAVAILABLE/i.test(value)) return "World Model 未配置";
  if (/RECOVERY/i.test(value)) return "需要恢复当前处理";
  return "处理失败，请查看相关状态";
}
export function toolPhase(name: string, args: unknown) {
  if (name === "memory_read") {
    const source = (args as { source?: unknown } | null)?.source;
    return source === "world"
      ? "正在查看 World Model"
      : source === "consciousness"
        ? "正在读取工作记忆"
        : "正在查询历史记录";
  }
  return (
    (
      {
        task_propose: "正在分发 task",
        task_query: "正在查询 task 状态",
        task_control: "正在控制 task",
        memory_propose_change: "正在提交记忆变更",
        MasterInteract: "正在处理交互",
        read: "正在读取文件",
        write: "正在写入文件",
        bash: "正在运行命令",
        submit_result: "正在提交任务结果",
        request_decision: "正在请求 Master 决定",
      } as Record<string, string>
    )[name] ?? "正在执行工具"
  );
}
export class Activities {
  readonly instance = randomUUID();
  private revision = 0;
  private active = new Map<string, Activity>();
  private history: Activity[] = [];
  private projected = new Map<string, Activity>();
  private signature = "";
  private cached?: ActivitySnapshot;
  private cachedRevision = -1;
  private checkpointCache = new Map<
    string,
    { revision: number; progress: Progress }
  >();
  // All hooks are observational: no exception may alter the business operation.
  start(
    id: string,
    scope: Scope,
    kind: string,
    phase: string,
    parent: string | null = null,
    association: { loop_id?: string; call_id?: string } = {},
  ) {
    try {
      if (this.active.has(id)) return;
      const at = new Date().toISOString();
      const entry: Activity = {
        id,
        parent_id: parent,
        session_id: scope.session_id,
        execution_id: scope.execution_id,
        scope: scope.execution_id
          ? "background"
          : kind === "settings" || kind === "compaction"
            ? "maintenance"
            : "main",
        kind,
        phase,
        status: "running",
        version: ++this.revision,
        started_at: at,
        last_progress_at: at,
        ended_at: null,
        actions: [],
        ...association,
      };
      this.active.set(id, entry);
      this.remember(entry);
      // Bound observations even if a faulty producer never finishes.
      if (this.active.size > 256)
        this.active.delete(this.active.keys().next().value!);
    } catch {
      /* display only */
    }
  }
  step(
    id: string,
    phase: string,
    progress?: Progress,
    status: ActivityStatus = "running",
  ) {
    try {
      const old = this.active.get(id);
      if (!old) return;
      const entry = {
        ...old,
        phase,
        status,
        ...(progress ? { progress: { ...progress } } : {}),
        version: ++this.revision,
        last_progress_at: new Date().toISOString(),
      };
      this.active.set(id, entry);
      this.remember(entry);
    } catch {
      /* display only */
    }
  }
  end(id: string, status: ActivityStatus = "succeeded", error?: unknown) {
    try {
      const old = this.active.get(id);
      if (!old) return;
      const at = new Date().toISOString();
      this.remember({
        ...old,
        status,
        phase: error ? safeActivityReason(error) : old.phase,
        version: ++this.revision,
        last_progress_at: at,
        ended_at: at,
      });
      this.active.delete(id);
    } catch {
      /* display only */
    }
  }
  private remember(value: Activity) {
    this.history.push(structuredClone(value));
    if (this.history.length > 50) this.history.shift();
  }
  async tool<T>(
    id: string,
    scope: Scope,
    name: string,
    args: unknown,
    work: () => Promise<T>,
    association: { loop_id?: string; call_id?: string } = {},
  ): Promise<T> {
    try {
      this.start(
        id,
        scope,
        "tool",
        toolPhase(name, args),
        scope.execution_id ? "task:" + scope.execution_id : null,
        association,
      );
    } catch {}
    try {
      const value = await work();
      try {
        this.end(
          id,
          (value as { isError?: boolean })?.isError ? "failed" : "succeeded",
        );
      } catch {}
      return value;
    } catch (error) {
      try {
        this.end(id, "failed", error);
      } catch {}
      throw error;
    }
  }
  snapshot(app: App): ActivitySnapshot {
    if (
      this.cached &&
      this.cachedRevision === this.revision &&
      this.cached.store_revision === app.store.sequence
    )
      return {
        ...structuredClone(this.cached),
        observed_at: new Date().toISOString(),
      };
    const session = app.host.session,
      store = app.store;
    const entries: Activity[] = [];
    const make = (
      id: string,
      kind: string,
      phase: string,
      status: ActivityStatus,
      at: string,
      execution: string | null = null,
      progress?: Progress,
      actions: Activity["actions"] = [],
      lifetime?: { started_at: string | null; ended_at: string | null },
    ) => {
      const old = this.projected.get(id);
      const entry: Activity = {
        id,
        parent_id: null,
        session_id: session.id,
        execution_id: execution,
        scope:
          execution || kind === "task"
            ? "background"
            : kind === "settings" || kind === "compaction"
              ? "maintenance"
              : "main",
        kind,
        phase,
        status,
        version: 0,
        started_at: lifetime?.started_at ?? old?.started_at ?? at,
        last_progress_at: at,
        ended_at:
          status === "running" || status === "waiting"
            ? null
            : (lifetime?.ended_at ?? at),
        progress,
        actions,
      };
      if (
        old &&
        JSON.stringify({ ...old, version: 0 }) === JSON.stringify(entry)
      )
        entry.version = old.version;
      else {
        entry.version = ++this.revision;
        this.remember(entry);
      }
      this.projected.set(id, structuredClone(entry));
      entries.push(entry);
      return entry;
    };
    const allSettings = app.settings
      .applications()
      .filter((a) => a.session_id === session.id);
    const settings = allSettings.filter(
      (a) => !["APPLIED", "FAILED"].includes(a.state),
    );
    const last = allSettings.at(-1);
    if (last?.state === "FAILED") settings.push(last);
    for (const a of settings) {
      let cached = this.checkpointCache.get(a.id);
      if (cached?.revision !== a.revision) {
        const source = a.source_ref
          ? store.read<{ chunks: unknown[] }>(a.source_ref)
          : null;
        const candidate = a.candidate_ref
          ? store.read<{ completed: number }>(a.candidate_ref)
          : null;
        cached = {
          revision: a.revision,
          progress: {
            total: source?.chunks.length,
            completed: candidate?.completed ?? 0,
          },
        };
        this.checkpointCache.set(a.id, cached);
      }
      const live = this.active.get("settings:" + a.id);
      const phase =
        live?.phase ??
        (
          {
            QUEUED: "等待应用配置",
            SUMMARIZING: "等待恢复上下文整理",
            COMMITTING: "等待核对设置提交",
            REBUILDING: "等待恢复上下文重建",
            FAILED: safeActivityReason(a.error),
            BLOCKED: "设置提交结果待核对",
          } as Record<string, string>
        )[a.state] ??
        "设置待处理";
      const e = make(
        "settings:" + a.id,
        "settings",
        phase,
        a.state === "FAILED" ? "failed" : live ? live.status : "waiting",
        live?.last_progress_at ?? a.updated_at,
        null,
        { ...cached.progress, ...live?.progress },
        ["settings"],
      );
      if (live) e.started_at = live.started_at;
    }
    // Only the latest ordinary memory job is relevant to the current session.
    const job = store
      .all<CompactionJob>("CompactionJob")
      .filter((j) => j.session_id === session.id)
      .at(-1);
    if (
      job &&
      ["SUMMARIZING", "FAILED"].includes(job.state) &&
      !(last?.state === "APPLIED" && last.updated_at > job.updated_at)
    ) {
      const live = this.active.get("compaction:" + job.id);
      make(
        "compaction:" + job.id,
        "compaction",
        live?.phase ??
          (job.state === "FAILED"
            ? job.mode === "WORKING_MEMORY"
              ? "工作记忆更新失败"
              : "上下文整理失败"
            : "等待恢复" +
              (job.mode === "WORKING_MEMORY" ? "工作记忆更新" : "上下文整理")),
        job.state === "FAILED" ? "failed" : live ? "running" : "waiting",
        live?.last_progress_at ?? job.updated_at,
        null,
        { attempt: job.attempt ?? 1, max_attempts: 2 },
        ["status"],
      );
    }
    const background_counts = { running: 0, waiting: 0 };
    for (const p of store.all<TaskPlan>("TaskPlan")) {
      if (
        !["INITIALIZING", "INIT_FAILED"].includes(p.state) ||
        store.read<TaskProposal>(p.proposal_ref).session_id !== session.id
      )
        continue;
      make(
        "plan:" + p.id,
        "task",
        p.state === "INIT_FAILED" ? "任务初始化失败" : "正在初始化任务",
        p.state === "INIT_FAILED" ? "failed" : "waiting",
        p.updated_at,
        null,
        undefined,
        ["tasks"],
      ).scope = "background";
    }
    const taskIDs = new Set(
      store
        .all<TaskPlan>("TaskPlan")
        .filter(
          (p) =>
            store.read<TaskProposal>(p.proposal_ref).session_id === session.id,
        )
        .map((p) => p.id),
    );
    const executions = store
      .all<Execution>("Execution")
      .filter((e) => taskIDs.has(e.task_id));
    for (const e of executions) {
      if (["SUCCEEDED", "CANCELLED", "EXPIRED"].includes(e.state)) continue;
      // A failed execution is actionable until a newer execution supersedes it.
      if (
        e.state === "FAILED" &&
        executions
          .slice(executions.indexOf(e) + 1)
          .some((n) => n.task_id === e.task_id)
      )
        continue;
      const running = ["RUNNING", "DISPATCHING", "CANCEL_REQUESTED"].includes(
        e.state,
      );
      if (running) background_counts.running++;
      else if (e.state !== "FAILED") background_counts.waiting++;
      const names: Record<string, string> = {
        CREATED: "任务已创建",
        WAIT_PRECONDITION: "等待前置条件",
        READY: "等待执行",
        RUNNING: "任务执行中",
        DISPATCHING: "正在分发任务",
        WAIT_AUTH: "等待 Master 授权",
        WAIT_DECISION: "等待 Master 决定",
        RESULT_UNKNOWN: "操作结果未知，等待核对",
        CANCEL_REQUESTED: "正在取消任务",
        FAILED: "任务处理失败",
      };
      make(
        "task:" + e.id,
        "task",
        names[e.state] ?? "任务待处理",
        e.state === "FAILED" ? "failed" : running ? "running" : "waiting",
        e.updated_at,
        e.id,
        undefined,
        e.state === "WAIT_AUTH"
          ? ["authorization"]
          : e.state === "WAIT_DECISION"
            ? ["decisions"]
            : ["tasks"],
        e,
      );
    }
    if (["RECOVERY_BLOCKED", "CAPACITY_BLOCKED"].includes(session.state))
      make(
        "session:" + session.id,
        "main",
        session.state === "CAPACITY_BLOCKED"
          ? "上下文容量不足"
          : "主会话需要恢复",
        "failed",
        session.updated_at,
        null,
        undefined,
        ["status"],
      );
    for (const a of store.all<AuthorizationRequest>("AuthorizationRequest")) {
      if (
        a.scope.session_id !== session.id ||
        a.scope.execution_id ||
        a.state !== "PENDING"
      )
        continue;
      make(
        "authorization:" + a.id,
        "authorization",
        "等待 Master 授权",
        "waiting",
        a.updated_at,
        null,
        undefined,
        ["authorization"],
      );
    }
    const inputs = store
      .all<Input>("Input")
      .filter((i) => i.session_id === session.id);
    const queue = {
      accepted: inputs.filter(
        (i) => i.producer === "MASTER" && i.state === "ACCEPTED",
      ).length,
      claimed: inputs.filter(
        (i) => i.producer === "MASTER" && i.state === "CLAIMED",
      ).length,
      feedback: inputs.filter(
        (i) => i.producer !== "MASTER" && i.state !== "HANDLED",
      ).length,
      blocked:
        app.settings.blocked ||
        ["RECOVERY_BLOCKED", "CAPACITY_BLOCKED"].includes(session.state),
    };
    const visibleLive = [...this.active.values()].filter(
      (e) =>
        e.session_id === session.id ||
        (!!e.execution_id && executions.some((x) => x.id === e.execution_id)),
    );
    for (const live of visibleLive) {
      const parent = entries.find((e) => e.id === live.parent_id);
      if (parent) {
        if (parent.kind === "task" && parent.status === "running") {
          parent.phase = live.phase;
          parent.last_progress_at = live.last_progress_at;
        }
        continue;
      }
      if (!entries.some((e) => e.id === live.id))
        entries.push(structuredClone(live));
    }
    if (session.state === "RUNNING" && !entries.some((e) => e.scope === "main"))
      make(
        "session:" + session.id,
        "main",
        queue.feedback ? "正在读取任务结果 / 整理回复" : "正在处理已领取消息",
        "running",
        session.updated_at,
      );
    const present = new Set(entries.map((e) => e.id));
    for (const [id, old] of this.projected)
      if (!present.has(id)) {
        this.projected.delete(id);
        const execution = old.execution_id
          ? store.get<Execution>("Execution", old.execution_id)
          : null;
        this.remember({
          ...old,
          started_at: execution?.started_at ?? old.started_at,
          status: old.execution_id
            ? ((
                {
                  CANCELLED: "cancelled",
                  EXPIRED: "interrupted",
                  SUCCEEDED: "succeeded",
                  FAILED: "failed",
                } as Record<string, ActivityStatus>
              )[store.get<Execution>("Execution", old.execution_id).state] ??
              "interrupted")
            : old.status === "failed"
              ? "failed"
              : "succeeded",
          ended_at:
            execution?.ended_at ?? old.ended_at ?? new Date().toISOString(),
          version: ++this.revision,
        });
      }
    for (const key of this.checkpointCache.keys())
      if (!settings.some((a) => a.id === key)) this.checkpointCache.delete(key);
    entries.sort(
      (a, b) =>
        ({ main: 0, maintenance: 1, background: 2 })[a.scope] -
          { main: 0, maintenance: 1, background: 2 }[b.scope] ||
        a.started_at.localeCompare(b.started_at) ||
        a.id.localeCompare(b.id),
    );
    const recent = this.history
      .filter(
        (e) =>
          e.session_id === session.id ||
          (!!e.execution_id && executions.some((x) => x.id === e.execution_id)),
      )
      .slice(-50);
    const signature = JSON.stringify([
      entries,
      recent,
      queue,
      background_counts,
    ]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.revision++;
    }
    const snapshot: ActivitySnapshot = {
      server_instance_id: this.instance,
      activity_revision: this.revision,
      store_revision: store.sequence,
      observed_at: new Date().toISOString(),
      activities: entries.slice(0, 128),
      total: entries.length,
      truncated: entries.length > 128,
      recent,
      queue,
      background_counts,
    };
    this.cached = structuredClone(snapshot);
    this.cachedRevision = this.revision;
    return snapshot;
  }
}
