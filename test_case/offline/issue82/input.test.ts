import test from "node:test";
import assert from "node:assert/strict";
import { TuiAltScreen, StdinBuffer } from "@earendil-works/pi-tui";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import {
  DraftEditor,
  parseInput,
  commandCompletion,
  configureKeys,
} from "../../../src/pi_secretary/src/tui/input.ts";

test("raw-first-character routing, literal payloads and Task isolation", () => {
  assert.deepEqual(parseInput("  /T", "Main"), { kind: "send", text: "  /T" });
  assert.deepEqual(parseInput("body\n/T", "Main"), {
    kind: "send",
    text: "body\n/T",
  });
  assert.deepEqual(parseInput("/t ", "Main"), {
    kind: "navigate",
    page: "Task",
  });
  assert.deepEqual(parseInput("/rawmessage /T", "Main"), {
    kind: "send",
    text: "/T",
  });
  assert.deepEqual(parseInput("/send  A\n/T", "Main"), {
    kind: "send",
    text: " A\n/T",
  });
  for (const raw of ["/send hi", "/rawmessage /T"])
    assert.equal(parseInput(raw, "Task").kind, "error");
  assert.equal(parseInput("ordinary\n/M", "Task").kind, "draft");
  for (const raw of ["/T\n/M", "/T; /M", "/T x", "/send", "/bogus"])
    assert.equal(parseInput(raw, "Main").kind, "error");
});
test("custom completion never offers paths, leading-space commands or wrong scope", async () => {
  const p = commandCompletion(() => "Task"),
    opts = { signal: new AbortController().signal };
  for (const [s, col] of [
    ["  /T", 4],
    ["some /T", 7],
    ["/send hi", 8],
    ["/tmp/a", 6],
  ] as const)
    assert.equal(await p.getSuggestions([s], 0, col, opts), null);
  assert.equal(p.shouldTriggerFileCompletion?.(["a"], 0, 1), false);
  const list = await p.getSuggestions(["/"], 0, 1, opts);
  assert.deepEqual(
    list?.items.map((x) => x.value),
    ["/M", "/T", "/back", "/help"],
  );
});
test("actual Pi Editor: completion Enter cannot submit, errors preserve cursor and undo, raw whitespace preserved", async () => {
  configureKeys();
  const terminal = new VirtualTerminal(),
    tui = new TuiAltScreen(terminal),
    editor = new DraftEditor(tui, () => "Main");
  const sent: string[] = [];
  editor.onExplicitSubmit = (s) => sent.push(s);
  editor.handleInput("/b");
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(editor.isShowingAutocomplete(), true);
  editor.handleInput("\r");
  assert.deepEqual(sent, []);
  assert.equal(editor.getExpandedText(), "/back ");
  editor.handleInput("\x1b[13;2u");
  assert.deepEqual(sent, ["/back "]);
  editor.setText("  /T");
  const cursor = editor.getCursor();
  editor.handleInput("\x1b[13;2u");
  assert.equal(sent.at(-1), "  /T");
  assert.deepEqual(editor.getCursor(), cursor);
  editor.setText("first");
  const count = sent.length;
  editor.handleInput("\r");
  editor.handleInput("second");
  assert.equal(editor.getExpandedText(), "first\nsecond");
  assert.equal(sent.length, count);
  editor.handleInput("\x1b[13;2u");
  assert.equal(sent.at(-1), "first\nsecond");
  editor.setText("line");
  const sentBefore = sent.length;
  editor.handleInput("\n");
  assert.equal(editor.getExpandedText(), "line\n");
  assert.equal(sent.length, sentBefore);
  editor.setText("abc\\");
  editor.handleInput("\r");
  assert.equal(editor.getExpandedText(), "abc\\\n");
  editor.setText("keep");
  editor.handleInput("!");
  editor.handleInput("\x1b[13;2u");
  editor.handleInput("\x1f");
  assert.equal(editor.getExpandedText(), "keep");
});
test("upstream StdinBuffer assembles split paste; embedded newline/slash never submit", () => {
  const terminal = new VirtualTerminal(),
    tui = new TuiAltScreen(terminal),
    editor = new DraftEditor(tui, () => "Main");
  let submits = 0;
  editor.onExplicitSubmit = () => submits++;
  const buffer = new StdinBuffer();
  buffer.on("paste", (content) =>
    editor.handleInput(`\x1b[200~${content}\x1b[201~`),
  );
  buffer.on("data", (data) => editor.handleInput(data));
  buffer.process("\x1b[200~line\n/");
  buffer.process("T\nlast\x1b[201~");
  assert.equal(submits, 0);
  assert.equal(editor.getExpandedText(), "line\n/T\nlast");
  buffer.destroy();
});

test("Shift+Enter with an open completion menu only completes; Enter never sends after completion", async () => {
  const tui = new TuiAltScreen(new VirtualTerminal()),
    editor = new DraftEditor(tui, () => "Main");
  const sent: string[] = [];
  editor.onExplicitSubmit = (raw) => sent.push(raw);
  editor.handleInput("/b");
  await new Promise((r) => setTimeout(r, 350));
  assert(editor.isShowingAutocomplete());
  editor.handleInput("\x1b[13;2u");
  assert.equal(editor.getExpandedText(), "/back ");
  assert.deepEqual(sent, []);
  editor.handleInput("\r");
  assert.equal(editor.getExpandedText(), "/back \n");
  assert.deepEqual(sent, []);
});

test("Shift+Enter supports xterm modified keys while plain Enter and Cmd+Enter never send", () => {
  const editor = new DraftEditor(
    new TuiAltScreen(new VirtualTerminal()),
    () => "Main",
  );
  const sent: string[] = [];
  editor.onExplicitSubmit = (raw) => sent.push(raw);
  editor.setText("first");
  editor.handleInput("\r");
  editor.handleInput("second");
  editor.handleInput("\x1b[27;2;13~");
  assert.deepEqual(sent, ["first\nsecond"]);
  editor.handleInput("\x1b[13;9u");
  assert.equal(sent.length, 1);
});

test("complete local commands submit once without a trailing space; an older slash menu cannot intercept", async () => {
  for (const raw of ["/T", "/m", "/help", "/back"]) {
    const editor = new DraftEditor(
      new TuiAltScreen(new VirtualTerminal()),
      () => "Main",
    );
    const sent: string[] = [];
    editor.onExplicitSubmit = (s) => sent.push(s);
    editor.handleInput(raw);
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(editor.isShowingAutocomplete(), false);
    editor.handleInput("\x1b[13;2u");
    assert.deepEqual(sent, [raw]);
  }
  const editor = new DraftEditor(
    new TuiAltScreen(new VirtualTerminal()),
    () => "Main",
  );
  const sent: string[] = [];
  editor.onExplicitSubmit = (s) => sent.push(s);
  editor.handleInput("/");
  await new Promise((r) => setTimeout(r, 350));
  assert(editor.isShowingAutocomplete());
  editor.handleInput("T");
  editor.handleInput("\x1b[13;2u");
  assert.deepEqual(sent, ["/T"]);
});
