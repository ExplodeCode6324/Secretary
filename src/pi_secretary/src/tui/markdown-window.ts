import { extractAnsiCode } from "@earendil-works/pi-tui/dist/utils.js";
import { markdownParser } from "./markdown-lexer.ts";

export const WINDOW_BYTES = 1024 * 1024;
export const WINDOW_TARGET = 8 * 4999;
export const DEFINITION_BYTES = 256 * 1024;
export type SourcePiece = {
  text: string;
  start: number;
  prefix?: string;
  suffix?: string;
  boundary?: boolean;
  code?: boolean;
  indent?: boolean;
  trimCodeStart?: boolean;
  trimCodeEnd?: boolean;
};
export type MarkdownWindow = SourcePiece & {
  previousStart: number;
  nextStart: number;
};

/** Same sanitization as the display, then Pi's three-space TAB normalization.
 * Offsets refer back to the original Core source, never to expanded TAB columns. */
export function normalizedSource(raw: string) {
  if (!/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(raw))
    return { text: raw, sourceOffset: (n: number) => n };
  const offsets = new Uint32Array(raw.length * 3 + 1),
    parts: string[] = [];
  let size = 0;
  for (let at = 0; at < raw.length;) {
    const ansi = extractAnsiCode(raw, at);
    if (ansi) {
      at += ansi.length;
      continue;
    }
    const c = raw[at];
    if (c === "\t") {
      parts.push("   ");
      for (let i = 0; i < 3; i++) offsets[size++] = at;
    } else if (!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(c)) {
      parts.push(c);
      offsets[size++] = at;
    }
    at++;
  }
  offsets[size] = raw.length;
  return {
    text: parts.join(""),
    sourceOffset: (n: number) => offsets[Math.min(n, size)],
  };
}

export class Definitions {
  private values = new Map<string, string>();
  private bytes = 0;
  overflow = false;
  add(links: Record<string, { href: string; title?: string | null }>) {
    for (const [id, value] of Object.entries(links)) {
      if (this.values.has(id)) continue;
      const escape = (s: string) => s.replaceAll("\\", "\\\\");
      const line = `[${escape(id).replaceAll("]", "\\]")}]: <${escape(value.href).replaceAll(">", "\\>")}>${value.title ? ` "${escape(value.title).replaceAll('"', '\\"')}"` : ""}\n`;
      const bytes = Buffer.byteLength(line);
      if (this.bytes + bytes > DEFINITION_BYTES) {
        this.overflow = true;
        continue;
      }
      this.bytes += bytes;
      this.values.set(id, line);
    }
  }
  get text() {
    return [...this.values.values()].join("");
  }
}

/** Emits only complete Pi top-level blocks. A partial physical line is never
 * used as evidence that the previous list/table/paragraph has ended. */
