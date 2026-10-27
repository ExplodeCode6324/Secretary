import {
  CURSOR_MARKER,
  visibleWidth,
  wrapTextWithAnsi,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { displayText } from "./editor.ts";
import type { TuiApp } from "./app.ts";
export type Snapshot = ReturnType<TuiApp["snapshot"]>;
export type ColorMode = "auto" | "truecolor" | "256" | "none";
export const safeText = (value: string) =>
  displayText(value).replaceAll("\t", "    ");
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
/** Canonical UTF-16 offsets map to terminal cells, never HTML/input-sink positions. */
export function renderDraft(snapshot: Snapshot, width: number) {
  width = Math.max(1, width);
  const lines = [""];
  const positions = new Map<number, { row: number; column: number }>();
  let column = 0;
  const head = snapshot.selection.head,
    lo = Math.min(head, snapshot.selection.anchor),
    hi = Math.max(head, snapshot.selection.anchor);
  let marked = false;
  const point = (offset: number) => {
    positions.set(offset, { row: lines.length - 1, column });
    if (offset === head && !marked) {
      lines[lines.length - 1] += CURSOR_MARKER;
      marked = true;
    }
  };
  const atom = (text: string, start: number, end: number) => {
    if (text === "\n") {
      point(start);
      lines.push("");
      column = 0;
      point(end);
      return;
    }
    const cells = visibleWidth(text);
    if (column && column + cells > width) {
      lines.push("");
      column = 0;
    }
    point(start);
    const selected = start < hi && end > lo;
    const shown = cells > width ? "□" : text;
    lines[lines.length - 1] += selected ? `\x1b[7m${shown}\x1b[27m` : shown;
    column += Math.min(cells, width);
    if (column >= width) {
      lines.push("");
      column = 0;
    }
    point(end);
  };
  for (const run of snapshot.runs) {
    if (run.text === undefined) {
      // Labels are projections only; selection/copy retains the full original range.
      const label = safeText(run.label ?? "[retained text]");
      const pieces = [...segmenter.segment(label)];
      pieces.forEach((p, index) =>
        atom(
          p.segment,
          index === 0 ? run.start : -1,
          index === pieces.length - 1 ? run.end : -1,
        ),
      );
    } else {
      for (const part of segmenter.segment(run.text)) {
        const start = run.start + part.index,
          end = start + part.segment.length;
        const safe = safeText(part.segment);
        atom(safe, start, end);
      }
    }
  }
  if (!marked) {
    point(head);
  }
  return { lines, positions, cursor: positions.get(head)! };
}
export class Palette {
  readonly mode: Exclude<ColorMode, "auto">;
  constructor(mode: ColorMode = "auto", env = process.env) {
    this.mode =
      mode === "auto"
        ? env.NO_COLOR !== undefined
          ? "none"
          : env.TERM_PROGRAM === "Apple_Terminal"
            ? "256"
            : /truecolor|24bit/.test(env.COLORTERM ?? "")
              ? "truecolor"
              : "256"
        : mode;
  }
  color(text: string, tone: "normal" | "blue" | "light" | "error" = "normal") {
    if (this.mode === "none") return text;
    const rgb = {
      normal: [216, 227, 238],
      blue: [121, 172, 217],
      light: [177, 213, 236],
      error: [237, 135, 145],
    }[tone];
    const index = { normal: 254, blue: 110, light: 153, error: 210 }[tone];
    return this.mode === "truecolor"
      ? `\x1b[38;2;${rgb.join(";")}m${text}\x1b[39m`
      : `\x1b[38;5;${index}m${text}\x1b[39m`;
  }
  line(
    text: string,
    width: number,
    tone: "normal" | "blue" | "light" | "error" = "normal",
  ) {
    const clipped = truncateToWidth(text, Math.max(1, width));
    if (this.mode === "none") return clipped;
    const background =
      this.mode === "truecolor" ? "\x1b[48;2;18;28;41m" : "\x1b[48;5;234m";
    return (
      background +
      this.color(clipped, tone) +
      " ".repeat(Math.max(0, width - visibleWidth(clipped))) +
      "\x1b[0m"
    );
  }
}
export type TranscriptLine = {
  id?: string;
  local?: boolean;
  offset: number;
  text: string;
};
export function transcript(
  snapshot: Snapshot,
  width: number,
): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const offsets = new Map<string, number>();
  const add = (text: string, id?: string, local = false) => {
    const safe = safeText(text);
    const wrapped = safe
      .split("\n")
      .flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width)));
    const base = id ? (offsets.get(id) ?? 0) : 0;
    wrapped.forEach((text, offset) =>
      lines.push({ id, local, offset: base + offset, text }),
    );
    if (id) offsets.set(id, base + wrapped.length);
  };
  for (const row of snapshot.rows) {
    const title =
      row.kind === "message"
        ? `${row.role} | ${row.id} | ${row.outcome ?? ""} ${row.input_state ?? ""}`
        : `${row.kind} | ${row.id}`;
    add(
      title +
        "\n" +
        row.text +
        (row.clipped ? "\n[bounded preview; /more]" : ""),
      row.id,
    );
    if ("preview" in row && row.preview)
      add("CoT preview: " + row.preview, row.id);
  }
  for (const row of snapshot.previews)
    add(
      `${row.status} | ${row.id}\n${row.text}\nCoT preview: ${row.preview}`,
      row.id,
    );
  for (const pending of snapshot.pending)
    add(
      `PENDING ${pending.sequence} ${pending.id} ${pending.state}`,
      `local:pending:${pending.id}`,
      true,
    );
  if (snapshot.expansion)
    add(
      `Expanded ${snapshot.expansion.id}\n${snapshot.expansion.text}\n${snapshot.expansion.thinking}${snapshot.expansion.more ? "\n[more available]" : ""}`,
      `local:expansion:${snapshot.expansion.id}`,
      true,
    );
  if (snapshot.panel) add(snapshot.panel, "local:panel", true);
  if (!lines.length)
    add("No messages loaded. Core is independent; drafts remain local.");
  return lines;
}
