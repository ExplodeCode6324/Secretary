import MarkdownIt from "markdown-it";
export const phaseFrames = [
  [0, 0, 0],
  [-4, 3, -1],
  [3, -5, 2],
  [-2, 1, 5],
] as const;
export const outline =
  "M16 3 L29 10.5 V25.5 L16 33 L3 25.5 V10.5 Z M16 3 V18 M3 10.5 L16 18 L29 10.5 M16 18 V33";
export const streamChunk =
  "持续整理中文记录与 English，保持段落、光标和输入稳定。 ";
const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});
markdown.renderer.rules.image = (tokens, i) =>
  markdown.utils.escapeHtml(tokens[i].content);
// Links remain selectable document text. The spike never navigates externally.
markdown.renderer.rules.link_open = () => '<span class="document-link">';
markdown.renderer.rules.link_close = () => "</span>";
export const render = (source: string) => markdown.render(source);
export type Message = {
  id: number;
  role: string;
  time: string;
  source: string;
};
export function fixture(count = 8): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    role: i % 4 === 0 ? "你" : "secretary",
    time: `09:${String(i % 60).padStart(2, "0")}`,
    source:
      i === 0
        ? "整理今天的工作，从一个清楚的起点开始。\n\n保留重要细节，也留一点思考的空间。"
        : i === 1
          ? "## 今天的工作\n\n先把输入整理成可以继续的线索。内容留在文档中，状态沿着右侧的边界展开。\n\n1. 阅读与归纳已有材料\n2. 检查实现中的细节\n3. 记录结果，继续下一步\n\n> 一段安静、可选择、可复制的文字。"
          : i === 2
            ? '```typescript\nconst next = {\n  state: "ready",\n  message: "从这里继续。",\n};\n```\n\n已准备好下一步。'
            : `### 记录 ${i + 1}\n\n第 ${i + 1} 条记录：中文与 English text 共同组成一段连续的文档。\n\n${"先观察，再判断；保留可以复核的细节。 ".repeat(1 + (i % 5))}`,
  }));
}
export function loadFixture(): Message[] {
  const rows = fixture(1000);
  rows[40].source =
    "## 长代码\n\n```typescript\n" +
    Array.from(
      { length: 10000 },
      (_, i) => `const line${i} = "合成数据 ${i}";`,
    ).join("\n") +
    "\n```";
  const encoder = new TextEncoder();
  const header = "## 长文档\n\n";
  const paragraph = "中文与 English。文档段落用于排版验证。\n\n";
  const remaining = 102400 - encoder.encode(header).length;
  const paragraphBytes = encoder.encode(paragraph).length;
  rows[80].source =
    header +
    paragraph.repeat(Math.floor(remaining / paragraphBytes)) +
    " ".repeat(remaining % paragraphBytes);
  return rows;
}
export function shouldSend(
  event: {
    key: string;
    shiftKey: boolean;
    isComposing: boolean;
    keyCode: number;
  },
  composing: boolean,
): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !composing
  );
}
export function safeDraft(value: string, composing: boolean): string | null {
  return composing || !value.trim() ? null : value;
}
export function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
  return { count: values.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}
