import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Fixture, until } from "../issue9/helpers.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import type { Input } from "../../../src/pi_secretary/src/contracts.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";

const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
function seed(f: Fixture, count: number, label: string) {
  f.app.store.commit(
    [],
    Array.from({ length: count }, (_, i) =>
      f.app.store.event(
        "main.message",
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `${label} ${i}\n\n${"Reading row.\n".repeat(8)}`,
            },
          ],
          stopReason: "stop",
        },
        { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
      ),
    ),
  );
}
async function setup(
  count = 40,
  copy?: (text: string) => Promise<boolean | string>,
) {
  const f = new Fixture();
  await f.open();
  seed(f, count, "old");
  await fs.writeFile(
    path.join(f.dir, "core-endpoint.json"),
    JSON.stringify(f.server.endpoint),
    { mode: 0o600 },
  );
  const terminal = new VirtualTerminal(80, 24),
    state = path.join(f.dir, "native-follow-state");
  const ui = new TerminalApp(f.dir, terminal, state, copy);
  ui.start();
  await until(
    () =>
      !!ui.remote?.timelineReady &&
      ui.editors.Main.enabled &&
      !!ui.documents.Main.anchor,
    5000,
  );
  const cleanup = async () => {
    await ui.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  };
  return { f, ui, terminal, state, cleanup };
}
async function send(ui: TerminalApp, terminal: VirtualTerminal, text: string) {
  terminal.sendInput(text);
  terminal.sendInput("\x1b[13;2u");
  await until(
    () =>
      !ui.delivery!.busy &&
      !ui.delivery!.state.pending &&
      !ui.editors.Main.getExpandedText(),
    5000,
  );
}
async function grow(f: Fixture, ui: TerminalApp) {
  seed(f, 1, "new reply");
  await ui.remote!.refresh(["timeline"]);
  await pause();
}

test("explicit Main send reaches latest beyond resident history and follows new reply growth", async () => {
  const { f, ui, terminal, cleanup } = await setup(260);
  try {
    for (let i = 0; i < 5; i++) await ui.remote!.historyPage("before");
    await pause();
    assert.equal(ui.remote!.history.hasAfter, true);
    terminal.sendInput("\x1b[A");
    terminal.sendInput("\x1b");
    await send(ui, terminal, "synthetic follow test");
    await until(
      () => !ui.remote!.history.hasAfter && ui.scrolls.Main.atEnd,
      5000,
    );
    const before = ui.scrolls.Main.scrollTop;
    await grow(f, ui);
    assert.equal(ui.scrolls.Main.atEnd, true);
    assert.ok(ui.scrolls.Main.scrollTop > before);
    assert.ok(ui.remote!.history.items.size <= 200);
  } finally {
    await cleanup();
  }
});

for (const action of [
  "keyboard",
  "pageup",
  "wheel",
  "scrollbar",
  "selection",
  "task",
] as const) {
  test(`explicit ${action} interaction cancels send-follow until another send`, async () => {
    const { f, ui, terminal, cleanup } = await setup();
    try {
      await send(ui, terminal, "follow then cancel");
      await grow(f, ui);
      assert.equal(ui.scrolls.Main.atEnd, true);
      if (action === "keyboard") terminal.sendInput("\x1b[A");
      if (action === "pageup") terminal.sendInput("\x1b[5~");
      if (action === "wheel") terminal.sendInput("\x1b[<64;5;5M");
      if (action === "scrollbar") {
        ui.scrolls.Main.setScrollbar("always");
        await pause();
        terminal.sendInput("\x1b[<0;80;3M");
        terminal.sendInput("\x1b[<32;80;5M");
        terminal.sendInput("\x1b[<0;80;5m");
      }
      if (action === "selection") terminal.sendInput("\x1b[<0;5;5M");
      if (action === "task") {
        terminal.sendInput("/T");
        terminal.sendInput("\x1b[13;2u");
        assert.equal(ui.page, "Task");
      }
      await pause();
      const anchor = ui.documents.Main.anchor;
      await grow(f, ui);
      if (action === "task") {
        terminal.sendInput("/M");
        terminal.sendInput("\x1b[13;2u");
        await pause();
      }
      assert.deepEqual(ui.documents.Main.anchor, anchor);
      assert.equal(ui.scrolls.Main.atEnd, false);
    } finally {
      await cleanup();
    }
  });
}

test("reopen restores rich draft and both restored and subsequent sends reach Core exactly once", async () => {
  const { f, ui, terminal, state, cleanup } = await setup();
  let reopened: TerminalApp | undefined;
  const syncCursor = CoreClient.prototype.syncCursor;
  let release = () => {};
  try {
    const a = "第一块\n  保留缩进\n",
      b = "abcdefghijklmnopqrstuvwxyz12345";
    terminal.sendInput("A");
    terminal.sendInput("\x1b[200~" + a + "\x1b[201~");
    terminal.sendInput("B");
    terminal.sendInput("\x1b[200~" + b + "\x1b[201~");
    const expected = "A" + a + "B" + b;
    assert.equal(ui.editors.Main.getExpandedText(), expected);
    await ui.close();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    CoreClient.prototype.syncCursor = async function () {
      await gate;
      return syncCursor.call(this);
    };
    const next = new VirtualTerminal(80, 24);
    reopened = new TerminalApp(f.dir, next, state);
    reopened.start();
    await until(
      () => !!reopened!.delivery && reopened!.editors.Main.enabled,
      5000,
    );
    assert.equal(reopened.editors.Main.getExpandedText(), expected);
    // Input must already contain the disk snapshot even while initial reads wait.
    release();
    CoreClient.prototype.syncCursor = syncCursor;
    next.sendInput("\x1b[13;2u");
    await until(
      () =>
        !reopened!.delivery!.busy &&
        !reopened!.delivery!.state.pending &&
        !reopened!.editors.Main.getExpandedText(),
      5000,
    );
    await send(reopened, next, "new synthetic message");
    const inputs = f.app.store
      .all<Input>("Input")
      .filter((x) => x.producer === "MASTER");
    assert.deepEqual(
      inputs.map((x) => f.app.store.bytes(x.payload).toString("utf8")),
      [expected, "new synthetic message"],
    );
  } finally {
    release();
    CoreClient.prototype.syncCursor = syncCursor;
    await reopened?.close();
    await cleanup();
  }
});

