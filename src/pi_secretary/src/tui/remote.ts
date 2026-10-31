import { TaskBrowserWindow } from "./task-browser.ts";
import type { CoreClient } from "../core-client.ts";
import type {
  Message,
  TimelineItem,
  SyncTransaction,
  SSETransient,
} from "../api/contracts.ts";
import { HistoryWindow, HISTORY_BYTES, type Direction } from "./history.ts";
import {
  readMessageBody,
  bodyBytes,
  messagePath,
  type MessageBody,
  type Region,
} from "./body.ts";

type Query = "timeline" | "task-browser";
export class RemoteViews {
  readonly history: HistoryWindow;
  readonly taskBrowser: TaskBrowserWindow;
  readonly bodies = new Map<string, MessageBody>();
  get error() {
    return this.history.error;
  }
  get messages() {
    const visible = new Map<string, TimelineItem>();
    for (const [id, item] of this.history.items)
      visible.set(id, this.bodies.get(id)?.message ?? item);
    return visible;
  }
  get notices() {
    return this.history.notices;
  }
  get timelineReady() {
    return this.history.ready;
  }
  generation = 0;
  private stopped = false;
  private abort?: AbortController;
  private requested = new Set<Query>();
  private refreshing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private previewIds = new Set<string>();
  private wanted = new Set<string>();
  private bodyJob?: Promise<void>;
  private reads = 0;
  private readWaiters: (() => void)[] = [];
  private bodiesEpoch?: string;
  private failedBodies = new Map<string, string>();
  // If visible bodies alone exceed 4 MiB, leave a rehydratable placeholder.
  // Retry on a new anchor/mode/generation or explicit navigation, not every layout.
  private budgetDeferred = new Map<string, string>();
  private following = false;
  private followEpoch = 0;
  setFollowing(value: boolean) {
    if (value === this.following) return;
    this.following = value;
    this.followEpoch++;
    this.focus([...this.wanted]);
  }
  private tailMessage() {
    return [...this.history.items.values()]
      .filter((item) => item.kind === "message")
      .at(-1)?.id;
  }
  private budgetKey() {
    return `${this.history.anchor ?? ""}:${this.history.thinking}:${this.history.generation}:${this.followEpoch}`;
  }
  onChange = () => {};
  onDisconnect = (error: unknown) => {};
  constructor(readonly client: CoreClient) {
    this.history = new HistoryWindow({
      endpoint: client.endpoint,
      query: this.query.bind(this),
    });
    this.taskBrowser = new TaskBrowserWindow(
      { query: this.query.bind(this) },
      () => this.history.thinking,
    );
    this.taskBrowser.onChange = () => this.onChange();
    this.history.onChange = () => {
      const epoch = `${this.client.endpoint.instance_id}:${this.history.generation}`;
      if (this.bodiesEpoch && this.bodiesEpoch !== epoch) this.bodies.clear();
      this.bodiesEpoch = epoch;
      this.prune();
      this.onChange();
      this.focus([...this.wanted]);
    };
  }
  private async query<T>(path: string): Promise<T> {
    if (this.reads >= 2)
      await new Promise<void>((resolve) => this.readWaiters.push(resolve));
    else this.reads++;
    try {
      if (this.stopped) throw Error("VIEW_STOPPED");
      return await this.client.query<T>(path);
    } finally {
      const next = this.readWaiters.shift();
      if (next) next();
      else this.reads--;
    }
  }
  inherit(previous: RemoteViews) {
    this.history.inherit(previous.history);
    this.taskBrowser.inherit(previous.taskBrowser);
    // Old bodies are display-only until the new generation has been located.
    for (const [id, value] of previous.bodies) this.bodies.set(id, value);
    this.bodiesEpoch = previous.bodiesEpoch;
  }
  clearError() {
    this.history.clearError();
    this.taskBrowser.clearError();
    this.failedBodies.clear();
  }
  async start() {
    const cursor = await this.client.syncCursor();
    await this.refresh();
    if (!this.stopped) void this.listen(cursor.cursor);
  }
  refresh(queries: Query[] = ["timeline", "task-browser"]) {
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
  private async read(queries: Set<Query>) {
    const gen = this.generation;
    const previews = [...this.previewIds];
    this.previewIds.clear();
    const results = await Promise.allSettled([
      queries.has("timeline") ? this.history.refresh(previews) : undefined,
      queries.has("task-browser") ? this.taskBrowser.refresh() : undefined,
    ]);
    if (this.stopped || gen !== this.generation) return;
    if (results[0].status === "rejected")
      this.history.error = String(results[0].reason);
    if (results[1].status === "rejected")
      this.taskBrowser.error = String(results[1].reason);
    this.prune();
    this.onChange();
  }
  private prune() {
    for (const id of this.failedBodies.keys())
      if (!this.history.items.has(id)) this.failedBodies.delete(id);
    for (const id of this.budgetDeferred.keys())
      if (!this.history.items.has(id)) this.budgetDeferred.delete(id);
    for (const id of this.bodies.keys())
      if (!this.history.items.has(id) || this.history.evictedBodies.has(id)) {
        if (this.history.items.has(id) && this.wanted.has(id))
          this.budgetDeferred.set(id, this.budgetKey());
        this.bodies.delete(id);
      }
    const resident = (id: string, item: Message) => {
      const body = this.bodies.get(id);
      return (
        (body ? bodyBytes(body) : 0) +
        (body?.message === item
          ? 0
          : Buffer.byteLength(item.text) +
            Buffer.byteLength(item.thinking ?? ""))
      );
    };
    let bytes = 0;
    for (const [id, item] of this.history.items)
      if (item.kind === "message") bytes += resident(id, item);
    const ids = [...this.history.items.keys()],
      anchorIndex = ids.indexOf(this.history.anchor ?? "");
    const victims = ids
      .filter((id) => id !== this.history.anchor)
      .sort(
        (a, b) =>
          Number(this.wanted.has(a)) - Number(this.wanted.has(b)) ||
          Math.abs(ids.indexOf(b) - anchorIndex) -
            Math.abs(ids.indexOf(a) - anchorIndex),
      );
    for (const id of victims) {
      if (bytes <= HISTORY_BYTES) break;
      const item = this.history.items.get(id)!;
      if (item.kind !== "message") continue;
      if (this.wanted.has(id)) this.budgetDeferred.set(id, this.budgetKey());
      bytes -= resident(id, item);
      this.bodies.delete(id);
      this.history.items.set(id, { ...item, text: "", thinking: undefined });
      this.history.evictedBodies.add(id);
    }
  }
  focus(ids: string[]) {
    const tail = this.following ? this.tailMessage() : undefined;
    if (tail) ids = [...ids, tail];
    this.wanted = new Set(ids.filter((id) => this.history.items.has(id)));
    this.history.preferredBodies = this.wanted;
    if (this.bodyJob || this.stopped) return;
    const followEpoch = this.followEpoch;
    this.bodyJob = (async () => {
      const attempted = new Set<string>();
      while (!this.stopped) {
        const id = [...this.wanted].find((id) => {
          const item = this.history.items.get(id),
            cached = this.bodies.get(id);
          const key = `${id}:${item?.revision}:${this.history.thinking}:${this.history.generation}:${this.followEpoch}`;
          return (
            item?.kind === "message" &&
            !attempted.has(key) &&
            this.budgetDeferred.get(id) !== this.budgetKey() &&
            this.failedBodies.get(id) !== key &&
            (this.history.evictedBodies.has(id) ||
              !!item.next_cursor ||
              (this.following &&
                id === this.tailMessage() &&
                cached?.windowed &&
                (cached.body.after || cached.thinking.after)) ||
              (cached &&
                (cached.message.revision !== item.revision ||
                  cached.mode !== this.history.thinking)))
          );
        });
        if (!id) break;
        const first = this.history.items.get(id) as Message;
        attempted.add(
          `${id}:${first.revision}:${this.history.thinking}:${this.history.generation}:${this.followEpoch}`,
        );
        await this.loadBody(id);
      }
    })().finally(() => {
      this.bodyJob = undefined;
      if (followEpoch !== this.followEpoch && !this.stopped)
        this.focus([...this.wanted]);
    });
  }
  async loadBody(id: string, region?: Region, direction?: Direction) {
    const original = this.history.items.get(id);
    if (original?.kind !== "message") return;
    this.budgetDeferred.delete(id);
    const cached = this.bodies.get(id),
      mode = this.history.thinking,
      gen = this.generation,
      followEpoch = this.followEpoch,
      timelineGen = this.history.generation;
    const targets =
      this.following && id === this.tailMessage()
        ? { body: Number.MAX_SAFE_INTEGER, thinking: Number.MAX_SAFE_INTEGER }
        : cached?.windowed
          ? {
              body: cached.body.start,
              thinking: cached.thinking.start,
            }
          : direction === "before"
            ? {
                body: Number.MAX_SAFE_INTEGER,
                thinking: Number.MAX_SAFE_INTEGER,
              }
            : undefined;
    if (targets && cached?.windowed && region && direction)
      targets[region] =
        direction === "before"
          ? cached![region].previousStart
          : cached![region].nextStart;
    const valid = () =>
      !this.stopped &&
      followEpoch === this.followEpoch &&
      this.generation === gen &&
      this.history.generation === timelineGen &&
      this.history.thinking === mode &&
      this.history.items.has(id);
    let first = original;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt || region || this.history.evictedBodies.has(id)) {
          const beforeRevision = this.history.items.get(id)?.revision;
          first = await this.query<Message>(
            `messages/${messagePath(id)}/content?streaming=true&thinking=${mode}`,
          );
          if (!valid()) return;
          const afterRevision = this.history.items.get(id)?.revision;
          if (
            afterRevision !== beforeRevision &&
            afterRevision !== first.revision
          )
            return;
          this.history.items.set(id, first);
        }
        const version = first.revision;
        const body = await readMessageBody(
          { query: this.query.bind(this) },
          first,
          mode,
          {
            targets,
            previous: attempt ? undefined : cached,
            windowed: !!cached?.windowed,
            valid: () =>
              valid() && this.history.items.get(id)?.revision === version,
          },
        );
        if (!valid()) return;
        if (region && !body[region].text && cached?.[region].text) {
          this.notices.set(id, "该位置已超出当前正文；保留最近可读片段");
          return;
        }
        this.bodies.set(id, body);
        this.history.items.set(id, body.message);
        this.history.evictedBodies.delete(id);
        this.failedBodies.delete(id);
        if (this.notices.get(id)?.startsWith("正文读取失败"))
          this.notices.delete(id);
        this.prune();
        this.onChange();
        return;
      } catch (e) {
        if (!valid()) return;
        const code = e instanceof Error ? e.message : String(e);
        if (
          code === "BODY_SUPERSEDED" ||
          (first.preview_status === "running" && code === "CURSOR_EXPIRED")
        )
          return;
        if (
          attempt === 0 &&
          [
            "CURSOR_EXPIRED",
            "TIMELINE_RESET_REQUIRED",
            "INVALID_FRAGMENT_OFFSET",
          ].includes(code)
        )
          continue;
        this.failedBodies.set(
          id,
          `${id}:${this.history.items.get(id)?.revision}:${mode}:${timelineGen}:${this.followEpoch}`,
        );
        this.notices.set(id, "正文读取失败；按 ↑/↓ 重试：" + code);
        this.onChange();
        return;
      }
    }
  }
  async historyPage(direction: Direction) {
    await this.history.page(direction);
  }
  async toggleThinking() {
    await this.bodyJob;
    await this.history.setThinking(!this.history.thinking);
    await this.taskBrowser.setThinking();
    this.prune();
    this.onChange();
    this.focus([...this.wanted]);
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
              if (frame.startsWith("event: transient")) {
                const data = frame
                  .split("\n")
                  .filter((line) => line.startsWith("data: "))
                  .map((line) => line.slice(6))
                  .join("\n");
                const transient = data
                  ? (JSON.parse(data) as SSETransient)
                  : undefined;
                for (const preview of transient?.previews ?? [])
                  this.previewIds.add("message:" + preview.id);
                this.schedule(["timeline"]);
              } else if (frame.startsWith("event: change")) {
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
                  if (
                    [
                      "tasks",
                      "scopes",
                      "task-browser",
                      "attention",
                      "executions",
                    ].includes(root ?? "")
                  )
                    affected.add("task-browser");
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
    this.history.stop();
    this.taskBrowser.stop();
    this.wanted.clear();
    clearTimeout(this.timer);
    this.abort?.abort();
  }
}
