import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { once } from "node:events";
import {
  ClientStore,
  supportedProducer,
} from "../../../src/pi_secretary/src/tui/state.ts";
import { StateWriter } from "../../../src/pi_secretary/src/tui/writer.ts";
import { Outbox } from "../../../src/pi_secretary/src/tui/outbox.ts";
const fixtures = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/browser-r7.json", import.meta.url),
    "utf8",
  ),
);
function root() {
  const parent = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "secretary-terminal-compat-"),
  );
  const dir = path.join(parent, "tui-v1");
  fs.mkdirSync(dir, { mode: 0o700 });
  return dir;
}
async function close(store: ClientStore) {
  const child = store.writer.child;
  const exit =
    child.exitCode === null && child.signalCode === null
      ? once(child, "exit")
      : Promise.resolve();
  await store.close();
  await exit;
}
function restore(variant: string) {
  const dir = root();
  for (const [name, body] of Object.entries(fixtures.profiles[variant].files))
    fs.writeFileSync(path.join(dir, name), body as string, { mode: 0o600 });
  return dir;
}
for (const variant of Object.keys(fixtures.profiles))
  test(`legacy ${variant} retains all durable fields, editor history, receipt and exact bodies across save/reopen`, async () => {
    const dir = restore(variant),
      expected = fixtures.profiles[variant].expected;
    for (let cycle = 0; cycle < 2; cycle++) {
      const store = new ClientStore(new StateWriter(dir));
      await store.open();
      try {
        assert.deepEqual(store.state, expected.state);
        assert.deepEqual(store.editors.Main.snapshot(), expected.editors.Main);
        assert.deepEqual(store.editors.Task.snapshot(), expected.editors.Task);
        for (const body of expected.bodies)
          assert.equal(
            await store.writer.read(
              store.state.outbox.find((e) => e.request_id === body.id)!.body,
            ),
            body.text,
          );
        for (const receipt of expected.receipts)
          assert.equal(
            await store.writer.read(
              store.state.receipts.find((e) => e.request_id === receipt.id)!
                .body,
            ),
            receipt.text,
          );
        let posts = 0;
        const outbox = new Outbox(store, async () => {
          posts++;
          throw Error("must not attach before Resume");
        });
        outbox.connect(1);
        outbox.kick();
        await outbox.idle();
        assert.equal(posts, 0);
        assert.equal(outbox.needsResume, true);
        outbox.close();
      } finally {
        await close(store);
      }
    }
  });
test("legacy UNKNOWN exact replay uses the same ID and raw bytes; new admission uses only the terminal pair", async () => {
  const dir = restore("UNKNOWN"),
    store = new ClientStore(new StateWriter(dir));
  await store.open();
  const original = structuredClone(store.state.outbox[0]),
    expected = fixtures.profiles.UNKNOWN.expected.bodies[0].text;
  const receipt = {
    request_id: original.request_id,
    command: "messages",
    acceptance: "ACCEPTED",
    state: "COMPLETED",
    revision: "1",
    resource_ids: [],
    error_code: null,
  } as const;
  const sent: string[] = [];
  const outbox = new Outbox(store, async () => ({
    core: { ...store.state.binding!, instance_id: "synthetic" } as any,
    client: {
      query: async () => ({ receipt, resources: [] }) as any,
      commandFrozen: async (_route, body, id) => {
        assert.equal(id, original.request_id);
        sent.push(body);
        return { ...receipt, resource_ids: [] };
      },
    },
  }));
  try {
    outbox.connect(1);
    outbox.kick();
    await outbox.idle();
    assert.deepEqual(sent, []);
    outbox.resume(1);
    await outbox.idle();
    assert.deepEqual(sent, [expected]);
    assert.equal(store.state.outbox.length, 0);
    outbox.disconnect(1);
    const entry = await store.enqueue(
      "Main",
      "new terminal",
      store.state.binding!,
      store.editors.Main.draft.revision,
    );
    assert.deepEqual(entry.producer, {
      class: "terminal-bracketed-paste",
      policy: "issue82-terminal-r1",
    });
  } finally {
    outbox.close();
    await close(store);
  }
});
test("unknown exact producer pair fails closed; public mutations and close cannot replace it", async () => {
  const dir = restore("UNKNOWN"),
    manifestFile = path.join(dir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.data.outbox[0].producer.policy = "unknown";
  fs.writeFileSync(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
  const before = fs.readFileSync(manifestFile);
  const store = new ClientStore(new StateWriter(dir));
  await assert.rejects(store.open(), /CORRUPT_OUTBOX/);
  await assert.rejects(store.save(), /STATE_NOT_OPEN/);
  await assert.rejects(
    store.bind({ api_version: "1", mode: "fixture", data_domain_id: "other" }),
    /STATE_NOT_OPEN/,
  );
  assert.throws(() => store.edited(), /STATE_NOT_OPEN/);
  await close(store);
  assert.deepEqual(fs.readFileSync(manifestFile), before);
  assert.equal(
    supportedProducer({
      class: "browser-structured",
      policy: "issue82-terminal-r1",
    }),
    false,
  );
  assert.equal(
    supportedProducer({
      class: "terminal-bracketed-paste",
      policy: "issue82-terminal-r1",
      extra: true,
    }),
    false,
  );
});
for (const orphan of ["blob-orphan", "checkpoint.json", ".pending-1"])
  test(`missing manifest with ${orphan} refuses initialization without deleting evidence`, async () => {
    const dir = root(),
      file = path.join(dir, orphan);
    fs.writeFileSync(file, "synthetic retained", { mode: 0o600 });
    const store = new ClientStore(new StateWriter(dir));
    await assert.rejects(store.open(), /MISSING_CLIENT_MANIFEST/);
    await close(store);
    assert.equal(fs.readFileSync(file, "utf8"), "synthetic retained");
    assert.equal(fs.existsSync(path.join(dir, "manifest.json")), false);
  });
test("pristine profile initializes, but a public save before successful open is refused", async () => {
  const store = new ClientStore(new StateWriter(root()));
  await assert.rejects(store.save(), /STATE_NOT_OPEN/);
  await store.open();
  await close(store);
});
test("mixed legacy and new terminal entries retain distinct producers and ordering on reopen", async () => {
  const dir = restore("MIXED");
  let store = new ClientStore(new StateWriter(dir));
  await store.open();
  const old = structuredClone(store.state.outbox);
  const entry = await store.enqueue(
    "Main",
    "new tail",
    store.state.binding!,
    store.editors.Main.draft.revision,
  );
  await close(store);
  store = new ClientStore(new StateWriter(dir));
  await store.open();
  try {
    assert.deepEqual(store.state.outbox.slice(0, old.length), old);
    assert.deepEqual(store.state.outbox.at(-1), entry);
    assert.ok(old.every((e) => e.producer.class === "browser-structured"));
    assert.equal(entry.producer.class, "terminal-bracketed-paste");
  } finally {
    await close(store);
  }
});
test("corrupt manifest remains untouched after open/close failure", async () => {
  const dir = root(),
    file = path.join(dir, "manifest.json");
  fs.writeFileSync(file, "{broken", { mode: 0o600 });
  const store = new ClientStore(new StateWriter(dir));
  await assert.rejects(store.open());
  await close(store);
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});
