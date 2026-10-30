import test from "node:test";
import assert from "node:assert/strict";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  BlockStream,
  WindowStream,
  Definitions,
  DEFINITION_BYTES,
  normalizedSource,
  type SourcePiece,
} from "../../../src/pi_secretary/src/tui/markdown-window.ts";
import { markdownParser } from "../../../src/pi_secretary/src/tui/markdown-lexer.ts";
import {
  SourceMarkdown,
  markdownTheme,
  messageComponent,
} from "../../../src/pi_secretary/src/tui/view.ts";
import {
  readMessageBody,
  bodyBytes,
} from "../../../src/pi_secretary/src/tui/body.ts";
import type { Message } from "../../../src/pi_secretary/src/api/contracts.ts";
const emptyMathCases = [
  "$x$\n\\[\n===\n",
  "para text\n$$ $$\nx^2\n===\n",
  "$$\nx^2\n$$\n---\n",
  "safe\n\n$x$\n\\[\n===\n",

  "$$\n$$\n\npara one\n\npara two\n\na = b\n",
  "$$   \n$$\n\npara one\n\na = b\n",
  "\\[\n\\]\n\npara one\n\na = b\n",
];
const corpus = [
  "```text\n$$\nliteral math marker\n```\n\nend\n",
  "before\n\n\x1b[31mcolored\x1b[0m **bold**\n\nend\n",
  "7. seven\n\n8. eight\n   - nested\n\n     continuing **bold**\n\nend\n",
  "| a | b |\n| --- | ---: |\n| 中 | 👨‍👩‍👧‍👦 |\n| x | y |\n\nend\n",
  "> ```js\n> a\n> ```\n>\n> quoted\n\nend\n",
  "标题\n===\n\nsetext\n---\n\nend\n",
  "$$\nwords\n\nmore words\n= 1\n$$\n\nend\n",
  "\\[\nx=1\n\ny=2\n\\]\n\nend\n",
  "$$\nx=1\n$$\n\n$$\ny=2\n$$\n\nend\n",
  '[reference][r]\n\n[r]: <https://example.com/a>\n "title"\n\nnext\n',
  "a ~~strike~~ ~not~ \\(x=1\\) $a+b$ and **bold**\n\n\tcode\n\nend\n",
  "```js\nconst a = `👨‍👩‍👧‍👦`;\n```\n\nend\n",
  "<div>\nhtml\n</div>\n\nend\n",
  "$$\nhello\n\nworld $$x$$ y\n\nnext para\n\na = b\n",
  "\\[\nhello\n\nworld \\] trailing\n\nnext para\n\na = b\n",
  "$$\nhello\n\nworld $$x$$ y\n\nnext para\n\na = b\n$$\n",
];
function boundaries(source: string) {
  const normal = normalizedSource(source),
    tokens = markdownParser.lexer(normal.text);
  let at = 0;
  const ends = new Set([source.length]);
  for (const token of tokens) {
    at = normal.text.indexOf(token.raw, at) + token.raw.length;
    ends.add(normal.sourceOffset(at));
  }
  return ends;
}
const color = (value: string) => `\x1b[37m${value}\x1b[0m`;
const clean = (rows: string[]) =>
  rows
    .map(stripTerminalSequences)
    .map((s) => s.trimEnd())
    .filter(Boolean);
