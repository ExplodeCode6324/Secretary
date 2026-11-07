import { executionRound, selectorValue } from "../task-locator.ts";
import { wellFormed } from "../task-identity.ts";

export type GuideCommand = { title: string; round: number; text: string };
// Delimiters are syntax; everything after the third delimiter is body data.
const titleToken =
  '("(?:[^"\\\\\\x00-\\x1f\\x7f-\\x9f]|\\\\["\\\\])*"|[^\\s"\\\\]+)';
const header = new RegExp("^/guide " + titleToken + " ([1-9][0-9]*) ", "i");
export function guideHeader(raw: string) {
  const m = header.exec(raw);
  if (!m) return;
  try {
    const title = selectorValue(m[1].startsWith('"') ? JSON.parse(m[1]) : m[1]);
    if (!title || m[1] === "--id") return;
    return { title, round: executionRound(m[2]), end: m[0].length };
  } catch {
    return;
  }
}
export function parseGuide(raw: string): GuideCommand | undefined {
  const h = guideHeader(raw);
  if (!h) return;
  const text = raw.slice(h.end);
  if (!text.trim() || !wellFormed(text) || Buffer.byteLength(text) > 16384)
    return;
  return { title: h.title, round: h.round, text };
}
/** Only title/round tokens are replaceable. Never include body or later lines. */
export function guideArgument(text: string, col: number) {
  if (!/^\/guide /i.test(text) || col < 7) return;
  const token = new RegExp("^/guide " + titleToken, "i").exec(text);
  // An unfinished quote has no reliable token end. Never consume text after
  // the cursor; suppress completion until the ambiguous suffix is resolved.
  if (!token && text.slice(col).trim()) return;
  if (!token || col <= token[0].length) {
    // An unfinished quoted title can contain spaces, but never a physical newline.
    const end = token?.[0].length ?? text.indexOf("\n");
    return {
      start: 7,
      end: end === -1 ? text.length : end,
      prefix: text.slice(7, col),
      command: "guide-title",
    };
  }
  const start = token[0].length + 1;
  if (text[token[0].length] !== " " || col < start) return;
  const rest = text.slice(start),
    len = /^[^\s]*/.exec(rest)![0].length;
  if (col > start + len) return;
  try {
    const title = selectorValue(
      token[1].startsWith('"') ? JSON.parse(token[1]) : token[1],
    );
    return {
      start,
      end: start + len,
      prefix: JSON.stringify({ title, prefix: text.slice(start, col) }),
      command: "guide-round",
    };
  } catch {
    return;
  }
}
