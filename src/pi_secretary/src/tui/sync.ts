import { CoreTransportError, type CoreClient } from "../core-client.ts";
import type {
  Core,
  Message,
  Session,
  SyncCursor,
  SyncPage,
  SyncTransaction,
  Timeline,
  TimelineItem,
  SSETransient,
} from "../api/contracts.ts";
import { sameBinding, type Binding, type ClientStore } from "./state.ts";
import { bindingOf } from "./outbox.ts";
export type Frame = { event: string; id: string; data: string };
/** Streaming decoder counts the entire incomplete frame, including ignored fields/comments. */
export class SSEFramer {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";
  private event = "message";
  private id = "";
  private data: string[] = [];
  private bytes = 0;
  constructor(
    readonly emit: (frame: Frame) => void,
    readonly limit = 512 * 1024,
  ) {}
  push(chunk: Uint8Array) {
    // Decode incrementally; a large network read can contain many individually bounded frames.
    for (let start = 0; start < chunk.length; start += 4096) {
      this.buffer += this.decoder.decode(chunk.subarray(start, start + 4096), {
        stream: true,
      });
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const raw = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        this.bytes += Buffer.byteLength(raw) + 1;
        if (this.bytes > this.limit) throw Error("SSE_FRAME_TOO_LARGE");
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (!line) {
          if (this.data.length)
            this.emit({
              event: this.event,
              id: this.id,
              data: this.data.join("\n"),
            });
          this.event = "message";
          this.id = "";
          this.data = [];
          this.bytes = 0;
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":"),
            field = colon < 0 ? line : line.slice(0, colon);
          let value = colon < 0 ? "" : line.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === "event") this.event = value;
          else if (field === "id") {
            if (value.includes("\0")) throw Error("INVALID_SSE_ID");
            this.id = value;
          } else if (field === "data") this.data.push(value);
        }
      }
      if (this.bytes + Buffer.byteLength(this.buffer) > this.limit)
        throw Error("SSE_FRAME_TOO_LARGE");
    }
  }
  finish() {
    this.buffer += this.decoder.decode();
    if (this.buffer || this.data.length || this.bytes)
      throw Error("INCOMPLETE_SSE_FRAME");
  }
}
function transaction(value: unknown): asserts value is SyncTransaction {
  const tx = value as SyncTransaction;
  if (
    !tx ||
    typeof tx.cursor !== "string" ||
    !tx.cursor ||
    !Array.isArray(tx.changes) ||
    tx.changes.length > 10000 ||
    tx.changes.some(
      (c) =>
        !c ||
        (c.kind === "record"
          ? typeof c.resource_type !== "string" ||
            typeof c.resource_id !== "string" ||
            typeof c.revision !== "string"
          : c.kind === "invalidate"
            ? typeof c.resource_type !== "string" || typeof c.query !== "string"
            : true),
    )
  )
    throw Error("INVALID_SYNC_TRANSACTION");
}
function message(value: unknown): asserts value is Message {
  const m = value as Message;
  if (
    !m ||
    m.kind !== "message" ||
    typeof m.id !== "string" ||
    typeof m.text !== "string" ||
    typeof m.revision !== "string" ||
    typeof m.role !== "string" ||
    typeof m.incomplete !== "boolean" ||
    !(m.next_cursor === null || typeof m.next_cursor === "string") ||
    (m.thinking !== undefined && typeof m.thinking !== "string") ||
    (m.thinking_preview &&
      (typeof m.thinking_preview.text !== "string" ||
        typeof m.thinking_preview.truncated !== "boolean"))
  )
    throw Error("INVALID_MESSAGE");
}
function timeline(value: unknown): asserts value is Timeline {
  const page = value as Timeline;
  if (
    !page ||
    !Array.isArray(page.items) ||
    page.items.length > 200 ||
    typeof page.version !== "string" ||
    typeof page.generation !== "string" ||
    !(page.before === null || typeof page.before === "string") ||
    !(page.after === null || typeof page.after === "string")
  )
    throw Error("INVALID_TIMELINE");
  const ids = new Set<string>();
  for (const item of page.items) {
    if (item.kind === "message") message(item);
    else if (
      item.kind !== "activity" ||
      typeof item.id !== "string" ||
      typeof item.revision !== "string" ||
      !item.activity ||
      typeof item.activity.id !== "string"
    )
      throw Error("INVALID_ACTIVITY");
    if (ids.has(item.id)) throw Error("DUPLICATE_TIMELINE_ID");
    ids.add(item.id);
  }
  if (Buffer.byteLength(JSON.stringify(page)) > 2 * 1024 * 1024)
    throw Error("TIMELINE_TOO_LARGE");
}
type Attach = () => Promise<{ core: Core; client: CoreClient }>;
type Checkpoint = {
  binding: Binding;
  instance: string;
  generation: string;
  cursor: string;
  dirty: Record<string, number>;
};
export class MainSync {
  page: Timeline = {
    items: [],
    version: "",
    generation: "",
    before: null,
    after: null,
  };
  session: Session | null = null;
  previews: SSETransient["previews"] = [];
  status = "offline";
  stale = true;
  newItems = 0;
  selected: string | null = null;
  following = true;
  loaded = new Map<
    string,
    {
      text: string;
      thinking: string;
      next: string | null;
      shown: boolean;
      thinkingEnabled: boolean;
    }
  >();
  onChange: () => void = () => {};
  private current?: { core: Core; client: CoreClient };
  private cursor = "";
  private durable?: Checkpoint;
  private dirty: Record<string, number> = {};
  private epoch = 0;
  private viewEpoch = 0;
  private invalidation = 0;
  private count = 0;
  private bytes = 0;
  private stop = new AbortController();
  private streamAbort?: AbortController;
  private contentAbort?: AbortController;
  private cache = new Map<string, { value: Message; bytes: number }>();
  private cacheBytes = 0;
  private checkpointTimer?: ReturnType<typeof setTimeout>;
  private checkpointWork?: Promise<void>;
  private loop?: Promise<void>;
  private loading = false;
  constructor(
    readonly store: ClientStore,
    readonly attach: Attach,
  ) {}
  async start() {
    try {
      const saved = await this.store.writer.loadCheckpoint();
      const cp = saved.value as Checkpoint;
      if (
        cp &&
        sameBinding(cp.binding, this.store.state.binding) &&
        saved.snapshot
      ) {
        const snapshot = saved.snapshot as {
          page: Timeline;
          session: Session | null;
        };
        timeline(snapshot.page);
        this.page = snapshot.page;
        this.session = snapshot.session;
        this.status = "saved snapshot — stale/offline";
        this.onChange();
      }
    } catch {
      this.status = "cache unavailable; fresh bootstrap required";
    }
    this.loop = this.run();
  }
  private valid(epoch: number) {
    if (epoch !== this.epoch || this.stop.signal.aborted)
      throw Error("STALE_FETCH");
  }
  private async query<T>(route: string, epoch = this.epoch): Promise<T> {
    const value = await this.current!.client.query<T>(route, {
      signal: this.stop.signal,
      maxBytes: 2 * 1024 * 1024,
    });
    this.valid(epoch);
    return value;
  }
  private async snapshot(
    epoch: number,
  ): Promise<{ page: Timeline; session: Session }> {
    let route = "timeline?limit=30&thinking=false";
    const anchor = this.store.state.anchor;
    if (!this.following && anchor)
      route =
        "timeline/around?" +
        new URLSearchParams({
          limit: "30",
          thinking: "false",
          ...(anchor.message_id ? { message_id: anchor.message_id } : {}),
          ...(anchor.event_id ? { event_id: anchor.event_id } : {}),
        });
    let page: Timeline;
    try {
      page = await this.query<Timeline>(route, epoch);
    } catch (error) {
      if (!(
        error instanceof CoreTransportError &&
        error.code === "TIMELINE_ITEM_NOT_FOUND" &&
        error.status === 404
      ))
        throw error;
      this.status = "saved anchor unavailable; showing latest bounded window";
      this.following = true;
      page = await this.query<Timeline>(
        "timeline?limit=30&thinking=false",
        epoch,
      );
    }
    timeline(page);
    const session = await this.query<Session>("session", epoch);
    if (
      !session ||
      typeof session.id !== "string" ||
      typeof session.revision !== "string" ||
      typeof session.state !== "string"
    )
      throw Error("INVALID_SESSION");
    return { page, session };
  }
  private checkpoint(): Checkpoint {
    return {
      binding: bindingOf(this.current!.core),
      instance: this.current!.core.instance_id,
      generation: this.page.generation,
      cursor: this.cursor,
      dirty: { ...this.dirty },
    };
  }
  private async persist(
    cp: Checkpoint,
    snapshot = { page: this.page, session: this.session },
  ) {
    await this.store.writer.checkpoint(cp, snapshot);
    this.durable = cp;
  }
  private apply(tx: SyncTransaction) {
    transaction(tx);
    this.cursor = tx.cursor;
    this.dirty.timeline = ++this.invalidation;
    this.dirty.session = this.invalidation;
    this.count++;
    this.bytes += Buffer.byteLength(JSON.stringify(tx));
    if (this.count > 256 || this.bytes > 2 * 1024 * 1024) {
      this.streamAbort?.abort();
      throw Error("SYNC_OVERLOAD_CATCHUP_REQUIRED");
    }
    this.schedule();
  }
  private schedule() {
    if (this.checkpointTimer || this.checkpointWork || this.stop.signal.aborted)
      return;
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = undefined;
      this.checkpointWork = this.refresh()
        .catch((error) => {
          this.stale = true;
          this.status = String(error);
          this.streamAbort?.abort();
          this.onChange();
        })
        .finally(() => {
          this.checkpointWork = undefined;
          if (Object.keys(this.dirty).length) this.schedule();
        });
    }, 500);
  }
  private async refresh() {
    const epoch = this.epoch,
      viewEpoch = this.viewEpoch,
      cp = this.checkpoint();
    await this.persist(cp);
    this.valid(epoch); // dirty obligation is durable before any clearing.
    this.count = 0;
    this.bytes = 0;
    const snapshot = await this.snapshot(epoch);
    if (viewEpoch !== this.viewEpoch) return;
    const nextDirty = { ...this.dirty };
    for (const [key, generation] of Object.entries(cp.dirty))
      if (nextDirty[key] === generation) delete nextDirty[key];
    const next = {
      ...this.checkpoint(),
      generation: snapshot.page.generation,
      dirty: nextDirty,
    };
    await this.persist(next, snapshot);
    this.valid(epoch);
    if (viewEpoch !== this.viewEpoch) {
      this.dirty.timeline = ++this.invalidation;
      return;
    }
    for (const [key, generation] of Object.entries(cp.dirty))
      if (this.dirty[key] === generation) delete this.dirty[key];
    if (!this.following)
      this.newItems += snapshot.page.items.filter(
        (item) => !this.page.items.some((old) => old.id === item.id),
      ).length;
    this.page = snapshot.page;
    this.session = snapshot.session;
    this.stale = false;
    this.previews = this.previews.filter(
      (p) =>
        !this.page.items.some(
          (m) =>
            m.kind === "message" &&
            (m.call_id === p.id || m.id === "message:" + p.id),
        ),
    );
    this.onChange();
  }
  private async catchup(epoch: number) {
    while (!this.stop.signal.aborted) {
      const page = await this.query<SyncPage>(
        "sync/changes?" +
          new URLSearchParams({ after: this.cursor, limit: "100" }),
        epoch,
      );
      if (
        !page ||
        !Array.isArray(page.transactions) ||
        page.transactions.length > 100 ||
        typeof page.next_cursor !== "string" ||
        typeof page.has_more !== "boolean"
      )
        throw Error("INVALID_SYNC_PAGE");
      const before = this.cursor;
      for (const tx of page.transactions) {
        transaction(tx);
        this.cursor = tx.cursor;
        this.dirty.timeline = ++this.invalidation;
        this.dirty.session = this.invalidation;
      }
      if (page.transactions.length && page.next_cursor !== this.cursor)
        throw Error("INVALID_SYNC_CURSOR");
      if (page.has_more && before === page.next_cursor)
        throw Error("NON_ADVANCING_SYNC_CURSOR");
      this.cursor = page.next_cursor;
      if (!page.has_more) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  private async run() {
    let cold = true,
      delay = 1000;
    while (!this.stop.signal.aborted) {
      try {
        this.current = await this.attach();
        if (
          !sameBinding(this.store.state.binding, bindingOf(this.current.core))
        )
          throw Error("FOREIGN_DOMAIN_QUARANTINED");
        const epoch = ++this.epoch;
        this.contentAbort?.abort();
        this.cache.clear();
        this.cacheBytes = 0;
        this.loaded.clear();
        if (
          cold ||
          !this.durable ||
          this.durable.instance !== this.current.core.instance_id
        ) {
          this.following = !this.store.state.anchor;
          const start = await this.query<SyncCursor>("sync/cursor", epoch);
          if (
            !start ||
            typeof start.cursor !== "string" ||
            start.instance_id !== this.current.core.instance_id
          )
            throw Error("INVALID_SYNC_CURSOR");
          this.cursor = start.cursor;
          this.dirty = {
            timeline: ++this.invalidation,
            session: this.invalidation,
          };
          const snapshot = await this.snapshot(epoch);
          this.page = snapshot.page;
          this.session = snapshot.session;
        } else {
          this.cursor = this.durable.cursor;
          this.dirty = { ...this.durable.dirty };
        }
        await this.catchup(epoch);
        await this.refresh();
        this.stale = false;
        this.status = "connected";
        cold = false;
        delay = 1000;
        this.onChange();
        await this.readStream(epoch);
        throw Error("STREAM_CLOSED");
      } catch (error) {
        if (this.stop.signal.aborted) break;
        this.stale = true;
        this.status = String(error);
        this.previews = [];
        this.onChange();
        clearTimeout(this.checkpointTimer);
        this.checkpointTimer = undefined;
        await this.checkpointWork;
        if (
          error instanceof CoreTransportError &&
          [
            "RESYNC_REQUIRED",
            "TIMELINE_RESET_REQUIRED",
            "CURSOR_EXPIRED",
          ].includes(error.code)
        ) {
          cold = true;
          this.durable = undefined;
          this.dirty = {};
        }
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            this.stop.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, delay);
          this.stop.signal.addEventListener("abort", done, { once: true });
        });
        delay = Math.min(30000, delay * 2);
      }
    }
  }
  private async readStream(epoch: number) {
    const controller = new AbortController();
    this.streamAbort = controller;
    const signal = AbortSignal.any([controller.signal, this.stop.signal]);
    let watchdog = setTimeout(() => controller.abort(), 15000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const framer = new SSEFramer((frame) => {
      this.valid(epoch);
      if (frame.event === "change") {
        const tx = JSON.parse(frame.data);
        transaction(tx);
        if (frame.id !== tx.cursor) throw Error("SSE_ID_MISMATCH");
        this.apply(tx);
      } else if (frame.event === "transient") {
        if (frame.id) throw Error("TRANSIENT_CURSOR_FORBIDDEN");
        const value = JSON.parse(frame.data) as SSETransient;
        if (
          !value ||
          !Array.isArray(value.previews) ||
          value.previews.length > 200 ||
          !value.activities ||
          typeof value.activities !== "object"
        )
          throw Error("INVALID_TRANSIENT");
        for (const p of value.previews)
          if (
            !p ||
            typeof p.id !== "string" ||
            !Number.isSafeInteger(p.version) ||
            !["running", "saved", "incomplete"].includes(p.status) ||
            !Array.isArray(p.blocks) ||
            p.blocks.some(
              (b) => b.type !== "text" || typeof b.text !== "string",
            ) ||
            (p.thinking_preview && typeof p.thinking_preview.text !== "string")
          )
            throw Error("INVALID_PREVIEW");
        this.previews = value.previews.filter(
          (p) =>
            !this.page.items.some(
              (m) =>
                m.kind === "message" &&
                (m.call_id === p.id || m.id === "message:" + p.id),
            ),
        );
        this.onChange();
      } else throw Error("UNKNOWN_SSE_EVENT");
    });
    try {
      const stream = await this.current!.client.stream(this.cursor, signal);
      reader = stream.getReader();
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) {
          framer.finish();
          break;
        }
        clearTimeout(watchdog);
        watchdog = setTimeout(() => controller.abort(), 15000);
        framer.push(value);
      }
    } finally {
      clearTimeout(watchdog);
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  }
  messageIDs() {
    return [
      ...new Set([
        ...this.page.items.filter((x) => x.kind === "message").map((x) => x.id),
        ...this.previews.map((p) => "message:" + p.id),
      ]),
    ];
  }
  private message(id: string): Message | undefined {
    const durable = this.page.items.find(
      (x) => x.id === id && x.kind === "message",
    ) as Message | undefined;
    if (durable) return durable;
    const preview = this.previews.find((p) => "message:" + p.id === id);
    return preview
      ? {
          id,
          kind: "message",
          revision: String(preview.version),
          role: "assistant",
          text: preview.blocks.map((b) => b.text).join(""),
          call_id: preview.id,
          incomplete: true,
          next_cursor: null,
          persistence: "transient",
        }
      : undefined;
  }
  async select(id: string) {
    const item = this.page.items.find((x) => x.id === id) ?? this.message(id);
    if (!item) throw Error("TIMELINE_ITEM_NOT_LOADED");
    this.selected = id;
    this.following = false;
    this.viewEpoch++;
    this.contentAbort?.abort();
    await this.store.setAnchor({
      ...(item.kind === "message"
        ? {
            message_id: id,
            ...(item.source_event_id ? { event_id: item.source_event_id } : {}),
          }
        : { event_id: item.activity.id }),
      offset: 0,
    });
    this.onChange();
  }
  async history(direction: "before" | "after" = "before") {
    if (!this.current) throw Error("OFFLINE");
    const cursor = this.page[direction];
    if (!cursor) {
      this.status = "no more history";
      this.onChange();
      return;
    }
    const epoch = this.epoch,
      viewEpoch = ++this.viewEpoch;
    this.contentAbort?.abort();
    try {
      const page = await this.query<Timeline>(
        "timeline?" +
          new URLSearchParams({
            cursor,
            direction,
            limit: "50",
            thinking: "false",
          }),
        epoch,
      );
      timeline(page);
      if (viewEpoch !== this.viewEpoch) throw Error("STALE_VIEW");
      if (page.generation !== this.page.generation)
        throw new CoreTransportError(
          "TIMELINE_RESET_REQUIRED",
          "timeline",
          409,
          true,
        );
      this.page = page;
      this.following = false;
      if (page.items[0]) await this.anchor(page.items[0].id, 0);
      this.onChange();
    } catch (error) {
      if (
        error instanceof CoreTransportError &&
        ["CURSOR_EXPIRED", "TIMELINE_RESET_REQUIRED"].includes(error.code)
      ) {
        const snapshot = await this.snapshot(epoch);
        this.page = snapshot.page;
        this.session = snapshot.session;
        this.status = "timeline reset; relocated by stable anchor";
        this.onChange();
      } else throw error;
    }
  }
  async latest() {
    this.viewEpoch++;
    this.contentAbort?.abort();
    this.following = true;
    this.selected = null;
    this.newItems = 0;
    await this.store.setAnchor(null);
    if (this.current) {
      const snapshot = await this.snapshot(this.epoch);
      this.page = snapshot.page;
      this.session = snapshot.session;
    }
    this.onChange();
  }
  async anchor(id: string, offset: number) {
    const item = this.page.items.find((row) => row.id === id);
    if (
      !item ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 10000000
    )
      throw Error("INVALID_VIEWPORT_ANCHOR");
    this.following = false;
    this.viewEpoch++;
    const anchor = {
      ...(item.kind === "message"
        ? {
            message_id: id,
            ...(item.source_event_id ? { event_id: item.source_event_id } : {}),
          }
        : { event_id: item.activity.id }),
      offset,
    };
    if (JSON.stringify(anchor) !== JSON.stringify(this.store.state.anchor))
      await this.store.setAnchor(anchor);
  }
  collapse(id: string) {
    this.contentAbort?.abort();
    const content = this.loaded.get(id);
    if (content) content.shown = false;
    this.onChange();
  }
  async more(id: string, thinking = false) {
    if (this.loading || !this.current)
      throw Error("CONTENT_LOADER_BUSY_OR_OFFLINE");
    const item = this.message(id);
    if (!item) throw Error("MESSAGE_NOT_LOADED");
    this.loading = true;
    const epoch = this.epoch,
      abort = new AbortController();
    this.contentAbort = abort;
    const old = this.loaded.get(id),
      content =
        old && old.shown && old.thinkingEnabled === thinking
          ? { ...old }
          : {
              text: "",
              thinkingEnabled: thinking,
              thinking: "",
              next: null as string | null,
              shown: true,
            };
    let retained = 0;
    const reserve = thinking ? 56000 : 28000;
    try {
      for (
        let fragments = 0;
        fragments < 4 && 128 * 1024 - retained >= reserve;
        fragments++
      ) {
        const params = new URLSearchParams({
          thinking: String(thinking),
          streaming: String(item.persistence === "transient"),
        });
        if (content.next) params.set("cursor", content.next);
        else if (
          old?.shown &&
          old.thinkingEnabled === thinking &&
          fragments === 0 &&
          !old.next
        )
          break;
        const key = [
          JSON.stringify(this.store.state.binding),
          this.current.core.instance_id,
          id,
          item.revision,
          params.toString(),
        ].join("|");
        let entry = this.cache.get(key);
        if (!entry) {
          const value = await this.current.client.query<Message>(
            "messages/" + encodeURIComponent(id) + "/content?" + params,
            {
              signal: AbortSignal.any([abort.signal, this.stop.signal]),
              maxBytes: 1048576,
            },
          );
          this.valid(epoch);
          if (abort.signal.aborted) throw Error("CONTENT_CANCELED");
          message(value);
          if (value.id !== id) throw Error("MESSAGE_ID_MISMATCH");
          entry = { value, bytes: Buffer.byteLength(JSON.stringify(value)) };
          if (entry.bytes > 8 * 1024 * 1024) throw Error("FRAGMENT_TOO_LARGE");
          while (this.cacheBytes + entry.bytes > 8 * 1024 * 1024) {
            const oldest = this.cache.keys().next().value!;
            this.cacheBytes -= this.cache.get(oldest)!.bytes;
            this.cache.delete(oldest);
          }
          this.cache.set(key, entry);
          this.cacheBytes += entry.bytes;
        } else {
          this.cache.delete(key);
          this.cache.set(key, entry);
        }
        const size =
          Buffer.byteLength(entry.value.text) +
          Buffer.byteLength(entry.value.thinking ?? "");
        if (size > reserve || retained + size > 128 * 1024)
          throw Error("FRAGMENT_DECODED_BOUND");
        retained += size;
        content.text += entry.value.text;
        content.thinking += thinking ? (entry.value.thinking ?? "") : "";
        content.next = entry.value.next_cursor;
        if (
          Buffer.byteLength(content.text) +
            Buffer.byteLength(content.thinking) >
          2 * 1024 * 1024
        )
          throw Error("VISIBLE_CONTENT_BOUND");
        if (!content.next) break;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      this.valid(epoch);
      if (this.message(id)?.revision !== item.revision)
        throw Error("STALE_CONTENT_REVISION");
      if (abort.signal.aborted) return;
      // Only the selected bounded expansion is retained outside the LRU.
      this.loaded.clear();
      this.loaded.set(id, content);
      this.onChange();
    } finally {
      this.loading = false;
    }
  }
  close() {
    this.stop.abort();
    this.streamAbort?.abort();
    this.contentAbort?.abort();
    clearTimeout(this.checkpointTimer);
  }
}
