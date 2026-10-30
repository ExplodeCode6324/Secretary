import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { RemoteViews } from "../../../src/pi_secretary/src/tui/remote.ts";
import { HISTORY_BYTES } from "../../../src/pi_secretary/src/tui/history.ts";
import {
  readMessageBody,
  bodyBytes,
} from "../../../src/pi_secretary/src/tui/body.ts";
import type { Message } from "../../../src/pi_secretary/src/api/contracts.ts";
import type { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
const message = (id: string, text: string): Message => ({
  id,
  kind: "message",
  role: "assistant",
  revision: "r",
  text,
  thinking: "",
  call_id: null,
  incomplete: false,
  persistence: "durable",
  next_cursor: null,
});
const seam = (remote: RemoteViews) =>
  remote as unknown as { prune(): void; bodyJob?: Promise<void> };
async function frames(remote: RemoteViews, visible: string[], n = 5) {
  for (let i = 0; i < n; i++) {
    remote.focus(visible);
    await seam(remote).bodyJob;
    await setImmediate();
  }
}
function fake() {
  let reads = 0;
  const sources = new Map<string, Message>();
  const client = {
    endpoint: { instance_id: "test" },
    query: async (route: string) => {
      reads++;
      const id = decodeURIComponent(route.split("/")[1]);
      assert(sources.has(id));
      return sources.get(id)!;
    },
  } as unknown as CoreClient;
  return { remote: new RemoteViews(client), sources, reads: () => reads };
}
test("visible bodies survive farthest-first pruning without layout reloads", async () => {
  const f = fake(),
    r = f.remote;
  try {
    for (let i = 0; i < 10; i++) {
      const m = message("m" + i, "a".repeat(512 * 1024));
      f.sources.set(m.id, m);
      const body = await readMessageBody(r.client, m, false);
      r.history.items.set(m.id, body.message);
      r.bodies.set(m.id, body);
    }
    r.history.setAnchor("m1");
    await frames(r, ["m1", "m2", "m3"], 1);
    seam(r).prune();
    assert.deepEqual([...r.history.evictedBodies].sort(), ["m8", "m9"]);
    await frames(r, ["m1", "m2", "m3"]);
    assert.equal(f.reads(), 0);
    assert(
      [...r.bodies.values()].reduce((n, b) => n + bodyBytes(b), 0) <=
        HISTORY_BYTES,
    );
  } finally {
    r.stop();
  }
});
test("visible-only budget pressure leaves stable placeholders and recovers on anchor navigation", async () => {
  const f = fake(),
    r = f.remote;
  try {
    // Nine individually ordinary <=1 MiB messages exceed the shared 4 MiB budget.
    for (let i = 0; i < 9; i++) {
      const m = message("m" + i, "a".repeat(512 * 1024));
      f.sources.set(m.id, m);
      const body = await readMessageBody(r.client, m, false);
      r.history.items.set(m.id, body.message);
      r.bodies.set(m.id, body);
    }
    const ids = [...f.sources.keys()];
    r.history.setAnchor("m0");
    await frames(r, ids, 1);
    seam(r).prune();
    assert(r.history.evictedBodies.has("m8"));
    await frames(r, ids);
    assert.equal(f.reads(), 0);
    assert(
      [...r.bodies.values()].reduce((n, b) => n + bodyBytes(b), 0) <=
        HISTORY_BYTES,
    );
    r.history.setAnchor("m8");
    await frames(r, ids);
    assert.equal(f.reads(), 1);
    assert(r.bodies.has("m8"));
    await frames(r, ids);
    assert.equal(f.reads(), 1);
    assert(
      [...r.bodies.values()].reduce((n, b) => n + bodyBytes(b), 0) <=
        HISTORY_BYTES,
    );
  } finally {
    r.stop();
  }
});

test("follow reads the settled >1 MiB reply tail, including from a cached first window", async () => {
  const text =
    "```text\n" +
    "Synthetic reading row\n".repeat(52000) +
    "```\n\nTAIL-SENTINEL";
  const fragment = (at: number): Message => ({
    ...message("tail", text.slice(at, at + 4999)),
    next_cursor: at + 4999 < text.length ? String(at + 4999) : null,
  });
  const client = {
    endpoint: { instance_id: "tail-test" },
    query: async <T>(route: string) =>
      fragment(
        Number(new URL(route, "http://test").searchParams.get("cursor") ?? 0),
      ) as T,
  } as unknown as CoreClient;
  const r = new RemoteViews(client);
  try {
    const first = fragment(0);
    r.history.items.set("tail", first);
    r.history.setAnchor("tail");
    await r.loadBody("tail");
    assert.equal(r.bodies.get("tail")!.body.after, true);
    r.setFollowing(true);
    await frames(r, ["tail"], 2);
    const end = r.bodies.get("tail")!;
    assert.equal(end.windowed, true);
    assert.equal(end.body.after, false);
    assert.ok(end.body.text.endsWith("TAIL-SENTINEL"));
    assert.ok(bodyBytes(end) < HISTORY_BYTES);
    r.bodies.clear();
    r.history.items.set("tail", first);
    await r.loadBody("tail");
    assert.ok(r.bodies.get("tail")!.body.text.endsWith("TAIL-SENTINEL"));
  } finally {
    r.stop();
  }
});
