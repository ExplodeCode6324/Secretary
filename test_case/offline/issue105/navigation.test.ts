import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Fixture, until } from "../issue9/helpers.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
const submit = "\x1b[13;2u";
test("real TerminalApp click and Esc keep rich draft/anchor; completion owns Esc and navigation has no business writes", async () => {
  const f = new Fixture();
  await f.open();
  let ui: TerminalApp | undefined;
  try {
    const p = f.app.scheduler.propose(
      "保留原目标 中文👩‍💻",
      id(),
      f.app.host.sessionID,
      { title_candidate: "整理 本周报告", at: "2099-01-01T00:00:00.000Z" },
    );
    await fs.writeFile(
      path.join(f.dir, "core-endpoint.json"),
      JSON.stringify(f.server.endpoint),
      { mode: 0o600 },
    );
    const terminal = new VirtualTerminal(90, 28);
    ui = new TerminalApp(f.dir, terminal, path.join(f.dir, "tui-state"));
    ui.start();
    await until(
      () => !!ui?.remote?.attention.head && !!ui?.editors.Main.enabled,
      5000,
    );
    terminal.sendInput("/t");
    terminal.sendInput(submit);
    await until(
      () => !!ui?.remote?.taskBrowser.root && !!ui?.editors.Task.enabled,
      5000,
    );
    terminal.sendInput(
      "\x1b[200~draft /literal\n中文👩‍💻".repeat(1) + "\x1b[201~",
    );
    const saved = ui.editors.Task.snapshot();
    const seq = f.app.store.sequence;
    await terminal.waitForRender();
    const viewport = terminal.getViewport();
    const row = viewport.findIndex((l) => l.includes("[详情]"));
    assert(row >= 0, viewport.join("\n"));
    const col = viewport[row].indexOf("[详情]") + 1;
    terminal.sendInput(`\x1b[<0;${col};${row + 1}M`);
    terminal.sendInput(`\x1b[<0;${col};${row + 1}m`);
    await until(() => ui?.remote?.taskBrowser.selected === p.id);
    assert.deepEqual(ui.editors.Task.snapshot(), saved);
    terminal.sendInput("\x1b[5~");
    terminal.sendInput("\x1b");
    await until(() => !ui?.remote?.taskBrowser.selected);
    assert.deepEqual(ui.editors.Task.snapshot(), saved);
    assert.equal(f.app.store.sequence, seq);
    terminal.sendInput("\x03");
    terminal.sendInput("/taskdetail 整理");
    await until(() => !!ui?.editors.Task.isShowingAutocomplete());
    terminal.sendInput("\x1b");
    assert.equal(ui.editors.Task.isShowingAutocomplete(), false);
    assert.equal(ui.remote?.taskBrowser.selected, undefined);
  } finally {
    await ui?.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
