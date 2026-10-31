import test from "node:test";
import assert from "node:assert/strict";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import {
  DraftEditor,
  parseDraft,
  configureKeys,
} from "../../../src/pi_secretary/src/tui/input.ts";
import {
  plainSnapshot,
  originAt,
  normalizePaste,
} from "../../../src/pi_secretary/src/tui/draft.ts";
const make = () => {
  configureKeys();
  return new DraftEditor(new TuiAltScreen(new VirtualTerminal()), () => "Main");
};
const paste = (e: DraftEditor, value: string) =>
  e.handleInput(`\x1b[200~${value}\x1b[201~`);
const undo = (e: DraftEditor) => e.handleInput("\x1f");

test("30 grapheme threshold, LF/TAB blocks, terminal control removal and lossless payload", () => {
  for (const character of ["a", "中", "e\u0301", "👨‍👩‍👧‍👦", "🇭🇰"])
    for (const count of [0, 1, 29, 30, 31]) {
      const e = make(),
        text = character.repeat(count);
      paste(e, text);
      assert.equal(e.getExpandedText(), text);
      assert.equal(
        e.snapshot().ranges.some((r) => r.block),
        count > 30,
      );
    }
  for (const [input, label, expected] of [
    ["a\tb", "1 line", "a\tb"],
    ["hello\n", "2 lines", "hello\n"],
    ["a\r\nb\r", "3 lines", "a\nb\n"],
  ]) {
    const e = make();
    paste(e, input);
    assert.match(e.getText(), new RegExp(label));
    assert.equal(e.getExpandedText(), expected);
  }
  assert.equal(
    normalizePaste("a\x1b[31mred\x1b[0m\x07\x00\x1b]0;title\x07 b"),
    "ared b",
  );
  const e = make();
  paste(e, "p\u2028q");
  assert.equal(e.getText(), "p\u2028q");
});

test("inline slash provenance survives editing, undo, restore; a typed slash owns command classification", async () => {
  const e = make();
  paste(e, "/he");
  e.handleInput("l");
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(e.isShowingAutocomplete(), false);
  assert.deepEqual(parseDraft(e.snapshot(), "Main"), {
    kind: "send",
    text: "/hel",
  });
  undo(e);
  assert.equal(originAt(e.snapshot(), 0), "paste");
  const saved = e.snapshot();
  const restored = make();
  restored.restore(saved);
  assert.deepEqual(parseDraft(restored.snapshot(), "Main"), {
    kind: "send",
    text: "/he",
  });
  restored.handleInput("\x01");
  restored.handleInput("\x04");
  restored.handleInput("/");
  assert.equal(originAt(restored.snapshot(), 0), "typed");
  const command = make();
  command.handleInput("/");
  paste(command, "help");
  assert.deepEqual(parseDraft(command.snapshot(), "Main"), { kind: "help" });
  assert.equal(parseDraft(command.snapshot(), "Task").kind, "help");
  const migrated = make();
  migrated.restore(plainSnapshot(" /T"));
  migrated.handleInput("\x01");
  migrated.handleInput("\x04");
  assert.equal(parseDraft(migrated.snapshot(), "Main").kind, "error");
});

test("mixed paste and typing expand left-to-right once; literal label text is editable", () => {
  const e = make();
  e.handleInput("A ");
  paste(e, "first\n/T");
  e.handleInput(" B ");
  paste(e, "second\nline");
  e.handleInput(" end");
  assert.equal(e.getExpandedText(), "A first\n/T B second\nline end");
  const first = Object.values(e.snapshot().blocks)[0].label;
  const literal = make();
  paste(literal, "<pasted 1 line ab12cd.txt>");
  literal.handleInput("\x7f");
  assert.equal(literal.getExpandedText(), "<pasted 1 line ab12cd.txt");
  const nested = make();
  paste(nested, first + "\nend");
  assert.equal(nested.getExpandedText(), first + "\nend");
  const raw = make();
  raw.handleInput("/rawmessage ");
  paste(raw, "/T\n/M");
  assert.deepEqual(parseDraft(raw.snapshot(), "Main"), {
    kind: "send",
    text: "/T\n/M",
  });
});

test("owned blocks are atomic for delete, arrows, and whitespace-aware word operations", () => {
  const e = make();
  e.handleInput("abc ");
  paste(e, "a\nb");
  e.handleInput("  ");
  e.handleInput("\x17");
  assert.equal(e.getExpandedText(), "abc ");
  e.handleInput("\x17");
  assert.equal(e.getExpandedText(), "");
  undo(e);
  undo(e);
  assert.equal(e.getExpandedText(), "abc a\nb  ");
  const forward = make();
  forward.handleInput("  ");
  paste(forward, "a\nb");
  forward.handleInput(" abc");
  forward.handleInput("\x01");
  forward.handleInput("\x1bd");
  assert.equal(forward.getExpandedText(), " abc");
  const adjacent = make();
  adjacent.handleInput("xy");
  paste(adjacent, "a\nb");
  adjacent.handleInput("\x17");
  assert.equal(adjacent.getExpandedText(), "xy");
  const arrows = make();
  paste(arrows, "a\nb");
  arrows.handleInput("\x1b[D");
  assert.equal(arrows.getCursor().col, 0);
  arrows.handleInput("\x1b[C");
  assert.equal(arrows.getCursor().col, arrows.getText().length);
  arrows.handleInput("\x7f");
  assert.equal(arrows.getExpandedText(), "");
  undo(arrows);
  assert.equal(arrows.getExpandedText(), "a\nb");
});

