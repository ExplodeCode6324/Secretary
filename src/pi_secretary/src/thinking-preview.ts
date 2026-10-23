import type { ThinkingPreview } from "./api/contracts.ts";

export type DisplayBlock = {
  type: string;
  text?: string;
  thinking?: string;
  redacted?: boolean;
};
export function* visibleThinking(content: readonly DisplayBlock[]) {
  for (const block of content)
    if (block.type === "thinking" && !block.redacted && block.thinking)
      yield block.thinking;
}

const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const WINDOW = 4097;
export const THINKING_PREVIEW_BYTES = 4096;

/** Disposable display prefix. Never used as model input, identity, or pagination. */
export function thinkingPreview(
  content: readonly DisplayBlock[],
): ThinkingPreview | undefined {
  let prefix = "",
    clipped = false,
    seen = false;
  outer: for (const text of visibleThinking(content)) {
    for (const piece of seen ? ["\n", text] : [text]) {
      const available = WINDOW - prefix.length;
      prefix += piece.slice(0, available);
      if (piece.length > available) {
        clipped = true;
        break outer;
      }
    }
    seen = true;
  }
  if (!prefix) return undefined;
  let omitted = clipped;
  // A stream delta may end with half an emoji. Wait for a later complete snapshot.
  for (let i = 0; i < prefix.length; i++) {
    const unit = prefix.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = prefix.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
    } else if (unit < 0xdc00 || unit > 0xdfff) continue;
    prefix = prefix.slice(0, i);
    clipped = false;
    omitted = true;
    break;
  }
  const segments: string[] = [];
  let reachedWindowEnd = true;
  for (const { segment } of segmenter.segment(prefix)) {
    segments.push(segment);
    // Twenty display clusters and one lookahead determine whether more exists.
    if (segments.length === 21) {
      reachedWindowEnd = false;
      break;
    }
  }
  // A cluster at the bounded window edge can continue outside the window.
  if (clipped && reachedWindowEnd) segments.pop();
  let text = "",
    count = 0;
  for (const segment of segments) {
    const more = omitted || count + 1 < segments.length;
    if (
      count === 20 ||
      Buffer.byteLength(JSON.stringify(text + segment + (more ? "…" : ""))) >
        THINKING_PREVIEW_BYTES
    ) {
      omitted = true;
      break;
    }
    text += segment;
    count++;
  }
  return { text: text + (omitted && text ? "…" : ""), truncated: omitted };
}
