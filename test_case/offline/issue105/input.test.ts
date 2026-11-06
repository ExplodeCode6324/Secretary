import test from "node:test";
import assert from "node:assert/strict";
import { Text, TuiAltScreen, VStack } from "@earendil-works/pi-tui";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import {
  DocumentView,
  AnchoredScroll,
} from "../../../src/pi_secretary/src/tui/view.ts";
import {
  parseInput,
  DraftEditor,
} from "../../../src/pi_secretary/src/tui/input.ts";
import { originAt } from "../../../src/pi_secretary/src/tui/draft.ts";
const wait = () => new Promise((r) => setTimeout(r, 80));

test("quoted title grammar is exact and completion preserves typed slash without submission", async () => {
  for (const title of ["整理 本周报告", 'a"b\\c', "abc_1", "cafe"]) {
    assert.deepEqual(
      parseInput("/taskdetail " + JSON.stringify(title), "Task"),
      { kind: "taskdetail", id: title, selectorKind: "title" },
    );
  }
  assert.deepEqual(parseInput("/taskdetail --id cafe", "Task"), {
    kind: "taskdetail",
    id: "cafe",
    selectorKind: "id",
  });
  for (const suffix of [
    ' "a\\nb"',
    ' "a" extra',
    ' "unterminated',
    ' "a"\n',
    " a\nb",
    ' "a\tb"',
  ])
    assert.equal(parseInput("/taskdetail" + suffix, "Task").kind, "error");
  const terminal = new VirtualTerminal();
  const tui = new TuiAltScreen(terminal);
  const title = '整理 "报告"\\文件';
  const editor = new DraftEditor(
    tui,
    () => "Task",
    async () => [{ value: JSON.stringify(title), label: title }],
  );
  let submits = 0;
  editor.onExplicitSubmit = () => submits++;
  editor.handleInput("/taskdetail 整");
  await new Promise((r) => setTimeout(r, 350));
  assert(editor.isShowingAutocomplete());
  editor.handleInput("\r");
  assert.equal(editor.getText(), "/taskdetail " + JSON.stringify(title));
  assert.equal(originAt(editor.snapshot(), 0), "typed");
  assert.equal(submits, 0);
  editor.handleInput("\x1b[13;2u");
  assert.equal(submits, 1);
});

test("pinned Pi dispatch requires consumed hotspot press and rejects selection fallback, reflow, wheel, drag, disabled input and resize", async () => {
  const terminal = new VirtualTerminal(30, 8),
    tui = new TuiAltScreen(terminal);
  const doc = new DocumentView(),
    scroll = new AnchoredScroll(doc);
  const opened: string[] = [];
  doc.navigationEnabled = () => true;
  doc.onTaskOpen = (id) => opened.push(id);
  const set = (id: string) => {
    doc.entries = [
      {
        id,
        version: id,
        taskAction: id,
        component: new Text(
          "[详情]\n中文👩‍💻 ordinary selectable text\n" + "正文\n".repeat(20),
          0,
          0,
        ),
      },
    ];
  };
  set("A");
  tui.setLayoutRoot(
    new VStack([{ component: scroll, basis: 0, grow: 1, minSize: 1 }]),
  );
  tui.start();
  await wait();
  const press = (x = 1, y = 1, code = 0) =>
    terminal.sendInput(`\x1b[<${code};${x};${y}M`);
  const release = (x = 1, y = 1, code = 0) =>
    terminal.sendInput(`\x1b[<${code};${x};${y}m`);
  try {
    press();
    release();
    await wait();
    assert.deepEqual(opened, ["A"]);
    // Let click counter reset before the next independent gesture.
    await new Promise((r) => setTimeout(r, 550));
    press(15, 2);
    set("B");
    tui.requestRender();
    await wait();
    release(1, 1);
    await wait();
    assert.deepEqual(opened, ["A"]);
    press();
    set("C");
    tui.requestRender();
    await wait();
    release();
    assert.deepEqual(opened, ["A"]);
    press();
    terminal.sendInput("\x1b[<32;12;2M");
    release(12, 2);
    assert.deepEqual(opened, ["A"]);
    press();
    terminal.sendInput("\x1b[<65;1;1M");
    release();
    await wait();
    assert.deepEqual(opened, ["A"]);
    scroll.scrollTo(0);
    tui.requestRender();
    await wait();
    press();
    terminal.resize(20, 8);
    await wait();
    release();
    assert.deepEqual(opened, ["A"]);
    doc.navigationEnabled = () => false;
    press();
    release();
    assert.deepEqual(opened, ["A"]);
  } finally {
    await tui.stop();
  }
});
