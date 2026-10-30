import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Fixture, until } from "../issue9/helpers.ts";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";

test("Core restart publishes a complete reader window and preserves surviving body anchor and draft cursor", async () => {
  const f = new Fixture();
  await f.open();
  const terminal = new VirtualTerminal(80, 24);
  const ui = new TerminalApp(
    f.dir,
    terminal,
    path.join(f.dir, "restart-state"),
  );
  const endpoint = () =>
    fs.writeFile(
      path.join(f.dir, "core-endpoint.json"),
      JSON.stringify(f.server.endpoint),
      { mode: 0o600 },
    );
  try {
    const events = Array.from({ length: 40 }, (_, i) =>
      f.app.store.event(
        "main.message",
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Block ${i}\n\n${"Stable body text. ".repeat(12)}\n\nLast paragraph.`,
            },
          ],
          stopReason: "stop",
        },
        { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
      ),
    );
    f.app.store.commit([], events);
    await endpoint();
    ui.start();
    await until(
      () =>
        !!ui.remote?.timelineReady &&
        ui.editors.Main.enabled &&
        !!ui.documents.Main.anchor,
      5000,
    );
    terminal.sendInput("keep draft");
    terminal.sendInput("\x1b[D\x1b[D");
    for (let i = 0; i < 20; i++) {
      terminal.sendInput("\x1b[A");
      await new Promise((r) => setTimeout(r, 20));
      if (ui.documents.Main.anchor?.region === "body") break;
    }
    const before = ui.documents.Main.anchor!,
      draft = ui.editors.Main.snapshot();
    assert.equal(before.region, "body");
    await f.server.close();
    await f.app.close();
    f.app = await App.open(f.dir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    f.server = await serveCore(f.app, 0, undefined, { pump: false });
    await endpoint();
    await until(
      () =>
        ui.documents.Main.anchor?.instance_id ===
          f.server.endpoint.instance_id && !!ui.remote?.timelineReady,
      10000,
    );
    const after = ui.documents.Main.anchor!;
    assert.deepEqual(
      [
        after.item_id,
        after.region,
        after.block_start_utf16,
        after.row_in_block,
      ],
      [
        before.item_id,
        before.region,
        before.block_start_utf16,
        before.row_in_block,
      ],
    );
    assert.deepEqual(ui.editors.Main.snapshot(), draft);
    assert(ui.remote!.history.items.size > 1);
  } finally {
    await ui.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
