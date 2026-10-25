import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import {
  ClientStore,
  type Binding,
} from "../../../src/pi_secretary/src/tui/state.ts";
import { StateWriter } from "../../../src/pi_secretary/src/tui/writer.ts";
import {
  Outbox,
  type Attached,
} from "../../../src/pi_secretary/src/tui/outbox.ts";
import { CoreTransportError } from "../../../src/pi_secretary/src/core-client.ts";
import type { Receipt } from "../../../src/pi_secretary/src/api/contracts.ts";
const binding: Binding = {
  api_version: "1",
  data_domain_id: "test-domain",
  mode: "fixture",
};
const evidence = path.resolve(".demo-data/issue82-tui/implementation");
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
const run = fs.mkdtempSync(path.join(evidence, "outbox-tests-"));
const receipt = (id: string): Receipt => ({
  request_id: id,
  command: "messages",
  acceptance: "ACCEPTED",
  state: "FAILED",
  revision: "1",
  resource_ids: [],
  error_code: "MODEL_FAILED",
});
async function setup() {
  const root = path.join(fs.mkdtempSync(path.join(run, "state-")), "tui-v1");
  const writer = new StateWriter(root),
    store = new ClientStore(writer);
  await store.open();
  await store.bind(binding);
  return { root, store, writer };
}
async function close(store: ClientStore) {
  const exit = once(store.writer.child, "exit");
  await store.close();
  await exit;
}
async function enqueue(store: ClientStore, text = "body\u009b\n中文") {
  store.editors.Main.insert(text, "paste");
  return store.enqueue(
    "Main",
    text,
    binding,
    store.editors.Main.draft.revision,
  );
}
function attached(
  query: (route: string) => Promise<unknown>,
  post: (body: string, id: string) => Promise<Receipt>,
): Attached {
  return {
    core: { ...binding, instance_id: "instance" } as Attached["core"],
    client: {
      query: query as Attached["client"]["query"],
      commandFrozen: ((_route: string, body: string, id: string) =>
        post(body, id)) as Attached["client"]["commandFrozen"],
    },
  };
}

test("durable submit clears only originating revision; paste origin and undo survive reload", async () => {
  const { root, store, writer } = await setup();
  store.editors.Main.insert("typed", "typed");
  store.editors.Main.insert("\n/quit\u009b", "paste");
  await store.save();
  const snapshot = store.editors.Main.snapshot();
  await close(store);
  const reopened = new ClientStore(new StateWriter(root));
  await reopened.open();
  assert.deepEqual(reopened.editors.Main.snapshot(), snapshot);
  const commit = reopened.writer.commit.bind(reopened.writer);
  let duringCommit = false;
  reopened.writer.commit = async (...args) => {
    if (!duringCommit) {
      duringCommit = true;
      reopened.editors.Main.insert("new typing", "typed");
    }
    await commit(...args);
  };
  const entry = await reopened.enqueue(
    "Main",
    "frozen",
    binding,
    snapshot.draft.revision,
  );
  assert.ok(
    reopened.editors.Main.draft.nodes.some((n) =>
      n.text.includes("new typing"),
    ),
  );
  assert.equal(
    JSON.parse(await reopened.writer.read(entry.body)).text,
    "frozen",
  );
  await close(reopened);
  assert.equal(writer.healthy, false);
});

test("new submit stays FIFO tail behind Resume; lost receipt replays exact bytes before handoff", async () => {
  const { store } = await setup();
  const first = await enqueue(store, "first");
  await store.update(first.request_id, (e) => {
    e.state = "UNKNOWN";
    e.attempted = true;
    e.uncertain = true;
  });
  const requests: string[] = [],
    bodies: string[] = [];
  const api = attached(
    async (route) => {
      requests.push(route);
      return {
        receipt: receipt(first.request_id),
        resources: [],
        result: null,
      };
    },
    async (body, id) => {
      bodies.push(body);
      return receipt(id);
    },
  );
  const dispatcher = new Outbox(store, async () => api);
  dispatcher.connect(1);
  const second = await enqueue(store, "second");
  dispatcher.kick();
  await dispatcher.idle();
  assert.equal(bodies.length, 0);
  await dispatcher.observe();
  assert.equal(store.state.outbox.length, 2);
  const firstBytes = await store.writer.read(first.body),
    secondBytes = await store.writer.read(second.body);
  dispatcher.resume(1);
  await dispatcher.idle();
  assert.deepEqual(bodies, [firstBytes, secondBytes]);
  assert.equal(store.state.outbox.length, 0);
  assert.equal(store.state.receipts.length, 2);
  assert.ok(requests.length >= 2);
  dispatcher.close();
  await close(store);
});

