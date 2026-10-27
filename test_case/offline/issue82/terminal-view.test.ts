import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TuiApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { TerminalView } from "../../../src/pi_secretary/src/tui/terminal-view.ts";
async function harness() {
  const app = new TuiApp({
    data: fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "terminal-view-"),
    ),
    mode: "fixture",
    quota: 268435456,
    maxOutbox: 1000,
    aliases: {},
    color: "none",
  });
  await app.store.open();
  const view = new TerminalView(app);
  view.terminal.modes = () => {}; // exercise layout without writing to the operator's TTY
  const internal = view as unknown as {
    render(width: number): string[];
    scroll(direction: number): void;
    reading?: { id: string; offset: number };
    top: number;
  };
  const source = app.snapshot.bind(app);
  let patch: Partial<ReturnType<TuiApp["snapshot"]>> = {};
  app.snapshot = () => ({ ...source(), ...patch });
  let anchors: [string, number][] = [];
  app.sync.anchor = async (id, offset) => {
    app.sync.following = false;
    anchors.push([id, offset]);
    app.store.state.anchor = { message_id: id, offset };
  };
  app.presentation = view;
  return {
    app,
    view,
    internal,
    patch: (v: typeof patch) => {
      patch = v;
    },
    anchors,
    draw: () => internal.render(80),
    close: () => app.close(),
  };
}
test("long local panels and expansions scroll without persisting synthetic anchors", async () => {
  for (const kind of ["panel", "expansion", "pending"] as const) {
    const h = await harness();
    try {
      const text = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
      h.patch(
        kind === "panel"
          ? { panel: text }
          : kind === "expansion"
            ? {
                expansion: {
                  id: "message:test",
                  text,
                  thinking: "",
                  more: false,
                },
              }
            : {
                pending: Array.from({ length: 60 }, (_, i) => ({
                  id: String(i),
                  sequence: i,
                  state: "UNKNOWN" as const,
                  error: null,
                })),
              },
      );
      const before = h.draw();
      h.internal.scroll(-1);
      const after = h.draw();
      assert.notDeepEqual(after.slice(2, 16), before.slice(2, 16));
      await new Promise((r) => setTimeout(r, 240));
      assert.equal(h.anchors.length, 0);
      assert.equal(h.app.store.state.anchor, null);
    } finally {
      await h.close();
    }
  }
});
test("persisted message anchor can scroll into a local panel, and legacy offset clamps visibly", async () => {
  const h = await harness();
  try {
    h.patch({
      rows: [
        {
          kind: "message",
          id: "message:m",
          role: "assistant",
          text: "message body",
          clipped: false,
          outcome: null,
          input_state: null,
        } as any,
      ],
      panel: Array.from({ length: 60 }, (_, i) => `panel ${i}`).join("\n"),
    });
    h.app.sync.following = false;
    h.app.store.state.anchor = { message_id: "message:m", offset: 999 };
    h.internal.reading = { id: "message:m", offset: 999 };
    const before = h.draw();
    assert.match(before.join("\n"), /clamped/);
    assert.equal(h.app.store.state.anchor.offset, 999);
    h.internal.scroll(1);
    const after = h.draw();
    assert.ok(h.internal.top > 2);
    assert.notDeepEqual(after.slice(2, 16), before.slice(2, 16));
    await new Promise((r) => setTimeout(r, 240));
    assert.equal(h.anchors.length, 0);
  } finally {
    await h.close();
  }
});
test("scroll anchor writes coalesce, close flushes the last stable position, and Latest cancels pending writes", async () => {
  for (const exit of [false, true]) {
    const h = await harness();
    h.patch({
      rows: Array.from(
        { length: 50 },
        (_, i) =>
          ({
            kind: "message",
            id: `message:${i}`,
            role: "assistant",
            text: `body ${i}`,
            clipped: false,
            outcome: null,
            input_state: null,
          }) as any,
      ),
    });
    h.draw();
    for (let i = 0; i < 5; i++) {
      h.internal.scroll(-1);
      h.draw();
    }
    assert.equal(h.anchors.length, 0);
    if (exit) await h.close();
    else await new Promise((r) => setTimeout(r, 240));
    assert.equal(h.anchors.length, 1);
    assert.equal(h.anchors[0][0], h.internal.reading?.id);
    if (!exit) {
      h.internal.scroll(-1);
      h.draw();
      await h.app.sync.latest();
      h.draw();
      await new Promise((r) => setTimeout(r, 240));
      assert.equal(h.anchors.length, 1);
      assert.equal(h.app.store.state.anchor, null);
      await h.close();
    }
  }
});
test("closing a local panel restores a saved timeline anchor or follows the bottom", async () => {
  for (const anchored of [false, true]) {
    const h = await harness();
    try {
      const rows = Array.from(
        { length: 40 },
        (_, i) =>
          ({
            kind: "message",
            id: `message:${i}`,
            role: "assistant",
            text: `body ${i}`,
            clipped: false,
            outcome: null,
            input_state: null,
          }) as any,
      );
      h.patch({
        rows,
        panel: Array.from({ length: 60 }, (_, i) => `panel ${i}`).join("\n"),
      });
      h.draw();
      h.internal.scroll(-1);
      h.draw();
      if (anchored)
        h.app.store.state.anchor = { message_id: "message:5", offset: 0 };
      h.patch({ rows, panel: "" });
      const after = h.draw();
      assert.ok(h.internal.top > 0);
      assert.match(after.join("\n"), /Local view closed/);
      if (anchored) assert.equal(h.internal.reading?.id, "message:5");
      else {
        assert.equal(h.internal.reading, undefined);
        assert.equal(h.app.sync.following, true);
      }
    } finally {
      await h.close();
    }
  }
});
