import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
    f.dir,
    "tui-state",
    core.data_domain_id,
    core.mode,
  );
  await assert.rejects(fs.stat(stateDir), /ENOENT/);
  const terminal = new VirtualTerminal(100, 30),
    app = new TerminalApp(f.dir, terminal, path.join(f.dir, "tui-state"));
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

test("real Core timeline renders Master blue, assistant white, system neutral and tool activities pink", async () => {
  const f = new Fixture();
  await f.open();
  const { randomUUID } = await import("node:crypto");
  const { timelineComponent } =
    await import("../../../src/pi_secretary/src/tui/view.ts");
  const { RemoteViews } =
    await import("../../../src/pi_secretary/src/tui/remote.ts");
  const views = new RemoteViews(f.client);
  try {
    await f.client.command("messages", {
      request_id: randomUUID(),
      text: "task: synthetic rendering probe",
    });
    await f.app.host.drain();
    await views.refresh();
    const items = [...views.messages.values()];
    const master = items.find(
      (i) => i.kind === "message" && i.role === "master",
    );
    const assistant = items.find(
      (i) => i.kind === "message" && i.role === "assistant",
    );
    const tool = items.find(
      (i) => i.kind === "activity" && i.activity.kind === "tool",
    );
    assert(master && assistant && tool, JSON.stringify(items));
    const rendered = (i: typeof master) =>
      timelineComponent(i).render(100).join("\n");
    assert.match(rendered(master), /\x1b\[94m/);
    assert.match(rendered(master), /Master/);
    assert.match(rendered(master), /─{10}/);
    assert.match(rendered(assistant), /\x1b\[37m/);
    assert.match(rendered(tool), /\x1b\[95m/);
    const system = { ...master, role: "system" };
    assert.match(rendered(system), /系统/);
    assert.doesNotMatch(rendered(system), /工具/);
    if (tool.kind === "activity") {
      const unsafe = {
        ...tool,
        activity: { ...tool.activity, phase: "tool\x1b[2J\nnext\x07" },
      };
      assert.doesNotMatch(rendered(unsafe), /\x1b\[2J|\x07/);
    }
  } finally {
    views.stop();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
