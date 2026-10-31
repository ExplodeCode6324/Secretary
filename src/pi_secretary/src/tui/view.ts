import {
  Markdown,
  ScrollView,
  stripTerminalSequences,
  Text,
  type Component,
  type MarkdownTheme,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import type { Message, TaskSummary, TimelineItem } from "../api/contracts.ts";
import { markdownParser } from "./markdown-lexer.ts";
import {
  Definitions,
  normalizedSource,
  type SourceBlock,
} from "./markdown-window.ts";
import { renderBlocks } from "./markdown-block-render.ts";
import { color } from "./input.ts";
import type { MessageBody, RegionWindow } from "./body.ts";

export function safeText(text: string) {
  return stripTerminalSequences(text).replace(
    /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
    "",
  );
}
const white = color("37"),
  gray = color("90"),
  blue = color("38;5;117"),
  pink = color("38;5;218");
export const markdownTheme: MarkdownTheme = {
  heading: color("1;37"),
  link: white,
  linkUrl: gray,
  code: white,
  codeBlock: white,
  codeBlockBorder: gray,
  quote: white,
  quoteBorder: gray,
  hr: gray,
  listBullet: white,
  bold: color("1"),
  italic: color("3"),
  strikethrough: color("9"),
  underline: color("4"),
};
export type SourceRow = {
  region: "body" | "thinking" | "header" | "activity";
  block_start_utf16: number;
  row_in_block: number;
  boundary?: "before" | "after";
};
export type ReadingAnchor = SourceRow & {
  item_id: string;
  measured_width: number;
  instance_id?: string;
  timeline_generation?: string;
  revision?: string;
};
export interface MappedComponent extends Component {
  renderMapped?(width: number): { lines: string[]; rows: SourceRow[] };
}

/** Pi remains the rendering authority, including its private LaTeX extensions.
 * Standalone block renders identify boundaries in the authoritative output;
 * unmatched blocks are conservatively grouped with their preceding source block.
 * No exact source-character position inside a rendered row is inferred.
 */
export class SourceMarkdown {
  private md: Markdown;
  private blocks: { start: number; source: string }[];
  private definitions: string;
  private fallbackBlocks?: SourceBlock[];
  private mapped?: {
    width: number;
    value: {
      lines: string[];
      rows: { block_start_utf16: number; row_in_block: number }[];
    };
  };
  constructor(
    readonly source: string,
    readonly paint = white,
    readonly start = 0,
    readonly prefix = "",
    readonly context?: Pick<
      RegionWindow,
      | "definitions"
      | "suffix"
      | "code"
      | "contextBoundary"
      | "futureMath"
      | "lastMathStart"
      | "blocks"
      | "trimCodeStart"
      | "trimCodeEnd"
    >,
  ) {
    if (context?.blocks && !context.code && !context.contextBoundary) {
      this.definitions = context.definitions;
      this.blocks = [];
      this.md = new Markdown("", 0, 0, markdownTheme, { color: paint });
      return;
    }
    const normalized = normalizedSource(source),
      lexical = normalized.text;
    const tokens = markdownParser.lexer(lexical);
    // When raw spans do not tile, parse the complete resident window. Preserve
    // Pi's tokens and global future-math merging, with a conservative window anchor.
    if (
      context?.lastMathStart !== undefined &&
      !context.code &&
      !context.contextBoundary
    ) {
      this.definitions = context.definitions;
      this.blocks = [];
      this.fallbackBlocks = tokens.map((token) => ({ start, token }));
      this.md = new Markdown("", 0, 0, markdownTheme, { color: paint });
      return;
    }
    const definitions = new Definitions();
    definitions.add(tokens.links);
    this.definitions = context?.definitions || definitions.text;
    this.md = new Markdown(
      safeText(
        (context?.definitions ? context.definitions + "\n" : "") +
          prefix +
          source +
          (context?.suffix ?? ""),
      ),
      0,
      0,
      markdownTheme,
      { color: paint },
    );
    let offset = 0;
    this.blocks = [];
    for (const token of tokens) {
      const at = lexical.indexOf(token.raw, offset);
      if (at < 0) continue;
      if (at >= normalized.text.length) break;
      offset = Math.min(at + token.raw.length, normalized.text.length);
      if (token.type !== "space")
        this.blocks.push({
          start: start + normalized.sourceOffset(at),
          source:
            (at === 0 ? prefix : "") +
            token.raw.slice(0, normalized.text.length - at) +
            (offset === normalized.text.length ? (context?.suffix ?? "") : ""),
        });
    }
    // Context windows inside an exceptional block have a window-relative anchor.
    // Ordinary blocks retain their actual source starts through Pi's own lexer.
    if (context?.contextBoundary || context?.code) this.blocks = [];
  }
  invalidate() {
    this.md.invalidate();
    this.mapped = undefined;
  }
  render(width: number) {
    if (this.mapped?.width === width) return this.mapped.value;
    if (this.fallbackBlocks) {
      const value = normalizedSource(this.source).text.trim()
        ? renderBlocks(
            this.fallbackBlocks,
            this.context?.futureMath ? Number.MAX_SAFE_INTEGER : -1,
            this.definitions,
            this.md,
            width,
          )
        : { lines: [], rows: [] };
      this.mapped = { width, value };
      return value;
    }
    if (
      this.context?.blocks &&
      !this.context.code &&
      !this.context.contextBoundary
    ) {
      const value = normalizedSource(this.source).text.trim()
        ? renderBlocks(
            this.context.blocks,
            this.context.lastMathStart ?? -1,
            this.definitions,
            this.md,
            width,
          )
        : { lines: [], rows: [] };
      this.mapped = { width, value };
      return value;
    }
    const lines = [...this.md.render(width)];
    if (
      this.context?.definitions &&
      lines.length &&
      !stripTerminalSequences(lines[0]).trim()
    )
      lines.shift();
    if (this.context?.code && (this.prefix || this.context.trimCodeStart)) {
      while (lines.length && !stripTerminalSequences(lines[0]).trim())
        lines.shift();
      lines.shift(); // synthetic opening fence border; source content is untouched
    }
    if (
      this.context?.code &&
      (this.context.suffix || this.context.trimCodeEnd)
    ) {
      while (lines.length && !stripTerminalSequences(lines.at(-1)!).trim())
        lines.pop();
      lines.pop(); // synthetic closing fence border
    }
    const normalized = lines.map((line) =>
      stripTerminalSequences(line).trimEnd(),
    );
    const boundaries: { row: number; source: number }[] = [
      { row: 0, source: this.start },
    ];
    let cursor = 0;
    for (const block of this.blocks) {
      // Definitions are shared, not copied into a retained Markdown per source block.
      // The probe is short-lived; cache only the final mapping for the active width.
      const refs = block.source.includes("[") ? this.definitions : "";
      const rendered = new Markdown(
        safeText((refs ? refs + "\n" : "") + block.source),
        0,
        0,
        markdownTheme,
        { color: this.paint },
      )
        .render(width)
        .map((line) => stripTerminalSequences(line).trimEnd());
      while (rendered.length && !rendered.at(-1)) rendered.pop();
      while (rendered.length && !rendered[0]) rendered.shift();
      if (!rendered.length) continue;
      let at = normalized.indexOf(rendered[0], cursor);
      while (
        at >= 0 &&
        !rendered.every((line, index) => normalized[at + index] === line)
      )
        at = normalized.indexOf(rendered[0], at + 1);
      if (at < 0) continue;
      boundaries.push({ row: at, source: block.start });
      cursor = at + rendered.length;
    }
    let boundary = 0;
    const rows = lines.map((_, index) => {
      while (
        boundary + 1 < boundaries.length &&
        boundaries[boundary + 1].row <= index
      )
        boundary++;
      return {
        block_start_utf16: boundaries[boundary].source,
        row_in_block: index - boundaries[boundary].row,
      };
    });
    const value = { lines, rows };
    this.mapped = { width, value };
    return value;
  }
}
export function messageComponent(
  m: Message,
  expanded = false,
  body?: MessageBody,
  evicted = false,
  assistantLabel = "Secretary",
  bodyNotice?: string,
): MappedComponent {
  const role = m.role,
    paint =
      role === "master" || role === "user"
        ? blue
        : role === "toolResult" || role === "tool"
          ? pink
          : white;
  const title =
    role === "master" || role === "user"
      ? assistantLabel === "Agent"
        ? "── 任务输入 ──"
        : "── Master ──"
      : role === "assistant"
        ? assistantLabel
        : role === "system"
          ? "系统"
          : `工具 ${m.tool_name ?? role}${m.call_id ? " · " + m.call_id : ""}`;
  const md = new SourceMarkdown(
    m.text,
    paint,
    body?.body.start,
    body?.body.prefix,
    body?.body,
  );
  const thought = new SourceMarkdown(
    m.thinking ?? "",
    gray,
    body?.thinking.start,
    body?.thinking.prefix,
    body?.thinking,
  );
  const component: MappedComponent = {
    invalidate: () => {
      md.invalidate();
      thought.invalidate();
    },
    render: (width) => component.renderMapped!(width).lines,
    renderMapped: (width) => {
      const lines: string[] = [],
        rows: SourceRow[] = [];
      const add = (
        content: string[],
        region: SourceRow["region"],
        start = 0,
        boundary?: "before" | "after",
      ) => {
        content.forEach((line, index) => {
          lines.push(line);
          rows.push({
            region,
            block_start_utf16: start,
            row_in_block: index,
            ...(boundary ? { boundary } : {}),
          });
        });
      };
      const text = (
        value: string,
        region: SourceRow["region"] = "header",
        start = 0,
        boundary?: "before" | "after",
      ) =>
        add(
          new Text(safeText(value), 0, 0).render(width),
          region,
          start,
          boundary,
        );
      const region = (
        value: SourceMarkdown,
        name: "body" | "thinking",
        window?: RegionWindow,
      ) => {
        if (window?.contextBoundary)
          text(gray("格式上下文边界：本段独立渲染；原文可继续翻阅"));
        if (window?.before)
          text(gray("↑ 前一段"), name, window.start, "before");
        const content = value.render(width);
        lines.push(...content.lines);
        rows.push(...content.rows.map((row) => ({ ...row, region: name })));
        if (window?.after)
          text(
            gray("↓ 后一段"),
            name,
            window.start + window.text.length,
            "after",
          );
      };
      text(paint(safeText(title)));
      if (expanded && m.thinking) region(thought, "thinking", body?.thinking);
      else if (m.thinking_preview?.text)
        text(gray(m.thinking_preview.text), "thinking");
      else if (
        expanded &&
        (m.truncated || m.preview_availability === "expired")
      )
        text(gray("当前没有可显示的思考正文（预览已截断或过期）"), "thinking");
      if (evicted)
        text(gray(bodyNotice ?? "正文未驻留；移至此消息后按 ↑/↓ 读取"), "body");
      else region(md, "body", body?.body);
      if (m.outcome && m.outcome !== "completed")
        text(gray(`状态 ${m.outcome}`));
      if (m.next_cursor) text(gray("正文片段读取中…"));
      if (role === "master" || role === "user")
        add([blue("─".repeat(Math.max(1, width)))], "header");
      add([""], "header");
      return { lines, rows };
    },
  };
  return component;
}
export function timelineComponent(
  item: TimelineItem,
  notice?: string,
  expanded = false,
  body?: MessageBody,
  evicted = false,
): MappedComponent {
  const content =
    item.kind === "message"
      ? messageComponent(item, expanded, body, evicted)
      : new Text(
          pink(
            safeText(
              `工具 · ${item.activity.phase ?? "调用"} · ${item.activity.status ?? ""}`,
            ).replace(/\s+/g, " "),
          ),
          0,
          0,
        );
  if (!notice) return content;
  const mapped: MappedComponent = {
    invalidate: () => content.invalidate(),
    render: (width) => mapped.renderMapped!(width).lines,
    renderMapped: (width) => {
      const prefix = new Text(gray(safeText(notice)), 0, 0).render(width);
      const result = (content as MappedComponent).renderMapped?.(width) ?? {
        lines: content.render(width),
        rows: content.render(width).map((_, i) => ({
          region: "activity" as const,
          block_start_utf16: 0,
          row_in_block: i,
        })),
      };
      return {
        lines: [...prefix, ...result.lines],
        rows: [
          ...prefix.map((_, i) => ({
            region: "header" as const,
            block_start_utf16: 0,
            row_in_block: i,
          })),
          ...result.rows,
        ],
      };
    },
  };
  return mapped;
}
export type ViewEntry = {
  id: string;
  version: string;
  component: MappedComponent;
  revision?: string;
  instance_id?: string;
  timeline_generation?: string;
};
export class DocumentView implements Component {
  entries: ViewEntry[] = [];
  private rows: ReadingAnchor[] = [];
  private lines: string[] = [];
  private width = 0;
  private signature = "";
  desiredTop?: number;
  private restoredAnchor?: ReadingAnchor;
  restoreAnchor(anchor: ReadingAnchor) {
    this.restoredAnchor = anchor;
    this.signature = "";
  }
  navigationDelta = 0;
  scroll?: ScrollView;
  initialEnd = false;
  selectionActive = () => false;
  selectionDragging = false;
  onPointerRead = () => {};
  handleMouse(event: TuiMouseEvent) {
    if (event.type === "press") this.selectionDragging = true;
    if (event.type === "release") this.selectionDragging = false;
    if (event.type === "press" || event.type === "wheel") this.onPointerRead();
    return undefined;
  }
  onViewport = (_rows: ReadingAnchor[]) => {};
  get anchor() {
    return this.rows[this.scroll?.scrollTop ?? 0];
  }
  rowAt(index: number) {
    return this.rows[index];
  }
  invalidate() {
    for (const e of this.entries) e.component.invalidate();
    this.signature = "";
  }
  render(width: number) {
    // Keep Pi's document-row selection stable while background body reads settle.
    if (
      this.selectionDragging &&
      this.selectionActive() &&
      width === this.width
    )
      return this.lines;
    const sig = this.entries.map((e) => `${e.id}:${e.version}`).join("|");
    if (width === this.width && sig === this.signature) return this.lines;
    const anchor = this.restoredAnchor ?? this.anchor,
      lines: string[] = [],
      rows: ReadingAnchor[] = [];
    for (const e of this.entries) {
      const result = e.component.renderMapped?.(Math.max(1, width));
      const rendered = result?.lines ?? e.component.render(Math.max(1, width));
      rendered.forEach((line, index) => {
        lines.push(line);
        rows.push({
          item_id: e.id,
          measured_width: width,
          revision: e.revision,
          instance_id: e.instance_id,
          timeline_generation: e.timeline_generation,
          ...(result?.rows[index] ?? {
            region: "activity",
            block_start_utf16: 0,
            row_in_block: index,
          }),
        });
      });
    }
    if (anchor) {
      const candidates = rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.item_id === anchor.item_id);
      const region = candidates.filter(
        ({ row }) => row.region === anchor.region,
      );
      const block = region.filter(
        ({ row }) => row.block_start_utf16 === anchor.block_start_utf16,
      );
      const closest = (
        block.length ? block : region.length ? region : candidates
      ).sort(
        (a, b) =>
          Math.abs(a.row.block_start_utf16 - anchor.block_start_utf16) -
            Math.abs(b.row.block_start_utf16 - anchor.block_start_utf16) ||
          Math.abs(a.row.row_in_block - anchor.row_in_block) -
            Math.abs(b.row.row_in_block - anchor.row_in_block),
      )[0];
      if (closest) {
        this.desiredTop = closest.index;
        this.restoredAnchor = undefined;
      }
    }
    this.rows = rows;
    this.lines = lines;
    this.width = width;
    this.signature = sig;
    return lines;
  }
}
export class AnchoredScroll extends ScrollView {
  private maxTop = 0;
  private selected = false;
  following = false;
  onReading = () => {};
  endSelection() {
    this.document.selectionDragging = false;
    // A rapid drag/release may finish before any layout observes its selection.
    // Remember that edge now so the next send is not mistaken for new reading.
    this.selected = this.document.selectionActive();
  }
  get atEnd() {
    return this.scrollTop >= this.maxTop;
  }
  constructor(readonly document: DocumentView) {
    super(document, { primary: true, follow: "none", scrollbar: "auto" });
    document.scroll = this;
  }
  override scrollBy(lines: number) {
    this.onReading();
    return super.scrollBy(lines);
  }
  override scrollTo(
    top: number,
    options?: Parameters<ScrollView["scrollTo"]>[1],
  ) {
    this.onReading();
    super.scrollTo(top, options);
  }
  override scrollToStart() {
    this.onReading();
    super.scrollToStart();
  }
  override scrollToEnd() {
    this.onReading();
    super.scrollToEnd();
  }
  override updateLayout(height: number, viewport: number, render: () => void) {
    const selected = this.document.selectionActive();
    if (selected && !this.selected) this.onReading();
    this.selected = selected;
    this.maxTop = Math.max(0, height - viewport);
    super.updateLayout(height, viewport, render);
    if (this.following || this.document.initialEnd) {
      this.document.initialEnd = false;
      this.document.desiredTop = undefined;
      this.document.navigationDelta = 0;
      super.scrollToEnd();
    } else if (this.document.desiredTop !== undefined) {
      const target = this.document.desiredTop;
      this.document.desiredTop = undefined;
      super.scrollTo(target);
    }
    if (this.document.navigationDelta) {
      super.scrollBy(this.document.navigationDelta);
      this.document.navigationDelta = 0;
    }
    const visible: ReadingAnchor[] = [];
    for (let row = this.scrollTop; row < this.scrollTop + viewport; row++) {
      const anchor = this.document.rowAt(row);
      if (anchor) visible.push(anchor);
    }
    this.document.onViewport(visible);
  }
}
export function taskEntry(t: TaskSummary, scope: string): ViewEntry {
  const actual =
    t.active_executions?.map((e) => `${e.state} (${e.id})`).join(", ") ||
    "无活跃执行";
  const last = t.latest_execution_id
    ? `最近执行 ${t.latest_execution_state} (${t.latest_execution_id})`
    : "尚无执行";
  const text = safeText(
    `${t.id}\n${t.goal}\nScope: ${scope} · 计划 ${t.state}\n${actual} · 排队请求 ${t.pending_request_count}\n${last}\n`,
  );
  return {
    id: t.id,
    version: JSON.stringify(t) + scope,
    component: new Text(text, 0, 0),
  };
}
