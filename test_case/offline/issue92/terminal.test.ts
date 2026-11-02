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
const invisible = "\u202e\u200b\u2066\u2028\u2029";
function assertVisibleFormatting(text: string) {
  for (const marker of ["202E", "200B", "2066", "2028", "2029"])
    assert(text.includes("\\u{" + marker + "}"), marker);
  assert(!/[\p{Cf}\u2028\u2029]/u.test(text));
}
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

test("Ctrl+C clears Main/Task rich drafts in one undoable edit; release does not exit and empty input exits only the client", async () => {
  const { f, ui, terminal, cleanup } = await setup(
    async (f) => (await decision(f)).id,
  );
  const close = ui.close.bind(ui);
  let closing: Promise<void> | undefined;
  ui.close = () => (closing ??= close());
  try {
    const core = await f.client.core();
    for (const page of ["Main", "Task"] as const) {
      if (page === "Task") {
        terminal.sendInput("/t");
        terminal.sendInput(shiftEnter);
      }
      terminal.sendInput(
        "\x1b[200~/m literal\n" + "中文😀".repeat(70) + "\x1b[201~",
      );
      terminal.sendInput("\x1b[D");
      const saved = ui.editors[page].snapshot();
      const sequence = f.app.store.sequence;
      terminal.sendInput("\x03");
      assert.equal(ui.editors[page].getExpandedText(), "");
      assert.equal(ui.delivery!.state.drafts[page].raw, "");
      assert.equal(closing, undefined);
      terminal.sendInput("\x1b[99;5:3u");
      assert.equal(closing, undefined);
      terminal.sendInput("\x1f");
      assert.deepEqual(ui.editors[page].snapshot(), saved);
      assert.equal(f.app.store.sequence, sequence);
      terminal.sendInput("\x03");
      assert.equal(closing, undefined);
    }
    terminal.sendInput("\x03");
    assert(closing);
    await closing;
    assert.equal((await f.client.core()).instance_id, core.instance_id);
  } finally {
    await cleanup();
  }
});

test("clearing a pending Main message preserves the frozen request and never posts a replacement", async () => {
  const { f, ui, terminal, cleanup } = await setup(
    async (f) => (await decision(f)).id,
  );
  try {
    const client = ui.delivery!.client!;
    let posts = 0;
    await ui.delivery!.connect({
      ...client,
      endpoint: client.endpoint,
      core: client.core.bind(client),
      query: async () => {
        throw Error("offline receipt");
      },
      command: async (...args) => {
        posts++;
        await client.command(...args);
        throw Error("lost acknowledgement");
      },
      syncCursor: client.syncCursor.bind(client),
      changes: client.changes.bind(client),
    });
    terminal.sendInput("frozen Main message");
    terminal.sendInput(shiftEnter);
    await until(
      () =>
        !!ui.delivery!.state.pending &&
        !ui.delivery!.busy &&
        ui.editors.Main.getExpandedText() === "frozen Main message",
    );
    const pending = JSON.stringify(ui.delivery!.state.pending);
    const inputs = f.app.store.all("Input").length;
    terminal.sendInput("\x03");
    assert.equal(ui.editors.Main.getExpandedText(), "");
    assert.equal(JSON.stringify(ui.delivery!.state.pending), pending);
    assert.equal(posts, 1);
    assert.equal(f.app.store.all("Input").length, inputs);
    terminal.sendInput("\x1f");
    assert.equal(ui.editors.Main.getExpandedText(), "frozen Main message");
    await ui.delivery!.connect(client);
    await ui.delivery!.reconcile();
    assert.equal(ui.delivery!.state.pending, undefined);
    assert.equal(posts, 1);
  } finally {
    await cleanup();
  }
});

