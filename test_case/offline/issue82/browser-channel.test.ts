import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { once } from "node:events";
import { BrowserServer } from "../../../src/pi_secretary/src/tui/server.ts";
import { InputProtocol } from "../../../src/pi_secretary/src/tui/input.ts";
import { Editor, flatten } from "../../../src/pi_secretary/src/tui/editor.ts";
function peer(server: BrowserServer, origin = server.origin) {
  const ws = new WebSocket(server.origin.replace("http:", "ws:") + "/channel", {
    origin,
  });
  const queue: Record<string, any>[] = [],
    pending: Array<(v: Record<string, any>) => void> = [];
  ws.on("message", (raw) => {
    const value = JSON.parse(String(raw));
    const resolve = pending.shift();
    if (resolve) resolve(value);
    else queue.push(value);
  });
  return {
    ws,
    read: () =>
      queue.length
        ? Promise.resolve(queue.shift()!)
        : new Promise<Record<string, any>>((resolve) => pending.push(resolve)),
    send: (v: unknown) => ws.send(JSON.stringify(v)),
  };
}
async function authenticate(server: BrowserServer, credential: string) {
  const p = peer(server);
  await once(p.ws, "open");
  p.send({ type: "hello", credential });
  const hello = await p.read();
  assert.equal(hello.type, "hello");
  p.send({ type: "hello-ack", generation: hello.generation });
  assert.equal((await p.read()).type, "sync");
  p.send({ type: "sync-ack", generation: hello.generation });
  assert.equal((await p.read()).type, "ready");
  return {
    ...p,
    reconnect: String(hello.reconnect),
    generation: Number(hello.generation),
  };
}
test("single-use bootstrap, strict Origin and synchronized generation revoke duplicate tab", async () => {
  const connections: number[] = [],
    revoked: number[] = [],
    events: unknown[] = [];
  const server = new BrowserServer(
    { "/": { type: "text/html", body: "test" } },
    {
      snapshot: () => ({ revision: 0 }),
      event: async (e) => {
        events.push(e);
      },
      connected: (g) => {
        connections.push(g);
      },
      disconnected: (g) => {
        revoked.push(g);
      },
      expired() {},
    },
  );
  await server.listen();
  try {
    const hostile = peer(server, "https://example.com");
    const error = once(hostile.ws, "error");
    await error;
    const first = await authenticate(server, server.launchURL.split("#")[1]);
    const reused = peer(server);
    await once(reused.ws, "open");
    reused.send({ type: "hello", credential: server.launchURL.split("#")[1] });
    assert.equal((await reused.read()).type, "invalid-credential");
    const second = await authenticate(server, first.reconnect);
    assert.equal((await first.read()).type, "replaced");
    assert.deepEqual(revoked, [1]);
    assert.deepEqual(connections, [1, 2]);
    second.send({
      type: "event",
      generation: 2,
      seq: 1,
      event: { type: "action" },
    });
    assert.equal((await second.read()).type, "ack");
    assert.equal(events.length, 1);
    second.send({ type: "event", generation: 1, seq: 2, event: {} });
    assert.equal((await second.read()).type, "replaced");
    assert.equal(events.length, 1);
  } finally {
    await server.close();
  }
});
test("unconsumed bootstrap and lost handshake expire without unauthenticated extension", async () => {
  for (const consume of [false, true]) {
    let expired = 0;
    const server = new BrowserServer(
      {},
      {
        snapshot: () => ({}),
        event: async () => {},
        connected() {},
        disconnected() {},
        expired() {
          expired++;
        },
      },
      80,
    );
    await server.listen();
    if (consume) {
      const p = peer(server);
      await once(p.ws, "open");
      p.send({ type: "hello", credential: server.launchURL.split("#")[1] });
      await p.read();
      p.ws.terminate();
    }
    await new Promise((resolve) => setTimeout(resolve, 140));
    assert.equal(expired, 1);
    await server.close();
  }
});
test("structured paste cannot dispatch and partial transactions cannot authorize actions", () => {
  const editor = new Editor(),
    input = new InputProtocol(() => editor),
    text = "/quit\r\n\u001b[201~\u0013\u009b\0中文";
  input.apply({ type: "begin", revision: 0, id: "paste-1", source: "paste" });
  assert.throws(
    () => input.apply({ type: "action", revision: 0, action: "submit" }),
    /INCOMPLETE/,
  );
  input.apply({ type: "chunk", revision: 0, id: "paste-1", index: 0, text });
  assert.deepEqual(
    input.apply({ type: "commit", revision: 0, id: "paste-1" }),
    { changed: true },
  );
  assert.equal(flatten(editor.draft.nodes), text.replace(/\r\n?/g, "\n"));
  assert.equal(editor.draft.nodes[0].kind, "paste");
  assert.throws(
    () => input.apply({ type: "action", revision: 0, action: "submit" }),
    /STALE_REVISION/,
  );
  assert.throws(
    () =>
      input.apply({
        type: "action",
        revision: 1,
        action: "submit",
        trusted: true,
      }),
    /INVALID_EVENT_FIELDS/,
  );
});
