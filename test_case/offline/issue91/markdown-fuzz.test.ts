import test from "node:test";
import assert from "node:assert/strict";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  BlockStream,
  WindowStream,
  type MarkdownWindow,
  type SourcePiece,
} from "../../../src/pi_secretary/src/tui/markdown-window.ts";
import { markdownParser } from "../../../src/pi_secretary/src/tui/markdown-lexer.ts";
import {
  markdownTheme,
  SourceMarkdown,
} from "../../../src/pi_secretary/src/tui/view.ts";

const plain = [
  "[r]: /u\n",
  "[r]: /u\n[r]: /u\n",
  "[r]\n",
  "$$$$\n",
  "first line\n",
  "second line\n",
  "|---|---|\n",
  "| a | b |\n",
  "===\n",
  "---\n",
  "\n",
  " \n",
  "```\n",
  "~~~\n",
  "> quote\n",
  "- item\n",
  "  continued\n",
  "    code\n",
];
const math = [
  "$$\n",
  "$$ $$\n",
  "\\[\n",
  "\\]\n",
  "$x$\n",
  "\\(y\\)\n",
  "x^2\n",
];
function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}
function spans(source: string) {
  let at = 0;
  const result = [];
  for (const token of markdownParser.lexer(source)) {
    const start = source.indexOf(token.raw, at);
    if (start < 0) return undefined;
    at = start + token.raw.length;
    result.push({ start, end: at, token });
  }
  return result;
}
for (const [seed, withMath] of [
  [21, false],
  [22, false],
  [1, true],
  [2, true],
  [3, true],
] as const) {
  test(`seeded every-split block/source parity (seed ${seed}, math ${withMath})`, (t) => {
    const next = random(seed),
      vocabulary = withMath ? [...plain, ...math] : plain;
    let splits = 0;
    for (let document = 0; document < 500; document++) {
      const source = Array.from(
        { length: 2 + Math.floor(next() * 8) },
        () => vocabulary[Math.floor(next() * vocabulary.length)],
      ).join("");
      const blocks = spans(source),
        ends = new Set([source.length, ...(blocks ?? []).map((b) => b.end)]);
      for (let split = 1; split < source.length; split++) {
        const pieces: SourcePiece[] = [],
          p = new BlockStream((value) => pieces.push(value), 0, 1024 * 1024, 1);
        p.feed(source.slice(0, split));
        p.feed(source.slice(split));
        p.finish();
        splits++;
        assert.equal(pieces.map((piece) => piece.text).join(""), source);
        for (const piece of pieces) {
          const end = piece.start + piece.text.length;
          assert(
            !blocks || ends.has(end),
            JSON.stringify({
              seed,
              document,
              split,
              end,
              source,
              blocks,
              pieces,
            }),
          );
        }
      }
      const windows: MarkdownWindow[] = [],
        stream = new WindowStream(
          0,
          (window) => windows.push(window),
          0,
          0,
          1024 * 1024,
          9,
        );
      for (let at = 0; at < source.length; at += 3)
        stream.feed(source.slice(at, at + 3));
      stream.finish();
      const visible = (lines: string[]) =>
        lines
          .map(stripTerminalSequences)
          .map((line) => line.trimEnd())
          .filter(Boolean);
      let actual: string[];
      try {
        actual = windows.flatMap((window) =>
          visible(
            new SourceMarkdown(window.text, undefined, window.start, "", {
              definitions: stream.parser.definitions.text,
              suffix: "",
              code: false,
              contextBoundary: false,
              futureMath: stream.parser.lastMathStart >= window.nextStart,
              lastMathStart: stream.parser.lastMathStart,
              blocks: window.blocks,
            }).render(24).lines,
          ),
        );
      } catch (error) {
        throw new Error(
          JSON.stringify({
            seed,
            document,
            source,
            windows,
            lastMathStart: stream.parser.lastMathStart,
          }),
          { cause: error },
        );
      }
      const expected = visible(
        new Markdown(source, 0, 0, markdownTheme, {
          color: (value) => "\x1b[37m" + value + "\x1b[0m",
        }).render(24),
      );
      // Window-edge blank spacing is excluded here; the dedicated forward-math
      // regression below compares interior blank rows exactly, at three widths.
      assert.deepEqual(
        actual,
        expected,
        JSON.stringify({ seed, document, source, windows }),
      );
    }
    t.diagnostic(JSON.stringify({ seed, documents: 500, splits }));
  });
}

