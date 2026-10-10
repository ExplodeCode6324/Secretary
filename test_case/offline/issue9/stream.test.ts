import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fixture, target } from "./helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
async function stream(c: any, after: string, header?: string) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20000);
  const response = await fetch(
    c.endpoint.url + "/api/v1/sync/stream?after=" + encodeURIComponent(after),
    {
      headers: {
        Authorization: "Bearer " + c.endpoint.token,
        ...(c.binding ? { "X-Secretary-Client": c.binding } : {}),
        ...(header ? { "Last-Event-ID": header } : {}),
      },
      signal: abort.signal,
    },
  );
  if (!response.ok) {
    clearTimeout(timeout);
    return {
      response,
      abort,
      next: async () => {
        throw Error("not stream");
      },
      close: () => abort.abort(),
    };
  }
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  return {
    response,
    abort,
    close: () => {
      clearTimeout(timeout);
      abort.abort();
    },
    next: async () => {
      for (;;) {
        const at = buffer.indexOf("\n\n");
        if (at >= 0) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          if (block.startsWith(":")) continue;
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const text = /^data: (.*)$/m.exec(block)?.[1];
          return {
            event,
            id: /^id: (.*)$/m.exec(block)?.[1],
            data: text ? JSON.parse(text) : null,
          };
        }
        const r = await reader.read();
        if (r.done) return { event: "closed", id: undefined, data: null };
        buffer += decoder.decode(r.value, { stream: true });
      }
    },
  };
}
test("S03/S08: bootstrap-to-connect, catch-up-to-live, transient merge and reconnect", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const snap = await c.bootstrap();
    app.store.commit([
      revise(app.host.session, { state: app.host.session.state }),
    ]);
    const first = app.store.sequence;
    const s = await stream(c, snap.cursor);
    try {
      let event = await s.next();
      assert.equal(event.event, "change");
      assert.equal(event.data.sequence, String(first));
      validate("SyncBatch", event.data);
      const cursor = event.id!;
      app.store.commit([
        revise(app.host.session, { state: app.host.session.state }),
      ]);
      const second = app.store.sequence;
      do {
        event = await s.next();
      } while (event.event !== "change");
      assert.equal(event.data.sequence, String(second));
      s.close();
      const again = await stream(c, cursor);
      try {
        const replay = await again.next();
        assert.equal(replay.data.sequence, String(second));
      } finally {
        again.close();
      }
      const before = app.store.sequence,
        call = id();
      for (let i = 0; i < 100; i++)
        app.host.previews.update({
          type: "start",
          id: call,
          loop: "synthetic",
          session: app.host.sessionID,
        });
      assert.equal(app.store.sequence, before);
      const live = await stream(c, event.id!);
      try {
        const transient = await live.next();
        assert.equal(transient.event, "transient");
        assert.equal(transient.id, undefined);
        assert.equal(transient.data.instance_id, server.service.instanceID);
        assert.equal(transient.data.previews.length, 1);
      } finally {
        live.close();
      }
    } finally {
      s.close();
    }
    const conflict = await stream(c, snap.cursor, "different");
    assert.equal(conflict.response.status, 400);
    assert.equal(
      (await conflict.response.json()).error.code,
      "SYNC_CURSOR_CONFLICT",
    );
    conflict.close();
  }));
test("S09: binding rotation terminates an existing stream, cached authority is rejected", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const a = await target(c, "A");
    const snap = await a.client.bootstrap();
    const s = await stream(a.client, snap.cursor);
    try {
      assert.equal((await s.next()).event, "transient");
      await c.command("clients/" + a.id + "/notification-target", {
        request_id: id(),
        enabled: true,
        rotate_binding: true,
      });
      const event = await s.next();
      assert.equal(event.event, "control");
      assert.equal(event.data.code, "FORBIDDEN_TARGET");
      assert.equal(event.id, undefined);
      await assert.rejects(a.client.bootstrap(), /FORBIDDEN_TARGET/);
    } finally {
      s.close();
    }
  }));
test("S07: paused network reader does not block other clients or create unbounded queues", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const snap = await c.bootstrap();
    const slow = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.get(
        c.endpoint.url +
          "/api/v1/sync/stream?after=" +
          encodeURIComponent(snap.cursor),
        { headers: { Authorization: "Bearer " + c.endpoint.token } },
        (res) => {
          res.pause();
          resolve(res);
        },
      );
      req.on("error", reject);
    });
    try {
      // One durable transaction much larger than TCP receive buffers. Empty payload is reused.
      const events = Array.from({ length: 35000 }, () =>
        app.store.event(
          "main.message",
          { display_call_id: null },
          { session_id: app.host.sessionID, task_id: null, execution_id: null },
        ),
      );
      app.store.commit([], events);
      const commandStart = performance.now();
      const next = await c.command("messages", {
        request_id: id(),
        text: "B remains responsive",
      });
      const commandMillis = performance.now() - commandStart;
      assert.equal(next.acceptance, "ACCEPTED");
      assert.equal(app.store.all("Input").length, 1);
      const deadline = Date.now() + 12000;
      const { streamStats } =
        await import("../../../src/pi_secretary/src/sync-stream.ts");
      while (
        Date.now() < deadline &&
        streamStats(server.service).slow_closes === 0
      )
        await new Promise((r) => setTimeout(r, 100));
      const stats = streamStats(server.service);
      assert(stats.slow_closes >= 1, JSON.stringify(stats));
      assert(stats.peak_buffer_bytes <= 512 * 1024);
      console.info(
        "ISSUE9_SLOW_READER",
        JSON.stringify({
          events: 35000,
          slow_connections: 1,
          command_ms: commandMillis,
          ...stats,
        }),
      );
      const recovered = await c.changes(snap.cursor);
      assert(recovered.batches.length > 0);
      assert.equal(
        recovered.batches[0].sequence,
        String(app.store.sequence - 1),
      );
    } finally {
      slow.destroy();
    }
  }));
