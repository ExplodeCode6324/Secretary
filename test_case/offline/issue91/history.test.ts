import test from "node:test";
import assert from "node:assert/strict";
import {
  HistoryWindow,
  HISTORY_BYTES,
} from "../../../src/pi_secretary/src/tui/history.ts";
import type {
  TimelineItem,
  Timeline,
} from "../../../src/pi_secretary/src/api/contracts.ts";
import type { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";

function fixture(count = 600) {
  const rows: TimelineItem[] = Array.from({ length: count }, (_, i) => ({
    id: `message:${i}`,
    kind: "message",
    revision: String(i),
    role: "assistant",
    text: `body ${i}`,
    call_id: null,
    incomplete: false,
    next_cursor: null,
    persistence: "durable",
  }));
  const calls: string[] = [];
  let generation = "epoch1";
  let fail = false;
  const client = {
    endpoint: { instance_id: "instance1" },
    async query(path: string): Promise<Timeline> {
      calls.push(path);
      if (fail) throw Error("NETWORK_FAILURE");
      const u = new URL(path, "http://test/"),
        q = u.searchParams;
      const limit = Number(q.get("limit"));
      let first: number, end: number;
      if (u.pathname === "/timeline/around") {
        assert.equal(limit, 1);
        first = rows.findIndex((r) => r.id === q.get("message_id"));
        if (first < 0) throw Error("TIMELINE_ITEM_NOT_FOUND");
        end = first + 1;
      } else if (q.has("cursor")) {
        const [epoch, id] = q.get("cursor")!.split("|");
        if (epoch !== generation) throw Error("CURSOR_EXPIRED");
        const at = rows.findIndex((r) => r.id === id);
        if (at < 0) throw Error("TIMELINE_RESET_REQUIRED");
        first =
          q.get("direction") === "before" ? Math.max(0, at - limit) : at + 1;
        end =
          q.get("direction") === "before"
            ? at
            : Math.min(rows.length, first + limit);
      } else {
        end = rows.length;
        first = Math.max(0, end - limit);
      }
      const items = structuredClone(rows.slice(first, end));
      return {
        items,
        version: "1",
        generation,
        before:
          first > 0 && items.length ? `${generation}|${items[0].id}` : null,
        after:
          end < rows.length && items.length
            ? `${generation}|${items.at(-1)!.id}`
            : null,
      };
    },
  } as unknown as CoreClient;
  return {
    rows,
    calls,
    history: new HistoryWindow(client),
    reset: () => {
      generation = "epoch2";
    },
    fail: (v: boolean) => {
      fail = v;
    },
  };
}

test("continuous history beyond H, bounded metadata and reversible cursor navigation", async () => {
  const f = fixture();
  await f.history.refresh();
  assert.equal(f.history.items.size, 50);
  for (let i = 0; i < 11; i++) {
    f.history.setAnchor(f.history.items.keys().next().value);
    await f.history.page("before");
    assert.ok(f.history.items.size <= 200);
  }
  assert.equal(f.history.items.keys().next().value, "message:0");
  assert.equal(f.history.hasBefore, false);
  for (let i = 0; i < 10; i++) {
    f.history.setAnchor([...f.history.items.keys()].at(-1));
    await f.history.page("after");
  }
  assert.equal([...f.history.items.keys()].at(-1), "message:599");
});

test("filtered-only pages advance across yielded batches without losing the reading anchor", async () => {
  const f = fixture(702);
  for (let i = 1; i < 701; i++)
    f.rows[i] = {
      id: `event:${i}`,
      kind: "activity",
      revision: "1",
      activity: { id: String(i), kind: "model", source: "durable" },
    };
  await f.history.refresh();
  f.history.setAnchor("message:701");
  await f.history.page("before");
  assert.deepEqual([...f.history.items.keys()], ["message:0", "message:701"]);
  assert.equal(f.history.anchor, "message:701");
  assert.ok(f.calls.length > 14);
});

test("new arrivals preserve an older resident window and reader identity", async () => {
  const f = fixture(100);
  await f.history.refresh();
  f.history.setAnchor("message:50");
  f.rows.push(
    ...Array.from({ length: 240 }, (_, i) => ({
      ...f.rows[0],
      id: `message:${100 + i}`,
      revision: String(100 + i),
    })),
  );
  await f.history.refresh();
  assert.equal(f.history.anchor, "message:50");
  assert.ok(f.history.items.has("message:50"));
  assert.equal(f.history.items.size, 200);
  assert.equal(f.history.hasAfter, true);
  const before = [...f.history.items.keys()];
  await f.history.refresh();
  assert.deepEqual([...f.history.items.keys()], before);
});

test("generation rebuild and bounded neighbour fallback never silently jump to tail", async () => {
  const f = fixture();
  await f.history.refresh();
  f.history.setAnchor("message:570");
  f.rows.splice(570, 1);
  f.reset();
  await f.history.page("before");
  assert.equal(f.history.anchor, "message:569");
  assert(f.history.items.has("message:569"));
  assert(!f.history.items.has("message:570"));
  assert(f.history.items.size > 1 && f.history.items.size <= 200);
  assert.match(f.history.notices.get("message:569")!, /缺口/);
  f.rows.splice(0);
  await f.history.page("before");
  assert.equal(f.history.unavailable, true);
  assert.equal(f.history.anchor, "message:569");
});

test("body budget evicts content independently; network failure does not destroy rows or auto-clear error", async () => {
  const f = fixture(200);
  for (const row of f.rows)
    if (row.kind === "message") row.text = "中".repeat(40000);
  await f.history.refresh();
  const bytes = [...f.history.items.values()].reduce(
    (n, row) => n + (row.kind === "message" ? Buffer.byteLength(row.text) : 0),
    0,
  );
  assert.ok(bytes <= HISTORY_BYTES);
  assert.ok(f.history.evictedBodies.size);
  const ids = [...f.history.items.keys()];
  f.fail(true);
  await f.history.page("before");
  assert.deepEqual([...f.history.items.keys()], ids);
  assert.match(f.history.error, /NETWORK_FAILURE/);
  f.fail(false);
  await f.history.refresh();
  assert.match(f.history.error, /NETWORK_FAILURE/);
  f.history.clearError();
  assert.equal(f.history.error, "");
});

test("CoT mode creates fresh signed queries around the reader", async () => {
  const f = fixture();
  await f.history.refresh();
  f.history.setAnchor("message:570");
  const before = f.calls.length;
  const published: number[] = [];
  f.history.onChange = () => published.push(f.history.items.size);
  await f.history.setThinking(true);
  assert.equal(f.history.anchor, "message:570");
  assert(
    f.calls
      .slice(before)
      .some((call) =>
        /around.*limit=1&streaming=true&thinking=true/.test(call),
      ),
  );
  assert(f.calls.slice(before).every((call) => call.includes("thinking=true")));
  assert(
    published.every((size) => size > 1),
    "Never publish only a short anchor and clamp the viewport to its title",
  );
});
