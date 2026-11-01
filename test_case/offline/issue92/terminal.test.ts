import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Fixture, until } from "../issue9/helpers.ts";
import { authorization, decision } from "./helpers.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import {
  parseInput,
  commandCompletion,
} from "../../../src/pi_secretary/src/tui/input.ts";
import type {
  Decision,
  Authorization,
} from "../../../src/pi_secretary/src/api/contracts.ts";
const shiftEnter = "\x1b[13;2u",
  up = "\x1b[A",
  down = "\x1b[B",
  esc = "\x1b";
async function setup(
  seed: (f: Fixture) => Promise<string>,
  columns = 80,
  rows = 24,
) {
  const f = new Fixture();
  await f.open();
  const item = await seed(f);
  await fs.writeFile(
    path.join(f.dir, "core-endpoint.json"),
    JSON.stringify(f.server.endpoint),
    { mode: 0o600 },
  );
  const terminal = new VirtualTerminal(columns, rows),
    ui = new TerminalApp(f.dir, terminal, path.join(f.dir, "tui-state"));
  ui.start();
  await until(
    () => !!ui.remote?.attention.head && ui.editors.Main.enabled,
    5000,
  );
  const cleanup = async () => {
    await ui.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  };
  const open = async () => {
    terminal.sendInput(up);
    assert.equal(ui.remote?.attention.row?.id, item);
    terminal.sendInput("\r");
    await until(() => !!ui.matters.current && !ui.matters.loading);
  };
  return { f, ui, terminal, item, cleanup, open };
}
for (const [columns, rows] of [
  [80, 24],
  [120, 40],
])
  test(`real Pi input routes literal answers and preserves rich Main draft at ${columns}x${rows}`, async () => {
    const { f, ui, terminal, item, cleanup, open } = await setup(
      async (f) => (await decision(f)).id,
      columns,
      rows,
    );
    try {
      terminal.sendInput(
        "\x1b[200~" + "原始草稿😀".repeat(40) + "\n第二行\x1b[201~",
      );
      const saved = ui.editors.Main.snapshot(),
        inputs = f.app.store.all("Input").length;
      await open();
      assert(ui.remote!.attention.seen.size === 1);
      terminal.sendInput("/m");
      terminal.sendInput("\r");
      terminal.sendInput("/send 原样");
      assert.equal(ui.page, "Main");
      assert.equal(ui.matterEditor.getExpandedText(), "/m\n/send 原样");
      assert.deepEqual(ui.editors.Main.snapshot(), saved);
      terminal.sendInput(shiftEnter);
      await until(() => !ui.matters.current);
      assert.deepEqual(
        (await f.client.query<Decision>("decisions/" + item)).answer,
        { value: "/m\n/send 原样" },
      );
      assert.deepEqual(ui.editors.Main.snapshot(), saved);
      assert.equal(f.app.store.all("Input").length, inputs);
      assert(
        ui.remote!.attention.render(columns).length <=
          Math.min(8, Math.max(3, Math.floor(rows / 4))),
      );
    } finally {
      await cleanup();
    }
  });

test("option focus has no bare-number or Shift+Enter shortcut; Enter copies exact option then editor submits", async () => {
  const { f, ui, terminal, item, cleanup, open } = await setup(
    async (f) =>
      (await decision(f, "Choose", ["/m literal option", "  二号😀\n保留  "]))
        .id,
  );
  try {
    await open();
    terminal.sendInput("\t");
    terminal.sendInput("\t");
    terminal.sendInput(shiftEnter);
    assert.equal(
      (await f.client.query<Decision>("decisions/" + item)).state,
      "OPEN",
    );
    terminal.sendInput(down);
    terminal.sendInput("\r");
    assert.equal(ui.matterEditor.getExpandedText(), "  二号😀\n保留  ");
    terminal.sendInput(shiftEnter);
    await until(() => !ui.matters.current);
    assert.deepEqual(
      (await f.client.query<Decision>("decisions/" + item)).answer,
      { value: "  二号😀\n保留  " },
    );
  } finally {
    await cleanup();
  }
});

test("authorization begins neutral; Enter/text cannot approve; explicit reject confirms and preserves draft", async () => {
  const { f, ui, terminal, item, cleanup, open } = await setup(
    async (f) => authorization(f).authorization_id!,
  );
  try {
    terminal.sendInput("main draft");
    await open();
    terminal.sendInput("APPROVE /send");
    terminal.sendInput(shiftEnter);
    assert.equal(
      (await f.client.query<Authorization>("authorizations/" + item)).state,
      "PENDING",
    );
    terminal.sendInput("\t");
    terminal.sendInput("\r");
    assert.equal(
      (await f.client.query<Authorization>("authorizations/" + item)).state,
      "PENDING",
    );
    terminal.sendInput("\t");
    terminal.sendInput(shiftEnter);
    await until(() => !ui.matters.current);
    assert.equal(
      (await f.client.query<Authorization>("authorizations/" + item)).state,
      "REJECTED",
    );
    assert.equal(ui.editors.Main.getExpandedText(), "main draft");
  } finally {
    await cleanup();
  }
});

