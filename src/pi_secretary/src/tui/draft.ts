import { randomUUID } from "node:crypto";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

export type OwnedRange = {
  start: number;
  end: number;
  source: "paste" | "unknown";
  block?: string;
};
export type PasteBlock = { label: string; payload: string };
export type DraftSnapshot = {
  version: 2;
  text: string;
  cursor: { line: number; col: number };
  ranges: OwnedRange[];
  blocks: Record<string, PasteBlock>;
  damaged?: boolean;
};
export const normalizePaste = (text: string) =>
  stripTerminalSequences(text.replace(/\r\n?/g, "\n")).replace(
    /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
    "",
  );
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function inlinePaste(text: string) {
  if (/[\n\t]/.test(text)) return false;
  let count = 0;
  for (const _ of graphemes.segment(text)) if (++count > 30) return false;
  return true;
}
export function plainSnapshot(
  text: string,
  source: "typed" | "unknown" = "unknown",
): DraftSnapshot {
  const lines = text.split("\n");
  return {
    version: 2,
    text,
    cursor: { line: lines.length - 1, col: lines.at(-1)!.length },
    ranges:
      source === "unknown" && text
        ? [{ start: 0, end: text.length, source }]
        : [],
    blocks: {},
  };
}
export function validateSnapshot(
  value: unknown,
): asserts value is DraftSnapshot {
  const s = value as DraftSnapshot;
  if (
    !s ||
    s.version !== 2 ||
    typeof s.text !== "string" ||
    !Array.isArray(s.ranges) ||
    !s.blocks ||
    typeof s.blocks !== "object" ||
    Array.isArray(s.blocks) ||
    !s.cursor
  )
    throw Error("INVALID_DRAFT_SNAPSHOT");
  const lines = s.text.split("\n");
  if (
    !Number.isInteger(s.cursor.line) ||
    !Number.isInteger(s.cursor.col) ||
    s.cursor.line < 0 ||
    s.cursor.line >= lines.length ||
    s.cursor.col < 0 ||
    s.cursor.col > lines[s.cursor.line].length
  )
    throw Error("INVALID_DRAFT_CURSOR");
  let end = 0;
  for (const range of s.ranges) {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < end ||
      range.end <= range.start ||
      range.end > s.text.length ||
      !["paste", "unknown"].includes(range.source)
    )
      throw Error("INVALID_DRAFT_RANGES");
    if (range.block) {
      const block = Object.hasOwn(s.blocks, range.block)
        ? s.blocks[range.block]
        : undefined;
      if (
        !block ||
        typeof block.payload !== "string" ||
        typeof block.label !== "string" ||
        s.text.slice(range.start, range.end) !== block.label
      )
        throw Error("INVALID_PASTE_BLOCK");
    }
    end = range.end;
  }
}
export function expandSnapshot(s: DraftSnapshot, start = 0): string {
  validateSnapshot(s);
  if (s.damaged) throw Error("PASTE_BLOCK_DAMAGED");
  let result = "",
    offset = start;
  for (const range of s.ranges)
    if (range.block && range.end > start) {
      if (range.start < start) throw Error("COMMAND_INSIDE_PASTE_BLOCK");
      result +=
        s.text.slice(offset, range.start) + s.blocks[range.block].payload;
      offset = range.end;
    }
  return result + s.text.slice(offset);
}
export function originAt(s: Pick<DraftSnapshot, "ranges">, offset: number) {
  return (
    s.ranges.find((range) => range.start <= offset && offset < range.end)
      ?.source ?? "typed"
  );
}
export function equalSnapshotContent(
  a: DraftSnapshot | undefined,
  b: DraftSnapshot | undefined,
) {
  if (!a || !b) return a === b;
  return (
    a.text === b.text &&
    a.damaged === b.damaged &&
    JSON.stringify(a.ranges) === JSON.stringify(b.ranges) &&
    Object.keys(a.blocks).length === Object.keys(b.blocks).length &&
    Object.entries(a.blocks).every(
      ([id, block]) =>
        b.blocks[id]?.payload === block.payload &&
        b.blocks[id]?.label === block.label,
    )
  );
}

