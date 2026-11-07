import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Fixture, until } from "../issue9/helpers.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  Guidance,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";
import { replyStream } from "../../../src/pi_secretary/src/model.ts";
import { guidanceFor } from "../../../src/pi_secretary/src/guidance.ts";
const submit = "\x1b[13;2u";
test("product TerminalApp over HTTP/SSE: Task draft, header preview, guide, SENT/RECEIVED/GUIDED, F6 detail", async () => {
  const f = new Fixture();
  await f.open();
  let ui: TerminalApp | undefined;
  try {
    const p = f.app.scheduler.propose(
      "Read gate and report",
      id(),
      f.app.host.sessionID,
      {
        title_candidate: "验收 目标",
        preconditions: [
          {
            condition_id: id(),
            kind: "RESOURCE_PRESENT",
            target: "gate",
            required_revision: null,
          },
        ],
      },
    );
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const e = f.app.store
      .all<Execution>("Execution")
      .find((e) => e.task_id === p.id)!;
    await fs.writeFile(
      path.join(f.dir, "core-endpoint.json"),
      JSON.stringify(f.server.endpoint),
      { mode: 0o600 },
    );
    const terminal = new VirtualTerminal(110, 35);
    ui = new TerminalApp(f.dir, terminal, path.join(f.dir, "tui"));
    ui.start();
    await until(
      () => !!ui?.remote?.attention.head && !!ui?.guidance?.client,
      5000,
    );
    terminal.sendInput("/t");
    terminal.sendInput(submit);
    await until(() => ui?.page === "Task");
    terminal.sendInput('\x1b[200~/guide "验收 目标" 1 pasted only\x1b[201~');
    terminal.sendInput(submit);
    assert.equal(f.app.store.all<Guidance>("Guidance").length, 0);
    terminal.sendInput("\x03");
    terminal.sendInput('/guide "验收 目标" 1 ');
    terminal.sendInput(
      "\x1b[200~Only report revised requirement\n保留末尾  \x1b[201~",
    );
    await until(() => !!ui?.guidance?.preview, 3000);
    assert.match(ui.guidance!.preview, /#1/);
    terminal.sendInput(submit);
    await until(
      () => ui?.delivery?.state.guidanceLast?.status === "ACCEPTED",
      5000,
    );
    await until(() => ui?.editors.Task.getText() === "");
    const g = guidanceFor(f.app.store).list(e.id)[0];
    assert.equal(
      f.app.store.bytes(g.text).toString(),
      "Only report revised requirement\n保留末尾  ",
    );
    assert.equal(
      f.app.store.all<Input>("Input").filter((i) => i.guidance_id === g.id)
        .length,
      1,
    );
    Object.assign(f.app.scheduler, {
      stream: () =>
        replyStream([
          {
            type: "toolCall",
            id: "r",
            name: "guidance_receipt",
            arguments: {
              items: [
                {
                  guidance_id: g.id,
                  outcome: "ADOPTED",
                  explanation: "Revised requirement observed",
                  effective_requirements: "Only revised report",
                  conflicts_with: [],
                  resolution_refs: [],
                },
              ],
            },
          },
          {
            type: "toolCall",
            id: "done",
            name: "submit_result",
            arguments: {
              outcome: "SUCCEEDED",
              summary: "Revised requirement observed",
              criteria: [{ id: "C1", met: true, evidence: "read gate" }],
              artifacts: [],
              limitations: [],
            },
          },
        ]),
    });
    await fs.writeFile(path.join(f.app.scheduler.rootFor(e), "gate"), "ok");
    f.app.scheduler.ready(e.id);
    await f.app.scheduler.run(e.id);
    terminal.sendInput('/taskdetail "验收 目标"');
    terminal.sendInput(submit);
    await until(
      () => !!ui?.remote?.taskBrowser.guidance.get(e.id)?.[0]?.guided_at,
      5000,
    );
    const entries = ui.remote!.taskBrowser.entries();
    const meta = entries.filter((x) => x.id === "guidance:" + g.id);
    assert.equal(meta.length, 1);
    const rendered = meta[0].component.render(160).join("\n");
    assert.match(rendered, /GUIDED/);
    assert(!rendered.includes("Only report"));
    const before = ui.editors.Task.snapshot();
    ui.remote!.taskBrowser.followTarget = e.id;
    terminal.sendInput("\x1b[17~");
    await terminal.waitForRender();
    assert(
      terminal.getViewport().join("\n").includes("重试原请求"),
      terminal.getViewport().join("\n"),
    );
    terminal.sendInput("\r");
    await terminal.waitForRender();
    assert(terminal.getViewport().join("\n").includes("保留末尾"));
    terminal.sendInput("\x1b");
    terminal.sendInput("\x1b");
    assert.deepEqual(ui.editors.Task.snapshot(), before);
    assert.equal(ui.remote!.taskBrowser.followTarget, e.id);
    await ui.close();
    ui = undefined;
  } finally {
    await ui?.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
