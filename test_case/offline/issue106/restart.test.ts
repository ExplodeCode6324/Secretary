import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Fixture, until } from "../issue9/helpers.ts";
import { AcceptanceBudget } from "../../online/issue106-budget.ts";
import { AcceptanceLifecycle } from "../../online/issue106-lifecycle.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { replyStream } from "../../../src/pi_secretary/src/model.ts";
import { guidanceFor } from "../../../src/pi_secretary/src/guidance.ts";
import type {
  Execution,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";
const submit = "\x1b[13;2u";
test("persisted ACTIVE restarts the actual Core pump; already-open TerminalApp reconnects and guide advances past SENT without connect handshake", async () => {
  const f = new Fixture();
  await f.open();
  let ui: TerminalApp | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let life: AcceptanceLifecycle | undefined;
  try {
    const p = f.app.scheduler.propose(
      "read gate and report",
      id(),
      f.app.host.sessionID,
      {
        title_candidate: "重连 引导",
        acceptance: ["Report evidence"],
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
    let clock = Date.now();
    const ledger = path.join(f.dir, "budget.json");
    const budget = new AcceptanceBudget(ledger, () => clock);
    budget.arm();
    budget.connect(() => {});
    for (let n = 0; n < 41; n++) budget.attempt("scripted-test");
    budget.proposals(121);
    clock += 31 * 60000;
    assert.throws(() => budget.requireReserve(), /RESERVE/);
    const endpoint = path.join(f.dir, "core-endpoint.json");
    await fs.writeFile(endpoint, JSON.stringify(f.server.endpoint), {
      mode: 0o600,
    });
    const terminal = new VirtualTerminal(100, 30);
    ui = new TerminalApp(f.dir, terminal, path.join(f.dir, "tui"));
    ui.start();
    await until(() => !!ui?.guidance?.client, 5000);
    terminal.sendInput("/t");
    terminal.sendInput(submit);
    const original = f.server.endpoint.instance_id;
    await f.restart();
    await fs.writeFile(endpoint, JSON.stringify(f.server.endpoint), {
      mode: 0o600,
    });
    assert.notEqual(f.server.endpoint.instance_id, original);
    const restored = new AcceptanceBudget(ledger, () => clock);
    assert.equal(
      restored.value.manual_started_at,
      budget.value.manual_started_at,
    );
    restored.connect = () => {
      throw Error("NO_NEW_HANDSHAKE_ALLOWED");
    };
    let pumps = 0;
    life = new AcceptanceLifecycle(
      restored,
      async () => {
        pumps++;
        await f.app.pump();
      },
      () => {
        throw Error("UNEXPECTED_EXHAUSTION");
      },
      (e) => {
        throw e;
      },
    );
    assert(life.enabled);
    Object.assign(f.app.scheduler, {
      stream: () => {
        const g = guidanceFor(f.app.store).list(e.id)[0];
        assert(g);
        return replyStream([
          {
            type: "toolCall",
            id: "receipt",
            name: "guidance_receipt",
            arguments: {
              items: [
                {
                  guidance_id: g.id,
                  outcome: "ADOPTED",
                  explanation: "Reconnected instruction",
                  effective_requirements: "report only",
                  conflicts_with: [],
                  resolution_refs: [],
                },
              ],
            },
          },
          {
            type: "toolCall",
            id: "result",
            name: "submit_result",
            arguments: {
              outcome: "SUCCEEDED",
              summary: "Reconnected guide applied",
              criteria: [{ id: "C1", met: true, evidence: "gate" }],
              artifacts: [],
              limitations: [],
            },
          },
        ]);
      },
    });
    timer = setInterval(() => life!.tick(), 30);
    await until(
      () =>
        ui?.guidance?.client?.endpoint.instance_id ===
        f.server.endpoint.instance_id,
      10000,
    );
    terminal.sendInput('/guide "重连 引导" 1 report only');
    terminal.sendInput(submit);
    await until(
      () => ui?.delivery?.state.guidanceLast?.status === "ACCEPTED",
      5000,
    );
    await fs.writeFile(path.join(f.app.scheduler.rootFor(e), "gate"), "ready");
    f.app.scheduler.ready(e.id);
    await until(
      () => !!guidanceFor(f.app.store).list(e.id)[0]?.guided_at,
      10000,
    );
    assert(pumps > 0);
    assert.equal(guidanceFor(f.app.store).list(e.id).length, 1);
    assert.equal(
      f.app.store.all<Input>("Input").filter((i) => i.guidance_id).length,
      1,
    );
    assert.equal(restored.value.phase, "ACTIVE");
    assert.equal(restored.remaining().physical, 59);
    assert.equal(restored.remaining().tools, 179);
  } finally {
    clearInterval(timer);
    await life?.stop();
    await ui?.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
