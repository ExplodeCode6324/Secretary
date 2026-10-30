import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Fixture, until } from "../issue9/helpers.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import type { RequestStatus } from "../../../src/pi_secretary/src/api/contracts.ts";

test("integrated terminal attaches existing Core, sends multiline once, navigates locally and exits without stopping Core", async () => {
  const f = new Fixture();
  await f.open();
  await fs.writeFile(
    path.join(f.dir, "core-endpoint.json"),
    JSON.stringify(f.server.endpoint),
    { mode: 0o600 },
  );
  const core = await f.client.core();
  const stateDir = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Secretary",
    "tui",
    "v1",
    core.data_domain_id,
    core.mode,
  );
  await assert.rejects(fs.stat(stateDir), /ENOENT/);
  const terminal = new VirtualTerminal(100, 30),
    app = new TerminalApp(f.dir, terminal);
  let posted: string | undefined;
  try {
    app.start();
    await until(
      () =>
        !!app.delivery &&
        app.editors.Main.enabled &&
        !!app.remote?.timelineReady,
      5000,
    );
    app.delivery!.onEvent = (e) => {
      if (e.type === "post-start") posted = e.id;
    };
    terminal.sendInput("first");
    terminal.sendInput("\r");
    terminal.sendInput("second");
    assert.equal(app.editors.Main.getExpandedText(), "first\nsecond");
    assert.equal(posted, undefined);
    terminal.sendInput("\x1b[13;2u");
    await until(
      () => !!posted && !app.delivery!.busy && !app.delivery!.state.pending,
      5000,
    );
    assert.equal(app.editors.Main.getExpandedText(), "");
    const status = await f.client.query<RequestStatus>(`requests/${posted}`);
    assert.equal(status.receipt.acceptance, "ACCEPTED");
    terminal.sendInput("/T");
    await until(() => app.editors.Main.isShowingAutocomplete());
    terminal.sendInput("\x1b[13;2u");
    assert.equal(app.page, "Main");
    terminal.sendInput("\x1b[13;2u");
    assert.equal(app.page, "Task");
    const original = posted;
    terminal.sendInput("Task draft");
    terminal.sendInput("\x1b[13;2u");
    assert.equal(app.editors.Task.getExpandedText(), "Task draft");
    assert.equal(posted, original);
    await app.close();
    assert.equal((await f.client.core()).instance_id, core.instance_id);
    const state = JSON.parse(
      await fs.readFile(path.join(stateDir, "state.json"), "utf8"),
    );
    assert.equal(state.drafts.Task.raw, "Task draft");
  } finally {
    await app.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
