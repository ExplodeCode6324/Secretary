import test from "node:test";
import assert from "node:assert/strict";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import {
  DraftEditor,
  parseInput,
  parseDraft,
  commandCompletion,
} from "../../../src/pi_secretary/src/tui/input.ts";
import { originAt } from "../../../src/pi_secretary/src/tui/draft.ts";
import { parseGuide } from "../../../src/pi_secretary/src/tui/guide-command.ts";
const wait = () => new Promise((r) => setTimeout(r, 180));
test("guide grammar preserves body bytes, normalizes only title, rejects ambiguous separators and oversize", () => {
  const body = " \t中文👩‍💻e\u0301\u00a0\u2028\n$HOME `literal` \\ trailing  \n";
  assert.deepEqual(
    parseInput('/GuIdE "cafe\u0301 \\"x\\"" 3 ' + body, "Task"),
    { kind: "guide", title: 'café "x"', round: 3, text: body },
  );
  for (const bad of [
    "/guide  x 1 body",
    "/guide x 01 body",
    "/guide x 0 body",
    "/guide x -1 body",
    "/guide x 1.0 body",
    "/guide x 1e2 body",
    "/guide x ９ body",
    "/guide　x 1 body",
    "/guide x　1 body",
    "/guide x 1　body",
    "/guide “quoted title” 1 body",
    "/guide x 9007199254740992 body",
    "/guide x 1\nbody",
    "/guide x 1 \n\t",
    "/guide --id abc 1 body",
    '/guide "bad\\n" 1 body',
    "/guide x 1 \ud800",
  ])
    assert.equal(parseInput(bad, "Task").kind, "error", bad);
  assert.equal(
    parseGuide("/guide x 1 " + "界".repeat(5461) + "x")!.text.length,
    5462,
  );
  assert.equal(parseGuide("/guide x 1 " + "界".repeat(5461) + "xx"), undefined);
  assert.equal(parseInput("/guide x 1 body", "Main").kind, "error");
  const bad = parseInput("/guide x 1\nbody", "Task");
  assert(bad.kind === "error");
  assert.match(bad.message, /不能直接换行/);
  assert.match(bad.message, /ASCII/);
  assert.match(bad.message, /无前导零/);
});
test("real editor ingestion provenance and multiple paste blocks: only typed slash dispatches", () => {
  const e = new DraftEditor(
    new TuiAltScreen(new VirtualTerminal()),
    () => "Task",
  );
  e.handleInput("\x1b[200~/guide x 1 body\x1b[201~");
  assert.equal(parseDraft(e.snapshot(), "Task").kind, "draft");
  e.clearInput();
  e.handleInput("/");
  e.handleInput("\x1b[200~guide x 1 \tA\r\nB\rC\x1b[31m\x1b[201~");
  e.handleInput("\x1b[200~\n" + "中".repeat(800) + "  \x1b[201~");
  const action = parseDraft(e.snapshot(), "Task");
  assert.equal(action.kind, "guide");
  if (action.kind === "guide")
    assert.equal(action.text, "\tA\nB\nC\n" + "中".repeat(800) + "  ");
  assert.equal(originAt(e.snapshot(), 0), "typed");
});
test("completion replaces only exact header token; multiline and trailing body survive", async () => {
  const text = '/guide "old" 2 first\nsecond  ';
  const c = commandCompletion(
    () => "Task",
    () => true,
    undefined,
    async () => ['"new title"'],
    (t) => t === text,
  );
  const suggestions = await c.getSuggestions(text.split("\n"), 0, 10, {
    signal: new AbortController().signal,
  });
  assert(suggestions);
  const result = c.applyCompletion(
    text.split("\n"),
    0,
    10,
    suggestions.items[0],
    suggestions.prefix,
  );
  assert.equal(result.lines.join("\n"), '/guide "new title" 2 first\nsecond  ');
  assert.equal(
    await c.getSuggestions(text.split("\n"), 0, 18, {
      signal: new AbortController().signal,
    }),
    null,
  );
});
test("paced title/round completion preserves provenance, accepts without send, Shift Enter submits multiline", async () => {
  const e = new DraftEditor(
    new TuiAltScreen(new VirtualTerminal()),
    () => "Task",
    async (_, command) =>
      command === "guide-round"
        ? [{ value: "2", label: "#2 WAIT_AUTH" }]
        : [{ value: '"整理 报告"', label: "整理 报告" }],
  );
  let submits = 0;
  e.onExplicitSubmit = () => submits++;
  for (const c of "/guide 整") {
    e.handleInput(c);
    await wait();
  }
  assert(e.isShowingAutocomplete());
  e.handleInput("\t");
  assert.equal(e.getText(), '/guide "整理 报告"');
  e.handleInput(" ");
  await wait();
  assert(e.isShowingAutocomplete());
  e.handleInput("\r");
  assert.equal(e.getText(), '/guide "整理 报告" 2');
  e.handleInput(" ");
  e.handleInput("\x1b[200~保留\n多行  \x1b[201~");
  e.handleInput("\x1b[13;2u");
  assert.equal(submits, 1);
  assert.equal(originAt(e.snapshot(), 0), "typed");
  assert.equal(parseDraft(e.snapshot(), "Task").kind, "guide");
});

test("damaged paste with an open picker submits a local error without throwing on either page", async () => {
  for (const page of ["Main", "Task"] as const) {
    const e = new DraftEditor(
      new TuiAltScreen(new VirtualTerminal()),
      () => page,
    );
    e.handleInput("/guide x 1 ");
    e.handleInput("\x1b[200~first\nsecond\x1b[201~");
    // Model a partial label edit, preserving the actual pasted payload and provenance.
    const damaged = { ...e.snapshot(), damaged: true };
    e.restore(damaged);
    e.isShowingAutocomplete = () => true;
    let action: ReturnType<typeof parseDraft> | undefined;
    e.onExplicitSubmit = (_, snapshot) => {
      assert(snapshot);
      action = parseDraft(snapshot, page);
    };
    assert.doesNotThrow(() => e.handleInput("\x1b[13;2u"));
    assert.equal(action?.kind, "error");
    if (action?.kind === "error")
      assert.match(action.message, /PASTE_BLOCK_DAMAGED/);
    assert.equal(e.snapshot().damaged, true);
  }
});
test("unfinished title with a suffix cannot consume that suffix during completion", async () => {
  const text = '/guide "old 1 preserved body';
  const c = commandCompletion(
    () => "Task",
    () => true,
    undefined,
    async () => ['"replacement"'],
    () => true,
  );
  assert.equal(
    await c.getSuggestions([text], 0, 10, {
      signal: new AbortController().signal,
    }),
    null,
  );
});
