import type { CoreClient } from "../core-client.ts";
import type { Timeline, TimelineItem } from "../api/contracts.ts";

export const HISTORY_PAGE = 50;
export const HISTORY_ITEMS = 200;
export const HISTORY_BYTES = 4 * 1024 * 1024;
export type Direction = "before" | "after";
export const visibleItem = (item: TimelineItem) =>
  item.kind === "message" || item.activity.kind === "tool";
const durable = (item: TimelineItem) =>
  item.kind === "message"
    ? item.persistence === "durable"
    : item.activity.source === "durable";
const resetCode = (e: unknown) =>
  /^(CURSOR_EXPIRED|TIMELINE_RESET_REQUIRED)$/.test(
    e instanceof Error ? e.message : String(e),
  );

/** One contiguous, bounded window. Cursors are never decoded or manufactured. */
export class HistoryWindow {
  readonly items = new Map<string, TimelineItem>();
  readonly notices = new Map<string, string>();
  readonly evictedBodies = new Set<string>();
  before: string | null = null;
  after: string | null = null;
  ready = false;
  thinking = false;
  generation?: string;
  error = "";
  errorSide: Direction = "before";
  anchor?: string;
  preferredBodies = new Set<string>();
  unavailable = false;
  hasBefore = false;
  hasAfter = false;
  private closed = false;
  private epoch = 0;
  private job?: Promise<void>;
  private directions = new Set<Direction>();
  private resume = false;
  private neighbours: string[] = [];
  private eventLocators = new Map<string, string>();
  private previewIds = new Set<string>();
  private refreshPending = false;
  private latestIntent = 0;
  private latestRequested?: number;
  onChange = () => {};
  constructor(readonly client: Pick<CoreClient, "query" | "endpoint">) {}

