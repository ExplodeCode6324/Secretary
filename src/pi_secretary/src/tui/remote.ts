import type { CoreClient } from "../core-client.ts";
import type {
  Message,
  Timeline,
  TaskPage,
  ScopePage,
  TimelineItem,
  SyncTransaction,
} from "../api/contracts.ts";

type Query = "timeline" | "tasks" | "scopes";
export class RemoteViews {
  messages = new Map<string, TimelineItem>();
  notices = new Map<string, string>();
  private confirmed = new Set<string>();
  tasks: TaskPage = { items: [], next_cursor: null, version: "0" };
  scopes = new Map<string, string>();
  error = "";
  timelineReady = false;
  generation = 0;
  taskCursor?: string;
  private stopped = false;
  private abort?: AbortController;
  private requested = new Set<Query>();
  private taskReadOK = false;
  private refreshing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private fragments = new Set<string>();
  onChange = () => {};
  onDisconnect = (error: unknown) => {};
  constructor(readonly client: CoreClient) {}
  inherit(previous: RemoteViews) {
    this.messages = new Map(previous.messages);
    this.notices = new Map(previous.notices);
    if (
      previous.client.endpoint.instance_id !== this.client.endpoint.instance_id
    )
      for (const item of this.messages.values())
        if (
          item.kind === "message"
            ? item.persistence === "transient"
            : item.activity.source === "live"
        )
          this.notices.set(item.id, "重启前的临时内容，尚未在当前 Core 确认");
  }
  private durable(item: TimelineItem) {
    return item.kind === "message"
      ? item.persistence === "durable"
      : item.activity.source === "durable";
  }
  async start() {
    const cursor = await this.client.syncCursor();
    await this.refresh();
    if (!this.stopped) void this.listen(cursor.cursor);
  }
  refresh(queries: Query[] = ["timeline", "tasks", "scopes"]) {
    for (const q of queries) this.requested.add(q);
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      while (this.requested.size && !this.stopped) {
        const batch = new Set(this.requested);
        this.requested.clear();
        await this.read(batch);
      }
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private schedule(queries: Query[]) {
    for (const q of queries) this.requested.add(q);
    if (this.timer || this.stopped || !this.requested.size) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh([]);
    }, 100);
  }
  private remember(item: TimelineItem) {
    if (item.kind !== "message" && item.activity.kind !== "tool") return;
    // Preserve assembled fragments and object identity at the same revision.
    this.notices.delete(item.id);
    if (
      this.confirmed.has(item.id) &&
      this.messages.get(item.id)?.revision === item.revision
    )
      return;
    this.confirmed.add(item.id);
    this.messages.set(item.id, item);
  }
  private async read(queries: Set<Query>) {
    const gen = this.generation;
    const anchor = [...this.messages.values()]
      .filter((item) => this.durable(item) && !this.notices.has(item.id))
      .at(-1)?.id;
    const results = await Promise.allSettled([
      queries.has("timeline")
        ? this.client.query<Timeline>("timeline?limit=50&streaming=true")
        : undefined,
      queries.has("tasks")
        ? this.client.query<TaskPage>(
            "tasks?limit=50" +
              (this.taskCursor
                ? "&cursor=" + encodeURIComponent(this.taskCursor)
                : ""),
          )
        : undefined,
      queries.has("scopes")
        ? this.client.query<ScopePage>("scopes?limit=100")
        : undefined,
    ]);
    if (this.stopped || gen !== this.generation) return;
    this.error = "";
    if (results[0].status === "fulfilled" && results[0].value) {
      let catchupFailed = false;
      // Catch up from the prior tail so >50 arrivals between refreshes are retained.
      if (anchor)
        try {
          let page = await this.client.query<Timeline>(
            `timeline/around?message_id=${encodeURIComponent(anchor)}&limit=50&streaming=true`,
          );
          let reached = false;
          while (!this.stopped && gen === this.generation) {
            for (const item of page.items) {
              if (item.id === anchor) reached = true;
              if (reached) this.remember(item);
            }
            if (!page.after) break;
            page = await this.client.query<Timeline>(
              `timeline?direction=after&limit=50&streaming=true&cursor=${encodeURIComponent(page.after)}`,
            );
          }
        } catch (e) {
          if (String(e) === "Error: TIMELINE_ITEM_NOT_FOUND") {
            this.notices.set(
              anchor,
              "原定位内容在当前 Core 中不存在；保留本地显示",
            );
          } else {
            catchupFailed = true;
            this.error = "新消息补读失败，保留已有内容：" + String(e);
          }
        }
      if (this.stopped || gen !== this.generation) return;
      this.timelineReady = true;
      for (const item of results[0].value.items) {
        if (catchupFailed && !this.messages.has(item.id)) continue;
        this.remember(item);
      }
      for (const m of this.messages.values())
        if (m.kind === "message" && m.next_cursor) void this.complete(m, gen);
    } else if (results[0].status === "rejected")
      this.error = "历史加载失败；保留已显示内容：" + String(results[0].reason);
    if (queries.has("tasks")) {
      this.taskReadOK = results[1].status === "fulfilled";
      if (results[1].status === "fulfilled" && results[1].value)
        this.tasks = results[1].value;
      else if (results[1].status === "rejected")
        this.error += " Task 读取失败：" + String(results[1].reason);
    }
    if (results[2].status === "fulfilled" && results[2].value)
      for (const scope of results[2].value.items)
        this.scopes.set(scope.id, scope.name);
    this.onChange();
  }
  private async complete(first: Message, gen: number) {
    const key = first.id + ":" + first.revision;
    if (this.fragments.has(key)) return;
    this.fragments.add(key);
    try {
      let text = first.text,
        next = first.next_cursor;
      while (next && !this.stopped) {
        const part = await this.client.query<Message>(
          `messages/${encodeURIComponent(first.id)}/content?streaming=true&cursor=${encodeURIComponent(next)}`,
        );
        if (
          gen !== this.generation ||
          this.messages.get(first.id)?.revision !== first.revision
        )
          return;
        text += part.text;
        next = part.next_cursor;
        this.messages.set(first.id, { ...first, text, next_cursor: next });
        this.onChange();
      }
    } catch (e) {
      if (!this.stopped) {
        this.error = "正文读取失败，保留已加载片段：" + String(e);
        this.onChange();
      }
    } finally {
      this.fragments.delete(key);
    }
  }
  async page(cursor?: string) {
    const previous = this.taskCursor;
    await this.refreshing;
    if (this.stopped) return false;
    this.taskCursor = cursor;
    await this.refresh(["tasks"]);
    if (!this.taskReadOK) this.taskCursor = previous;
    return this.taskReadOK;
  }
  private async listen(cursor: string) {
    this.abort = new AbortController();
    try {
      const body = await this.client.stream(cursor, this.abort.signal),
        reader = body.getReader(),
        decode = new TextDecoder();
      let buffer = "";
      try {
        while (!this.stopped) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decode.decode(chunk.value, { stream: true });
          if (buffer.length > 1024 * 1024)
            throw Error("STREAM_FRAME_TOO_LARGE");
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.startsWith("event:")) {
              if (frame.includes("event: reset"))
                throw Error("RESYNC_REQUIRED");
              if (frame.startsWith("event: transient"))
                this.schedule(["timeline"]);
              else if (frame.startsWith("event: change")) {
                const data = frame
                  .split("\n")
                  .filter((l) => l.startsWith("data: "))
                  .map((l) => l.slice(6))
                  .join("\n");
                const tx = JSON.parse(data) as SyncTransaction;
                const affected = new Set<Query>();
                for (const change of tx.changes) {
                  const query =
                    change.kind === "invalidate"
                      ? change.query
                      : change.resource_type;
                  const root = query?.split("/")[0];
                  if (root === "timeline" || root === "activities")
                    affected.add("timeline");
                  if (root === "tasks") affected.add("tasks");
                  if (root === "scopes") affected.add("scopes");
                }
                this.schedule([...affected]);
              }
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (!this.stopped) throw Error("STREAM_ENDED");
    } catch (e) {
      if (!this.stopped) this.onDisconnect(e);
    }
  }
  stop() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.timer);
    this.abort?.abort();
  }
}
