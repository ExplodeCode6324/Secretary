import { Text } from "@earendil-works/pi-tui";
import type { CoreClient } from "../core-client.ts";
import type {
  TaskBrowserPage,
  TaskBrowserDetail,
  TaskBrowserMessages,
  TaskBrowserTask,
  Message,
} from "../api/contracts.ts";
import {
  readMessageBody,
  bodyBytes,
  type MessageBody,
  type Region,
} from "./body.ts";
import {
  messageComponent,
  safeText,
  type ViewEntry,
  type ReadingAnchor,
} from "./view.ts";
import { HISTORY_BYTES, HISTORY_ITEMS, type Direction } from "./history.ts";

const key = (m: Message) =>
  m.execution_id ? `${m.execution_id}:${m.id}` : m.id;
const textEntry = (id: string, text: string): ViewEntry => ({
  id,
  version: text,
  component: new Text(safeText(text), 0, 0),
});
const code = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
type Group = {
  items: Message[];
  before: boolean;
  after: boolean;
  availability: string;
};
const taskPath = (id: string) => `task-browser/${encodeURIComponent(id)}`;
const messagePath = (m: Message) =>
  `${taskPath(m.task_id!)}/executions/${encodeURIComponent(m.execution_id!)}/messages/${encodeURIComponent(m.id)}/content`;