test("forward-math context preserves interior blank-row parity and preserves parsed tokens without synthetic source", () => {
  const prefix = "first line\nsecond line\n|---|---|\n\nlater para\n";
  const render = (source: string) =>
    new Markdown(source, 0, 0, markdownTheme)
      .render(80)
      .map(stripTerminalSequences)
      .map((line) => line.trimEnd());
  const separate = render(prefix),
    whole = render(prefix + "\n$$ $$\nx\n");
  assert.equal(separate[0], "first line");
  assert.equal(separate[1], "");
  assert.equal(separate[2], "second line");
  assert.equal(whole[0], "first line");
  assert.equal(whole[1], "second line");
  assert.deepEqual(
    separate.filter(Boolean),
    whole.filter(Boolean).slice(0, separate.filter(Boolean).length),
  );
  const stream = new WindowStream(0, () => {}, 0, 0, 1024 * 1024, 9);
  stream.feed(prefix);
  stream.finish();
  const pieces: SourcePiece[] = [];
  const parser = new BlockStream((p) => pieces.push(p));
  parser.feed(prefix);
  parser.finish();
  for (const width of [1, 8, 80]) {
    const mapped = new SourceMarkdown(prefix, undefined, 0, "", {
      definitions: "",
      suffix: "",
      code: false,
      contextBoundary: false,
      futureMath: true,
      lastMathStart: prefix.length + 1,
      blocks: pieces.flatMap((p) => p.blocks ?? []),
    }).render(width);
    const expected = new Markdown(
      prefix + "\n$$ $$\nx\n",
      0,
      0,
      markdownTheme,
      { color: (value) => "\x1b[37m" + value + "\x1b[0m" },
    )
      .render(width)
      .map(stripTerminalSequences)
      .map((line) => line.trimEnd());
    const actual = mapped.lines
      .map(stripTerminalSequences)
      .map((line) => line.trimEnd());
    assert.deepEqual(actual, expected.slice(0, actual.length));
    assert.deepEqual(
      actual.filter(Boolean).join("").replaceAll(" ", ""),
      "firstlinesecondline|---|---|laterpara",
    );
    assert.equal(mapped.rows.length, actual.length);
  }
});

test("parsed windows retain forward references and nested/table/code semantics at narrow widths", () => {
  const cases = [
    'See [future][target].\n\n> quote [future][target]\n\n- one [future][target]\n- **two**\n\n[target]: https://example.test/path "Title"\n',
    "| head | ref |\n|---|---|\n| *a* | [r][target] |\n\n[target]: https://example.test\n",
    "first line\n    code\nfirst line\n    code\n---\n\n",
    "---\n---\n  continued\n    code\nsecond line\n$$ $$\n \n$$\n$$ $$\n",
    "## heading **bold**\n\n```ts\nconst a = 1;\n``\n",
    "- outer\n  - nested\n\n> quote\n>\n> more\n\n\\[\nx^2\n\\]\n",
    "A\tTAB and \x1b[31mred\x1b[0m\n\n---\n",
  ];
  for (const source of cases) {
    const windows: MarkdownWindow[] = [];
    const stream = new WindowStream(
      0,
      (w) => windows.push(w),
      0,
      0,
      1024 * 1024,
      9,
    );
    for (let at = 0; at < source.length; at += 3)
      stream.feed(source.slice(at, at + 3));
    stream.finish();
    for (const width of [1, 8, 24, 80]) {
      const visible = (lines: string[]) =>
        lines
          .map(stripTerminalSequences)
          .map((line) => line.trimEnd())
          .filter(Boolean);
      const actual = windows.flatMap((window) =>
        visible(
          new SourceMarkdown(window.text, undefined, window.start, "", {
            definitions: stream.parser.definitions.text,
            suffix: "",
            code: false,
            contextBoundary: false,
            blocks: window.blocks,
            lastMathStart: stream.parser.lastMathStart,
          }).render(width).lines,
        ),
      );
      const expected = visible(
        new Markdown(stripTerminalSequences(source), 0, 0, markdownTheme, {
          color: (v) => "\x1b[37m" + v + "\x1b[0m",
        }).render(width),
      );
      assert.deepEqual(actual, expected, JSON.stringify({ source, width }));
    }
  }
});

