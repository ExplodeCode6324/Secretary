import test from "node:test";
import assert from "node:assert/strict";
import type { Message, Timeline } from "../src/contracts";
import type { BridgePort } from "../src/bridge";
import {
  ContentStore,
  ReadBudget,
  ReadingWindow,
  LIMITS,
  visibleFragment,
  thinkingPreference,
  outboxLabel,
  reconcileWindow,
} from "../src/conversation/model";
import { Renderer, safeUrl } from "../src/conversation/render";
import { conversation } from "../src/workflow";
const row = (id: number, text = "body"): Message => ({
  id: String(id),
  kind: "message",
  role: "assistant",
  revision: "1",
  text,
  thinking: "",
  call_id: String(id),
  incomplete: false,
  next_cursor: null,
  persistence: "durable",
});
const page = (start: number): Timeline => ({
  items: Array.from({ length: 50 }, (_, i) => row(start + i)),
  version: "1",
  generation: "g",
  before: String(start),
  after: String(start + 50),
});
const port = (query: (q: any) => Promise<any>) =>
  ({ query: (_d: string, q: any) => query(q) }) as BridgePort;
test("100 page cycles keep row/byte caps and refuse eviction of selected/focused anchors", async () => {
  const reader = new ReadingWindow(new ReadBudget());
  for (let i = 0; i < 100; i++) {
    await reader.load(
      port(async () => page(i * 50)),
      "d",
      { operation: "timeline" },
      i ? "after" : "replace",
    );
    assert(reader.pages.length <= 3);
    assert(reader.value!.items.length <= 150);
    assert(reader.size < LIMITS.raw);
  }
  const ids = reader.value!.items.map((r) => r.id);
  await assert.rejects(
    reader.load(
      port(async () => page(5000)),
      "d",
      { operation: "timeline" },
      "after",
      new Set([ids[0]]),
    ),
    /PINNED/,
  );
  assert.deepEqual(
    reader.value!.items.map((r) => r.id),
    ids,
  );
});
test("late page and fragment replies cannot resurrect an old domain/preference epoch", async () => {
  let resolve!: (v: any) => void;
  const bridge = port(() => new Promise((r) => (resolve = r)));
  const reader = new ReadingWindow(new ReadBudget());
  const pending = reader.load(
    bridge,
    "d",
    { operation: "timeline" },
    "replace",
  );
  reader.clear();
  resolve(page(0));
  await pending;
  assert.equal(reader.value, undefined);
  const store = new ContentStore(new ReadBudget());
  const m = { ...row(1), next_cursor: "cursor" };
  const fragment = store.read(m, bridge, "d", true);
  store.clear();
  resolve({
    ...m,
    text: "late thought",
    thinking: "secret",
    next_cursor: null,
  });
  await fragment;
  assert.equal(store.get(m), m);
  assert.equal(store.size, 0);
});
test("fragments reject revision/cursor loops, enforce UTF8 size and preserve exact EOF body", async () => {
  const m = { ...row(1, "中👩"), next_cursor: "c1" };
  const store = new ContentStore(new ReadBudget());
  await assert.rejects(
    store.read(
      m,
      port(async () => ({ ...m, revision: "2", text: "wrong" })),
      "d",
      true,
    ),
    /EXPIRED/,
  );
  await assert.rejects(
    store.read(
      m,
      port(async () => ({ ...m, text: "loop" })),
      "d",
      true,
    ),
    /REPEATED/,
  );
  await store.read(
    m,
    port(async () => ({ ...m, text: "‍💻é", next_cursor: null })),
    "d",
    true,
  );
  assert.equal(store.get(m).text, "中👩‍💻é");
  assert.equal(visibleFragment("中👩‍", false), "中");
  assert.equal(visibleFragment("中👩‍💻é", false), "中👩‍💻");
  assert.equal(visibleFragment(store.get(m).text, true), store.get(m).text);
  assert.throws(() => store.put(row(2, "中".repeat(800000))), /LIMIT/);
});
test("thinking defaults on and explicit off survives restart/read failure remains on", () => {
  assert.equal(thinkingPreference("d", { getItem: () => null }), true);
  assert.equal(thinkingPreference("d", { getItem: () => "off" }), false);
  assert.equal(
    thinkingPreference("d", {
      getItem: () => {
        throw Error();
      },
    }),
    true,
  );
});
test("transient SSE retains >5000 units, joins blocks identically to Core, expired and durable rows win", () => {
  const p = {
    id: "1",
    at: "now",
    status: "running",
    truncated: false,
    blocks: [
      { type: "text", text: "中".repeat(6000) },
      { type: "text", text: "second" },
    ],
  };
  const t = { ...page(0), items: [] };
  assert.equal(
    (conversation(t, { previews: [p] }, new Set())[0] as Message).text,
    "中".repeat(6000) + "\nsecond",
  );
  const expired = {
    ...row(1, ""),
    id: "message:1",
    persistence: "transient" as const,
    preview_availability: "expired" as const,
  };
  assert.equal(
    (
      conversation(
        { ...t, items: [expired] },
        { previews: [p] },
        new Set(),
      )[0] as Message
    ).text,
    "",
  );
});
test("safe Markdown keeps tables/code, blocks active markup/images, URL schemes and credentials", () => {
  const renderer = new Renderer();
  const html = renderer.render(
    "m|body",
    "<script>alert(1)</script>\n\n![remote](https://evil.test/img)\n\n[a **bold**](https://example.com/a)\n\n|a|b|\n|-|-|\n|1|2|\n\n```ts\nconst x = 1;\n```",
  );
  assert(!html.includes("<script>"));
  assert(!html.includes("<img"));
  assert(html.includes("<table>"));
  assert(html.includes("<pre><code"));
  assert(html.includes('data-url="https://example.com/a"'));
  assert(html.includes("</button>"));
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/x",
    "https://user:pass@example.com",
    "https://example.com/%0aevil",
    "https://exa\nmple.com",
    "data:text/html,x",
    "/relative",
  ])
    assert.equal(safeUrl(url), null);
  assert(safeUrl("https://例子.测试/path")?.includes("xn--"));
  for (let i = 0; i < 1000; i++)
    renderer.render(String(i) + "|body", "中文".repeat(1000));
  assert(renderer.size <= LIMITS.html);
  renderer.clear();
  assert.equal(renderer.size, 0);
});
test("unknown outbox values are never presented as success or definite rejection", () => {
  for (const state of [
    "FUTURE",
    "UNSUPPORTED_VERSION",
    "CONTRACT_INVALID",
    "RECEIPT_MISSING",
  ])
    assert(!/已完成|失败|已受理/.test(outboxLabel(state)));
});

