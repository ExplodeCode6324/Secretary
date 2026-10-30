import type { CoreClient } from "../core-client.ts";
import type {
  Message,
  Timeline,
  TaskPage,
  ScopePage,
} from "../api/contracts.ts";

export class RemoteViews {
  messages = new Map<string, Message>();
  tasks: TaskPage = { items: [], next_cursor: null, version: "0" };
  scopes = new Map<string, string>();
  error = "";
  timelineReady = false;
  generation = 0;
  taskCursor?: string;
  private stopped = false;
  private abort?: AbortController;
  private dirty = false;
  private refreshing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private fragments = new Set<string>();
  onChange = () => {};
  onDisconnect = (error: unknown) => {};
  constructor(readonly client: CoreClient) {}
  async start() {
    const cursor = await this.client.syncCursor();
    await this.refresh();
    if (!this.stopped) void this.listen(cursor.cursor);
  }
  refresh() {
    if (this.refreshing) {
      this.dirty = true;
      return this.refreshing;
    }
    this.refreshing = this.read().finally(() => {
      this.refreshing = undefined;
      if (this.dirty && !this.stopped) {
        this.dirty = false;
        this.schedule();
      }
    });
    return this.refreshing;
  }
  private schedule() {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, 100);
  }
  private async read() {
    const gen = this.generation;
    const anchor = [...this.messages.keys()].at(-1);
    const results = await Promise.allSettled([
      this.client.query<Timeline>("timeline?limit=50&streaming=true"),
      this.client.query<TaskPage>(
        "tasks?limit=50" +
          (this.taskCursor
            ? "&cursor=" + encodeURIComponent(this.taskCursor)
            : ""),
      ),
      this.client.query<ScopePage>("scopes?limit=100"),
    ]);
    if (this.stopped || gen !== this.generation) return;
    this.error = "";
    if (results[0].status === "fulfilled") {
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
              if (reached && item.kind === "message")
                this.messages.set(item.id, item as Message);
            }
            if (!page.after) break;
            page = await this.client.query<Timeline>(
              `timeline?direction=after&limit=50&streaming=true&cursor=${encodeURIComponent(page.after)}`,
            );
          }
        } catch (e) {
          catchupFailed = true;
          this.error = "新消息补读失败，保留已有内容：" + String(e);
        }
      if (this.stopped || gen !== this.generation) return;
      this.timelineReady = true;
      for (const item of results[0].value.items) {
        if (
          item.kind !== "message" ||
          (catchupFailed && !this.messages.has(item.id))
        )
          continue;
        const m = item as Message;
        const prior = this.messages.get(m.id);
        if (prior?.revision === m.revision && !prior.next_cursor) continue;
        this.messages.set(m.id, m);
        if (m.next_cursor) void this.complete(m, gen);
      }
      for (const m of this.messages.values())
        if (m.next_cursor) void this.complete(m, gen);
    } else
      this.error = "历史加载失败；保留已显示内容：" + String(results[0].reason);
    if (results[1].status === "fulfilled") this.tasks = results[1].value;
    else this.error += " Task 读取失败：" + String(results[1].reason);
    if (results[2].status === "fulfilled")
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
    this.taskCursor = cursor;
    this.generation++;
    await this.refreshing;
    if (!this.stopped) await this.refresh();
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
              this.schedule();
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