test("Ctrl+C in authorization detail exits without clearing the hidden ordinary draft or deciding", async () => {
  const { f, ui, terminal, item, cleanup, open } = await setup(
    async (f) => authorization(f).authorization_id!,
  );
  const close = ui.close.bind(ui);
  let closing: Promise<void> | undefined;
  ui.close = () => (closing ??= close());
  try {
    terminal.sendInput("hidden Main draft");
    await open();
    const sequence = f.app.store.sequence;
    terminal.sendInput("\x03");
    assert(closing);
    await closing;
    assert.equal(ui.editors.Main.getExpandedText(), "hidden Main draft");
    assert.equal(ui.delivery!.state.drafts.Main.raw, "hidden Main draft");
    assert.equal(
      (await f.client.query<Authorization>("authorizations/" + item)).state,
      "PENDING",
    );
    assert.equal(f.app.store.sequence, sequence);
  } finally {
    await cleanup();
  }
});

test("Ctrl+C clears only the visible question answer, preserving its frozen pending identity and underlying Main draft", async () => {
  const { f, ui, terminal, item, cleanup, open } = await setup(
    async (f) => (await decision(f)).id,
  );
  try {
    terminal.sendInput("Main draft stays");
    await open();
    terminal.sendInput(
      "\x1b[200~/m literal answer\n" + "保留".repeat(40) + "\x1b[201~",
    );
    const saved = ui.matterEditor.snapshot();
    const core = await f.client.core();
    let offline = false,
      posts = 0;
    ui.matters.connect(
      {
        query: <T>(route: string) =>
          offline ? Promise.reject(Error("offline")) : f.client.query<T>(route),
        command: async (...args) => {
          posts++;
          const receipt = await f.client.command(...args);
          offline = true;
          throw Error("lost acknowledgement");
        },
      },
      core.data_domain_id + ":" + core.mode,
    );
    terminal.sendInput(shiftEnter);
    await until(() => !!ui.matters.pending && !ui.matters.busy);
    const pending = JSON.stringify(ui.matters.pending);
    terminal.sendInput("\x03");
    assert.equal(ui.matterEditor.getExpandedText(), "");
    assert.equal(ui.editors.Main.getExpandedText(), "Main draft stays");
    assert.equal(JSON.stringify(ui.matters.pending), pending);
    assert.equal(posts, 1);
    terminal.sendInput("\x1f");
    assert.deepEqual(ui.matterEditor.snapshot(), saved);
    offline = false;
    await ui.matters.refresh();
    assert.equal(ui.matters.current, undefined);
    assert.equal(ui.matters.pending, undefined);
    assert.equal(ui.editors.Main.getExpandedText(), "Main draft stays");
    assert.equal(posts, 1);
    assert.equal(f.app.store.all("Input").length, 0);
    assert.equal(
      (await f.client.query<Decision>("decisions/" + item)).answered_by,
      "MASTER",
    );
  } finally {
    await cleanup();
  }
});

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

