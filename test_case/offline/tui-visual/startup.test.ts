import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Fixture, until } from "../issue9/helpers.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { setColorDepth } from "../../../src/pi_secretary/src/tui/theme.ts";
import type { TimelineItem } from "../../../src/pi_secretary/src/api/contracts.ts";

test("splash covers startup, ignores terminal reports and mouse motion, and yields to the first key without eating it", async () => {
  setColorDepth("256");
  const f = new Fixture();
  await f.open();
  await fs.writeFile(
    path.join(f.dir, "core-endpoint.json"),
    JSON.stringify(f.server.endpoint),
    { mode: 0o600 },
  );
  const terminal = new VirtualTerminal(120, 40),
    app = new TerminalApp(
      f.dir,
      terminal,
      path.join(f.dir, "tui-state"),
      undefined,
      undefined,
      { splash: true, motion: true },
    );
  const activityKind = () => app.indicator.activity?.kind;
  const screen = async () => (await terminal.flushAndGetViewport()).join("\n");
  try {
    app.start();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
    await settle();
    assert.match(await screen(), /S E C R E T A R Y/);
    await until(
      () => app.editors.Main.enabled && !!app.remote?.timelineReady,
      5000,
    );
    app.draw();
    await settle();
    const ready = await screen();
    assert.match(ready, /已连接/);
    assert.match(ready, /[⠁-⣿]{4}/);
    assert.doesNotMatch(ready, /Main · ↑\/↓ 连续读取历史/);
    // Not Master: focus-in report, a device-attributes reply, mouse motion.
    for (const report of ["\x1b[I", "\x1b[?62;4c", "\x1b[<35;10;10M"])
      terminal.sendInput(report);
    await settle();
    assert.match(await screen(), /S E C R E T A R Y/);
    terminal.sendInput("你");
    await settle();
    const after = await screen();
    assert.doesNotMatch(after, /S E C R E T A R Y/);
    assert.match(after, /Main · ↑\/↓ 连续读取历史/);
    assert.equal(app.editors.Main.getExpandedText(), "你");
    app.remote!.stop();
    await settle();
    // Observe animation through rendering, including its hidden/disconnected lifecycle.
    const activity = {
      id: "visual-main-probe",
      kind: "activity",
      revision: "1",
      activity: {
        id: "visual-main-probe",
        kind: "model",
        status: "running",
        source: "live",
        phase: "正在思考",
      },
    } as TimelineItem;
    app.remote!.history.items.set(activity.id, activity);
    let paints = 0;
    const render = app.tui.requestRender.bind(app.tui);
    app.tui.requestRender = (...args) => {
      paints++;
      return render(...args);
    };
    app.draw();
    await settle();
    const before = paints;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert(paints > before);
    assert.equal(activityKind(), "thinking");
    app.page = "Task";
    app.draw();
    const hidden = paints;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(paints, hidden);
    assert.equal(app.indicator.activity, undefined);
    app.page = "Main";
    app.draw();
    assert.equal(activityKind(), "thinking");
    app.remote!.onDisconnect(Error("synthetic disconnect"));
    const disconnected = paints;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(paints, disconnected);
    assert.equal(app.indicator.activity, undefined);
  } finally {
    await app.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
