// Pure bounded cache. All messages and child activities consume the same budget.
export const MAX_ITEMS = 2000;
export const MAX_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
export const bytes = (value) => encoder.encode(JSON.stringify(value)).length;
export const compare = (a, b) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export class TimelineWindow {
  items = [];
  bytes = 0;
  generation = 0;
  before = null;
  after = null;
  reset() {
    this.items = [];
    this.bytes = 0;
    this.before = this.after = null;
    this.generation++;
  }
  apply(page, direction = "after", protectedIDs = new Set(), replace = false) {
    if (bytes(page) > 1024 * 1024) throw Error("时间线响应超过预算");
    const merged = new Map((replace ? [] : this.items).map((m) => [m.id, m]));
    for (const item of page.items) {
      const old = merged.get(item.id);
      if (!old || item.revision >= old.revision) merged.set(item.id, item);
    }
    const next = [...merged.values()].sort(compare);
    let total = next.reduce((n, item) => n + bytes(item), 0),
      droppedBefore = false,
      droppedAfter = false;
    while (next.length > MAX_ITEMS || total > MAX_BYTES) {
      const index = direction === "before" ? next.length - 1 : 0;
      if (protectedIDs.has(next[index].id)) return false;
      total -= bytes(next[index]);
      next.splice(index, 1);
      if (direction === "before") droppedAfter = true;
      else droppedBefore = true;
    }
    this.items = next;
    this.bytes = total;
    if (replace || direction === "before") this.before = page.before ?? null;
    if (replace || direction === "after") this.after = page.after ?? null;
    if (droppedBefore) this.before = next[0]?.cursor ?? null;
    if (droppedAfter) this.after = next.at(-1)?.cursor ?? null;
    return true;
  }
}
