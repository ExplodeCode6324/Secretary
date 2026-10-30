import {
  Markdown,
  ScrollView,
  stripTerminalSequences,
  Text,
  type Component,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import type { Message, TaskSummary, TimelineItem } from "../api/contracts.ts";
import { color } from "./input.ts";

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
export function messageComponent(m: Message): Component {
  const role = m.role,
    paint =
      role === "master" || role === "user"
        ? blue
        : role === "toolResult" || role === "tool"
          ? pink
          : white;
  const title =
    role === "master" || role === "user"
      ? "── Master ──"
      : role === "assistant"
        ? "Secretary"
        : role === "system"
          ? "系统"
          : `工具 ${role}`;
  const preview = m.thinking_preview?.text;
  const text = safeText(m.text);
  const md = new Markdown(text, 0, 0, markdownTheme, { color: paint });
  return {
    invalidate: () => md.invalidate(),
    render: (width) => [
      ...new Text(paint(safeText(title)), 0, 0).render(width),
      ...(preview
        ? new Text(gray(safeText(String(preview))), 0, 0).render(width)
        : []),
      ...md.render(width),
      ...(m.outcome && m.outcome !== "completed"
        ? new Text(gray(`状态 ${m.outcome}`), 0, 0).render(width)
        : []),
      ...(m.next_cursor
        ? new Text(gray("正文片段读取中…"), 0, 0).render(width)
        : []),
      ...(role === "master" || role === "user"
        ? [blue("─".repeat(Math.max(1, width)))]
        : []),
      "",
    ],
  };
}
export function timelineComponent(
  item: TimelineItem,
  notice?: string,
): Component {
  if (notice) {
    const content = timelineComponent(item);
    return {
      invalidate: () => content.invalidate(),
      render: (width) => [
        ...new Text(gray(safeText(notice)), 0, 0).render(width),
        ...content.render(width),
      ],
    };
  }
  if (item.kind === "message") return messageComponent(item);
  return new Text(
    pink(
      safeText(
        `工具 · ${item.activity.phase ?? "调用"} · ${item.activity.status ?? ""}`,
      ).replace(/\s+/g, " "),
    ),
    0,
    0,
  );
}
export type ViewEntry = { id: string; version: string; component: Component };
/** Anchor measured in displayed text characters within a stable object, not global row. */
export class DocumentView implements Component {
  entries: ViewEntry[] = [];
  private rows: { id: string; offset: number }[] = [];
  private lines: string[] = [];
  private width = 0;
  private signature = "";
  desiredTop?: number;
  scroll?: ScrollView;
  initialEnd = false;
  invalidate() {
    for (const e of this.entries) e.component.invalidate();
    this.signature = "";
  }
  render(width: number) {
    const sig = this.entries.map((e) => `${e.id}:${e.version}`).join("|");
    if (width === this.width && sig === this.signature) return this.lines;
    const anchor = this.rows[this.scroll?.scrollTop ?? 0];
    const lines: string[] = [],
      rows: { id: string; offset: number }[] = [];
    for (const e of this.entries) {
      let offset = 0;
      for (const line of e.component.render(Math.max(1, width))) {
        lines.push(line);
        rows.push({ id: e.id, offset });
        offset += stripTerminalSequences(line).trim().length;
      }
    }
    if (anchor) {
      let at = rows.findIndex((r) => r.id === anchor.id);
      if (at >= 0) {
        while (
          at + 1 < rows.length &&
          rows[at + 1].id === anchor.id &&
          rows[at + 1].offset <= anchor.offset
        )
          at++;
        this.desiredTop = at;
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
  get atEnd() {
    return this.scrollTop >= this.maxTop;
  }
  constructor(readonly document: DocumentView) {
    super(document, { primary: true, follow: "none", scrollbar: "auto" });
    document.scroll = this;
  }
  override updateLayout(height: number, viewport: number, render: () => void) {
    this.maxTop = Math.max(0, height - viewport);
    super.updateLayout(height, viewport, render);
    if (this.document.initialEnd) {
      this.document.initialEnd = false;
      this.scrollToEnd();
    } else if (this.document.desiredTop !== undefined) {
      const target = this.document.desiredTop;
      this.document.desiredTop = undefined;
      this.scrollTo(target);
    }
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
