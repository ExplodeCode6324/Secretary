import test from "node:test";
import assert from "node:assert/strict";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import {
  visualEnvironment,
  visualOptions,
} from "../../../src/pi_secretary/src/tui/options.ts";
import { setColorDepth } from "../../../src/pi_secretary/src/tui/theme.ts";
import { messageComponent } from "../../../src/pi_secretary/src/tui/view.ts";
import type { Message } from "../../../src/pi_secretary/src/api/contracts.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

test("agile keeps only validated visual options; defaults enable the real CLI experience", () => {
  const env = visualEnvironment({
    SECRETARY_TUI_SPLASH: "off",
    SECRETARY_TUI_MOTION: "off",
    SECRETARY_TUI_COLOR: "256",
    SECRETARY_DATA: "/wrong-domain",
    SECRETARY_CREDENTIALS_FILE: "/wrong-credentials",
    SECRETARY_TUI_UNKNOWN: "arbitrary",
  });
  assert.deepEqual(env, {
    SECRETARY_TUI_SPLASH: "off",
    SECRETARY_TUI_MOTION: "off",
    SECRETARY_TUI_COLOR: "256",
  });
  assert.deepEqual(visualOptions(env), { splash: false, motion: false });
  assert.deepEqual(visualOptions({}), { splash: true, motion: true });
  assert.deepEqual(
    visualEnvironment({
      SECRETARY_TUI_COLOR: "invalid",
      SECRETARY_TUI_MOTION: "invalid",
    }),
    {},
  );
});

for (const [input, expected] of [
  ["你", "你"],
  ["/", "/"],
  ["\x1b[200~中文\n/pasted\x1b[201~", "中文\n/pasted"],
]) {
  test(`first input survives splash dismissal: ${JSON.stringify(expected)}`, async () => {
    setColorDepth("256");
    const terminal = new VirtualTerminal(120, 36);
    const app = new TerminalApp(
      "unused-no-core",
      terminal,
      undefined,
      undefined,
      undefined,
      { splash: true },
    );
    // Start the renderer only: no Core, endpoint, database, disk state or network.
    app.tui.start();
    app.editors.Main.enabled = true;
    app.draw();
    const screen = async () =>
      (await terminal.flushAndGetViewport()).join("\n");
    try {
      await settle();
      assert.match(await screen(), /S E C R E T A R Y/);
      for (const report of ["\x1b[I", "\x1b[?62;4c", "\x1b[<35;10;10M"])
        terminal.sendInput(report);
      await settle();
      assert.match(await screen(), /S E C R E T A R Y/);
      terminal.sendInput(input);
      await settle();
      assert.equal(app.editors.Main.getExpandedText(), expected);
      assert.doesNotMatch(await screen(), /S E C R E T A R Y/);
    } finally {
      await app.close();
    }
  });
}

test("startup resize and a multiline draft keep status and the editor visible", async () => {
  const terminal = new VirtualTerminal(120, 36);
  const app = new TerminalApp(
    "unused-no-core",
    terminal,
    undefined,
    undefined,
    undefined,
    { splash: true },
  );
  app.tui.start();
  app.editors.Main.setText("one\ntwo\nthree\nfour\nfive\nsix");
  app.draw();
  try {
    for (const [width, height] of [
      [120, 36],
      [80, 24],
      [40, 14],
      [100, 30],
    ]) {
      terminal.resize(width, height);
      await settle();
      const screen = (await terminal.flushAndGetViewport()).join("\n");
      assert.match(screen, /Core/);
      assert.match(screen, /six/);
      assert.match(screen, /Main/);
    }
  } finally {
    await app.close();
  }
});

test("no-color removes message and Markdown styles; boxed body retains source rows", () => {
  setColorDepth("none");
  const text =
    "中文 **bold** and *italic*\n\n```ts\nconst x = 1;\n```\n\n[link](https://example.com)";
  const message = {
    id: "m",
    kind: "message",
    role: "master",
    text,
    revision: "1",
    persistence: "durable",
  } as Message;
  const box = messageComponent(message).renderMapped!(80);
  const plain = messageComponent({ ...message, role: "assistant" })
    .renderMapped!(76);
  assert.doesNotMatch(box.lines.join("\n"), /\x1b/);
  assert.deepEqual(
    box.rows.filter((r) => r.region === "body"),
    plain.rows.filter((r) => r.region === "body"),
  );
  assert.deepEqual(
    box.lines.slice(1, -2).map((line) => line.slice(2, -2).trimEnd()),
    plain.lines.slice(1, -1).map((line) => line.trimEnd()),
  );
});
