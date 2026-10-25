import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { WebSocket } from "ws";
import {
  Editor,
  GraphemeIndex,
  boundaries,
  flatten,
  validateDraft,
  DRAFT_BYTES,
} from "../../../src/pi_secretary/src/tui/editor.ts";
import { InputProtocol } from "../../../src/pi_secretary/src/tui/input.ts";
import { ClientStore } from "../../../src/pi_secretary/src/tui/state.ts";
import { StateWriter } from "../../../src/pi_secretary/src/tui/writer.ts";
import { TuiApp } from "../../../src/pi_secretary/src/tui/app.ts";
import { parseSubmission } from "../../../src/pi_secretary/src/tui/commands.ts";
const evidence = path.resolve(".demo-data/issue82-tui/implementation");
const directory = () => fs.mkdtempSync(path.join(evidence, "r1-regression-"));
async function shutdown(store: ClientStore) {
  const exited = once(store.writer.child, "exit");
  await store.close();
  await exited;
}
async function product() {
  const dir = directory();
  const app = new TuiApp(
    {
      data: dir,
      mode: "fixture",
      open: false,
      quota: 256 * 1024 * 1024,
      maxOutbox: 1000,
      aliases: {},
    },
    {},
  );
  await app.store.open();
  return app;
}
test("full-context indexed boundaries match ICU across unbounded RI and combining/ZWJ contexts", () => {
  for (const text of [
    "e" + "\u0301".repeat(10000),
    "🇦".repeat(1001),
    "👩" + "\u200d👩".repeat(1001),
    "각✈️",
  ]) {
    const index = new GraphemeIndex(text),
      expected = boundaries(text);
    for (let offset = 0; offset <= text.length; offset++) {
      assert.equal(index.has(offset), expected.includes(offset));
      assert.equal(
        index.snap(offset, true),
        expected.find((n) => n >= offset),
      );
      assert.equal(
        index.snap(offset, false),
        expected.findLast((n) => n <= offset),
      );
    }
  }
});
test("durable reopen repairs only valid-range legacy caret metadata and retains UNKNOWN outbox bytes", async () => {
  const dir = directory(),
    root = path.join(dir, "tui-v1"),
    binding = {
      api_version: "1",
      data_domain_id: "unicode-recovery",
      mode: "fixture",
    } as const;
  let store = new ClientStore(new StateWriter(root));
  await store.open();
  await store.bind(binding);
  const entry = await store.enqueue(
    "Main",
    "pending original body",
    binding,
    store.editors.Main.draft.revision,
  );
  await store.update(entry.request_id, (item) => {
    item.state = "UNKNOWN";
    item.attempted = true;
    item.uncertain = true;
  });
  const original = await store.writer.read(entry.body);
  try {
    for (const [prefix, suffix] of [
      ["e", "\u0301abc"],
      ["👩", "\u200d💻"],
      ["✈", "\ufe0f"],
      ["🇨", "🇦🇧"],
      ["ᄀ", "ᅡ"],
    ]) {
      const e = (store.editors.Main = new Editor());
      e.insert(suffix, "paste");
      e.select({ anchor: 0, head: 0 });
      e.insert(prefix, "typed");
      validateDraft(e.draft);
      e.undo();
      e.undo(true);
      validateDraft(e.draft);
      assert.equal(flatten(e.draft.nodes), prefix + suffix);
      // Reproduce metadata emitted by the first product commit, without weakening blob authentication.
      e.draft.selection = { anchor: prefix.length, head: prefix.length };
      await store.save();
      await shutdown(store);
      store = new ClientStore(new StateWriter(root));
      await store.open();
      validateDraft(store.editors.Main.draft);
      assert.equal(flatten(store.editors.Main.draft.nodes), prefix + suffix);
      assert.equal(store.state.outbox[0].state, "UNKNOWN");
      assert.equal(
        await store.writer.read(store.state.outbox[0].body),
        original,
      );
      const broken = store.editors.Main.snapshot();
      broken.draft.selection.head = -1;
      assert.throws(() => Editor.restore(broken), /INVALID_SELECTION/);
      broken.draft.selection.head = 1e9;
      assert.throws(() => Editor.restore(broken), /INVALID_SELECTION/);
    }
  } finally {
    await shutdown(store);
  }
});
test("completion cannot promote paste-origin tokens, including mixed ranges and cycles", async () => {
  const app = await product();
  try {
    const e = app.store.editors.Main;
    e.insert("/qu", "paste");
    const before = e.snapshot();
    (app as any).complete();
    assert.deepEqual(e.snapshot(), before);
    assert.equal(parseSubmission(e.draft, "Main").kind, "message");
    assert.match((app as any).notice, /only to typed/);
    app.store.editors.Main = new Editor();
    const mixed = app.store.editors.Main;
    mixed.insert("/q", "typed");
    mixed.insert("u", "paste");
    const mixedBefore = mixed.snapshot();
    (app as any).complete();
    (app as any).complete();
    assert.deepEqual(mixed.snapshot(), mixedBefore);
    app.store.editors.Main = new Editor();
    const typed = app.store.editors.Main;
    typed.insert("/", "typed");
    (app as any).complete();
    const first = flatten(typed.draft.nodes);
    (app as any).complete();
    assert.notEqual(flatten(typed.draft.nodes), first);
    assert.ok(typed.draft.nodes.every((n) => n.kind === "typed"));
  } finally {
    await app.close();
  }
});
test("empty paste transaction preserves selection, history and body; cancelled transaction permits editing", () => {
  const e = new Editor();
  e.insert("keep", "typed");
  e.select({ anchor: 0, head: 4 });
  const input = new InputProtocol(() => e),
    before = e.snapshot(),
    revision = e.draft.revision;
  input.apply({ type: "begin", revision, id: "empty", source: "paste" });
  input.apply({ type: "commit", revision, id: "empty" });
  assert.deepEqual(e.snapshot(), before);
  input.apply({ type: "begin", revision, id: "cancelled", source: "paste" });
  input.apply({ type: "cancel", revision });
  input.apply({ type: "insert", revision, text: "edit" });
  assert.equal(flatten(e.draft.nodes), "edit");
});
test(
  "non-empty draft accepts paste up to 4MiB through real chunk ACKs within 5s; large keystrokes stay bounded",
  { timeout: 30000 },
  async () => {
    const app = await product();
    let ws: WebSocket | undefined;
    try {
      app.store.editors.Main.insert("a".repeat(400 * 1024), "typed", true);
      let snapshots = 0;
      const snapshot = app.snapshot.bind(app);
      app.snapshot = () => {
        snapshots++;
        return snapshot();
      };
      const url = await app.browser.listen();
      ws = new WebSocket(
        app.browser.origin.replace("http:", "ws:") + "/channel",
        { origin: app.browser.origin },
      );
      const messages: any[] = [],
        waiting: Array<(value: any) => void> = [];
      ws.on("message", (raw) => {
        const value = JSON.parse(String(raw)),
          resolve = waiting.shift();
        if (resolve) resolve(value);
        else messages.push(value);
      });
      const read = () =>
        messages.length
          ? Promise.resolve(messages.shift())
          : new Promise<any>((resolve) => waiting.push(resolve));
      await once(ws, "open");
      ws.send(JSON.stringify({ type: "hello", credential: url.split("#")[1] }));
      const hello = await read(),
        generation = hello.generation;
      ws.send(JSON.stringify({ type: "hello-ack", generation }));
      assert.equal((await read()).type, "sync");
      ws.send(JSON.stringify({ type: "sync-ack", generation }));
      assert.equal((await read()).type, "ready");
      let seq = 0;
      const event = async (event: unknown) => {
        const target = ++seq;
        ws!.send(
          JSON.stringify({ type: "event", generation, seq: target, event }),
        );
        while (true) {
          const value = await read();
          if (value.seq === target) return value;
        }
      };
      const revision = app.store.editors.Main.draft.revision,
        text = "b".repeat(DRAFT_BYTES - 400 * 1024),
        begin = performance.now();
      const beforeSnapshots = snapshots;
      assert.equal(
        (await event({ type: "begin", revision, id: "large", source: "paste" }))
          .state,
        undefined,
      );
      for (
        let offset = 0, index = 0;
        offset < text.length;
        offset += 8000, index++
      ) {
        const ack = await event({
          type: "chunk",
          revision,
          id: "large",
          index,
          text: text.slice(offset, offset + 8000),
        });
        assert.equal(ack.type, "ack");
        assert.equal(ack.state, undefined);
      }
      const committed = await event({ type: "commit", revision, id: "large" });
      assert.equal(committed.error, "NON_UNDOABLE_CONFIRMATION_REQUIRED");
      const transferMs = performance.now() - begin;
      assert.ok(transferMs < 5000, String(transferMs));
      assert.ok(
        snapshots - beforeSnapshots < 10,
        "chunks must not rebuild snapshots",
      );
      assert.equal(
        (await event({ type: "confirm-large", revision, accept: true })).type,
        "ack",
      );
      assert.equal(
        flatten(app.store.editors.Main.draft.nodes),
        "a".repeat(400 * 1024) + text,
      );
      const overflow = await event({
        type: "insert",
        revision: app.store.editors.Main.draft.revision,
        text: "x",
      });
      assert.equal(overflow.error, "DRAFT_TOO_LARGE");
      assert.equal(app.store.editors.Main.index.text.length, DRAFT_BYTES);
      const metrics = [];
      for (const size of [1024 * 1024, DRAFT_BYTES - 32]) {
        app.store.editors.Main = new Editor();
        app.store.editors.Main.insert("x".repeat(size), "typed", true);
        const timings = [];
        for (let i = 0; i < 20; i++) {
          const start = performance.now();
          app.store.editors.Main.insert("y", "typed");
          app.snapshot();
          timings.push(performance.now() - start);
        }
        timings.sort((a, b) => a - b);
        const result = { size, p95: timings[18], max: timings[19] };
        metrics.push(result);
        assert.ok(
          result.p95 <= 100 && result.max <= 250,
          JSON.stringify(result),
        );
      }
      console.log(
        JSON.stringify({ issue82LargeDraft: { transferMs, metrics } }),
      );
    } finally {
      ws?.close();
      await app.close();
    }
  },
);
