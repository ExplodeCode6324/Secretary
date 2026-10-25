import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import { ClientStore } from "../../../src/pi_secretary/src/tui/state.ts";
import { StateWriter } from "../../../src/pi_secretary/src/tui/writer.ts";
import { Outbox, bindingOf } from "../../../src/pi_secretary/src/tui/outbox.ts";
import { MainSync } from "../../../src/pi_secretary/src/tui/sync.ts";
const evidence = path.resolve(".demo-data/issue82-tui/implementation");
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
test("real fixture Core accepts frozen control-bearing text once across lost-receipt replay; client shutdown leaves Core attached", async () => {
  const dir = fs.mkdtempSync(path.join(evidence, "core-integration-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const server = await serveCore(app, 0, undefined, { pump: false }),
    client = new CoreClient(server.endpoint);
  const store = new ClientStore(new StateWriter(path.join(dir, "tui-v1")));
  await store.open();
  const core = await client.core(),
    binding = bindingOf(core);
  await store.bind(binding);
  const text = "/quit\n\u001b[201~\u0013\u009b\0\t中文👩‍💻";
  store.editors.Main.insert(text, "paste");
  const entry = await store.enqueue(
    "Main",
    text,
    binding,
    store.editors.Main.draft.revision,
  );
  const frozen = await store.writer.read(entry.body);
  const first = await client.commandFrozen(
    "messages",
    frozen,
    entry.request_id,
    entry.body_sha256,
  );
  await store.update(entry.request_id, (e) => {
    e.state = "UNKNOWN";
    e.attempted = true;
    e.uncertain = true;
  });
  const outbox = new Outbox(store, async () => ({
    client,
    core: await client.core(),
  }));
  const sync = new MainSync(store, async () => ({
    client,
    core: await client.core(),
  }));
  try {
    outbox.connect(1);
    outbox.resume(1);
    await outbox.idle();
    assert.equal(store.state.outbox.length, 0);
    assert.equal(store.state.receipts.length, 1);
    const status = await client.query<{ receipt: { resource_ids: unknown[] } }>(
      "requests/" + entry.request_id,
    );
    assert.deepEqual(status.receipt.resource_ids, first.resource_ids);
    await sync.start();
    const deadline = Date.now() + 4000;
    while (sync.stale && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(sync.stale, false, sync.status);
    const rows = sync.page.items.filter(
      (item) => item.kind === "message" && item.request_id === entry.request_id,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, text);
    sync.close();
    outbox.close();
    const exit = once(store.writer.child, "exit");
    await store.close();
    await exit;
    assert.equal((await client.core()).instance_id, core.instance_id);
  } finally {
    sync.close();
    outbox.close();
    if (store.writer.healthy) {
      const exit = once(store.writer.child, "exit");
      await store.close();
      await exit;
    }
    await server.close();
    await app.close();
  }
});

test("product commands preserve Task drafts and require explicit replacement; foreign endpoint quarantines mutations", async () => {
  const { TuiApp } = await import("../../../src/pi_secretary/src/tui/app.ts");
  const dir = fs.mkdtempSync(path.join(evidence, "product-core-"));
  const coreApp = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const server = await serveCore(coreApp, 0, undefined, { pump: false });
  fs.writeFileSync(
    path.join(dir, "core-endpoint.json"),
    JSON.stringify(server.endpoint),
    { mode: 0o600 },
  );
  const product = new TuiApp(
    {
      data: dir,
      mode: "fixture",
      open: false,
      quota: 256 * 1024 * 1024,
      maxOutbox: 1000,
      aliases: { cotv: "cotvisible" },
    },
    {},
  );
  await product.start();
  product.outbox.connect(1);
  const deadline = Date.now() + 4000;
  while (product.sync.stale && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(product.sync.stale, false, product.sync.status);
  const event = (value: Record<string, unknown>) =>
    product.event({ revision: product.editor().draft.revision, ...value }, 1);
  const action = (name: string) => event({ type: "action", action: name });
  const command = async (text: string) => {
    await action("commands");
    await event({ type: "insert", text });
    await action("submit");
  };
  try {
    await command("/T");
    await event({ type: "insert", text: "original Task draft" });
    await action("submit");
    assert.equal(product.store.state.outbox.length, 0);
    assert.equal(product.store.state.view, "Task");
    await command("/send replacement");
    assert.equal(product.snapshot().replacement, true);
    assert.equal(
      product.store.editors.Task.draft.nodes[0].text,
      "original Task draft",
    );
    await event({ type: "dismiss" });
    assert.equal(
      product.store.editors.Task.draft.nodes[0].text,
      "original Task draft",
    );
    await command("/send replacement");
    await action("submit");
    await product.outbox.idle();
    assert.equal(product.store.state.receipts.length, 1);
    assert.equal(product.store.editors.Task.draft.nodes.length, 0);
    product.store.editors.Task.insert(
      "large\n" + "x".repeat(600000),
      "paste",
      true,
    );
    await product.store.save();
    const block = product.store.editors.Task.draft.nodes[0];
    await assert.rejects(
      command("/pasteblock " + block.id + " remove"),
      /NON_UNDOABLE_CONFIRMATION_REQUIRED/,
    );
    assert.equal(product.store.editors.Task.draft.nodes[0].text.length, 600006);
    await event({ type: "confirm-large", accept: true });
    assert.equal(product.store.editors.Task.draft.nodes.length, 0);
    await product.store.flush();
    const foreignDir = fs.mkdtempSync(path.join(evidence, "foreign-core-"));
    const foreignApp = await App.open(foreignDir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    const foreignServer = await serveCore(foreignApp, 0, undefined, {
      pump: false,
    });
    try {
      fs.writeFileSync(
        path.join(dir, "core-endpoint.json"),
        JSON.stringify(foreignServer.endpoint),
        { mode: 0o600 },
      );
      await command("/send retained on foreign domain");
      await product.outbox.idle();
      assert.equal(product.store.readOnly, true);
      assert.equal(product.store.state.outbox.length, 1);
      await assert.rejects(
        event({ type: "insert", text: "must not replace" }),
        /QUARANTINED/,
      );
      await assert.rejects(
        product.store.discard(product.store.state.outbox[0].request_id),
        /QUARANTINED/,
      );
      const foreignClient = new CoreClient(foreignServer.endpoint);
      const foreignPage = await foreignClient.query<{ items: unknown[] }>(
        "timeline",
      );
      assert.equal(foreignPage.items.length, 0);
    } finally {
      await foreignServer.close();
      await foreignApp.close();
    }
  } finally {
    const exit = once(product.store.writer.child, "exit");
    await product.close();
    await exit;
    await server.close();
    await coreApp.close();
  }
});