  inherit(previous: HistoryWindow) {
    this.thinking = previous.thinking;
    this.anchor = previous.anchor;
    this.generation = previous.generation;
    for (const [id, item] of previous.items) this.items.set(id, item);
    for (const [id, notice] of previous.notices) this.notices.set(id, notice);
    this.rememberNeighbours();
    this.resume = true;
  }
  setAnchor(id?: string) {
    if (id && this.items.has(id)) {
      this.anchor = id;
      this.rememberNeighbours();
    }
  }
  private rememberNeighbours() {
    const rows = [...this.items.values()];
    const index = rows.findIndex((row) => row.id === this.anchor);
    if (index < 0) return;
    const before = rows.slice(0, index).filter(durable).slice(-2).reverse(),
      after = rows
        .slice(index + 1)
        .filter(durable)
        .slice(0, 2);
    this.neighbours = [before[0], after[0], before[1], after[1]]
      .filter((row): row is TimelineItem => !!row)
      .map((row) => row.id);
    this.eventLocators.clear();
    for (const id of [this.anchor, ...this.neighbours]) {
      const row = id ? this.items.get(id) : undefined;
      if (row && typeof row.source_event_id === "string")
        this.eventLocators.set(row.id, row.source_event_id);
    }
  }
  clearError() {
    this.error = "";
  }
  get mode() {
    return `streaming=true&thinking=${this.thinking}`;
  }
  private query(url: string) {
    return this.client.query<Timeline>(url + "&" + this.mode);
  }
  private around(id: string) {
    // With a large body, a wider around page can exhaust its byte budget before the target.
    return this.query(
      `timeline/around?message_id=${encodeURIComponent(id)}&limit=1`,
    );
  }
  refresh(previews: Iterable<string> = []) {
    for (const id of previews) {
      if (this.previewIds.size < HISTORY_ITEMS) this.previewIds.add(id);
    }
    this.refreshPending = true;
    return this.drain();
  }
  page(direction: Direction) {
    this.cancelLatest();
    this.clearError();
    this.directions.add(direction); // one coalesced successor per direction
    return this.drain();
  }
  jumpToLatest() {
    this.latestRequested = ++this.latestIntent;
    this.directions.clear();
    return this.drain();
  }
  cancelLatest() {
    this.latestIntent++;
    this.latestRequested = undefined;
  }
  private drain(): Promise<void> {
    if (this.job) return this.job;
    const epoch = this.epoch;
    this.job = (async () => {
      while (
        !this.closed &&
        epoch === this.epoch &&
        (this.refreshPending ||
          this.directions.size ||
          this.latestRequested !== undefined)
      ) {
        const direction = this.directions.values().next().value;
        const latest = this.latestRequested;
        try {
          if (latest !== undefined) {
            this.latestRequested = undefined;
            await this.latest(() => latest === this.latestIntent);
          } else if (!this.ready) {
            this.refreshPending = false;
            if (this.resume) await this.relocate();
            else await this.latest();
          } else if (direction) {
            this.directions.delete(direction);
            this.errorSide = direction;
            if (this.unavailable) await this.latest();
            else await this.load(direction);
          } else {
            this.refreshPending = false;
            if (!this.unavailable) await this.update();
          }
        } catch (e) {
          if (this.closed || epoch !== this.epoch) break;
          if (latest !== undefined && latest !== this.latestIntent) continue;
          if (
            resetCode(e) ||
            (e instanceof Error && e.message === "TIMELINE_ITEM_NOT_FOUND")
          ) {
            try {
              await this.relocate();
            } catch (failure) {
              this.error = "历史重新定位失败，保留当前窗口：" + String(failure);
            }
          } else this.error = "历史读取失败，保留当前窗口：" + String(e);
          // A failing response cannot spin on the same outstanding navigation.
          this.refreshPending = false;
          this.directions.clear();
        }
        if (!this.closed && epoch === this.epoch) this.onChange();
      }
    })().finally(() => {
      this.job = undefined;
    });
    return this.job;
  }
  private current(epoch: number) {
    return !this.closed && epoch === this.epoch;
  }
  private acceptGeneration(page: Timeline) {
    if (this.generation && page.generation !== this.generation)
      throw Error("TIMELINE_RESET_REQUIRED");
  }
  private replace(page: Timeline) {
    this.items.clear();
    this.notices.clear();
    this.evictedBodies.clear();
    this.generation = page.generation;
    this.before = page.before;
    this.after = page.after;
    for (const item of page.items)
      if (visibleItem(item)) this.items.set(item.id, item);
    this.hasBefore = !!page.before;
    this.hasAfter = !!page.after;
    this.ready = true;
    this.unavailable = false;
    this.trim("after");
  }
  private async latest(wanted = () => true) {
    const epoch = this.epoch;
    if (!wanted()) return;
    let page = await this.query(`timeline?limit=${HISTORY_PAGE}`);
    let scanned = 0;
    while (
      !page.items.some(visibleItem) &&
      page.before &&
      this.current(epoch) &&
      wanted()
    ) {
      const cursor = page.before;
      page = await this.query(
        `timeline?direction=before&limit=${HISTORY_PAGE}&cursor=${encodeURIComponent(cursor)}`,
      );
      if (page.before === cursor)
        throw Error("TIMELINE_CURSOR_DID_NOT_ADVANCE");
      if (++scanned % 4 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!this.current(epoch) || !wanted()) return;
    this.replace(page);
    this.anchor = [...this.items.keys()].at(-1);
  }
  private async relocate() {
    const epoch = this.epoch;
    const target =
      this.anchor ?? [...this.items.values()].filter(durable).at(-1)?.id;
    const candidates = [
      ...new Set(
        [target, ...this.neighbours].filter((id): id is string => !!id),
      ),
    ];
    for (const id of candidates) {
      try {
        let page: Timeline;
        let located = id;
        try {
          page = await this.around(id);
        } catch (e) {
          const event = this.eventLocators.get(id);
          if (
            !event ||
            !(e instanceof Error && e.message === "TIMELINE_ITEM_NOT_FOUND")
          )
            throw e;
          page = await this.query(
            `timeline/around?event_id=${encodeURIComponent(event)}&limit=1`,
          );
          const row = page.items.find((row) => row.source_event_id === event);
          if (!row) throw Error("TIMELINE_ITEM_NOT_FOUND");
          located = row.id;
        }
        if (!this.current(epoch)) return;
        if (!page.items.some((item) => item.id === located))
          throw Error("TIMELINE_ITEM_NOT_FOUND");
        // A lone short anchor cannot fill a viewport: publishing it would clamp
        // scrollTop to zero and replace the reader's anchor with the page title.
        // Stage fresh adjacent pages before replacing the visible old window.
        const staged = new HistoryWindow(this.client);
        staged.thinking = this.thinking;
        staged.replace(page);
        staged.anchor = located;
        if (staged.hasBefore) await staged.load("before");
        if (staged.hasAfter) await staged.load("after");
        if (!this.current(epoch)) return;
        this.items.clear();
        this.notices.clear();
        this.evictedBodies.clear();
        for (const [key, value] of staged.items) this.items.set(key, value);
        for (const key of staged.evictedBodies) this.evictedBodies.add(key);
        this.generation = staged.generation;
        this.before = staged.before;
        this.after = staged.after;
        this.hasBefore = staged.hasBefore;
        this.hasAfter = staged.hasAfter;
        this.ready = true;
        this.unavailable = false;
        this.anchor = located;
        if (target !== located)
          this.notices.set(
            located,
            "原阅读内容已不可用；这里是仍存在的邻近内容，历史存在缺口",
          );
        this.resume = false;
        // Keep the target at the same logical position; viewport layout restores it.
        return;
      } catch (e) {
        if (!(e instanceof Error && e.message === "TIMELINE_ITEM_NOT_FOUND"))
          throw e;
      }
    }
    if (!target) return this.latest();
    // Do not silently jump to the tail when the entire bounded fallback set is gone.
    const old = this.items.get(target);
    this.items.clear();
    this.notices.clear();
    this.evictedBodies.clear();
    if (old) {
      this.items.set(target, old);
      this.notices.set(
        target,
        "原阅读位置及邻近内容已不可用；再次按 ↑/↓ 进入当前近期窗口（存在历史缺口）",
      );
    }
    this.before = this.after = null;
    this.ready = this.unavailable = true;
    this.resume = false;
  }
  private merge(page: Timeline, direction: Direction) {
    const existing = [...this.items.values()];
    const eligible = page.items.filter(visibleItem);
    const incoming = new Map(eligible.map((item) => [item.id, item]));
    const rows =
      direction === "before"
        ? [...eligible, ...existing]
        : [...existing, ...eligible];
    const ordered = new Map<string, TimelineItem>();
    for (const row of rows) {
      const old = this.items.get(row.id),
        fresh = incoming.get(row.id) ?? row;
      ordered.set(
        row.id,
        old &&
          old.revision === fresh.revision &&
          !this.evictedBodies.has(row.id)
          ? old
          : fresh,
      );
    }
    this.items.clear();
    for (const [id, item] of ordered) this.items.set(id, item);
    this[direction] = page[direction];
    if (direction === "before") this.hasBefore = !!page.before;
    else this.hasAfter = !!page.after;
    this.trim(direction);
  }
  private trim(direction: Direction) {
    const ids = [...this.items.keys()];
    const pin = Math.max(0, ids.indexOf(this.anchor ?? ""));
    const desiredStart =
      direction === "after" ? Math.max(0, ids.length - HISTORY_ITEMS) : 0;
    const start = Math.max(
      Math.min(desiredStart, pin),
      pin - HISTORY_ITEMS + 1,
    );
    for (let i = 0; i < ids.length; i++)
      if (i < start || i >= start + HISTORY_ITEMS) {
        if (i < start) this.hasBefore = true;
        else this.hasAfter = true;
        this.items.delete(ids[i]);
        this.notices.delete(ids[i]);
        this.evictedBodies.delete(ids[i]);
      }
    this.enforceBodyBudget();
  }
  enforceBodyBudget() {
    let bytes = 0;
    for (const row of this.items.values())
      if (row.kind === "message")
        bytes +=
          Buffer.byteLength(row.text) + Buffer.byteLength(row.thinking ?? "");
    // Evict bodies independently, preserving order and metadata. Rehydrate on deliberate navigation.
    const ids = [...this.items.keys()],
      anchorIndex = ids.indexOf(this.anchor ?? "");
    const victims = ids
      .filter((id) => id !== this.anchor)
      .sort(
        (a, b) =>
          Number(this.preferredBodies.has(a)) -
            Number(this.preferredBodies.has(b)) ||
          Math.abs(ids.indexOf(b) - anchorIndex) -
            Math.abs(ids.indexOf(a) - anchorIndex),
      );
    for (const id of victims) {
      if (bytes <= HISTORY_BYTES) break;
      const row = this.items.get(id)!;
      if (row.kind !== "message") continue;
      bytes -=
        Buffer.byteLength(row.text) + Buffer.byteLength(row.thinking ?? "");
      this.items.set(id, { ...row, text: "", thinking: undefined });
      this.evictedBodies.add(id);
    }
  }
  private async load(direction: Direction) {
    const epoch = this.epoch;
    const edge =
      direction === "before"
        ? this.items.values().next().value
        : [...this.items.values()].at(-1);
    if (!edge) return this.latest();
    const around = await this.around(edge.id);
    if (!this.current(epoch)) return;
    this.acceptGeneration(around);
    if (!around.items.some((item) => item.id === edge.id))
      throw Error("TIMELINE_ITEM_NOT_FOUND");
    const refreshed = around.items.find((item) => item.id === edge.id)!;
    if (refreshed.revision !== edge.revision)
      this.items.set(edge.id, refreshed);
    let cursor = around[direction];
    this[direction] = cursor;
    if (direction === "before") this.hasBefore = !!cursor;
    else this.hasAfter = !!cursor;
    let scanned = 0;
    while (cursor && this.current(epoch)) {
      const page = await this.query(
        `timeline?direction=${direction}&limit=${HISTORY_PAGE}&cursor=${encodeURIComponent(cursor)}`,
      );
      if (!this.current(epoch)) return;
      this.acceptGeneration(page);
      const next = page[direction];
      if (next === cursor) throw Error("TIMELINE_CURSOR_DID_NOT_ADVANCE");
      this.merge(page, direction);
      scanned += Math.max(1, page.items.length);
      cursor = next;
      if (page.items.some(visibleItem)) return;
      if (scanned >= 4 * HISTORY_PAGE) {
        // Preserve the advancing cursor through filtered-only pages, yielding between batches.
        scanned = 0;
        this.onChange();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  private async update() {
    const epoch = this.epoch;
    const ids = new Set([
      ...this.previewIds,
      ...[...this.items.values()]
        .filter(
          (item) => item.kind === "message" && item.persistence === "transient",
        )
        .map((item) => item.id),
    ]);
    this.previewIds.clear();
    for (const id of ids) {
      // Unknown previews are discovered through ordered tail pagination; around never appends them.
      if (!this.items.has(id)) continue;
      try {
        const page = await this.around(id);
        if (!this.current(epoch)) return;
        this.acceptGeneration(page);
        const item = page.items.find((row) => row.id === id);
        if (item && item.revision !== this.items.get(id)?.revision)
          this.items.set(id, item);
      } catch (e) {
        if (!(e instanceof Error && e.message === "TIMELINE_ITEM_NOT_FOUND"))
          throw e;
      }
    }
    // While reading an older range, do not replace it with the latest 50 rows.
    if (this.hasAfter) return;
    let scanned = 0;
    do {
      const previous = [...this.items.keys()].at(-1);
      await this.load("after");
      scanned += HISTORY_PAGE;
      if ([...this.items.keys()].at(-1) === previous) break;
      if (this.items.size >= HISTORY_ITEMS) break;
      if (scanned >= 4 * HISTORY_PAGE) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        scanned = 0;
      }
    } while (this.after && this.current(epoch));
  }
  async setThinking(value: boolean) {
    if (value === this.thinking) return;
    await this.job;
    this.thinking = value;
    // Cursor signatures include thinking mode. Recreate the window around its reading anchor.
    this.epoch++;
    this.resume = true;
    this.ready = false;
    await this.refresh();
  }
  stop() {
    this.cancelLatest();
    this.closed = true;
    this.epoch++;
  }
}
