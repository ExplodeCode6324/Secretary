import MarkdownIt from "markdown-it";
import { bytes, LIMITS } from "./model";
export function safeUrl(value: string): string | null {
  if (
    bytes(value) > 2048 ||
    /[\s\u0000-\u001f\u007f]/u.test(value) ||
    /%(00|0a|0d|09|7f)/i.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.renderer.rules.image = (tokens, i) => md.utils.escapeHtml(tokens[i].content);
md.renderer.rules.link_open = (tokens, i) => {
  const href = safeUrl(String(tokens[i].attrGet("href") ?? ""));
  return href
    ? `<button type="button" class="document-link" data-url="${md.utils.escapeHtml(href)}" title="${md.utils.escapeHtml(new URL(href).host)}">`
    : '<span class="document-link-invalid">';
};
md.renderer.rules.link_close = (tokens, i) => {
  let depth = 1;
  for (let n = i - 1; n >= 0; n--) {
    if (tokens[n].type === "link_close") depth++;
    if (tokens[n].type === "link_open" && --depth === 0)
      return safeUrl(String(tokens[n].attrGet("href") ?? ""))
        ? "</button>"
        : "</span>";
  }
  return "</span>";
};
export class Renderer {
  private cache = new Map<
    string,
    { source: string; html: string; bytes: number }
  >();
  size = 0;
  clear() {
    this.cache.clear();
    this.size = 0;
  }
  render(key: string, source: string) {
    const old = this.cache.get(key);
    if (old?.source === source) return old.html;
    if (old) {
      this.size -= old.bytes;
      this.cache.delete(key);
    }
    const html = md.render(source),
      cost = bytes(html) + bytes(source);
    if (cost > LIMITS.html)
      return "<p>渲染内容达到上限，请复制已加载部分。</p>";
    while (
      this.size + cost > LIMITS.html ||
      this.cache.size >= LIMITS.rows * 2
    ) {
      const first = this.cache.entries().next().value;
      if (!first) break;
      this.size -= first[1].bytes;
      this.cache.delete(first[0]);
    }
    this.cache.set(key, { source, html, bytes: cost });
    this.size += cost;
    return html;
  }
  retain(ids: Set<string>) {
    for (const [key, entry] of this.cache)
      if (!ids.has(key.split("|")[0])) {
        this.cache.delete(key);
        this.size -= entry.bytes;
      }
  }
}