test("empty fragments cannot grow cursor metadata without content progress", async () => {
  const m = { ...row(1), next_cursor: "first" };
  const store = new ContentStore(new ReadBudget());
  await assert.rejects(
    store.read(
      m,
      port(async () => ({ ...m, text: "", thinking: "", next_cursor: "new" })),
      "d",
      true,
    ),
    /EMPTY_FRAGMENT/,
  );
  assert.equal(store.get(m), m);
  assert.equal(store.size, 0);
});
test("full copy reaches EOF within caps and two readers service bounded FIFO waiters", async () => {
  const m = { ...row(1, "first"), next_cursor: "c1", thinking: "" };
  const store = new ContentStore(new ReadBudget());
  assert.equal(
    await store.complete(
      m,
      port(async () => ({ ...m, text: " last", next_cursor: null })),
      "d",
      true,
    ),
    "first last",
  );
  const budget = new ReadBudget();
  let peak = 0;
  const releases: (() => void)[] = [];
  const jobs = Array.from({ length: 6 }, () =>
    budget.run(async () => {
      peak = Math.max(peak, budget.active);
      await new Promise<void>((r) => releases.push(r));
    }),
  );
  await assert.rejects(
    budget.run(async () => {}),
    /READ_BUSY/,
  );
  for (let i = 0; i < 6; i++) {
    releases.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  }
  await Promise.all(jobs);
  assert.equal(peak, 2);
  assert.equal(budget.active, 0);
});
test("transient thinking survives text revisions but clears on durable transition and preference epoch", () => {
  const store = new ContentStore(new ReadBudget());
  const m = {
    ...row(1),
    persistence: "transient" as const,
    thinking: "thought",
  };
  store.put(m);
  const newer = { ...m, revision: "2", text: "new SSE", thinking: undefined };
  store.retain([newer]);
  assert.equal(store.get(newer).thinking, "thought");
  store.retain([{ ...newer, persistence: "durable" }]);
  assert.equal(store.get(newer).thinking, undefined);
  store.put(m);
  store.clear();
  assert.equal(store.get(newer).thinking, undefined);
});

