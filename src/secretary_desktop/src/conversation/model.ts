import type { Message, Timeline, TimelineItem } from "../contracts";
import type { BridgePort, Query } from "../bridge";
export const LIMITS = {
  pages: 3,
  rows: 150,
  raw: 8 * 1024 * 1024,
  row: 2 * 1024 * 1024,
  html: 8 * 1024 * 1024,
  cursors: 1024,
};
export const bytes = (v: string) => new TextEncoder().encode(v).length;
export const rowBytes = (r: TimelineItem) =>
  r.kind === "message"
    ? bytes(r.text) + bytes(r.thinking ?? "")
    : bytes(JSON.stringify(r.activity));
export function thinkingPreference(
  domain: string,
  storage: Pick<Storage, "getItem">,
): boolean {
  try {
    return storage.getItem("secretary.thinking.v1." + domain) !== "off";
  } catch {
    return true;
  }
}
export function saveThinking(
  domain: string,
  value: boolean,
  storage: Pick<Storage, "setItem">,
) {
  try {
    storage.setItem("secretary.thinking.v1." + domain, value ? "on" : "off");
  } catch {
    /* this session's choice still applies */
  }
}
export function visibleFragment(text: string, eof: boolean) {
  if (eof || !text) return text;
  // Withhold the last grapheme until its following boundary arrives. Never
  // rewrite a displayed combining sequence/ZWJ cluster on the next fragment.
  const segments = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(text);
  let boundary = 0;
  for (const segment of segments) boundary = segment.index;
  return text.slice(0, boundary);
}
export class ReadBudget {
  active = 0;
  private waiting: (() => void)[] = [];
  async run<T>(read: () => Promise<T>): Promise<T> {
    if (this.active < 2) this.active++;
    else {
      if (this.waiting.length >= 4) throw Error("READ_BUSY");
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await read();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
export class ContentStore {
  private rows = new Map<string, Message>();
  private used = new Map<string, Set<string>>();
  private busy = new Set<string>();
  epoch = 0;
  private residents: Map<string, string> | null = null;
  constructor(
    readonly budget: ReadBudget,
    private baseBytes: () => number = () => 0,
  ) {}
  get size() {
    return [...this.rows.values()].reduce((n, r) => n + rowBytes(r), 0);
  }
  get(row: Message) {
    const r = this.rows.get(row.id);
    return r?.persistence === "transient" && row.persistence === "transient"
      ? { ...row, thinking: r.thinking }
      : r?.revision === row.revision
        ? r
        : row;
  }
  clear() {
    this.epoch++;
    this.rows.clear();
    this.residents = null;
    this.used.clear();
    this.busy.clear();
  }
  retain(items: TimelineItem[]) {
    const keep = new Map(items.map((r) => [r.id, String(r.revision)]));
    this.residents = keep;
    for (const [id, row] of this.rows)
      if (
        keep.get(id) !== row.revision &&
        !(
          row.persistence === "transient" &&
          items.some(
            (r) =>
              r.id === id &&
              r.kind === "message" &&
              r.persistence === "transient",
          )
        )
      ) {
        this.rows.delete(id);
        this.used.delete(id + ":" + row.revision);
      }
  }
  put(row: Message) {
    const old = this.rows.get(row.id);
    if (
      rowBytes(row) > LIMITS.row ||
      this.baseBytes() + this.size - (old ? rowBytes(old) : 0) + rowBytes(row) >
        LIMITS.raw
    )
      throw Error("CONTENT_LIMIT");
    if (!old && this.rows.size >= LIMITS.rows) throw Error("CONTENT_LIMIT");
    this.rows.set(row.id, row);
  }
  async complete(
    row: Message,
    bridge: BridgePort,
    domain: string,
    thinking: boolean,
  ): Promise<string> {
    if (row.persistence !== "durable") throw Error("CONTENT_NOT_DURABLE");
    const epoch = this.epoch;
    if (
      this.get(row).loaded_portion ||
      (thinking && this.get(row).thinking === undefined)
    )
      await this.read(row, bridge, domain, thinking, true);
    while (this.get(row).next_cursor) {
      if (
        epoch !== this.epoch ||
        (this.residents && this.residents.get(row.id) !== row.revision)
      )
        throw Error("CURSOR_EXPIRED");
      await this.read(row, bridge, domain, thinking);
    }
    if (epoch !== this.epoch) throw Error("CURSOR_EXPIRED");
    return this.get(row).text;
  }
  async read(
    row: Message,
    bridge: BridgePort,
    domain: string,
    thinking: boolean,
    replace = false,
  ): Promise<void> {
    const current = this.get(row);
    replace = replace || (thinking && current.thinking === undefined);
    const cursor = replace ? undefined : current.next_cursor;
    if (!replace && !cursor) return;
    const key = row.id + ":" + row.revision;
    if (this.busy.has(key)) throw Error("READ_BUSY");
    if (cursor && (this.used.get(key)?.size ?? 0) >= LIMITS.cursors)
      throw Error("CONTENT_LIMIT");
    if (cursor && this.used.get(key)?.has(cursor))
      throw Error("REPEATED_CURSOR");
    const epoch = this.epoch;
    this.busy.add(key);
    try {
      const next = await this.budget.run(() =>
        bridge.query<Message>(domain, {
          operation: "messages/{id}/content",
          id: row.id,
          parameters: {
            thinking,
            streaming: false,
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
      if (
        epoch !== this.epoch ||
        (this.residents && this.residents.get(row.id) !== row.revision)
      )
        return;
      if (next.id !== row.id || next.revision !== row.revision)
        throw Error("CURSOR_EXPIRED");
      if (next.persistence !== "durable") return;
      if (
        cursor &&
        (next.next_cursor === cursor ||
          this.used.get(key)?.has(next.next_cursor ?? ""))
      )
        throw Error("REPEATED_CURSOR");
      if (next.next_cursor && !next.text && !(thinking && next.thinking))
        throw Error("EMPTY_FRAGMENT");
      this.put({
        ...next,
        text: (replace ? "" : current.text) + next.text,
        ...(thinking
          ? {
              thinking:
                (replace ? "" : (current.thinking ?? "")) +
                (next.thinking ?? ""),
            }
          : { thinking: undefined }),
      });
      if (cursor) {
        const seen = this.used.get(key) ?? new Set();
        seen.add(cursor);
        this.used.set(key, seen);
      }
    } finally {
      if (epoch === this.epoch) this.busy.delete(key);
    }
  }
}
// Reconcile a frozen live window without evicting the reading anchor or adding
// unseen rows. Streaming=false baseline rows cannot erase an admitted SSE body.
export function reconcileWindow(
  frozen: Timeline,
  incoming: Timeline,
  extraBytes = 0,
): Timeline {
  if (frozen.generation !== incoming.generation)
    throw Error("TIMELINE_RESET_REQUIRED");
  const updates = new Map(incoming.items.map((r) => [r.id, r]));
  const items = frozen.items.map((old) => {
    const next = updates.get(old.id);
    if (!next) return old;
    if (
      old.kind === "message" &&
      next.kind === "message" &&
      next.persistence === "transient" &&
      next.preview_availability !== "expired"
    )
      return { ...next, text: next.text || old.text };
    return next;
  });
  if (
    items.length > LIMITS.rows ||
    items.reduce((n, r) => n + rowBytes(r), 0) + extraBytes > LIMITS.raw
  )
    throw Error("CONTENT_LIMIT");
  return { ...frozen, version: incoming.version, items };
}
export type WindowPage = { query: Query; value: Timeline };
export class ReadingWindow {
  pages: WindowPage[] = [];
  epoch = 0;
  busy = false;
  stale = false;
  constructor(
    readonly budget: ReadBudget,
    private extraBytes: () => number = () => 0,
  ) {}
  get value(): Timeline | undefined {
    if (!this.pages.length) return;
    const rows = new Map<string, TimelineItem>();
    for (const page of this.pages)
      for (const row of page.value.items) rows.set(row.id, row);
    return {
      ...this.pages[0].value,
      items: [...rows.values()],
      before: this.pages[0].value.before,
      after: this.pages.at(-1)!.value.after,
    };
  }
  get size() {
    return this.value?.items.reduce((n, r) => n + rowBytes(r), 0) ?? 0;
  }
  clear() {
    this.epoch++;
    this.pages = [];
    this.busy = false;
    this.stale = false;
  }
  async load(
    bridge: BridgePort,
    domain: string,
    query: Query,
    direction: "before" | "after" | "replace",
    pins: Set<string> | (() => Set<string>) = new Set<string>(),
  ) {
    if (this.busy) return;
    this.busy = true;
    const epoch = this.epoch;
    try {
      const value = await this.budget.run(() =>
        bridge.query<Timeline>(domain, query),
      );
      if (epoch !== this.epoch) return;
      if (value.items.length > 50 || bytes(JSON.stringify(value)) > 1024 * 1024)
        throw Error("PAGE_LIMIT");
      if (
        direction !== "replace" &&
        this.value?.generation !== value.generation
      )
        throw Error("TIMELINE_RESET_REQUIRED");
      const page = { query, value };
      const next =
        direction === "replace"
          ? [page]
          : direction === "before"
            ? [page, ...this.pages]
            : [...this.pages, page];
      while (
        next.length > LIMITS.pages ||
        next.reduce(
          (n, p) => n + p.value.items.reduce((m, r) => m + rowBytes(r), 0),
          0,
        ) +
          this.extraBytes() >
          LIMITS.raw
      ) {
        if (next.length <= 1) throw Error("CONTENT_LIMIT");
        const index = direction === "before" ? next.length - 1 : 0;
        if (
          next[index].value.items.some((r) =>
            (typeof pins === "function" ? pins() : pins).has(r.id),
          )
        )
          throw Error("READING_PINNED");
        next.splice(index, 1);
      }
      this.pages = next;
      this.stale = false;
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  async refresh(
    bridge: BridgePort,
    domain: string,
    pins: Set<string> | (() => Set<string>) = new Set<string>(),
  ) {
    if (this.busy || !this.pages.length) return;
    this.busy = true;
    this.stale = true;
    const epoch = this.epoch;
    try {
      const next: WindowPage[] = [];
      for (const page of this.pages) {
        const value = await this.budget.run(() =>
          bridge.query<Timeline>(domain, page.query),
        );
        if (epoch !== this.epoch) return;
        if (value.generation !== page.value.generation)
          throw Error("TIMELINE_RESET_REQUIRED");
        if (
          value.items.length > 50 ||
          bytes(JSON.stringify(value)) > 1024 * 1024
        )
          throw Error("PAGE_LIMIT");
        next.push({ query: page.query, value });
      }
      if (
        next.reduce(
          (n, p) => n + p.value.items.reduce((m, r) => m + rowBytes(r), 0),
          0,
        ) +
          this.extraBytes() >
        LIMITS.raw
      )
        throw Error("CONTENT_LIMIT");
      const ids = new Set(next.flatMap((p) => p.value.items.map((r) => r.id)));
      if (
        [...(typeof pins === "function" ? pins() : pins)].some(
          (id) => !ids.has(id),
        )
      )
        throw Error("READING_PINNED");
      this.pages = next;
      this.stale = false;
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
}
export const states: Record<string, string> = {
  PENDING: "已排队",
  SENDING: "发送中",
  TRACKING: "已受理 · 处理中",
  ACCEPTED: "已受理",
  COMPLETED: "命令已完成",
  FAILED: "失败",
  UNCERTAIN: "结果未确认 · 正在核对",
  UNKNOWN: "结果未知",
  RECEIPT_MISSING: "回执缺失 · 结果未确认",
  VERIFY_ACCEPTED: "正在重新核对回执",
  UNSUPPORTED_RECEIPT: "无法识别回执 · 不自动重试",
  UNSUPPORTED_VERSION: "结果未确认 · 协议版本不支持",
  CONTRACT_INVALID: "结果未确认 · 回执不符合契约",
};
export const outboxLabel = (state: string) =>
  states[state] ??
  (state.startsWith("STOP_")
    ? "生命周期操作 · " + state
    : "未识别状态 · " + state);
