import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { LocalFiles } from "../../../src/pi_secretary/src/tui/state.ts";
import { Delivery } from "../../../src/pi_secretary/src/tui/delivery.ts";
import { ImageImports } from "../../../src/pi_secretary/src/tui/image-import.ts";
import { ATTACHMENT_DEFAULTS } from "../../../src/pi_secretary/src/attachments.ts";
import { Fixture, until } from "../issue9/helpers.ts";
import { execution } from "../issue92/helpers.ts";
import { base, id } from "../../../src/pi_secretary/src/store.ts";
import type {
  TaskResult,
  Execution,
} from "../../../src/pi_secretary/src/contracts.ts";

test("clipboard eligibility failures leave no material; actual capture failures retain exactly one", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "issue94-clipboard-flow-"),
  );
  const files = new LocalFiles(dir);
  const state = await files.open("fixture", "fixture");
  const delivery = new Delivery(state, files);
  let failure = "NO_CLIPBOARD_IMAGE",
    eligible = false,
    allowed = true;
  const ui = new TerminalApp(
    "unused",
    new VirtualTerminal(),
    dir,
    async () => true,
    async (_imageOnly, authorize) => {
      if (eligible) {
        await authorize();
        const disk = JSON.parse(
          await fs.readFile(path.join(dir, "state.json"), "utf8"),
        );
        assert.equal(
          disk.drafts.Main.materials.length,
          1,
          "attempt persisted before native pixel read",
        );
      }
      throw Error(failure);
    },
  );
  ui.delivery = delivery;
  (ui as any).files = files;
  (ui as any).imageImports = new ImageImports(delivery, files);
  delivery.client = {
    query: async () => ({
      capabilities: {
        attachments: {
          allowed,
          import_allowed: allowed,
          formats: ["image/png"],
          limits: ATTACHMENT_DEFAULTS,
        },
      },
    }),
  } as any;
  try {
    for (failure of [
      "NO_CLIPBOARD_IMAGE",
      "CLIPBOARD_FILE_REFERENCE_NOT_IMAGE",
      "CLIPBOARD_PROBE_FAILED",
      "LOCAL_MAC_REQUIRED",
    ]) {
      await (ui as any).pasteClipboard(true);
      assert.equal(state.drafts.Main.materials?.length ?? 0, 0);
      assert.equal((ui as any).uiHint, "Error: " + failure);
    }
    eligible = true;
    allowed = false;
    await (ui as any).pasteClipboard(true);
    assert.equal(state.drafts.Main.materials?.length ?? 0, 0);
    allowed = true;
    for (failure of ["CLIPBOARD_IMAGE_UNAVAILABLE", "CLIPBOARD_CHANGED"]) {
      await (ui as any).pasteClipboard(true);
      assert.equal(state.drafts.Main.materials?.length, 1);
      assert.equal(state.drafts.Main.materials?.[0].status, "FAILED");
      state.drafts.Main.materials = [];
    }
  } finally {
    clearTimeout((ui as any).localNoticeTimer);
    await delivery.close();
    await files.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("ordinary Up/Down crosses artifact page boundaries in the running TUI", async () => {
  const f = new Fixture();
  await f.open();
  let ui: TerminalApp | undefined;
  try {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "SUCCEEDED", { done: true });
    const done = f.app.store.get<Execution>("Execution", e.id);
    const original = f.app.store.get<TaskResult>("TaskResult", done.result_id!);
    const artifacts = Array.from({ length: 32 }, (_, n) => ({
      artifact_id: id(),
      name: `${n}.txt`,
      workspace_path: `${n}.txt`,
      content: f.app.store.put("snapshot", "text/plain"),
      producing_operation_id: null,
      description: "explanation",
    }));
    const result = { ...original, ...base(), artifacts };
    f.app.store.commit([result]);
    const call = id();
    const scope = {
      session_id: f.app.host.sessionID,
      task_id: null,
      execution_id: null,
    };
    const message = f.app.store.event(
      "main.message",
      {
        role: "assistant",
        content: [{ type: "text", text: "Finished" }],
        stopReason: "stop",
        timestamp: 1,
        display_call_id: call,
      },
      scope,
      "MAIN",
    );
    const sidecar = f.app.store.event(
      "main.delivery",
      {
        message_event_id: message.event_id,
        display_call_id: call,
        loop_id: id(),
        artifacts: artifacts.map((a) => ({
          task_id: e.task_id,
          execution_id: e.id,
          result_id: result.id,
          artifact_id: a.artifact_id,
        })),
      },
      scope,
      "MAIN",
    );
    f.app.store.commit([], [message, sidecar]);
    await fs.writeFile(
      path.join(f.dir, "core-endpoint.json"),
      JSON.stringify(f.server.endpoint),
      { mode: 0o600 },
    );
    const terminal = new VirtualTerminal(100, 24);
    ui = new TerminalApp(f.dir, terminal, path.join(f.dir, "tui"));
    ui.start();
    const mid = "message:" + call;
    await until(() => !!ui?.remote?.deliveries.get(mid), 5000);
    terminal.sendInput("\x1b[5~");
    ui.scrolls.Main.scrollToEnd();
    ui.draw();
    terminal.sendInput("\x1b[B");
    await until(
      () => ui?.remote?.deliveries.get(mid)?.previous.length === 1,
      5000,
    );
    assert.equal(ui.remote!.deliveries.get(mid)!.items.length, 12);
    const doc = ui.documents.Main;
    const rows = doc.render(100);
    const marker = rows.findIndex(
      (_, i) =>
        doc.rowAt(i)?.region === "artifacts" &&
        doc.rowAt(i)?.boundary === "before",
    );
    assert(marker >= 0);
    ui.scrolls.Main.scrollTo(marker);
    ui.draw();
    terminal.sendInput("\x1b[A");
    await until(
      () => ui?.remote?.deliveries.get(mid)?.previous.length === 0,
      5000,
    );
    assert.equal(ui.remote!.deliveries.get(mid)!.items.length, 20);
  } finally {
    await ui?.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
