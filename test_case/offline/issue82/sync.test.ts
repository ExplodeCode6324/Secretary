import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import {
  SSEFramer,
  MainSync,
  type Frame,
} from "../../../src/pi_secretary/src/tui/sync.ts";
import { ClientStore } from "../../../src/pi_secretary/src/tui/state.ts";
import { StateWriter } from "../../../src/pi_secretary/src/tui/writer.ts";
import type { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import type { Core } from "../../../src/pi_secretary/src/api/contracts.ts";

test("SSE UTF-8 byte splits, CRLF, comments and multiline data retain complete event identity", () => {
  const frames: Frame[] = [],
    framer = new SSEFramer((frame) => frames.push(frame));
  const bytes = Buffer.from(
    ': heartbeat\r\n\r\nevent: change\r\nid: c1\r\ndata: {"text":"中文👩‍💻",\r\ndata: "line":2}\r\n\r\nevent: transient\ndata: {}\n\n',
  );
  for (const byte of bytes) framer.push(Uint8Array.of(byte));
  framer.finish();
  assert.deepEqual(frames, [
    { event: "change", id: "c1", data: '{"text":"中文👩‍💻",\n"line":2}' },
    { event: "transient", id: "", data: "{}" },
  ]);
});
test("SSE malformed, oversized and incomplete input never dispatches a partial change", () => {
  for (const bytes of [
    Buffer.from("data: " + "x".repeat(512 * 1024)),
    Buffer.from([0xff]),
    Buffer.from("event: change\ndata: {}\n"),
  ]) {
    const frames: Frame[] = [],
      framer = new SSEFramer((frame) => frames.push(frame));
    assert.throws(() => {
      framer.push(bytes);
      framer.finish();
    });
    assert.deepEqual(frames, []);
  }
});
test("cold cache remains stale until fresh cursor/snapshot/catchup; default reads never request thinking", async () => {
  const evidence = path.resolve(".demo-data/issue82-tui/implementation");
  fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const root = path.join(
    fs.mkdtempSync(path.join(evidence, "sync-test-")),
    "tui-v1",
  );
  const store = new ClientStore(new StateWriter(root));
  await store.open();
  await store.bind({ api_version: "1", mode: "fixture", data_domain_id: "d" });
  const page = {
      items: [],
      version: "1",
      generation: "g",
      before: null,
      after: null,
    },
    routes: string[] = [];
  await store.writer.checkpoint(
    {
      binding: store.state.binding,
      instance: "old",
      generation: "g",
      cursor: "old",
      dirty: {},
    },
    { page, session: null },
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const core = {
    api_version: "1",
    mode: "fixture",
    data_domain_id: "d",
    instance_id: "new",
  } as Core;
  const client = {
    async query(route: string) {
      routes.push(route);
      if (route === "sync/cursor") {
        await gate;
        return { cursor: "fresh", sequence: "0", instance_id: "new" };
      }
      if (route.startsWith("timeline")) return page;
      if (route === "session")
        return { id: "s", revision: "1", state: "IDLE", recovery_error: null };
      if (route.startsWith("sync/changes"))
        return { transactions: [], next_cursor: "fresh", has_more: false };
      throw Error("unexpected " + route);
    },
    async stream(_cursor: string, signal: AbortSignal) {
      return new ReadableStream({
        start(controller) {
          signal.addEventListener("abort", () => controller.close(), {
            once: true,
          });
        },
      });
    },
  } as unknown as CoreClient;
  const sync = new MainSync(store, async () => ({ client, core }));
  await sync.start();
  assert.equal(sync.stale, true);
  assert.equal(sync.status, "saved snapshot — stale/offline");
  release();
  const deadline = Date.now() + 3000;
  while (sync.stale && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sync.stale, false);
  assert.equal(routes[0], "sync/cursor");
  assert.ok(routes.some((r) => r.includes("after=fresh")));
  assert.ok(routes.every((r) => !r.includes("thinking=true")));
  const saved = await store.writer.loadCheckpoint();
  assert.equal((saved.value as { instance: string }).instance, "new");
  sync.close();
  const exit = once(store.writer.child, "exit");
  await store.close();
  await exit;
});

test("body-only batches fit four fragments, thinking is explicit and current transient uses streaming", async () => {
  const root = path.join(
    fs.mkdtempSync(
      path.resolve(".demo-data/issue82-tui/implementation/content-test-"),
    ),
    "tui-v1",
  );
  const store = new ClientStore(new StateWriter(root));
  await store.open();
  await store.bind({
    api_version: "1",
    mode: "fixture",
    data_domain_id: "content",
  });
  const core = {
    ...store.state.binding,
    instance_id: "content-instance",
  } as Core;
  const row = {
    id: "message:one",
    kind: "message",
    revision: "1",
    role: "assistant",
    text: "preview",
    call_id: "one",
    incomplete: true,
    next_cursor: "next",
    persistence: "durable",
  };
  const contentCalls: Array<{ route: string; maxBytes: number }> = [];
  const client = {
    async query(route: string, options: { maxBytes: number }) {
      if (route === "sync/cursor")
        return { cursor: "0", sequence: "0", instance_id: core.instance_id };
      if (route.startsWith("timeline"))
        return {
          items: [row],
          version: "1",
          generation: "g",
          before: null,
          after: null,
        };
      if (route === "session")
        return { id: "s", revision: "1", state: "IDLE", recovery_error: null };
      if (route.startsWith("sync/changes"))
        return { transactions: [], next_cursor: "0", has_more: false };
      if (route.startsWith("messages/")) {
        contentCalls.push({ route, maxBytes: options.maxBytes });
        const url = new URL("http://test/" + route),
          part = Number(url.searchParams.get("cursor") ?? 0),
          id = decodeURIComponent(url.pathname.split("/")[2]);
        return {
          ...row,
          id,
          revision: id === "message:live" ? "2" : "1",
          text: "t".repeat(28000),
          ...(url.searchParams.get("thinking") === "true"
            ? { thinking: "r".repeat(28000) }
            : {}),
          next_cursor: part === 3 ? null : String(part + 1),
        };
      }
      throw Error(route);
    },
    async stream(_cursor: string, signal: AbortSignal) {
      return new ReadableStream({
        start(controller) {
          if (signal.aborted) controller.close();
          else
            signal.addEventListener("abort", () => controller.close(), {
              once: true,
            });
        },
      });
    },
  } as unknown as CoreClient;
  const sync = new MainSync(store, async () => ({ core, client }));
  await sync.start();
  const deadline = Date.now() + 3000;
  while (sync.stale && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  try {
    assert.equal(sync.stale, false, sync.status);
    assert.equal(contentCalls.length, 0);
    await sync.more("message:one");
    assert.equal(contentCalls.length, 4);
    assert.equal(sync.loaded.get("message:one")!.text.length, 112000);
    assert.equal(sync.loaded.get("message:one")!.next, null);
    assert.ok(
      contentCalls.every(
        (call) =>
          call.route.includes("thinking=false") && call.maxBytes === 1048576,
      ),
    );
    sync.collapse("message:one");
    await sync.more("message:one", true);
    assert.equal(contentCalls.length, 6);
    assert.equal(sync.loaded.get("message:one")!.thinking.length, 56000);
    assert.ok(sync.loaded.get("message:one")!.next);
    sync.previews = [
      {
        id: "live",
        version: 2,
        status: "running",
        truncated: false,
        blocks: [{ index: 0, type: "text", text: "preview" }],
      },
    ];
    await sync.more("message:live", true);
    assert.ok(contentCalls.at(-1)!.route.includes("streaming=true"));
    assert.ok(
      contentCalls
        .slice(0, 6)
        .every((call) => call.route.includes("streaming=false")),
    );
  } finally {
    sync.close();
    const exit = once(store.writer.child, "exit");
    await store.close();
    await exit;
  }
});