test("disconnect during durable attempt ACK revokes POST; reopen conservatively reconciles", async () => {
  const { store } = await setup();
  await enqueue(store);
  let posts = 0;
  const dispatcher = new Outbox(store, async () =>
    attached(
      async (route) => {
        throw new CoreTransportError("NOT_FOUND", route, 404, true);
      },
      async (_body, id) => {
        posts++;
        return receipt(id);
      },
    ),
  );
  dispatcher.connect(1);
  const commit = store.writer.commit.bind(store.writer);
  store.writer.commit = async (...args) => {
    await commit(...args);
    dispatcher.disconnect(1);
  };
  dispatcher.resume(1);
  await dispatcher.idle();
  assert.equal(posts, 0);
  assert.equal(store.state.outbox[0].state, "ATTEMPTED");
  assert.equal(store.state.outbox[0].attempted, true);
  await assert.rejects(
    store.discard(store.state.outbox[0].request_id),
    /UNKNOWN_NOT_DISCARDABLE/,
  );
  dispatcher.close();
  store.writer.commit = commit;
  await close(store);
});

for (const failure of [
  "auth",
  "malformed404",
  "foreign",
  "conflict",
] as const) {
  test(`reconciliation ${failure} preserves unknown body and prevents unsafe advancement`, async () => {
    const { store } = await setup();
    const first = await enqueue(store),
      second = await enqueue(store, "tail");
    await store.update(first.request_id, (e) => {
      e.state = "UNKNOWN";
      e.attempted = true;
      e.uncertain = true;
    });
    let posts = 0;
    const api = attached(
      async (route) => {
        if (failure === "auth")
          throw new CoreTransportError("UNAUTHENTICATED", route, 401, true);
        if (failure === "malformed404")
          throw new CoreTransportError("INVALID_ENVELOPE", route, 404, false);
        return {
          receipt: receipt(first.request_id),
          resources: [],
          result: null,
        };
      },
      async () => {
        posts++;
        throw new CoreTransportError("REQUEST_CONFLICT", "messages", 409, true);
      },
    );
    if (failure === "foreign") api.core.data_domain_id = "foreign";
    const dispatcher = new Outbox(store, async () => api);
    dispatcher.connect(1);
    dispatcher.resume(1);
    await dispatcher.idle();
    dispatcher.close();
    assert.equal(posts, failure === "conflict" ? 1 : 0);
    assert.deepEqual(
      store.state.outbox.map((x) => x.request_id),
      [first.request_id, second.request_id],
    );
    assert.equal(
      store.state.outbox[0].state,
      failure === "conflict" ? "CONFLICT" : "UNKNOWN",
    );
    assert.equal(
      JSON.parse(await store.writer.read(first.body)).request_id,
      first.request_id,
    );
    await close(store);
  });
}

test("first pre-admission rejection retains editable body; ambiguous prior attempt remains UNKNOWN", async () => {
  for (const uncertain of [false, true]) {
    const { store } = await setup();
    const first = await enqueue(store);
    if (uncertain)
      await store.update(first.request_id, (e) => {
        e.state = "UNKNOWN";
        e.attempted = true;
        e.uncertain = true;
      });
    const api = attached(
      async (route) => {
        throw new CoreTransportError("NOT_FOUND", route, 404, true);
      },
      async () => {
        throw new CoreTransportError("INVALID_INPUT", "messages", 400, true);
      },
    );
    const dispatcher = new Outbox(store, async () => api);
    dispatcher.connect(1);
    dispatcher.resume(1);
    await dispatcher.idle();
    dispatcher.close();
    assert.equal(
      store.state.outbox[0].state,
      uncertain ? "UNKNOWN" : "NEEDS_EDIT",
    );
    if (uncertain)
      await assert.rejects(
        store.discard(first.request_id),
        /UNKNOWN_NOT_DISCARDABLE/,
      );
    else {
      await store.discard(first.request_id);
      assert.equal(store.state.outbox.length, 0);
    }
    await close(store);
  }
});