export class BlockStream {
  private buffer = "";
  private offset: number;
  private threshold: number;
  private continuation?: {
    code?: { marker: string; count: number; opening: string };
    indent?: boolean;
  };
  readonly definitions = new Definitions();
  constructor(
    readonly emit: (piece: SourcePiece) => void,
    start = 0,
    readonly limit = WINDOW_BYTES,
    readonly batch = WINDOW_TARGET,
  ) {
    this.offset = start;
    this.threshold = batch;
  }
  resume(
    context?: Pick<SourcePiece, "prefix" | "code" | "boundary" | "indent">,
  ) {
    if (context?.code && context.prefix) {
      const match = /^ {0,3}(`{3,}|~{3,})/.exec(context.prefix);
      if (match)
        this.continuation = {
          code: {
            marker: match[1][0],
            count: match[1].length,
            opening: context.prefix,
          },
        };
    } else if (context?.indent) this.continuation = { indent: true };
    else if (context?.boundary) this.continuation = {};
  }
  get retainedBytes() {
    return Buffer.byteLength(this.buffer);
  }
  feed(text: string) {
    for (let at = 0; at < text.length; at += 4999) {
      this.buffer += text.slice(at, at + 4999);
      if (Buffer.byteLength(this.buffer) >= this.threshold) this.drain(false);
    }
  }
  finish() {
    this.drain(true);
  }
  private send(length: number, context: Partial<SourcePiece> = {}) {
    if (!length) return;
    this.emit({
      text: this.buffer.slice(0, length),
      start: this.offset,
      ...context,
    });
    this.buffer = this.buffer.slice(length);
    this.offset += length;
  }
  private drain(final: boolean) {
    while (this.buffer) {
      if (this.continuation) {
        if (!this.drainContinuation(final)) break;
        continue;
      }
      const complete = final
        ? this.buffer.length
        : this.buffer.lastIndexOf("\n") + 1;
      const normalized = normalizedSource(this.buffer.slice(0, complete));
      const tokens = markdownParser.lexer(normalized.text);
      const meaningful = tokens
        .map((token, index) => ({ token, index }))
        .filter(({ token }) => token.type !== "space");
      const last = meaningful.at(-1)?.index ?? -1;
      let at = 0,
        safe = 0;
      const boundaries: number[] = [];
      const opaque: [number, number][] = [];
      for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        const begin = normalized.text.indexOf(token.raw, at);
        if (begin < 0) break;
        at = begin + token.raw.length;
        if (["code", "blockquote", "list", "html"].includes(token.type))
          opaque.push([begin, at]);
        if (index < last || final) {
          safe = normalized.sourceOffset(at);
          boundaries.push(safe);
        }
      }
      // Pi recognizes some unclosed $$ blocks only after a later math operator.
      // Do not finalize earlier apparent paragraphs across that unresolved opener.
      const pending = unresolvedMath(normalized.text, opaque);
      if (!final && pending !== undefined) {
        const pin = normalized.sourceOffset(pending);
        while (boundaries.length && boundaries.at(-1)! > pin) boundaries.pop();
        safe = boundaries.at(-1) ?? 0;
      }
      if (final) boundaries.push(this.buffer.length);
      const committed = boundaries.at(-1) ?? 0;
      if (committed)
        this.definitions.add(
          markdownParser.lexer(
            normalizedSource(this.buffer.slice(0, committed)).text,
          ).links,
        );
      let consumed = 0;
      for (const boundary of [...new Set(boundaries)]) {
        const length = boundary - consumed;
        if (Buffer.byteLength(this.buffer.slice(0, length)) > this.limit) break;
        this.send(length);
        consumed = boundary;
      }
      if (consumed) {
        this.threshold = this.batch;
        continue;
      }
      if (Buffer.byteLength(this.buffer) > this.limit) {
        const opening = /^ {0,3}(`{3,}|~{3,})[^\r\n]*\r?\n/.exec(this.buffer);
        this.continuation = opening
          ? {
              code: {
                marker: opening[1][0],
                count: opening[1].length,
                opening: opening[0],
              },
            }
          : /^ {4}\S|^\t/.test(normalizedSource(this.buffer).text)
            ? { indent: true }
            : {};
        if (!this.continuation.code && !this.continuation.indent)
          this.definitions.overflow = true;
        // First chunk includes the original opening; following code chunks reopen synthetically.
        this.drainContinuation(final, true);
        continue;
      }
      if (final) {
        this.send(this.buffer.length);
        break;
      }
      // Re-lex long unfinished blocks only as their retained size doubles.
      this.threshold = Math.min(
        this.limit + 1,
        Math.max(this.batch, Buffer.byteLength(this.buffer) * 2),
      );
      break;
    }
  }
  private drainContinuation(final: boolean, first = false) {
    const context = this.continuation!;
    const prefix = context.code && !first ? context.code.opening : "";
    const budget = Math.max(
      64,
      this.limit - Buffer.byteLength(prefix) - (context.code?.count ?? 0) - 2,
    );
    let end = 0;
    if (context.code) {
      const lines = this.buffer.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      let offset = 0;
      for (const line of lines) {
        const closed = new RegExp(
          `^ {0,3}${context.code.marker === "`" ? "`" : "~"}{${context.code.count},}[ \\t\\r]*(?:\\n|$)$`,
        ).test(line);
        if (
          closed &&
          !(first && offset === 0) &&
          (line.endsWith("\n") || final)
        ) {
          end = offset + line.length;
          break;
        }
        offset += line.length;
      }
    } else if (context.indent) {
      let offset = 0;
      for (const line of this.buffer.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
        const normal = normalizedSource(line).text;
        if (
          normal.trim() &&
          !/^ {4}/.test(normal) &&
          (line.endsWith("\n") || final)
        ) {
          if (!offset) {
            this.continuation = undefined;
            return true;
          }
          end = offset;
          break;
        }
        offset += line.length;
      }
      if (final && !end) end = this.buffer.length;
    } else {
      // After a bounded exceptional context, a blank line ends its local window.
      // All following windows remain explicitly labelled until the message ends:
      // a loose list/blockquote/math block may continue beyond that blank line.
      end = final ? this.buffer.length : 0;
    }
    if (end && Buffer.byteLength(this.buffer.slice(0, end)) <= budget) {
      this.send(end, {
        prefix: context.code && !first ? context.code.opening : "",
        boundary: !context.code && !context.indent,
        code: !!context.code || !!context.indent,
        indent: !!context.indent,
        trimCodeStart: !!context.indent && !first,
      });
      this.continuation = undefined;
      this.threshold = this.batch;
      return true;
    }
    if (!final && Buffer.byteLength(this.buffer) <= this.limit) {
      this.threshold = this.limit + 1;
      return false;
    }
    let cut = byteBoundary(this.buffer, budget);
    const line = this.buffer.lastIndexOf("\n", cut - 1);
    if (
      line >= 0 &&
      !(first && context.code && line + 1 === context.code.opening.length)
    )
      cut = line + 1;
    // A pathological single line/cluster over the cap is explicitly exceptional too.
    const splitLine = !this.buffer.slice(0, cut).endsWith("\n");
    this.send(cut, {
      prefix,
      suffix: context.code
        ? `${splitLine ? "\n" : ""}${context.code.marker.repeat(context.code.count)}\n`
        : "",
      boundary: (!context.code && !context.indent) || splitLine,
      code: !!context.code || !!context.indent,
      indent: !!context.indent,
      trimCodeStart: !!context.indent && !first,
      trimCodeEnd: !!context.indent,
    });
    this.threshold = this.batch;
    return true;
  }
}

