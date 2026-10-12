import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fixture, until } from "./helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { STREAM_BYTES } from "../../../src/pi_secretary/src/sync-stream.ts";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";

async function stream(
  f: Parameters<Parameters<typeof fixture>[0]>[0],
  after: string,
  headers: Record<string, string> = {},
) {
  const controller = new AbortController();
  const response = await fetch(
    f.server.endpoint.url +
      "/api/v1/sync/stream" +
      (after ? "?after=" + after : ""),
    {
      headers: {
        Authorization: `Bearer ${f.server.endpoint.token}`,
        ...headers,
      },
      signal: controller.signal,
    },
  );
  const reader = response.body!.getReader();
  let pending = "";
  return {
    response,
    close: () => controller.abort(),
    async next() {
      while (!pending.includes("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw Error("STREAM_ENDED");
        pending += new TextDecoder().decode(chunk.value);
      }
      const index = pending.indexOf("\n\n"),
        event = pending.slice(0, index);
      pending = pending.slice(index + 2);
      return event;
    },
  };
}
test("SSE: replay/live IDs, header resume, no-id heartbeat/transient, auth/conflict and disconnect cleanup", () =>
  fixture(async (f) => {
    const after = f.cursor();
    f.notice();
    const live = await stream(f, after);
    try {
      assert.equal(live.response.status, 200);
      const durable = await live.next();
      assert(durable.startsWith("event: change\nid: "));
      const tx = JSON.parse(durable.split("data: ")[1]);
      assert.equal(tx.cursor, f.cursor());
      const transient = await live.next();
      assert(transient.startsWith("event: transient"));
      assert(!transient.includes("\nid:"));
      f.notice("live");
      let next = await live.next();
      while (!next.startsWith("event: change")) next = await live.next();
      assert.equal(JSON.parse(next.split("data: ")[1]).cursor, f.cursor());
      let heartbeat = await live.next();
      while (!heartbeat.startsWith(":")) heartbeat = await live.next();
      assert.equal(heartbeat, ": heartbeat");
      assert(!heartbeat.includes("id:"));
    } finally {
      live.close();
    }
    await until(() => f.server.streams.active === 0);
    const resumed = await stream(f, "", { "Last-Event-ID": after });
    assert((await resumed.next()).includes("event: change"));
    resumed.close();
    await until(() => f.server.streams.active === 0);
    for (const [route, headers, status] of [
      ["sync/stream?after=" + after, { "Last-Event-ID": f.cursor() }, 400],
      ["sync/stream?after=invalid", {}, 409],
      ["sync/stream?after=" + after, { Authorization: "Bearer invalid" }, 401],
      [
        "sync/stream?after=" + after,
        { Origin: "https://example.invalid" },
        403,
      ],
      ["sync/stream?after=" + after + "&limit=1", {}, 400],
    ] as const)
      assert.equal((await f.raw(route, headers)).status, status);
    for (let n = 0; n < 12; n++) {
      const s = await stream(f, f.cursor());
      await s.next();
      s.close();
      await until(() => f.server.streams.active === 0);
    }
  }));
test("SSE: eight active streams enforce BUSY and Core close releases them", () =>
  fixture(async (f) => {
    const connections = [];
    for (let n = 0; n < 8; n++) connections.push(await stream(f, f.cursor()));
    assert.equal(f.server.streams.active, 8);
    assert.equal((await f.raw("sync/stream?after=" + f.cursor())).status, 503);
    await f.close();
    assert.equal(f.server.streams.active, 0);
    for (const c of connections) c.close();
  }));
test("SSE: paused TCP reader closes under bounded backpressure while commands/background/other client progress", () =>
  fixture(async (f) => {
    const sync = f.server.service.changes,
      after = f.cursor(),
      previews = f.app.host.previews;
    const ids = Array.from({ length: 7 }, () => id());
    for (const p of ids)
      previews.update({
        type: "start",
        id: p,
        session: f.app.host.sessionID,
        loop: id(),
      });
    const update = (tick: number) => {
      for (const p of ids)
        previews.update({
          type: "event",
          id: p,
          event: {
            type: "text_end",
            content: String(tick).padStart(32000, "x"),
            contentIndex: 0,
            partial: { content: [{ type: "text", text: "x" }] },
          } as AssistantMessageEvent,
        });
    };
    update(0);
    // Durable catch-up keeps yielding between batches; latest previews are sampled,
    // without writing preview updates into the journal or queuing every update.
    for (let n = 0; n < 240; n++)
      f.app.store.commit([], [f.app.store.event("internal.synthetic", { n })]);
    let paused!: http.IncomingMessage;
    const req = http.get(
      f.server.endpoint.url + "/api/v1/sync/stream?after=" + after,
      { headers: { Authorization: `Bearer ${f.server.endpoint.token}` } },
      (res) => {
        paused = res;
        res.pause();
      },
    );
    req.on("error", () => {});
    let tick = 0;
    const timer = setInterval(() => update(++tick), 1);
    try {
      await until(() => !!paused);
      const began = Date.now();
      const receipt = await f.client.command("messages", {
        request_id: id(),
        text: "Synthetic parallel command",
      });
      assert.equal(receipt.acceptance, "ACCEPTED");
      await f.app.host.drain();
      assert(f.app.store.all("ModelCall").length > 0);
      assert(
        Date.now() - began < 3000,
        "slow client must not block command or model fixture",
      );
      const other = await stream(f, f.cursor());
      assert((await other.next()).startsWith("event: transient"));
      other.close();
      await until(() => f.server.streams.active === 0, 12000);
      assert(f.server.streams.peakWritableBytes > 0);
      assert(f.server.streams.peakWritableBytes <= STREAM_BYTES);
      console.log(
        JSON.stringify({
          paused_tcp: true,
          peak_writable_bytes: f.server.streams.peakWritableBytes,
          budget: STREAM_BYTES,
          preview_updates: tick,
        }),
      );
      const recovered = await stream(f, after);
      assert((await recovered.next()).startsWith("event: change"));
      recovered.close();
    } finally {
      clearInterval(timer);
      req.destroy();
      paused?.destroy();
    }
    assert(sync.position(after) < f.app.store.sequence);
  }));
