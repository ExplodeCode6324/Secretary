import test from "node:test";
import assert from "node:assert/strict";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { DraftEditor } from "../../../src/pi_secretary/src/tui/input.ts";
import { originAt } from "../../../src/pi_secretary/src/tui/draft.ts";
import { Fixture, until } from "../issue9/helpers.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import fs from "node:fs/promises";
import path from "node:path";

const pause = () => new Promise((r) => setTimeout(r, 20));
async function type(editor: DraftEditor, text: string) {
  for (const char of text) {
    editor.handleInput(char);
    await pause();
  }
}
const titles = ["整理 本周报告", "整理 本周报告_1"];
test("paced title entry keeps the first CJK prefix and arrow selection alive; completion never submits", async () => {
  const editor = new DraftEditor(
    new TuiAltScreen(new VirtualTerminal()),
    () => "Task",
    async (prefix) =>
      titles
        .filter((t) => t.startsWith(prefix))
        .map((t) => ({ value: JSON.stringify(t), label: t })),
  );
  let submitted = 0;
  editor.onExplicitSubmit = () => submitted++;
  await type(editor, "/taskdetail ");
  editor.handleInput("整");
  await pause();
  assert(
    editor.isShowingAutocomplete(),
    "single CJK prefix must open the menu",
  );
  editor.handleInput("理");
  await pause();
  assert(editor.isShowingAutocomplete());
  editor.handleInput("\x1b[B");
  assert(editor.isShowingAutocomplete(), "Down must keep the menu open");
  editor.handleInput("\x1b[A");
  assert(editor.isShowingAutocomplete(), "Up must keep the menu open");
  editor.handleInput("\x1b[B");
  editor.handleInput("\r");
  assert.equal(editor.getText(), '/taskdetail "整理 本周报告_1"');
  assert.equal(editor.isShowingAutocomplete(), false);
  assert.equal(originAt(editor.snapshot(), 0), "typed");
  assert.equal(submitted, 0);
  editor.handleInput("\x1b[13;2u");
  assert.equal(submitted, 1);
});

test("follow arguments open on the separator and after command completion; Esc and explicit Tab remain local", async () => {
  const eid = "11111111-1111-4111-8111-111111111111";
  const editor = new DraftEditor(
    new TuiAltScreen(new VirtualTerminal()),
    () => "Task",
    async (prefix, command) =>
      command === "follow"
        ? [
            { value: "off", label: "off" },
            { value: eid, label: "第 7 次 · SUCCEEDED" },
          ].filter((v) => v.value.startsWith(prefix))
        : [],
    () => true,
  );
  let submitted = 0;
  editor.onExplicitSubmit = () => submitted++;
  await type(editor, "/follow ");
  assert(editor.isShowingAutocomplete(), "space must request follow arguments");
  editor.handleInput("\x1b");
  assert.equal(editor.isShowingAutocomplete(), false);
  editor.handleInput("\t");
  await pause();
  assert(editor.isShowingAutocomplete(), "Tab must reopen argument completion");
  editor.handleInput("\x1b[B");
  assert(editor.isShowingAutocomplete());
  editor.handleInput("\t");
  assert.equal(editor.getText(), "/follow " + eid);
  assert.equal(editor.isShowingAutocomplete(), false);
  assert.equal(submitted, 0);
  editor.clearInput();
  await type(editor, "/fol");
  editor.handleInput("\t");
  await pause();
  assert.equal(editor.getText(), "/follow ");
  assert(
    editor.isShowingAutocomplete(),
    "accepting /follow must offer its arguments",
  );
  editor.handleInput("\x1b[B");
  editor.handleInput("\r");
  assert.equal(editor.getText(), "/follow " + eid);
  assert.equal(submitted, 0);
});

