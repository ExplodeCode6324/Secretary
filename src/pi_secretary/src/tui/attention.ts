import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { MasterAttention, MasterAttentionItem } from "../api/contracts.ts";
import type { CoreClient } from "../core-client.ts";
import { safeText } from "./view.ts";

export const failureLabels = {
  authorization_rejected: "拒绝授权导致失败",
  authorization_revoked: "撤销授权导致失败",
  execution_failed: "执行失败",
  initialization_failed: "初始化失败",
  unclassified: "失败（原因未分类）",
} as const;
export function attentionLabel(row: MasterAttentionItem) {
  if (row.cause_evidence === "inconsistent")
    return "执行失败（原因证据不一致）";
  return row.failure_category
    ? failureLabels[row.failure_category]
    : {
        authorization: "待批准",
        decision: "待回答",
        failure: "失败",
        unknown: "UNKNOWN 异常",
      }[row.type];
}
export class AttentionWindow implements Component {
  head?: MasterAttention;
  page?: MasterAttention;
  selected?: string;
  seen = new Set<string>();
  error = "";
  loading = false;
  height = () => 6;
  onChange = () => {};
  onRefresh = () => {};
  private cursor?: string;
  private previous: (string | undefined)[] = [];
  private generation = 0;
  private stopped = false;
  private expiry?: ReturnType<typeof setTimeout>;
  private scheduled?: ReturnType<typeof setTimeout>;
  private refreshJob?: Promise<void>;
  private refreshAgain = false;
  constructor(readonly client: Pick<CoreClient, "query">) {}
  get row() {
    return this.page?.items.find((r) => r.key === this.selected);
  }
  private route(cursor?: string) {
    return (
      "attention?view=master&limit=30" +
      (cursor ? "&cursor=" + encodeURIComponent(cursor) : "")
    );
  }
  schedule() {
    if (this.scheduled || this.stopped) return;
    this.scheduled = setTimeout(() => {
      this.scheduled = undefined;
      void this.refresh();
    }, 1000);
  }
  async refresh(): Promise<void> {
    if (this.refreshJob) {
      this.refreshAgain = true;
      return this.refreshJob;
    }
    const gen = this.generation;
    this.refreshJob = (async () => {
      try {
        const head = await this.client.query<MasterAttention>(this.route());
        const page = this.cursor
          ? await this.client.query<MasterAttention>(this.route(this.cursor))
          : head;
        if (this.stopped || gen !== this.generation) return;
        let changed =
          this.head?.version !== head.version ||
          this.page?.next_cursor !== page.next_cursor ||
          !!this.error;
        this.head = head;
        this.page = page;
        this.error = "";
        if (this.selected && !page.items.some((r) => r.key === this.selected)) {
          // A missing selection is not silently transferred to another item.
          this.selected = undefined;
          this.error = "所选事项已变化；请重新选择";
          changed = true;
        }
        clearTimeout(this.expiry);
        if (head.valid_until)
          this.expiry = setTimeout(
            () => void this.refresh(),
            Math.min(
              2147483647,
              Math.max(1, Date.parse(head.valid_until) - Date.now() + 1),
            ),
          );
        this.onRefresh();
        if (changed) this.onChange();
      } catch (e) {
        if (this.stopped || gen !== this.generation) return;
        if (String(e).includes("CURSOR_EXPIRED")) {
          this.cursor = undefined;
          this.previous = [];
          this.page = this.head;
          this.selected = undefined;
        }
        this.error = "事项读取失败：" + String(e);
        this.onChange();
      }
    })().finally(() => {
      this.refreshJob = undefined;
      if (this.refreshAgain || gen !== this.generation) {
        this.refreshAgain = false;
        this.schedule();
      }
    });
    return this.refreshJob;
  }
  enter() {
    if (!this.head?.items.length) return false;
    this.generation++;
    this.cursor = undefined;
    this.previous = [];
    this.page = this.head;
    this.selected =
      this.page.items[
        Math.min(this.page.items.length, Math.max(1, this.height() - 1)) - 1
      ].key;
    this.onChange();
    return true;
  }
  exit() {
    this.generation++;
    this.selected = undefined;
    this.cursor = undefined;
    this.previous = [];
    this.page = this.head;
    this.onChange();
  }
  async move(delta: -1 | 1): Promise<"history" | "editor" | undefined> {
    if (this.loading || !this.page || !this.selected) return;
    const i = this.page.items.findIndex((r) => r.key === this.selected),
      next = i + delta;
    if (next >= 0 && next < this.page.items.length) {
      this.selected = this.page.items[next].key;
      this.onChange();
      return;
    }
    if (delta < 0 && !this.previous.length) {
      this.exit();
      return "history";
    }
    if (delta > 0 && !this.page.next_cursor) {
      this.exit();
      return "editor";
    }
    this.loading = true;
    const gen = this.generation;
    const cursor = delta > 0 ? this.page.next_cursor! : this.previous.at(-1);
    try {
      const page = await this.client.query<MasterAttention>(this.route(cursor));
      if (gen !== this.generation || this.stopped) return;
      if (delta > 0) this.previous.push(this.cursor);
      else this.previous.pop();
      this.cursor = cursor;
      this.page = page;
      this.selected = page.items[delta > 0 ? 0 : page.items.length - 1]?.key;
      this.error = "";
    } catch (e) {
      this.error = "事项翻页失败：" + String(e);
    } finally {
      this.loading = false;
      this.onChange();
    }
  }
  inherit(other: AttentionWindow) {
    this.seen = other.seen;
    this.head = other.head;
    this.page = other.head;
  }
  invalidate() {}
  render(width: number): string[] {
    const data = this.head;
    if (!data?.counts.total && !this.error) return [];
    const capacity = Math.max(1, this.height() - 1),
      page = this.selected ? this.page : data;
    const rows = page?.items ?? [],
      index = rows.findIndex((r) => r.key === this.selected);
    const start = this.selected ? Math.max(0, index - capacity + 1) : 0;
    const c = data?.counts;
    const title = c
      ? `事项 ${c.total} · 本页 ${rows.length ? start + 1 : 0}–${Math.min(rows.length, start + capacity)} · 授${c.authorizations} 问${c.decisions} 拒${c.authorization_rejected} 执${c.execution_failed} 初${c.initialization_failed} 未${c.unclassified} 撤${c.authorization_revoked} 未知${c.unknown}`
      : this.error;
    const result = [truncateToWidth(safeText(title), width)];
    for (const row of rows.slice(start, start + capacity)) {
      const selected = row.key === this.selected,
        color = selected ? "96" : this.seen.has(row.key) ? "90" : "37";
      const text = `${selected ? "›" : " "} ${attentionLabel(row)} ${row.id} · ${row.preview} · Task ${row.task_id ?? "Main"} / Execution ${row.execution_id ?? "—"}`;
      result.push(
        `\x1b[${color}m${truncateToWidth(safeText(text), width)}\x1b[0m`,
      );
    }
    return result;
  }
  stop() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.expiry);
    clearTimeout(this.scheduled);
  }
}
