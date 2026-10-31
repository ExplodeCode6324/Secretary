import { Lexer, type Token, type Tokens } from "marked";
import {
  type Markdown,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { isImageLine } from "@earendil-works/pi-tui/dist/terminal-image.js";
import { markdownParser } from "./markdown-lexer.ts";
import type { SourceBlock } from "./markdown-window.ts";

/** Preserve the block tokens established with source lookahead. Re-lexing a raw
 * paragraph alone loses marked's indented-code normalization. Inline tokens are
 * rebuilt with the completed region's definitions (including forward references).
 * Only the selected resident windows own these derived parse trees; indexes and
 * checkpoints retain no tokens. The 4 MiB source quota is not a JS heap limit. */
export function renderBlocks(
  blocks: SourceBlock[],
  lastMathStart: number,
  definitions: string,
  md: Markdown,
  width: number,
) {
  const links = markdownParser.lexer(definitions).links;
  const lexer = new Lexer(markdownParser.defaults);
  lexer.tokens.links = links;
  const inline = (text: string) => lexer.inlineTokens(text);
  const refresh = (original: Token): Token => {
    const token = { ...original };
    if (
      token.type === "paragraph" ||
      token.type === "heading" ||
      token.type === "text"
    )
      token.tokens = inline(token.text);
    else if (token.type === "blockquote")
      token.tokens = (token.tokens ?? []).map(refresh);
    else if (token.type === "list")
      token.items = token.items.map((item: Tokens.ListItem) => ({
        ...item,
        tokens: item.tokens.map(refresh),
      }));
    else if (token.type === "table") {
      const cell = (value: Tokens.TableCell) => ({
        ...value,
        tokens: inline(value.text),
      });
      token.header = token.header.map(cell);
      token.rows = token.rows.map((row: Tokens.TableCell[]) => row.map(cell));
    }
    return token;
  };
  const merged: SourceBlock[] = [];
  for (const block of blocks) {
    const previous = merged.at(-1);
    if (
      previous?.token.type === "paragraph" &&
      block.token.type === "paragraph" &&
      previous.start < lastMathStart
    ) {
      previous.token = {
        ...previous.token,
        raw: previous.token.raw + block.token.raw,
        text: previous.token.text + "\n" + block.token.text,
      };
    } else merged.push({ ...block });
  }
  const tokens = merged.map((block) => refresh(block.token));
  trimPartialClosingFences(tokens);
  // Pinned Pi 0.87.0 private seam, deliberately guarded and covered by rendering
  // parity tests. Pi still renders every block, including math, tables and lists.
  const renderer = md as unknown as {
    renderToken(token: Token, width: number, next?: string): string[];
  };
  if (typeof renderer.renderToken !== "function")
    throw Error("PI_MARKDOWN_RENDER_TOKEN_SEAM_CHANGED");
  const lines: string[] = [],
    rows: { block_start_utf16: number; row_in_block: number }[] = [];
  let row = 0;
  for (let index = 0; index < tokens.length; index++) {
    if (merged[index].start !== merged[index - 1]?.start) row = 0;
    for (const raw of renderer.renderToken(
      tokens[index],
      Math.max(1, width),
      tokens[index + 1]?.type,
    )) {
      for (const line of isImageLine(raw)
        ? [raw]
        : wrapTextWithAnsi(raw, Math.max(1, width))) {
        lines.push(
          isImageLine(line)
            ? line
            : line + " ".repeat(Math.max(0, width - visibleWidth(line))),
        );
        rows.push({
          block_start_utf16: merged[index].start,
          row_in_block: row++,
        });
      }
    }
  }
  return { lines, rows };
}

// Pi 0.87.0 trimPartialClosingFences, MIT (copyright Mario Zechner 2025).
// Full license and pinned parser source attribution: markdown-lexer.ts.
function trimPartialClosingFences(tokens: readonly Token[]): void {
  const token = tokens[tokens.length - 1];
  if (token?.type === "list") {
    trimPartialClosingFences(token.items[token.items.length - 1]?.tokens ?? []);
    return;
  }
  if (token?.type === "blockquote") {
    trimPartialClosingFences(token.tokens ?? []);
    return;
  }
  if (token?.type !== "code") return;
  const marker = /^(`{3,}|~{3,})/.exec(token.raw)?.[1];
  const lastLine = token.raw.split("\n").pop();
  if (
    !marker ||
    !lastLine ||
    lastLine.length >= marker.length ||
    lastLine !== marker[0]?.repeat(lastLine.length)
  )
    return;
  token.text = token.text.slice(0, -lastLine.length).replace(/\n$/, "");
}
