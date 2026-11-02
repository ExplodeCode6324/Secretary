import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, Fixture, until } from "../issue9/helpers.ts";
import { execution, decision } from "../issue92/helpers.ts";
import { MatterController } from "../../../src/pi_secretary/src/tui/matter.ts";
import { CancelController } from "../../../src/pi_secretary/src/tui/cancel.ts";
import {
  parseInput,
  parseDraft,
} from "../../../src/pi_secretary/src/tui/input.ts";
import { plainSnapshot } from "../../../src/pi_secretary/src/tui/draft.ts";
import { TerminalApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import type { Input } from "../../../src/pi_secretary/src/contracts.ts";
import type { MasterAttention } from "../../../src/pi_secretary/src/api/contracts.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
const shiftEnter = "\x1b[13;2u";
test("cancel parser requires one exact full ID in Task and preserves ID case and slash origin", () => {
  const target = id().toUpperCase(),
    raw = `/CaNcEl --execution ${target}`;
  assert.deepEqual(parseInput(raw, "Task"), {
    kind: "cancel",
    target: "execution",
    id: target,
  });
  for (const text of [
    `/cancel --request ${target} --execution ${target}`,
    `/cancel --execution ${target.slice(0, 8)}`,
    raw + "\n",
    `/cancel ${target}`,
  ])
    assert.equal(parseInput(text, "Task").kind, "error");
  assert.equal(parseInput(raw, "Main").kind, "error");
  assert.equal(parseDraft(plainSnapshot(raw), "Task").kind, "error");
});

test("failure envelope survives lost response and reconnect; one Main input and no direct disposal", () =>
  fixture(async (f) => {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "x" });
    const row = (
      await f.client.query<MasterAttention>("attention?view=master")
    ).items.find((r) => r.id === e.id)!;
    const c = new MatterController();
    let offline = false;
    const posts: string[] = [];
    c.connect(
      {
        query: async <T>(r: string) => {
          if (offline) throw Error("offline");
          return f.client.query<T>(r);
        },
        command: async (r, b) => {
          posts.push(b.request_id);
          const result = await f.client.command(r, b);
          offline = true;
          throw Error("response lost");
        },
      },
      "domain",
    );
    try {
      await c.open(e.id, "Main", row);
      assert.equal(c.current?.kind, "failure");
      await c.submitFailure();
      assert.equal(posts.length, 0);
      await c.submitFailure("DISMISS");
      assert(c.pending);
      const request = c.pending.id;
      await c.submitFailure("REDO");
      assert.equal(posts.length, 1);
      offline = false;
      c.connect(f.client, "domain");
      await c.reconcile();
      assert(!c.pending);
      assert.equal(
        f.app.store.all<Input>("Input").filter((i) => i.dedupe_key === request)
          .length,
        1,
      );
      assert.match(c.hint, /Main 输入已接收/);
      assert.equal(c.current?.data.disposition, "UNRESOLVED");
    } finally {
      c.stop();
    }
  }));

test("cancellation lost reply is reconciled by its exact request; terminal state is not attributed to cancel", () =>
  fixture(async (f) => {
    const d = await decision(f),
      c = new CancelController();
    let lost = true;
    const posts: string[] = [];
    c.connect(
      {
        query: async <T>(r: string) => {
          if (lost) throw Error("offline");
          return f.client.query<T>(r);
        },
        command: async (r, b) => {
          posts.push(b.request_id);
          await f.client.command(r, b);
          throw Error("lost");
        },
      },
      "domain",
    );
    await c.submit("execution", d.execution_id);
    const request = c.pending!.id;
    assert.match(c.hint, /未确认/);
    lost = false;
    c.connect(f.client, "domain");
    await c.reconcile();
    assert(c.pending!.accepted);
    assert.equal(c.pending!.id, request);
    assert.match(c.hint, /CANCELLED/);
    assert.match(c.hint, /不证明/);
    await c.submit("execution", d.execution_id);
    assert.equal(posts.length, 1);
    assert.equal(c.pending!.id, request);
    c.stop();
  }));

test("failure UI opens neutral, Enter cannot execute, explicit dismissal preserves the current rich Main draft", async () => {
  const f = new Fixture();
  await f.open();
  const e = await execution(f);
  f.app.scheduler.finish(e.id, "FAILED", { error: "x" });
  await fs.writeFile(
    path.join(f.dir, "core-endpoint.json"),
    JSON.stringify(f.server.endpoint),
    { mode: 0o600 },
  );
  const terminal = new VirtualTerminal(100, 32),
    ui = new TerminalApp(f.dir, terminal, path.join(f.dir, "tui-state"));
  ui.start();
  try {
    await until(
      () => !!ui.remote?.attention.head && ui.editors.Main.enabled,
      5000,
    );
    terminal.sendInput(
      "\x1b[200~中文😀\n" + "保留草稿".repeat(30) + "\x1b[201~",
    );
    const saved = ui.editors.Main.snapshot();
    // Public UI navigation: draft may be nonempty, select attention by leaving input.
    await (ui as any).openMatter(
      e.id,
      ui.remote!.attention.head!.items.find((r) => r.id === e.id),
    );
    const before = f.app.store.all<Input>("Input").length;
    terminal.sendInput("\r");
    terminal.sendInput(shiftEnter);
    assert.equal(f.app.store.all<Input>("Input").length, before);
    terminal.sendInput("\t");
    terminal.sendInput("\t");
    terminal.sendInput(shiftEnter);
    await until(() => f.app.store.all<Input>("Input").length === before + 1);
    const input = f.app.store.all<Input>("Input").at(-1)!;
    assert.equal(input.failure_action?.action, "DISMISS");
    assert.equal(
      f.app.store.bytes(input.payload).toString(),
      JSON.stringify({
        failure_action: input.failure_action,
        failure_intent_id: input.dedupe_key,
      }),
    );
    terminal.sendInput("\x1b");
    assert.deepEqual(ui.editors.Main.snapshot(), saved);
    assert.equal(ui.page, "Main");
    assert.equal(ui.remote?.attention.selected, undefined);
  } finally {
    await ui.close();
    await f.close();
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});

test("definitively rejected cancellation does not trap the next valid target", () =>
  fixture(async (f) => {
    const d = await decision(f),
      c = new CancelController();
    c.connect(f.client, "domain");
    await c.submit("execution", id());
    assert(!c.pending);
    assert.match(c.hint, /未被接收/);
    await c.submit("execution", d.execution_id);
    assert((c as CancelController).pending?.accepted);
    assert.match(c.hint, /CANCELLED/);
    c.stop();
  }));