test("cursor-anchored edits at matching token boundary characters preserve ownership", () => {
  const e = make();
  paste(e, "one\ntwo");
  e.handleInput("\x01");
  e.handleInput("<");
  assert.equal(e.getExpandedText(), "<one\ntwo");
  e.handleInput("\x05");
  e.handleInput(">");
  assert.equal(e.getExpandedText(), "<one\ntwo>");
  paste(e, "next\nblock");
  e.handleInput("中文");
  assert.equal(e.getExpandedText(), "<one\ntwo>next\nblock中文");
  const short = make();
  paste(short, "abcd");
  short.handleInput("\x1b[D");
  short.handleInput("X");
  assert.equal(originAt(short.snapshot(), 3), "typed");
  assert.equal(originAt(short.snapshot(), 4), "paste");
});

test("rich kill accumulation, duplicate yank, yank-pop and undo retain block and inline provenance", () => {
  const e = make();
  paste(e, "/help");
  e.handleInput(" ");
  paste(e, "a\nb");
  const payload = e.getExpandedText();
  e.handleInput("\x01");
  e.handleInput("\x0b");
  assert.equal(e.getExpandedText(), "");
  e.handleInput("\x19");
  e.handleInput("\x19");
  assert.equal(e.getExpandedText(), payload + payload);
  assert.equal(e.snapshot().ranges.filter((r) => r.block).length, 2);
  assert.equal(originAt(e.snapshot(), 0), "paste");
  undo(e);
  assert.equal(e.getExpandedText(), payload);
  e.handleInput("\x05");
  e.handleInput("\x17");
  e.handleInput("\x17");
  e.handleInput("\x19");
  assert.equal(e.getExpandedText(), payload);
  const cycle = make();
  paste(cycle, "one\nblock");
  cycle.handleInput("\x01");
  cycle.handleInput("\x0b");
  cycle.handleInput("second");
  cycle.handleInput("\x01");
  cycle.handleInput("\x0b");
  cycle.handleInput("\x19");
  cycle.handleInput("\x1by");
  assert.equal(cycle.getExpandedText(), "one\nblock");
  undo(cycle);
  assert.equal(cycle.getExpandedText(), "second");
});

test("same label on another line is literal; narrow wrapping never leaves the cursor inside an owned block", () => {
  const e = make();
  paste(e, "one\ntwo");
  const label = e.getText();
  e.handleInput("\r");
  e.handleInput(label);
  e.handleInput("\x7f");
  assert.equal(e.getExpandedText(), "one\ntwo\n" + label.slice(0, -1));
  for (const width of [4, 8, 12, 80]) {
    e.render(width);
    e.handleInput("\x1b[A");
    assert.equal(!!e.bridge.document.blockAt(e.bridge.offset()), false);
  }
});

test("mouse placement, restore and vertical movement never leave the cursor inside an owned occurrence", () => {
  const e = make();
  paste(e, "owned\npayload");
  const end = e.getText().length;
  e.render(80);
  const click = (x: number) =>
    e.handleMouse({
      type: "click",
      button: "left",
      x,
      y: 1,
      screenX: x,
      screenY: 1,
      width: 80,
      height: 5,
      shift: false,
      alt: false,
      ctrl: false,
    });
  click(2);
  assert.equal(e.getCursor().col, 0);
  e.handleInput("\x1b[C");
  assert.equal(e.getCursor().col, end);
  e.handleInput("\x1b[D");
  assert.equal(e.getCursor().col, 0);
  click(end - 2);
  assert.equal(e.getCursor().col, end);
  const saved = e.snapshot();
  saved.cursor.col = 2;
  e.restore(saved);
  assert.equal(e.getCursor().col, 0);
  e.handleInput("\x1b[3~");
  assert.equal(e.getText(), "");
  undo(e);
  assert.equal(e.getExpandedText(), "owned\npayload");
  const literal = make();
  paste(literal, "<pasted 1 line ab12cd.txt>");
  literal.render(80);
  literal.handleMouse({
    type: "click",
    button: "left",
    x: 2,
    y: 1,
    screenX: 2,
    screenY: 1,
    width: 80,
    height: 5,
    shift: false,
    alt: false,
    ctrl: false,
  });
  assert.equal(literal.getCursor().col, 2);
});