/** Payloads are immutable; undo/ring snapshots own spans and share the registry. */
export class PasteDocument {
  ranges: OwnedRange[] = [];
  blocks: Record<string, PasteBlock> = Object.create(null) as Record<
    string,
    PasteBlock
  >;
  damaged = false;
  snapshot(text: string, cursor: DraftSnapshot["cursor"]): DraftSnapshot {
    // Keep orphaned payloads recoverable if an unclaimed edit damaged a label.
    const blocks: Record<string, PasteBlock> = this.damaged
      ? { ...this.blocks }
      : {};
    for (const range of this.ranges)
      if (range.block && this.blocks[range.block])
        blocks[range.block] = this.blocks[range.block];
    return {
      version: 2,
      text,
      cursor: { ...cursor },
      ranges: this.ranges.map((range) => ({ ...range })),
      blocks,
      ...(this.damaged ? { damaged: true } : {}),
    };
  }
  restore(s: DraftSnapshot) {
    validateSnapshot(s);
    this.ranges = s.ranges.map((r) => ({ ...r }));
    Object.assign(this.blocks, s.blocks);
    this.damaged = !!s.damaged;
  }
  paste(payload: string): { text: string; ranges: OwnedRange[] } {
    const text = normalizePaste(payload);
    if (!text) return { text: "", ranges: [] };
    if (inlinePaste(text))
      return {
        text,
        ranges: [{ start: 0, end: text.length, source: "paste" }],
      };
    const id = randomUUID(),
      count = text.split("\n").length;
    const label = `<pasted ${count} ${count === 1 ? "line" : "lines"} ${id.slice(0, 8)}.txt>`;
    this.blocks[id] = { label, payload: text };
    return {
      text: label,
      ranges: [{ start: 0, end: label.length, source: "paste", block: id }],
    };
  }
  slice(start: number, end: number): OwnedRange[] {
    return this.ranges
      .filter((r) => r.start < end && r.end > start)
      .map((r) => ({
        ...r,
        start: Math.max(r.start, start) - start,
        end: Math.min(r.end, end) - start,
      }));
  }
  splice(
    start: number,
    end: number,
    length: number,
    inserted: OwnedRange[] = [],
  ) {
    const delta = length - (end - start),
      ranges: OwnedRange[] = [];
    for (const range of this.ranges) {
      if (range.end <= start) ranges.push(range);
      else if (range.start >= end)
        ranges.push({
          ...range,
          start: range.start + delta,
          end: range.end + delta,
        });
      else {
        if (range.block && (range.start < start || range.end > end))
          this.damaged = true;
        if (range.start < start)
          ranges.push({
            ...range,
            end: start,
            ...(range.block ? { source: "unknown", block: undefined } : {}),
          });
        if (range.end > end)
          ranges.push({
            ...range,
            start: start + length,
            end: range.end + delta,
            ...(range.block ? { source: "unknown", block: undefined } : {}),
          });
      }
    }
    ranges.push(
      ...inserted.map((r) => ({
        ...r,
        start: start + r.start,
        end: start + r.end,
      })),
    );
    this.ranges = ranges
      .filter((r) => r.end > r.start)
      .sort((a, b) => a.start - b.start);
  }
  blockAt(offset: number, edge: "inside" | "before" | "after" = "inside") {
    return this.ranges.find(
      (r) =>
        r.block &&
        (edge === "before"
          ? r.end === offset
          : edge === "after"
            ? r.start === offset
            : r.start < offset && offset < r.end),
    );
  }
  collect() {
    if (this.damaged) return;
    const live = new Set(this.ranges.map((r) => r.block));
    for (const id of Object.keys(this.blocks))
      if (!live.has(id)) delete this.blocks[id];
  }
}
