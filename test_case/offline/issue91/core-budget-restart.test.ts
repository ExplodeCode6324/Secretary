import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture } from "../issue9/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { RemoteViews } from "../../../src/pi_secretary/src/tui/remote.ts";
import { HISTORY_BYTES } from "../../../src/pi_secretary/src/tui/history.ts";
import { bodyBytes } from "../../../src/pi_secretary/src/tui/body.ts";
import type { Message } from "../../../src/pi_secretary/src/api/contracts.ts";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const residentBytes = (views: RemoteViews) =>
  [...views.history.items].reduce((sum, [key, item]) => {
    if (item.kind !== "message") return sum;
    const body = views.bodies.get(key);
    return (
      sum +
      (body ? bodyBytes(body) : 0) +
      (body?.message === item
        ? 0
        : Buffer.byteLength(item.text) + Buffer.byteLength(item.thinking ?? ""))
    );
  }, 0);

test("Core HTTP: >4 MiB history evicts, rehydrates exact bytes and relocates after restart without read-side writes", () =>
  fixture(async (f) => {
    // Synthetic durable journal only; real HTTP projections and disk recovery.
    // No live model, native terminal, or private RemoteViews cache injection.
    const sources = new Map<string, string>();
    const events = Array.from({ length: 10 }, (_, i) => {
      const call = id();
      const text = `HEAD-${i}\n` + "中😀x".repeat(65536) + `\nTAIL-${i}`;
      sources.set("message:" + call, text);
      return f.app.store.event(
        "main.message",
        {
          role: "assistant",
          content: [{ type: "text", text }],
          stopReason: "stop",
          display_call_id: call,
        },
        { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
      );
    });
    f.app.store.commit([], events);
    assert(
      [...sources.values()].reduce((n, v) => n + Buffer.byteLength(v), 0) >
        HISTORY_BYTES,
    );
    const beforeReads = f.app.store.sequence;
    const views = new RemoteViews(f.client);
    let renewed: RemoteViews | undefined;
    try {
      await views.refresh(["timeline"]);
      for (let pages = 0; views.history.hasBefore; pages++) {
        assert(pages < 20, "bounded traversal must advance");
        await views.historyPage("before");
      }
      assert.equal(views.history.items.size, sources.size);
      const first = [...sources.keys()][0];
      const initial = views.history.items.get(first) as Message;
      const oldFragment = initial.next_cursor;
      assert(oldFragment, "real Core must fragment the large message");
      for (const key of sources.keys()) {
        views.history.setAnchor(key);
        await views.loadBody(key);
        assert.equal(
          digest(views.bodies.get(key)!.body.text),
          digest(sources.get(key)!),
        );
        assert(residentBytes(views) <= HISTORY_BYTES);
      }
      assert(views.history.evictedBodies.size > 0, "crossed shared cache cap");
      const victim = [...views.history.evictedBodies][0];
      assert(!views.bodies.has(victim));
      assert.equal(views.history.items.get(victim)!.text, "");
      views.history.setAnchor(victim);
      await views.loadBody(victim);
      assert.equal(
        digest(views.bodies.get(victim)!.body.text),
        digest(sources.get(victim)!),
      );
      assert(!views.history.evictedBodies.has(victim));
      assert(residentBytes(views) <= HISTORY_BYTES);
      assert.equal(f.app.store.sequence, beforeReads);
      assert.equal(f.app.store.all("ModelCall").length, 0);

      const oldInstance = f.client.endpoint.instance_id;
      views.stop();
      await f.restart();
      assert.notEqual(f.client.endpoint.instance_id, oldInstance);
      const afterRestart = f.app.store.sequence;
      await assert.rejects(
        f.client.query(
          `messages/${encodeURIComponent(first)}/content?streaming=true&thinking=false&cursor=${encodeURIComponent(oldFragment)}`,
        ),
        /CURSOR_EXPIRED/,
      );
      renewed = new RemoteViews(f.client);
      renewed.inherit(views);
      await renewed.refresh(["timeline"]);
      assert.equal(renewed.history.anchor, victim);
      assert(renewed.history.items.has(victim));
      await renewed.loadBody(victim);
      assert.equal(
        digest(renewed.bodies.get(victim)!.body.text),
        digest(sources.get(victim)!),
      );
      assert(residentBytes(renewed) <= HISTORY_BYTES);
      assert.equal(renewed.error, "");
      assert.equal(f.app.store.sequence, afterRestart);
      assert.equal(f.app.store.all("ModelCall").length, 0);
    } finally {
      views.stop();
      renewed?.stop();
    }
  }));