/** Task's list and detail share no editor and issue only owner-authorized reads. */
export class TaskBrowserWindow {
  root?: TaskBrowserPage;
  detail?: TaskBrowserDetail;
  selected?: string;
  rootAnchor?: ReadingAnchor;
  detailAnchor?: ReadingAnchor;
  restoreAnchor?: ReadingAnchor;
  groups = new Map<string, Group>();
  bodies = new Map<string, MessageBody>();
  notices = new Map<string, string>();
  error = "";
  notice = "";
  private epoch = 0;
  private rootTask?: string;
  private searchTarget?: string;
  private entrySerial = 0;
  private pageDirection: Direction = "after";
  private entryCache = new Map<
    string,
    {
      revision: string;
      mode: boolean;
      body?: MessageBody;
      notice?: string;
      entry: ViewEntry;
    }
  >();
  private stopped = false;
  private expiry?: ReturnType<typeof setTimeout>;
  private wanted = new Set<string>();
  private deferred = new Set<string>();
  private bodyJob?: Promise<void>;
  private refreshJob?: Promise<void>;
  private refreshPending = false;
  private navigations = 0;
  private beginNavigation() {
    this.navigations++;
    return ++this.epoch;
  }
  private endNavigation() {
    this.navigations--;
    if (this.refreshPending && !this.refreshJob && !this.navigations)
      void this.refresh();
  }
  onChange = () => {};
  constructor(
    readonly client: Pick<CoreClient, "query">,
    readonly thinking: () => boolean,
  ) {}
  inherit(old: TaskBrowserWindow) {
    this.selected = old.selected;
    this.rootAnchor = old.rootAnchor;
    this.rootTask = old.rootTask;
    this.searchTarget = old.searchTarget;
    this.detailAnchor = old.detailAnchor;
    // Restore by stable IDs after restart; no old cursors or body bytes cross instances.
  }
  clearError() {
    this.error = "";
    this.notice = "";
    this.deferred.clear();
    this.notices.clear();
  }
  stop() {
    this.stopped = true;
    this.epoch++;
    clearTimeout(this.expiry);
    this.wanted.clear();
  }
  private changed() {
    this.prune();
    this.onChange();
  }
  private arm() {
    clearTimeout(this.expiry);
    if (this.root?.valid_until && !this.stopped)
      this.expiry = setTimeout(
        () => void this.refresh(),
        Math.max(
          1,
          Math.min(
            2147483647,
            Date.parse(this.root.valid_until) - Date.now() + 1,
          ),
        ),
      );
  }
  private rootTarget() {
    return this.rootTask ?? this.root?.historical?.id;
  }
  private async readRoot(epoch: number, target = this.rootTarget()) {
    let page: TaskBrowserPage;
    try {
      page = await this.client.query<TaskBrowserPage>(
        target
          ? `task-browser/locate?match=exact&task_id=${encodeURIComponent(target)}`
          : "task-browser?limit=50",
      );
    } catch (e) {
      if (!target || !/[A-Z_]*(NOT_BROWSABLE|NOT_FOUND)/.test(code(e))) throw e;
      const neighbors = (this.root?.items ?? [])
        .filter((r) => r.kind === "task")
        .map((r) => r.id);
      const position = neighbors.indexOf(target);
      const candidates = neighbors
        .filter((id) => id !== target)
        .sort(
          (a, b) =>
            Math.abs(neighbors.indexOf(a) - position) -
            Math.abs(neighbors.indexOf(b) - position),
        )
        .slice(0, 4);
      let located: TaskBrowserPage | undefined;
      for (const candidate of candidates) {
        try {
          located = await this.client.query<TaskBrowserPage>(
            `task-browser/locate?match=exact&task_id=${candidate}`,
          );
          break;
        } catch (error) {
          if (!/NOT_BROWSABLE|NOT_FOUND/.test(code(error))) throw error;
        }
      }
      page =
        located ??
        (await this.client.query<TaskBrowserPage>("task-browser?limit=50"));
      if (epoch === this.epoch) {
        this.rootTask =
          page.target ?? page.items.find((r) => r.kind === "task")?.id;
        this.notice = "原任务已不可浏览；已定位最近可用任务";
        if (!this.selected && this.rootTask)
          this.restoreAnchor = this.anchor(this.rootTask);
      }
    }
    if (this.stopped || epoch !== this.epoch) return;
    this.root = page;
    this.arm();
  }
  refresh(): Promise<void> {
    this.refreshPending = true;
    if (this.navigations) return Promise.resolve();
    if (this.refreshJob) return this.refreshJob;
    this.refreshJob = (async () => {
      while (this.refreshPending && !this.stopped && !this.navigations) {
        this.refreshPending = false;
        const epoch = this.epoch;
        try {
          await this.readRoot(epoch);
          if (this.selected && epoch === this.epoch)
            await this.readDetail(this.selected, epoch);
        } catch (e) {
          if (epoch === this.epoch) this.error = "Task 读取失败：" + code(e);
        }
        if (epoch === this.epoch) this.changed();
      }
    })().finally(() => {
      this.refreshJob = undefined;
      if (this.refreshPending && !this.navigations && !this.stopped)
        void this.refresh();
    });
    return this.refreshJob;
  }
  async search(id: string) {
    if (this.selected) {
      this.error = "/search_task 仅在 Task 列表根视图可用";
      this.changed();
      return;
    }
    const epoch = this.beginNavigation();
    try {
      const page = await this.client.query<TaskBrowserPage>(
        `task-browser/locate?match=prefix&task_id=${encodeURIComponent(id)}`,
      );
      if (this.stopped || epoch !== this.epoch) return;
      this.root = page;
      this.rootTask = page.target ?? undefined;
      this.searchTarget = page.target ?? undefined;
      this.restoreAnchor = this.anchor(page.target!);
      this.rootAnchor = this.restoreAnchor;
      this.arm();
    } catch (e) {
      if (epoch === this.epoch) this.error = "Task 定位失败：" + code(e);
    } finally {
      this.endNavigation();
    }
    this.changed();
  }
  async suggest(id: string) {
    try {
      return (
        await this.client.query<TaskBrowserPage>(
          `task-browser/locate?match=prefix&suggest=true&limit=20&task_id=${encodeURIComponent(id)}`,
        )
      ).suggestions;
    } catch {
      return [];
    }
  }
  private anchor(id: string): ReadingAnchor {
    return {
      item_id: id,
      measured_width: 0,
      region: "header",
      block_start_utf16: 0,
      row_in_block: 0,
    };
  }
  async open(id: string) {
    const epoch = this.beginNavigation();
    try {
      // Fetch/authorize before replacing the existing view.
      const detail = await this.client.query<TaskBrowserDetail>(taskPath(id));
      if (this.stopped || epoch !== this.epoch) return;
      this.selected = id;
      this.detail = detail;
      this.groups.clear();
      this.bodies.clear();
      this.notices.clear();
      this.deferred.clear();
      this.detailAnchor = undefined;
      this.restoreAnchor = this.anchor(
        detail.executions[0]
          ? "execution:" + detail.executions[0].id
          : detail.id,
      );
      this.changed();
      await this.readDetail(id, epoch, detail);
      if (epoch === this.epoch) this.changed();
    } catch (e) {
      if (epoch === this.epoch) {
        this.error = "Task 详情读取失败：" + code(e);
        this.changed();
      }
    } finally {
      this.endNavigation();
    }
  }
  back() {
    if (!this.selected) return;
    this.epoch++;
    this.selected = undefined;
    this.detail = undefined;
    this.groups.clear();
    this.bodies.clear();
    this.wanted.clear();
    this.deferred.clear();
    this.restoreAnchor = this.rootAnchor;
    this.changed();
  }
  async setThinking() {
    this.epoch++;
    this.bodies.clear();
    this.deferred.clear();
    this.notices.clear();
    for (const group of this.groups.values()) group.items = [];
    await this.refresh();
  }
  private async readDetail(
    id: string,
    epoch: number,
    provided?: TaskBrowserDetail,
  ) {
    let detail: TaskBrowserDetail;
    try {
      detail =
        provided ?? (await this.client.query<TaskBrowserDetail>(taskPath(id)));
    } catch (e) {
      if (epoch === this.epoch && /TASK_NOT_BROWSABLE/.test(code(e))) {
        this.back();
        this.notice = "任务已归档或不可用；详情与正文缓存已清除";
        return;
      }
      throw e;
    }
    if (this.stopped || epoch !== this.epoch || id !== this.selected) return;
    this.detail = detail;
    const retained = new Set(detail.executions.map((e) => e.id));
    let removed = false;
    for (const eid of this.groups.keys())
      if (!retained.has(eid)) {
        this.groups.delete(eid);
        removed = true;
      }
    if (
      this.detailAnchor &&
      /^(?:execution:|page:|[0-9a-f-]+:)/i.test(this.detailAnchor.item_id) &&
      !detail.executions.some((e) => this.detailAnchor!.item_id.includes(e.id))
    ) {
      this.notice = "原执行已不在最近三轮；已定位最近可读执行";
      this.detailAnchor = undefined;
      this.restoreAnchor = this.anchor("execution:" + detail.executions[0]?.id);
    }
    if (removed) this.changed();
    for (const execution of detail.executions) {
      const group = this.groups.get(execution.id);
      const anchor =
        group?.items.find((m) => key(m) === this.detailAnchor?.item_id) ??
        group?.items[0];
      await this.readGroup(
        execution.id,
        epoch,
        undefined,
        anchor?.id ??
          (this.detailAnchor?.item_id.startsWith(execution.id + ":")
            ? this.detailAnchor.item_id.slice(execution.id.length + 1)
            : undefined),
        true,
      );
      if (this.stopped || epoch !== this.epoch) return;
    }
  }
  private async readGroup(
    eid: string,
    epoch: number,
    direction?: Direction,
    around?: string,
    replace = false,
  ) {
    if (!this.selected) return;
    const route = `${taskPath(this.selected)}/executions/${encodeURIComponent(eid)}/messages`;
    const q = new URLSearchParams({
      limit: "50",
      thinking: String(this.thinking()),
    });
    if (direction) q.set("direction", direction);
    if (around) q.set("message_id", around);
    const page = await this.client.query<TaskBrowserMessages>(route + "?" + q);
    if (this.stopped || epoch !== this.epoch) return;
    const old = this.groups.get(eid),
      map = new Map<string, Message>();
    // Around-boundary pages must overlap the loaded window. Keep existing data
    // and its paging marker on a discontinuous response rather than hiding a gap.
    if (
      !replace &&
      around &&
      old?.items.length &&
      !page.items.some((m) => m.id === around)
    )
      throw new Error("TASK_MESSAGE_WINDOW_GAP");
    const items = replace
      ? page.items
      : direction === "before"
        ? [...page.items, ...(old?.items ?? [])]
        : [...(old?.items ?? []), ...page.items];
    for (const item of items) map.set(item.id, item);
    this.groups.set(eid, {
      items: [...map.values()],
      before:
        replace || direction === "before"
          ? !!page.before
          : (old?.before ?? !!page.before),
      after:
        replace || direction !== "before"
          ? !!page.after
          : (old?.after ?? !!page.after),
      availability: page.availability,
    });
  }
  async page(direction: Direction, marker?: string) {
    const epoch = this.beginNavigation();
    this.pageDirection = direction;
    try {
      if (this.selected) {
        const eid = marker?.startsWith("page:")
          ? marker.split(":")[1]
          : direction === "before"
            ? this.detail?.executions[0]?.id
            : this.detail?.executions.at(-1)?.id;
        if (!eid) return;
        const group = this.groups.get(eid);
        await this.readGroup(
          eid,
          epoch,
          direction,
          direction === "before"
            ? group?.items[0]?.id
            : group?.items.at(-1)?.id,
        );
      } else {
        const cursor =
          direction === "before" ? this.root?.before : this.root?.after;
        if (!cursor) return;
        const page = await this.client.query<TaskBrowserPage>(
          `task-browser?limit=50&direction=${direction}&cursor=${encodeURIComponent(cursor)}`,
        );
        if (this.stopped || epoch !== this.epoch) return;
        const old = this.root!,
          combined =
            direction === "before"
              ? [...page.items, ...old.items]
              : [...old.items, ...page.items];
        const map = new Map(combined.map((r) => [r.id, r]));
        let items = [...map.values()];
        // Cursor windows remain page-sized when exceeding the root metadata budget.
        if (
          items.length > HISTORY_ITEMS ||
          page.generation !== old.generation
        ) {
          items = page.items;
          const neighbor = direction === "after" ? items[0] : items.at(-1);
          if (neighbor) this.restoreAnchor = this.anchor(neighbor.id);
          this.notice = "较远列表已释放；已定位相邻窗口，可继续双向翻页";
        }
        this.root = {
          ...page,
          items,
          historical: old.historical,
          before:
            direction === "before" || items === page.items
              ? page.before
              : old.before,
          after:
            direction === "after" || items === page.items
              ? page.after
              : old.after,
        };
        this.arm();
      }
    } catch (e) {
      if (epoch !== this.epoch) return;
      if (/CURSOR_EXPIRED|RESET_REQUIRED|OUTSIDE_RECENT_THREE/.test(code(e))) {
        this.notice = "列表已变化；按任务/消息标识重新定位";
        await this.refresh();
      } else this.error = "Task 分页失败：" + code(e);
    } finally {
      this.endNavigation();
    }
    if (epoch === this.epoch) this.changed();
  }
  get hasBefore() {
    return this.selected
      ? !!this.groups.get(this.detail?.executions[0]?.id ?? "")?.before
      : !!this.root?.before;
  }
  get hasAfter() {
    return this.selected
      ? !!this.groups.get(this.detail?.executions.at(-1)?.id ?? "")?.after
      : !!this.root?.after;
  }
  viewport(rows: ReadingAnchor[]) {
    const first = rows[0];
    if (first) {
      if (this.selected) this.detailAnchor = first;
      else {
        this.rootAnchor = first;
        const visible = rows.find(
          (row) =>
            this.root?.items.some(
              (item) => item.kind === "task" && item.id === row.item_id,
            ) || this.root?.historical?.id === row.item_id,
        );
        if (visible) this.rootTask = visible.item_id;
      }
    }
    this.wanted = new Set(
      rows.map((r) => r.item_id).filter((id) => this.message(id)),
    );
    if (this.bodyJob || this.stopped) return;
    this.bodyJob = (async () => {
      const attempted = new Set<string>();
      while (!this.stopped) {
        const id = [...this.wanted].find(
          (id) =>
            !attempted.has(id) &&
            !this.deferred.has(id) &&
            (!this.bodies.has(id) ||
              this.bodies.get(id)!.message.revision !==
                this.message(id)?.revision),
        );
        if (!id) break;
        attempted.add(id);
        await this.loadBody(id);
      }
    })().finally(() => {
      this.bodyJob = undefined;
    });
  }
  message(id: string): Message | undefined {
    if (this.detail?.id === id) return this.detail;
    for (const g of this.groups.values()) {
      const m = g.items.find((m) => key(m) === id);
      if (m) return m;
    }
    return undefined;
  }
  async loadBody(id: string, region?: Region, direction?: Direction) {
    const original = this.message(id);
    if (!original) return;
    const epoch = this.epoch,
      mode = this.thinking(),
      cached = this.bodies.get(id);
    const path = original.execution_id
      ? messagePath(original)
      : taskPath(original.task_id!);
    const valid = () =>
      !this.stopped &&
      epoch === this.epoch &&
      mode === this.thinking() &&
      this.message(id)?.revision === original.revision;
    const targets = cached
      ? { body: cached.body.start, thinking: cached.thinking.start }
      : this.detailAnchor?.item_id === id
        ? {
            body:
              this.detailAnchor.region === "body"
                ? this.detailAnchor.block_start_utf16
                : 0,
            thinking:
              this.detailAnchor.region === "thinking"
                ? this.detailAnchor.block_start_utf16
                : 0,
          }
        : undefined;
    if (targets && cached && region && direction)
      targets[region] =
        direction === "before"
          ? cached![region].previousStart
          : cached![region].nextStart;
    try {
      const first = await this.client.query<Message>(
        path + "?thinking=" + mode,
      );
      if (!valid()) return;
      const body = await readMessageBody(this.client, first, mode, {
        contentPath: path,
        windowed: !!cached?.windowed || !!targets,
        targets,
        previous: cached,
        valid,
      });
      if (!valid()) return;
      this.bodies.set(id, body);
      this.notices.delete(id);
      this.deferred.delete(id);
      this.changed();
    } catch (e) {
      if (!valid()) return;
      if (/TASK_NOT_BROWSABLE|OUTSIDE_RECENT_THREE/.test(code(e))) {
        await this.refresh();
        return;
      }
      this.notices.set(id, "正文读取失败；↑/↓ 重试：" + code(e));
      this.deferred.add(id);
      this.onChange();
    }
  }
  private orderedMessages() {
    return (
      this.detail?.executions.flatMap(
        (e) => this.groups.get(e.id)?.items ?? [],
      ) ?? []
    );
  }
  private prune() {
    let all = this.orderedMessages();
    while (all.length > HISTORY_ITEMS) {
      const pos = all.findIndex((m) => key(m) === this.detailAnchor?.item_id);
      const dropLast =
        pos >= 0 ? pos < all.length / 2 : this.pageDirection === "before";
      const victim = dropLast ? all.at(-1)! : all[0];
      const g = this.groups.get(victim.execution_id!)!;
      const index = g.items.indexOf(victim);
      if (index === 0) g.before = true;
      else g.after = true;
      g.items.splice(index, 1);
      all = this.orderedMessages();
    }
    const messages = new Map(
      [...all, ...(this.detail ? [this.detail] : [])].map((m) => [key(m), m]),
    );
    for (const id of this.bodies.keys())
      if (!messages.has(id)) this.bodies.delete(id);
    for (const id of this.entryCache.keys())
      if (!messages.has(id)) this.entryCache.delete(id);
    for (const id of this.deferred)
      if (!messages.has(id)) this.deferred.delete(id);
    for (const id of this.notices.keys())
      if (!messages.has(id)) this.notices.delete(id);
    let bytes =
      [...messages.values()].reduce(
        (n, m) =>
          n + Buffer.byteLength(m.text) + Buffer.byteLength(m.thinking ?? ""),
        0,
      ) + [...this.bodies.values()].reduce((n, b) => n + bodyBytes(b), 0);
    const victims = [...this.bodies.keys()].sort(
      (a, b) => Number(this.wanted.has(a)) - Number(this.wanted.has(b)),
    );
    for (const id of victims) {
      if (bytes <= HISTORY_BYTES) break;
      bytes -= bodyBytes(this.bodies.get(id)!);
      this.bodies.delete(id);
      this.deferred.add(id);
      this.notices.set(id, "正文窗口已释放；↑/↓ 重新读取");
    }
  }
  entries(): ViewEntry[] {
    const root = this.root;
    if (!this.selected)
      return [
        textEntry(
          "task-title",
          `Task · Scope ${root?.counts.scopes ?? 0} · 已归档 Scope ${root?.counts.archived_scopes ?? 0}\n/search_task <ID> 定位 · /taskdetail <完整ID> 查看\n`,
        ),
        ...(root?.historical
          ? [
              textEntry("historical-title", "临时历史定位（不计入当前集合）"),
              this.taskEntry(root.historical),
            ]
          : []),
        ...(root?.items ?? [])
          .filter(
            (row) =>
              row.kind !== "group" ||
              !row.id.startsWith("continued:") ||
              !root?.items.some(
                (other) => other.kind === "group" && other.id === row.group.id,
              ),
          )
          .map((row) =>
            row.kind === "group"
              ? textEntry(
                  row.id,
                  `\n${row.group.name} · ${row.group.count} 个当前 Task${row.id.startsWith("continued:") ? "（续）" : ""}\n`,
                )
              : this.taskEntry(row.task),
          ),
        textEntry("task-end", root?.after ? "↓ 继续当前集合" : "当前集合结束"),
      ];
    const detail = this.detail;
    if (!detail) return [textEntry("task-loading", "正在读取任务…")];
    const entries = [
      textEntry(
        "task-detail-title",
        `Task 详情 · ${detail.task.scope_name}\n${detail.task.id} · /back 返回列表\n`,
      ),
      this.taskEntry(detail.task),
      this.messageEntry(detail),
    ];
    if (!detail.executions.length)
      entries.push(
        textEntry("no-execution", "尚未产生 Execution；无 Agent 对话"),
      );
    for (const e of detail.executions) {
      entries.push(
        textEntry(
          "execution:" + e.id,
          `\nExecution ${e.id}\n${e.state} · ${e.kind} · ${e.retention_state} · 调用 ${e.invoked_at ?? "未知"} (${e.ordering_source}) · 结束 ${e.ended_at ?? "尚未"}\n`,
        ),
      );
      const g = this.groups.get(e.id);
      if (!g) {
        entries.push(textEntry("loading:" + e.id, "正在读取 Agent 消息…"));
        continue;
      }
      if (g.before)
        entries.push(textEntry(`page:${e.id}:before`, "↑ 此执行更早的消息"));
      for (const m of g.items) entries.push(this.messageEntry(m));
      if (g.after)
        entries.push(textEntry(`page:${e.id}:after`, "↓ 此执行后续消息"));
      if (!g.items.length)
        entries.push(
          textEntry(
            "availability:" + e.id,
            g.availability === "not_agent"
              ? "PROGRAM 执行，不存在 Agent 对话"
              : g.availability === "recorded"
                ? "此消息窗口已释放；↑/↓ 重新读取"
                : "尚无可读取的 Agent 消息",
          ),
        );
    }
    return entries;
  }
  private taskEntry(t: TaskBrowserTask) {
    return textEntry(
      t.id,
      [
        `${!this.selected && this.searchTarget === t.id ? "▶ 已定位 · " : ""}${t.goal}${t.goal_truncated ? " …（预览；完整内容见详情）" : ""}`,
        `${t.id} · ${t.state} · ${t.executor} · ${t.trigger}`,
        `Scope: ${t.scope_name} · ${t.current ? "当前" : "历史"} · ${t.current_reasons.join(", ") || "无当前工作"}`,
        `执行: ${t.active_executions.map((e) => `${e.state} ${e.id} · ${e.ordering_source === "started_at" ? "开始" : e.ordering_source === "created_at" ? "创建（尚未开始）" : "调用时间"} ${e.invoked_at ?? "未知"}`).join("\n") || "无非终态执行"} · 排队请求 ${t.pending_request_count} / 触发 ${t.pending_occurrence_count}`,
        `计划下次: ${t.next_due_at ?? "无"} · ${t.schedule_status} · 排队到期: ${t.pending_due_at ?? "无"}`,
        `最新执行: ${t.latest_execution?.state ?? "尚无"} · ${t.latest_execution?.id ?? ""}`,
        ...(t.latest_execution
          ? [
              `调用排序: ${t.latest_execution.invoked_at ?? "未知"} (${t.latest_execution.ordering_source}) · 结束: ${t.latest_execution.ended_at ?? "尚未"}`,
            ]
          : []),
        `结果观测: ${t.latest_result_observed_at ?? "尚无"}`,
        `结果: ${t.latest_result ?? "尚无"}${t.initialization_error ? "\n初始化错误: " + t.initialization_error : ""}`,
        "",
      ].join("\n"),
    );
  }
  private messageEntry(m: Message): ViewEntry {
    const id = key(m),
      body = this.bodies.get(id),
      notice = this.notices.get(id),
      mode = this.thinking(),
      cached = this.entryCache.get(id);
    if (
      cached &&
      cached.revision === m.revision &&
      cached.mode === mode &&
      cached.body === body &&
      cached.notice === notice
    )
      return cached.entry;
    const entry: ViewEntry = {
      id,
      revision: m.revision,
      version: String(++this.entrySerial),
      component: messageComponent(
        body?.message ?? m,
        mode,
        body,
        !!notice,
        m.execution_id ? "Agent" : undefined,
        notice,
      ),
    };
    this.entryCache.set(id, {
      revision: m.revision,
      mode,
      body,
      notice,
      entry,
    });
    return entry;
  }
}