test("matter arrows wrap, detail Escape keeps the selected row, and PageUp reaches history after Escape", async () => {
  const { ui, terminal, cleanup } = await setup(async (f) => {
    let id = "";
    for (let i = 0; i < 7; i++) id = (await decision(f)).id;
    return id;
  });
  try {
    assert.equal(ui.remote!.attention.seen.size, 0);
    terminal.sendInput(up);
    assert(ui.remote!.attention.selected);
    const attention = ui.remote!.attention;
    while (attention.row?.key !== attention.page!.items[0].key)
      terminal.sendInput(up);
    terminal.sendInput(up);
    await until(() => !attention.loading);
    assert.equal(attention.row?.key, attention.page!.items.at(-1)!.key);
    terminal.sendInput(down);
    await until(() => !attention.loading);
    assert.equal(attention.row?.key, attention.page!.items[0].key);
    assert.equal(ui.viewing, false);
    assert.equal(ui.remote!.attention.seen.size, 0);
    const selected = attention.selected;
    terminal.sendInput("\r");
    await until(() => !!ui.matters.current);
    terminal.sendInput(esc);
    assert.equal(attention.selected, selected);
    terminal.sendInput("\r");
    await until(() => !!ui.matters.current);
    terminal.sendInput(esc);
    terminal.sendInput(esc);
    assert.equal(attention.selected, undefined);
    terminal.sendInput("\x1b[5~");
    assert.equal(ui.viewing, true);
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

test("pasted show stays a Task draft and explains why it did not open the matter", async () => {
  const { f, ui, terminal, item, cleanup } = await setup(
    async (f) => (await decision(f)).id,
  );
  try {
    terminal.sendInput("/t");
    terminal.sendInput(shiftEnter);
    const inputs = f.app.store.all("Input").length;
    terminal.sendInput("\x1b[200~/show " + item + "\x1b[201~");
    terminal.sendInput(shiftEnter);
    assert.equal(ui.matters.current, undefined);
    assert.equal(ui.editors.Task.getExpandedText(), "/show " + item);
    assert.match(
      ui.footer.render(120).join("\n"),
      /粘贴的 \/show 已保留为草稿/,
    );
    assert.equal(f.app.store.all("Input").length, inputs);
    assert.equal(
      (await f.client.query<Decision>("decisions/" + item)).state,
      "OPEN",
    );
    // A deliberately typed slash plus an inline pasted remainder is an
    // explicit command; the 60-grapheme threshold accommodates a full UUID.
    terminal.sendInput("\x15");
    assert.equal(ui.editors.Task.getExpandedText(), "");
    terminal.sendInput("/");
    terminal.sendInput("\x1b[200~show " + item + "\x1b[201~");
    terminal.sendInput(shiftEnter);
    await until(() => ui.matters.current?.id === item);
    assert.equal(f.app.store.all("Input").length, inputs);
  } finally {
    await cleanup();
  }
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
    await until(() => !ui.remote!.attention.loading);
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

test("authorization formats are visible in previews/details without changing display binding or approved bytes", async () => {
  const { f, ui, item, terminal, cleanup, open } = await setup(
    async (f) =>
      f.app.authorization.prepare(
        { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
        "file.write",
        f.dir + "/spoof-" + invisible,
        { text: "body" + invisible },
      ).authorization_id!,
  );
  try {
    const before = await f.client.query<Authorization>(
      "authorizations/" + item,
    );
    assertVisibleFormatting(ui.remote!.attention.render(800).join("\n"));
    await open();
    assertVisibleFormatting(ui.matters.current!.text);
    assert.deepEqual(ui.matters.current!.data.display, before.display);
    assert.equal(ui.matters.current!.data.display_hash, before.display_hash);
    terminal.sendInput("\t");
    assert(ui.footer.render(80).join("\n").includes("\x1b[1;30;103m"));
    assert(ui.footer.render(80).join("\n").includes("批准：Shift+Enter 确认"));
    terminal.sendInput("\r");
    assert.equal(
      (await f.client.query<Authorization>("authorizations/" + item)).state,
      "PENDING",
    );
    terminal.sendInput(shiftEnter);
    await until(() => !ui.matters.current);
    const after = await f.client.query<Authorization>("authorizations/" + item);
    assert.equal(after.state, "APPROVED");
    assert.deepEqual(after.display, before.display);
    assert.equal(after.display_hash, before.display_hash);
  } finally {
    await cleanup();
  }
});

test("question and option formatting is visible while a directed option answer keeps literal bytes", async () => {
  const answer = "/m option" + invisible;
  const { f, ui, item, terminal, cleanup, open } = await setup(
    async (f) => (await decision(f, "question" + invisible, [answer])).id,
  );
  try {
    assertVisibleFormatting(ui.remote!.attention.render(800).join("\n"));
    await open();
    assertVisibleFormatting(ui.matters.current!.text);
    assert.equal(ui.matters.current!.options[0], answer);
    terminal.sendInput("\t");
    terminal.sendInput("\t");
    terminal.sendInput("\r");
    assert.equal(ui.matterEditor.getExpandedText(), answer);
    terminal.sendInput(shiftEnter);
    await until(() => !ui.matters.current);
    assert.deepEqual(
      (await f.client.query<Decision>("decisions/" + item)).answer,
      { value: answer },
    );
  } finally {
    await cleanup();
  }
});