test("every split point preserves complete Pi block boundaries, graphemes and exact source", () => {
  for (const source of [...corpus, ...emptyMathCases])
    for (let split = 1; split < source.length; split++) {
      const pieces: SourcePiece[] = [],
        parser = new BlockStream((p) => pieces.push(p), 0, 1024 * 1024, 1);
      parser.feed(source.slice(0, split));
      parser.feed(source.slice(split));
      parser.finish();
      assert.equal(pieces.map((p) => p.text).join(""), source);
      const allowed = boundaries(source);
      for (const p of pieces)
        assert(
          allowed.has(p.start + p.text.length),
          `unstable boundary ${split}: ${JSON.stringify(source)}`,
        );
      assert.deepEqual(
        markdownParser.lexer(parser.definitions.text).links,
        markdownParser.lexer(normalizedSource(source).text).links,
      );
    }
});
test("complete windows retain Pi's supported formatting across tiny arbitrary fragments", () => {
  const source = corpus.join("\n\n"),
    windows: SourcePiece[] = [];
  const stream = new WindowStream(0, (w) => windows.push(w), 0, 0, 10000, 91);
  for (let at = 0; at < source.length; at += 7)
    stream.feed(source.slice(at, at + 7));
  stream.finish();
  const expected = clean(
    new Markdown(normalizedSource(source).text, 0, 0, markdownTheme, {
      color,
    }).render(60),
  );
  const actual = windows.flatMap((w) =>
    clean(
      new SourceMarkdown(w.text, color, w.start, w.prefix, {
        definitions: stream.parser.definitions.text,
        suffix: w.suffix ?? "",
        code: !!w.code,
        contextBoundary: !!w.boundary,
      }).render(60).lines,
    ),
  );
  assert.deepEqual(actual, expected);
  assert(windows.length > 4);
});
test("oversized code windows preserve every physical content line without synthetic blank lines", () => {
  const source =
    "```js\n" +
    Array.from({ length: 1000 }, (_, n) => `const n${n} = ${n};\n`).join("") +
    "```\n\nlast\n";
  const windows: SourcePiece[] = [],
    stream = new WindowStream(0, (w) => windows.push(w), 0, 0, 4096, 500);
  for (let at = 0; at < source.length; at += 79)
    stream.feed(source.slice(at, at + 79));
  stream.finish();
  assert.equal(windows.map((w) => w.text).join(""), source);
  assert(windows.filter((w) => w.code).length > 2);
  const actual = windows.flatMap(
    (w) =>
      new SourceMarkdown(w.text, color, w.start, w.prefix, {
        definitions: "",
        suffix: w.suffix ?? "",
        code: !!w.code,
        contextBoundary: !!w.boundary,
      }).render(80).lines,
  );
  assert.deepEqual(
    clean(actual),
    clean(
      new Markdown(normalizedSource(source).text, 0, 0, markdownTheme, {
        color,
      }).render(80),
    ),
  );
  for (const w of windows)
    assert(!w.boundary && Buffer.byteLength(w.text) <= 4096);
});
test("oversized non-code blocks and references expose a notice while preserving all source", () => {
  const source = "👨‍👩‍👧‍👦 中文 ".repeat(1000),
    windows: SourcePiece[] = [];
  const stream = new WindowStream(0, (w) => windows.push(w), 0, 0, 4096, 500);
  for (let at = 0; at < source.length; at += 199)
    stream.feed(source.slice(at, at + 199));
  stream.finish();
  assert.equal(windows.map((w) => w.text).join(""), source);
  const graphemes = new Set(
    [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        source,
      ),
    ].map((s) => s.index),
  );
  graphemes.add(source.length);
  for (const w of windows) {
    assert(w.boundary);
    assert(graphemes.has(w.start));
    assert(graphemes.has(w.start + w.text.length));
    assert(Buffer.byteLength(w.text) <= 4096);
  }
  const defs = new Definitions();
  for (let i = 0; i < 9000; i++)
    defs.add({
      ["ref" + i]: { href: "https://example.com/" + i + "x".repeat(50) },
    });
  assert(defs.overflow);
  assert(Buffer.byteLength(defs.text) <= DEFINITION_BYTES);
});
function fake(source: string, thought = "") {
  let calls = 0;
  const fragment = (n: number): Message => ({
    id: "message:test",
    kind: "message",
    role: "assistant",
    revision: "r",
    text: source.slice(n * 4999, (n + 1) * 4999),
    thinking: thought.slice(n * 4999, (n + 1) * 4999),
    call_id: null,
    incomplete: false,
    persistence: "durable",
    next_cursor:
      (n + 1) * 4999 < Math.max(source.length, thought.length)
        ? String(n + 1)
        : null,
  });
  return {
    first: fragment(0),
    calls: () => calls,
    client: {
      query: async <T>(path: string) => {
        calls++;
        return fragment(
          Number(new URL(path, "http://local").searchParams.get("cursor")),
        ) as T;
      },
    },
  };
}
test("source-offset navigation, definition lookahead and bounded checkpoints survive forward/back rereads", async () => {
  const text =
    "[r] **bold**\n\n7. a\n8. b\n\n".repeat(60000) +
    "[r]: https://example.com\n";
  const fixture = fake(text),
    first = await readMessageBody(fixture.client, fixture.first, false);
  assert(first.index && first.body.definitions.includes("https://example.com"));
  assert(first.index.body.checkpoints.length <= 32);
  let current = first,
    raw = "",
    lastCalls = fixture.calls();
  for (let n = 0; n < 5; n++) {
    raw += current.body.text;
    const next = await readMessageBody(fixture.client, fixture.first, false, {
      previous: current,
      targets: { body: current.body.nextStart },
    });
    assert.equal(next.body.start, current.body.nextStart);
    assert.equal(next.body.previousStart, current.body.start);
    assert(fixture.calls() - lastCalls < 40);
    lastCalls = fixture.calls();
    current = next;
  }
  assert.equal(raw, text.slice(0, raw.length));
  const back = await readMessageBody(fixture.client, fixture.first, false, {
    previous: current,
    targets: { body: current.body.previousStart },
  });
  assert.equal(back.body.nextStart, current.body.start);
  assert(bodyBytes(back) <= 4 * 1024 * 1024);
});