test("passive arrivals, receipt reconciliation and invalid local submits never start follow", async () => {
  const { f, ui, terminal, cleanup } = await setup();
  try {
    await pause();
    const top = ui.scrolls.Main.scrollTop;
    ui.delivery!.onEvent({
      type: "accepted",
      at: performance.now(),
      id: "previous-reconciled-request",
    });
    await grow(f, ui);
    assert.equal(ui.scrolls.Main.scrollTop, top);
    terminal.sendInput("/unknown");
    terminal.sendInput("\x1b[13;2u");
    await grow(f, ui);
    assert.equal(ui.scrolls.Main.scrollTop, top);
    assert.equal(
      f.app.store.all<Input>("Input").filter((x) => x.producer === "MASTER")
        .length,
      0,
    );
  } finally {
    await cleanup();
  }
});

test("another explicit send resumes follow after deliberate keyboard reading", async () => {
  const { f, ui, terminal, cleanup } = await setup();
  try {
    await send(ui, terminal, "first follow");
    await grow(f, ui);
    assert.equal(ui.scrolls.Main.atEnd, true);
    terminal.sendInput("\x1b[A");
    await pause();
    const top = ui.scrolls.Main.scrollTop;
    await grow(f, ui);
    assert.equal(ui.scrolls.Main.scrollTop, top);
    terminal.sendInput("\x1b");
    await send(ui, terminal, "second follow");
    await grow(f, ui);
    assert.equal(ui.scrolls.Main.atEnd, true);
  } finally {
    await cleanup();
  }
});

for (const releaseOutside of [false, true]) {
  test(`Pi drag release ${releaseOutside ? "outside document" : "inside document"} preserves copy and permits new output and follow`, async () => {
    const copied: string[] = [];
    const { f, ui, terminal, cleanup } = await setup(40, async (text) => {
      copied.push(text);
      return true;
    });
    try {
      await pause();
      const screen = await terminal.flushAndGetViewport();
      // Select away from Pi's edge auto-scroll zones; auto-scroll cancellation has
      // separate scroll-origin coverage and would intentionally enlarge this range.
      const y = screen.findIndex(
        (line, row) =>
          row >= 5 &&
          row < ui.scrolls.Main.viewportHeight - 5 &&
          line.includes("Reading row."),
      );
      assert.ok(y >= 0 && y < ui.scrolls.Main.viewportHeight);
      const x = screen[y].indexOf("Reading row.");
      terminal.sendInput(`\x1b[<0;${x + 1};${y + 1}M`);
      terminal.sendInput(`\x1b[<32;${x + 8};${y + 1}M`);
      await pause();
      assert.equal(ui.tui.hasActiveSelection(), true);
      const before = ui.documents.Main.render(80);
      await grow(f, ui);
      assert.deepEqual(ui.documents.Main.render(80), before);
      terminal.sendInput(
        `\x1b[<0;${x + 8};${releaseOutside ? terminal.rows : y + 1}m`,
      );
      await until(() => copied.length === 1, 2000);
      // Pi trims trailing whitespace on every selected display row (0.87 API).
      if (releaseOutside) assert.ok(copied[0].startsWith("Reading row."));
      else assert.equal(copied[0], "Reading");
      assert.equal(ui.documents.Main.selectionDragging, false);
      assert.equal(ui.scrolls.Main.following, false);
      await pause();
      assert.ok(ui.documents.Main.render(80).join("\n").includes("new reply"));
      await send(ui, terminal, "send after copy");
      await grow(f, ui);
      assert.equal(ui.scrolls.Main.following, true);
      assert.equal(ui.scrolls.Main.atEnd, true);
    } finally {
      await cleanup();
    }
  });
}

test("Task navigation during durable save wins over the delayed explicit POST", async () => {
  const { f, ui, terminal, cleanup } = await setup();
  let release!: () => void;
  try {
    const save = ui.delivery!.files.save.bind(ui.delivery!.files);
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    ui.delivery!.files.save = async (state) => {
      if (first) {
        first = false;
        await gate;
      }
      await save(state);
    };
    terminal.sendInput("late synthetic send");
    terminal.sendInput("\x1b[13;2u");
    terminal.sendInput("\x15");
    terminal.sendInput("/T");
    terminal.sendInput("\x1b[13;2u");
    assert.equal(ui.page, "Task");
    release();
    await until(() => !ui.delivery!.busy, 5000);
    assert.equal(
      f.app.store.all<Input>("Input").filter((x) => x.producer === "MASTER")
        .length,
      1,
    );
    await grow(f, ui);
    assert.equal(ui.scrolls.Main.following, false);
    terminal.sendInput("/M");
    terminal.sendInput("\x1b[13;2u");
    await pause();
    assert.equal(ui.scrolls.Main.following, false);
  } finally {
    release?.();
    await cleanup();
  }
});