test("unlocatable token raws never suppress window content at any split", () => {
  const corpus = [
    "$$$$\n\nVISIBLE-SENTINEL\n",
    "[r]: /u\n[r]: /u\n> quoted line\n\nSECOND-SENTINEL\n\nVISIBLE-SENTINEL\n",
    "safe paragraph\n\n[r]: /u\n[r]: /u\n> quote\n\nVISIBLE-SENTINEL\n",
  ];
  let fallback = 0;
  for (const source of corpus)
    for (let split = 1; split < source.length; split++) {
      const windows: MarkdownWindow[] = [];
      const stream = new WindowStream(
        0,
        (w) => windows.push(w),
        0,
        0,
        1024 * 1024,
        1,
      );
      stream.feed(source.slice(0, split));
      stream.feed(source.slice(split));
      stream.finish();
      assert.equal(windows.map((w) => w.text).join(""), source);
      fallback += windows.filter((w) => w.blocks === undefined).length;
      for (const width of [8, 40]) {
        const clean = (rows: string[]) =>
          rows
            .map(stripTerminalSequences)
            .map((s) => s.trimEnd())
            .filter(Boolean);
        const actual = windows.flatMap((w) =>
          clean(
            new SourceMarkdown(w.text, undefined, w.start, "", {
              definitions: stream.parser.definitions.text,
              suffix: "",
              code: false,
              contextBoundary: false,
              blocks: w.blocks,
              lastMathStart: stream.parser.lastMathStart,
              futureMath: stream.parser.lastMathStart >= w.nextStart,
            }).render(width).lines,
          ),
        );
        const expected = clean(
          new Markdown(source, 0, 0, markdownTheme, {
            color: (v) => "\x1b[37m" + v + "\x1b[0m",
          }).render(width),
        );
        assert.deepEqual(
          actual,
          expected,
          JSON.stringify({ source, split, width }),
        );
        assert(actual.join("").includes("VISIBLE-SENTINEL"));
      }
    }
  assert(fallback > 0);
});

test("whole-window token fallback preserves future-math interior blank rows", () => {
  const source =
    "[r]: /u\n[r]: /u\nfirst line\nsecond line\n|---|---|\n\nlater para\n";
  for (const width of [8, 40]) {
    const actual = new SourceMarkdown(source, undefined, 0, "", {
      definitions: "[r]: /u\n",
      suffix: "",
      code: false,
      contextBoundary: false,
      lastMathStart: source.length + 1,
      futureMath: true,
    }).render(width);
    const expected = new Markdown(
      source + "\n$$ $$\nx\n",
      0,
      0,
      markdownTheme,
      { color: (v) => "\x1b[37m" + v + "\x1b[0m" },
    ).render(width);
    assert.deepEqual(actual.lines, expected.slice(0, actual.lines.length));
    assert(actual.rows.every((row) => row.block_start_utf16 === 0));
    assert.equal(
      new Set(
        actual.rows.map(
          (row) => `${row.block_start_utf16}:${row.row_in_block}`,
        ),
      ).size,
      actual.rows.length,
    );
  }
});