test("caller intent table classifies saves/admission only, never captured draft content", async () => {
  const { store, writer } = await setup();
  const seen: Array<{ op: string; intent: string }> = [];
  const request = (writer as any).request;
  (writer as any).request = function (...args: any[]) {
    seen.push({ op: args[0].op, intent: args[2] ?? "maintenance" });
    return request.apply(this, args);
  };
  async function check(
    label: string,
    action: () => Promise<unknown>,
    intent = "maintenance",
    op = "commit",
  ) {
    const start = seen.length;
    store.editors.Main.insert("x", "typed");
    await action();
    assert.deepEqual(seen.slice(start), [{ op, intent }], label);
  }
  await check("save", () => store.save(), "input-ack");
  await check("flush via save", () => store.flush(), "input-ack");
  await check("view captures unsaved draft but stays maintenance", () =>
    store.setView("Task"),
  );
  await check("anchor", () => store.setAnchor({ offset: 1 }));
  // Existing binding is a no-op; exercise the actual bind transaction once.
  store.state.binding = null;
  await check("bind", () => store.bind(binding));
  let entry!: Awaited<ReturnType<typeof enqueue>>;
  await check(
    "enqueue",
    async () => {
      entry = await enqueue(store);
    },
    "input-ack",
  );
  for (const state of [
    "UNKNOWN",
    "NEEDS_EDIT",
    "CONFLICT",
    "PREPARED",
  ] as const)
    await check("update " + state, () =>
      store.update(entry.request_id, (e) => {
        e.state = state;
      }),
    );
  await check("handoff", () =>
    store.handoff(entry.request_id, receipt(entry.request_id)),
  );
  entry = await enqueue(store);
  await check("discard", () => store.discard(entry.request_id));
  await check("collect", () => writer.collect(), "maintenance", "collect");
  await check("receipts", () => writer.receipts(), "maintenance", "receipts");
  await check(
    "checkpoint read",
    () => writer.loadCheckpoint(),
    "maintenance",
    "checkpoint-read",
  );
  entry = await enqueue(store);
  await check(
    "blob read",
    () => writer.read(entry.body),
    "maintenance",
    "read",
  );
  await check("restore save", () => store.save(), "input-ack");
  const start = seen.length;
  await close(store);
  assert.deepEqual(
    seen.slice(start),
    [{ op: "commit", intent: "input-ack" }],
    "close via flush/save",
  );
});
for (const outcome of ["success", "unknown", "needs-edit", "conflict"] as const)
  test(`actual outbox caller intent: pre-POST and ${outcome}`, async () => {
    const { store, writer } = await setup();
    const entry = await enqueue(store);
    const seen: Array<{ state: string | undefined; intent: string }> = [];
    const commit = writer.commit;
    writer.commit = function (...args: Parameters<StateWriter["commit"]>) {
      seen.push({
        state: (args[0] as any).outbox[0]?.state,
        intent: args[3] ?? "maintenance",
      });
      return commit.apply(this, args);
    };
    const dispatcher = new Outbox(store, async () =>
      attached(
        async (route) => {
          throw new CoreTransportError("NOT_FOUND", route, 404, true);
        },
        async (_body, id) => {
          if (outcome === "unknown") throw Error("lost response");
          if (outcome === "needs-edit")
            throw new CoreTransportError(
              "INVALID_INPUT",
              "messages",
              400,
              true,
            );
          if (outcome === "conflict")
            throw new CoreTransportError(
              "REQUEST_CONFLICT",
              "messages",
              409,
              true,
            );
          return receipt(id);
        },
      ),
    );
    dispatcher.connect(1);
    dispatcher.resume(1);
    await dispatcher.idle();
    assert.deepEqual(seen, [
      { state: "ATTEMPTED", intent: "input-ack" },
      {
        state:
          outcome === "success"
            ? undefined
            : outcome === "unknown"
              ? "UNKNOWN"
              : outcome === "needs-edit"
                ? "NEEDS_EDIT"
                : "CONFLICT",
        intent: "maintenance",
      },
    ]);
    if (outcome === "unknown") {
      dispatcher.disconnect(1);
      dispatcher.connect(2);
      const start = seen.length;
      await dispatcher.retry(entry.request_id, 2);
      await dispatcher.idle();
      assert.equal(dispatcher.needsResume, true);
      assert.deepEqual(seen.slice(start), [
        { state: "UNKNOWN", intent: "maintenance" },
      ]);
    }
    dispatcher.close();
    await close(store);
  });
