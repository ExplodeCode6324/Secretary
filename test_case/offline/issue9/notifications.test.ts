import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
import { presentedNotification } from "../../../src/pi_secretary/src/notification-service.ts";

test("NOT/API: presented event and admission are atomic, read is global and separate, retries/restart deduplicate", () =>
  fixture(async (f) => {
    const n = f.notice(),
      a = await f.register("A"),
      b = await f.register("B"),
      boundary = f.cursor();
    const inputs = f.app.store.all("Input").length,
      models = f.app.store.all("ModelCall").length;
    const read = await f.client.command(`notifications/${n.id}/read`, {
      request_id: id(),
    });
    assert.deepEqual(read.resource_ids, [{ type: "Notification", id: n.id }]);
    let detail: any = await f.client.query(`notifications/${n.id}`);
    assert(detail.read_at);
    assert.deepEqual(detail.presented, []);
    const firstRead = detail.read_at,
      request = { request_id: id(), client_id: a };
    const receipt = await f.client.command(
      `notifications/${n.id}/presented`,
      request,
    );
    assert.deepEqual(receipt.resource_ids, [
      { type: "Notification", id: n.id },
    ]);
    assert.deepEqual(
      await f.client.command(`notifications/${n.id}/presented`, request),
      receipt,
    );
    await assert.rejects(
      f.client.command(`notifications/${n.id}/presented`, {
        ...request,
        client_id: b,
      }),
      /REQUEST_CONFLICT/,
    );
    const frame = f.app.store.projectionFrames.find((tx) =>
      tx.mutations.some(
        (m) =>
          m.object_type === "ApiCommand" && m.object_id === request.request_id,
      ),
    )!;
    assert.equal(
      frame.log_records.filter((e) => e.event_type === "notification.presented")
        .length,
      1,
    );
    assert(!frame.mutations.some((m) => m.object_type === "Notification"));
    await f.client.command(`notifications/${n.id}/presented`, {
      request_id: id(),
      client_id: a,
    });
    await f.client.command(`notifications/${n.id}/presented`, {
      request_id: id(),
      client_id: b,
    });
    await f.client.command(`notifications/${n.id}/read`, { request_id: id() });
    const state = f.app.store.get<any>("Notification", n.id);
    assert.equal(state.state, "QUEUED");
    assert.equal(state.revision, 2);
    assert.throws(
      () => f.app.store.commit([revise(state, { read_at: null })]),
      /NOTIFICATION_READ_MONOTONIC/,
    );
    assert.equal(
      f.app.store.logs.filter((e) => e.event_type === "notification.presented")
        .length,
      2,
    );
    const evidence = frame.log_records[0];
    assert(presentedNotification(f.app.store, evidence));
    f.app.store.commit([
      revise(state, {
        state: "SENT",
        receipt: f.app.store.put({ delivery_key: n.delivery_key }),
      }),
    ]);
    assert(presentedNotification(f.app.store, evidence));
    assert.equal(f.app.store.all("Input").length, inputs);
    assert.equal(f.app.store.all("ModelCall").length, models);
    assert(
      f.server.service.changes
        .changes(boundary)
        .transactions.some((t) =>
          t.changes.some(
            (c) => c.kind === "invalidate" && c.query === "notifications",
          ),
        ),
    );
    detail = await f.client.query(`notifications/${n.id}`);
    validate("Notification", { ...detail });
    assert.equal(detail.read_at, firstRead);
    await f.restart();
    await f.client.command(`notifications/${n.id}/presented`, {
      request_id: id(),
      client_id: a,
    });
    const after: any = await f.client.query(`notifications/${n.id}`);
    assert.deepEqual(after.presented, detail.presented);
    assert.equal(after.created_sequence, detail.created_sequence);
    await assert.rejects(
      f.client.command(`notifications/${n.id}/presented`, {
        request_id: id(),
        client_id: id(),
      }),
      /FORBIDDEN/,
    );
    const c = f.app.store.get<any>("ClientRegistration", a);
    f.app.store.commit([revise(c, { owner_id: id() })]);
    await assert.rejects(
      f.client.command(`notifications/${n.id}/presented`, {
        request_id: id(),
        client_id: a,
      }),
      /FORBIDDEN/,
    );
    await assert.rejects(
      f.client.command(`notifications/${n.id}/read`, {
        request_id: id(),
        client_id: b,
      }),
      /INVALID_REQUEST/,
    );
  }));
test("NOT: bounded UTF-8 inline text and JSON prefixes retain original immutable bytes and legacy state", () =>
  fixture(async (f) => {
    for (const media of ["text/plain", "application/json"]) {
      const original =
        media === "text/plain"
          ? "😀中".repeat(20000)
          : JSON.stringify({ text: "😀中".repeat(20000) });
      const n = f.notice(original, media),
        sequence = f.app.store.sequence;
      const page: any = await f.client.query("notifications");
      validate("NotificationPage", { ...page });
      const row = page.items.find((r: any) => r.id === n.id);
      assert(Buffer.byteLength(row.content.text) <= 2048);
      assert(row.content.truncated);
      const detail: any = await f.client.query(`notifications/${n.id}`);
      validate("Notification", { ...detail });
      assert(Buffer.byteLength(detail.content.text) <= 65536);
      assert(detail.content.truncated);
      assert(!detail.content.text.includes("�"));
      assert(original.startsWith(detail.content.text));
      assert.equal(detail.content.bytes, String(Buffer.byteLength(original)));
      assert.equal(f.app.store.bytes(n.message).toString(), original);
      assert.equal(f.app.store.sequence, sequence);
      assert.equal(detail.read_at, null);
      assert.deepEqual(detail.presented, []);
    }
  }));