test("Task /SHOW is exact, command is consumed and processing slash commands cannot navigate; Esc leaves current Delivery generation intact", async () => {
  const { f, ui, terminal, item, cleanup } = await setup(
    async (f) => (await decision(f)).id,
  );
  try {
    terminal.sendInput("/t");
    terminal.sendInput(shiftEnter);
    assert.equal(ui.page, "Task");
    terminal.sendInput("/SHOW " + item);
    terminal.sendInput(shiftEnter);
    await until(() => !!ui.matters.current);
    terminal.sendInput("/m");
    terminal.sendInput("\r");
    terminal.sendInput("/help");
    assert.equal(ui.page, "Task");
    // Delivery owns updates even while its editor is detached; exiting must not restore the old snapshot.
    ui.delivery!.edit("Task", "new background-owned draft");
    ui.draw();
    terminal.sendInput(esc);
    assert.equal(ui.matters.current, undefined);
    assert.equal(
      ui.editors.Task.getExpandedText(),
      "new background-owned draft",
    );
    assert.equal(
      (await f.client.query<Decision>("decisions/" + item)).state,
      "OPEN",
    );
  } finally {
    await cleanup();
  }
});

test("Main history remains reachable within one visible matter window, and seen changes only on actual opening", async () => {
  const { ui, terminal, cleanup } = await setup(async (f) => {
    let id = "";
    for (let i = 0; i < 7; i++) id = (await decision(f)).id;
    return id;
  });
  try {
    assert.equal(ui.remote!.attention.seen.size, 0);
    terminal.sendInput(up);
    assert(ui.remote!.attention.selected);
    for (let i = 0; i < 5; i++) terminal.sendInput(up);
    await until(() => ui.viewing);
    assert.equal(ui.remote!.attention.selected, undefined);
    assert.equal(ui.remote!.attention.seen.size, 0);
    terminal.sendInput(esc);
    assert.equal(ui.viewing, false);
  } finally {
    await cleanup();
  }
});

test("show completion is Task name-only; IDs preserve case and Main rejects the command", async () => {
  assert.deepEqual(parseInput("/SHOW A0b-Cd", "Task"), {
    kind: "show",
    id: "A0b-Cd",
  });
  assert.equal(parseInput("/show A0b-Cd", "Main").kind, "error");
  for (const value of ["/show a b", "/show a\nb", "/show  a"])
    assert.equal(parseInput(value, "Task").kind, "error");
  let suggestions = 0;
  const c = commandCompletion(
    () => "Task",
    () => true,
    undefined,
    async () => {
      suggestions++;
      return ["id"];
    },
  );
  const opts = { signal: new AbortController().signal };
  assert.equal(
    (await c.getSuggestions(["/sh"], 0, 3, opts))?.items[0].value,
    "/show",
  );
  assert.equal(await c.getSuggestions(["/show A"], 0, 7, opts), null);
  assert.equal(suggestions, 0);
});

test("an externally removed selection returns keyboard focus to the ordinary editor", async () => {
  const { f, ui, terminal, item, cleanup } = await setup(
    async (f) => (await decision(f)).id,
  );
  try {
    terminal.sendInput(up);
    assert(ui.remote!.attention.selected);
    f.app.scheduler.answer(item, "external", undefined, "MAIN");
    await ui.remote!.attention.refresh();
    terminal.sendInput("focus restored");
    assert.equal(ui.editors.Main.getExpandedText(), "focus restored");
  } finally {
    await cleanup();
  }
});

test("a cancelled late opening cannot mark a different matter as seen", async () => {
  const { f, ui, terminal, cleanup } = await setup(async (f) => {
    const first = await decision(f);
    await decision(f);
    return first.id;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    terminal.sendInput(up);
    const old = ui.remote!.attention.row!;
    const originalOpen = ui.matters.open.bind(ui.matters);
    let oldOpening: Promise<void> | undefined;
    ui.matters.open = (id, origin, row) => {
      const opening = originalOpen(id, origin, row);
      if (id === old.id) oldOpening = opening;
      return opening;
    };
    const core = await f.client.core();
    let delayed = false;
    ui.matters.connect(
      {
        query: async <T>(route: string) => {
          if (route === old.detail_route) {
            delayed = true;
            await gate;
          }
          return f.client.query<T>(route);
        },
        command: f.client.command.bind(f.client),
      },
      core.data_domain_id + ":" + core.mode,
    );
    terminal.sendInput("\r");
    await until(() => delayed);
    terminal.sendInput(esc);
    terminal.sendInput(up);
    terminal.sendInput(up);
    const next = ui.remote!.attention.row!;
    assert.notEqual(next.id, old.id);
    terminal.sendInput("\r");
    await until(() => ui.matters.current?.id === next.id);
    assert(ui.remote!.attention.seen.has(next.key));
    release();
    // openMatter registered its continuation before this await, so it has now drained.
    await oldOpening;
    assert.equal(ui.matters.current?.id, next.id);
    assert.equal(ui.remote!.attention.seen.has(old.key), false);
  } finally {
    release();
    await cleanup();
  }
});