test("actual TerminalApp routes title and follow picker arrows to the editor without navigation or submission", async () => {
  const f = new Fixture();
  await f.open();
  let ui: TerminalApp | undefined;
  try {
    const p = f.app.scheduler.propose(
      "completion fixture",
      id(),
      f.app.host.sessionID,
      { title_candidate: titles[0] },
    );
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const duplicate = f.app.scheduler.propose(
      "later",
      id(),
      f.app.host.sessionID,
      { title_candidate: titles[0], at: "2099-01-01T00:00:00.000Z" },
    );
    await fs.writeFile(
      path.join(f.dir, "core-endpoint.json"),
      JSON.stringify(f.server.endpoint),
      { mode: 0o600 },
    );
    const terminal = new VirtualTerminal(100, 30);
    ui = new TerminalApp(f.dir, terminal, path.join(f.dir, "tui-state"));
    ui.start();
    await until(
      () => !!ui?.remote?.attention.head && !!ui?.editors.Main.enabled,
    );
    terminal.sendInput("/t");
    terminal.sendInput("\x1b[13;2u");
    await until(
      () => !!ui?.remote?.taskBrowser.root && !!ui?.editors.Task.enabled,
    );
    const editor = ui.editors.Task;
    for (const char of "/taskdetail 整") {
      terminal.sendInput(char);
      await pause();
    }
    await until(() => editor.isShowingAutocomplete());
    terminal.sendInput("\x1b[B");
    assert(editor.isShowingAutocomplete());
    terminal.sendInput("\r");
    assert.equal(editor.getText(), '/taskdetail "整理 本周报告_1"');
    assert.equal(ui.remote?.taskBrowser.selected, undefined);
    terminal.sendInput("\x1b[13;2u");
    await until(() => ui?.remote?.taskBrowser.selected === duplicate.id);
    terminal.sendInput('/taskdetail "整理 本周报告"');
    terminal.sendInput("\x1b[13;2u");
    await until(() => ui?.remote?.taskBrowser.selected === p.id);
    for (const char of "/follow ") {
      terminal.sendInput(char);
      await pause();
    }
    await until(() => editor.isShowingAutocomplete());
    terminal.sendInput("\x1b[B");
    assert(editor.isShowingAutocomplete());
    terminal.sendInput("\t");
    assert.match(editor.getText(), /^\/follow [0-9a-f-]{36}$/);
    assert.equal(ui.remote?.taskBrowser.selected, p.id);
    assert.equal(ui.remote?.taskBrowser.followTarget, undefined);
    terminal.sendInput("\x03");
    for (const char of "/taskdetail ") {
      terminal.sendInput(char);
      await pause();
    }
    terminal.sendInput("整理");
    await until(() => editor.isShowingAutocomplete());
    terminal.sendInput("\x1b[B");
    assert(editor.isShowingAutocomplete());
    terminal.sendInput("\x1b");
    assert.equal(editor.isShowingAutocomplete(), false);
    assert.equal(
      ui.remote?.taskBrowser.selected,
      p.id,
      "first Esc only dismisses the picker",
    );
    assert.equal(editor.getText(), "/taskdetail 整理");
  } finally {
    await ui?.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});

test("pasted slash, wrong page and stale page changes cannot open an argument picker", async () => {
  let page: "Main" | "Task" = "Task",
    detail = false,
    calls = 0;
  let resolve!: (items: string[]) => void;
  const editor = new DraftEditor(
    new TuiAltScreen(new VirtualTerminal()),
    () => page,
    async () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
    () => detail,
  );
  editor.handleInput("\x1b[200~/taskdetail 整\x1b[201~");
  editor.handleInput("\t");
  await pause();
  assert.equal(calls, 0);
  assert.equal(editor.isShowingAutocomplete(), false);
  editor.clearInput();
  await type(editor, "/follow ");
  assert.equal(calls, 0);
  editor.clearInput();
  page = "Main";
  await type(editor, "/taskdetail 整");
  assert.equal(calls, 0);
  editor.clearInput();
  page = "Task";
  detail = true;
  editor.handleInput("/taskdetail 整");
  await pause();
  assert(calls > 0);
  page = "Main";
  resolve([JSON.stringify(titles[0])]);
  await pause();
  assert.equal(editor.isShowingAutocomplete(), false);
});