function unresolvedMath(text: string, opaque: [number, number][]) {
  const starts = /(^|\n) {0,3}(\$\$|\\\[)/g;
  let match: RegExpExecArray | null;
  while ((match = starts.exec(text))) {
    const start = match.index! + (match[1] ? 1 : 0),
      opening = match[2],
      closing = opening === "$$" ? "$$" : "\\]";
    if (opaque.some(([a, b]) => a <= start && start < b)) continue;
    const from = match.index! + match[0].length;
    const closer =
      opening === "$$" ? /\$\$[ \t]*(?:\n|$)/g : /\\\][ \t]*(?:\n|$)/g;
    closer.lastIndex = from;
    const found = closer.exec(text);
    if (!found) return start;
    starts.lastIndex = found.index + closing.length;
  }
}

/** Prefer a complete extended grapheme; one over-budget cluster still makes progress
 * at a code-point boundary and is covered by the explicit exceptional notice. */
export function byteBoundary(text: string, max: number) {
  let low = 0,
    high = Math.min(text.length, max);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid)) <= max) low = mid;
    else high = mid - 1;
  }
  if (
    low &&
    /[\uD800-\uDBFF]/.test(text[low - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[low] ?? "")
  )
    low--;
  if (low < text.length) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    const boundary = segmenter.segment(text).containing(low);
    if (boundary && boundary.index > 0) low = boundary.index;
  }
  return Math.max(1, low);
}

export class WindowStream {
  readonly parser: BlockStream;
  selected?: MarkdownWindow;
  private current?: SourcePiece;
  private previous: number;
  constructor(
    readonly target: number,
    readonly onWindow: (window: MarkdownWindow) => void = () => {},
    start = 0,
    previous = 0,
    limit = WINDOW_BYTES,
    batch = WINDOW_TARGET,
    context?: Pick<SourcePiece, "prefix" | "code" | "boundary" | "indent">,
  ) {
    this.previous = previous;
    this.parser = new BlockStream(
      (piece) => this.piece(piece),
      start,
      limit,
      batch,
    );
    this.parser.resume(context);
  }
  private publish() {
    const c = this.current;
    if (!c) return;
    const w = {
      ...c,
      previousStart: this.previous,
      nextStart: c.start + c.text.length,
    };
    this.onWindow(w);
    // MAX_SAFE_INTEGER is the explicit end-of-region request used when entering
    // an evicted body from below. Keep only the latest window while walking EOF.
    if (
      w.start <= this.target &&
      (this.target === Number.MAX_SAFE_INTEGER || this.target < w.nextStart)
    )
      this.selected = w;
    this.previous = c.start;
    this.current = undefined;
  }
  private piece(piece: SourcePiece) {
    if (
      this.current &&
      (piece.code ||
        this.current.code ||
        piece.prefix ||
        piece.suffix ||
        piece.boundary ||
        this.current.prefix ||
        this.current.suffix ||
        this.current.boundary ||
        Buffer.byteLength(this.current.text) + Buffer.byteLength(piece.text) >
          this.parser.limit)
    )
      this.publish();
    if (this.current) this.current.text += piece.text;
    else this.current = { ...piece };
    if (
      Buffer.byteLength(this.current.text) >= this.parser.batch ||
      piece.code ||
      piece.boundary
    )
      this.publish();
  }
  feed(text: string) {
    this.parser.feed(text);
  }
  finish() {
    this.parser.finish();
    this.publish();
  }
}