test("frozen live membership preserves SSE text and reconciles durable completion without eviction", () => {
  const preview = {
    ...row(1, "visible SSE"),
    persistence: "transient" as const,
  };
  const frozen = { ...page(0), items: [row(0), preview] };
  const incoming = {
    ...frozen,
    version: "2",
    items: [{ ...preview, text: "", revision: "2" }, row(2, "new unseen")],
  };
  const merged = reconcileWindow(frozen, incoming);
  assert.equal((merged.items[1] as Message).text, "visible SSE");
  assert.deepEqual(
    merged.items.map((r) => r.id),
    ["0", "1"],
  );
  const done = reconcileWindow(merged, {
    ...incoming,
    items: [{ ...row(1, "final body"), revision: "3" }],
  });
  assert.equal((done.items[1] as Message).persistence, "durable");
  assert.equal((done.items[1] as Message).text, "final body");
  assert.throws(
    () => reconcileWindow(frozen, { ...incoming, generation: "other" }),
    /RESET/,
  );
});

test("completion catches up to the displayed prefix without reading the whole answer", async () => {
  const text = "中👩‍💻é".repeat(5000);
  const m = {
    ...row(1, text.slice(0, 4999)),
    revision: "final",
    next_cursor: "4999",
    thinking: undefined,
  };
  const store = new ContentStore(new ReadBudget());
  store.retain([m]);
  const offsets: number[] = [];
  const bridge = port(async (q) => {
    const start = Number(q.parameters.cursor ?? 0);
    offsets.push(start);
    return {
      ...m,
      text: text.slice(start, start + 4999),
      thinking: q.parameters.thinking ? "" : undefined,
      next_cursor: start + 4999 < text.length ? String(start + 4999) : null,
    };
  });
  await store.readThrough(m, 16000, bridge, "d", true);
  assert.equal(store.get(m).text, text.slice(0, 19996));
  assert.deepEqual(offsets, [0, 4999, 9998, 14997]);
  assert(
    store.get(m).next_cursor,
    "continuation remains explicit beyond the displayed prefix",
  );
  assert.equal(await store.complete(m, bridge, "d", true), text);
});

test("completion catch-up rejects stale epochs and remains bounded after read failure", async () => {
  const m = { ...row(1, "a".repeat(4999)), next_cursor: "4999" };
  const store = new ContentStore(new ReadBudget());
  store.retain([m]);
  await assert.rejects(
    store.readThrough(
      m,
      12000,
      port(async () => {
        throw Error("offline");
      }),
      "d",
      false,
    ),
    /offline/,
  );
  assert.equal(store.get(m).text.length, 4999);
  let resolve!: (v: Message) => void;
  const pending = store.readThrough(
    m,
    12000,
    port(() => new Promise((r) => (resolve = r))),
    "d",
    false,
  );
  store.clear();
  resolve({ ...m, text: "late", next_cursor: null });
  await assert.rejects(pending, /CURSOR_EXPIRED/);
  assert.equal(store.size, 0);
});

test("completion uses final revision text at EOF even when the authoritative body differs", async () => {
  const m = { ...row(1, "final prefix"), next_cursor: "more" };
  const store = new ContentStore(new ReadBudget());
  store.retain([m]);
  await store.readThrough(
    m,
    16000,
    port(async () => ({ ...m, text: " end", next_cursor: null })),
    "d",
    false,
  );
  assert.equal(store.get(m).text, "final prefix end");
});