test("indented oversized code remains code and closes before the following ordinary block", () => {
  const source = "    code line\n".repeat(2000) + "\nordinary paragraph\n";
  const windows: SourcePiece[] = [];
  const stream = new WindowStream(0, (w) => windows.push(w), 0, 0, 4096, 500);
  for (let at = 0; at < source.length; at += 199)
    stream.feed(source.slice(at, at + 199));
  stream.finish();
  assert.equal(windows.map((w) => w.text).join(""), source);
  assert(windows.some((w) => w.indent));
  assert(windows.every((w) => !w.boundary));
  assert(!windows.at(-1)!.code);
  const actual = windows.flatMap(
    (w) =>
      new SourceMarkdown(w.text, color, w.start, w.prefix, {
        definitions: "",
        suffix: w.suffix ?? "",
        code: !!w.code,
        contextBoundary: !!w.boundary,
        trimCodeStart: w.trimCodeStart,
        trimCodeEnd: w.trimCodeEnd,
      }).render(80).lines,
  );
  assert.deepEqual(
    clean(actual),
    clean(new Markdown(source, 0, 0, markdownTheme, { color }).render(80)),
  );
});
test("exceptional body rendering visibly labels the formatting boundary", async () => {
  const f = fake("**" + "long ".repeat(220000) + "**");
  const body = await readMessageBody(f.client, f.first, false);
  assert(body.body.contextBoundary);
  assert(
    messageComponent(body.message, false, body)
      .render(80)
      .map(stripTerminalSequences)
      .some((x) => x.includes("格式上下文边界")),
  );
});

test("EOF math lookahead includes code-fence markers and survives bounded rereads", async () => {
  const text =
    "first line\nsecond line\n|---|---|\n\n" +
    "padding paragraph ".repeat(8).concat("\n\n").repeat(8500) +
    "```text\n$$\n```\n";
  const f = fake(text);
  const first = await readMessageBody(f.client, f.first, false);
  assert(first.windowed);
  assert.equal(first.index!.body.lastMathStart, text.lastIndexOf("$$"));
  assert(first.body.futureMath);
  const next = await readMessageBody(f.client, f.first, false, {
    previous: first,
    targets: { body: first.body.nextStart },
    windowed: true,
  });
  assert.equal(next.index!.body.lastMathStart, first.index!.body.lastMathStart);
  assert(next.body.futureMath);
  assert(bodyBytes(next) <= 4 * 1024 * 1024);
});

test("end-target reading displays every sentinel after duplicate definition raws", async () => {
  const source =
    "padding paragraph ".repeat(8).concat("\n\n").repeat(8500) +
    "[r]: /u\n[r]: /u\n> quoted line\n\nSECOND-SENTINEL\n\nVISIBLE-SENTINEL\n";
  const f = fake(source);
  const result = await readMessageBody(f.client, f.first, false, {
    targets: { body: Number.MAX_SAFE_INTEGER },
  });
  assert(result.windowed);
  assert(result.body.text.includes("SECOND-SENTINEL"));
  assert(result.body.text.includes("VISIBLE-SENTINEL"));
  assert.equal(result.body.blocks, undefined);
  const rows = new SourceMarkdown(
    result.body.text,
    color,
    result.body.start,
    result.body.prefix,
    result.body,
  ).render(80);
  const visible = rows.lines.map(stripTerminalSequences).join("\n");
  assert(visible.includes("SECOND-SENTINEL"));
  assert(visible.includes("VISIBLE-SENTINEL"));
  assert.equal(
    source.slice(result.body.start, result.body.nextStart),
    result.body.text,
  );
  assert(bodyBytes(result) <= 4 * 1024 * 1024);
  assert(!JSON.stringify(result.index).includes('"token"'));
});
