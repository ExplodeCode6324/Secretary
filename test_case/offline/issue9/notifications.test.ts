import test from "node:test";
import assert from "node:assert/strict";
import { fixture, target, drain } from "./helpers.ts";
import { id, revise, hash, base } from "../../../src/pi_secretary/src/store.ts";
import {
  NotificationService,
  presentedNotification,
} from "../../../src/pi_secretary/src/notification-service.ts";
import { validate as validateDTO } from "../../../src/pi_secretary/src/api/protocol.ts";
function validate(name: string, value: unknown) {
  validateDTO(name, value);
}
import type { NotificationDelivery } from "../../../src/pi_secretary/src/contracts.ts";
test("N01/N02/N05: independent delivery, received/presented/read, wrong target and repeated ACKs", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const a = await target(c, "A"),
      b = await target(c, "B");
    const startA = await a.client.bootstrap(),
      startB = await b.client.bootstrap();
    const n = new NotificationService(app.store).create(
      app.host.sessionID,
      "Synthetic result 😀",
      id(),
    );
    const frame = app.store.projectionFrames.at(-1)!;
    assert.equal(
      frame.mutations.filter((m) => m.object_type === "NotificationDelivery")
        .length,
      2,
    );
    assert(frame.mutations.some((m) => m.object_type === "Notification"));
    const da: any = await a.client.query("deliveries"),
      db: any = await b.client.query("deliveries");
    validate("DeliveryPage", da);
    validate("NotificationPage", await c.query("notifications"));
    const aid = da.items[0].id,
      bid = db.items[0].id;
    assert.notEqual(aid, bid);
    assert.equal(da.items[0].received_at, null);
    await assert.rejects(
      a.client.query("deliveries/" + bid),
      /FORBIDDEN_TARGET/,
    );
    await assert.rejects(c.query("deliveries"), /CLIENT_BINDING_REQUIRED/);
    const ack = (kind: string, request_id = id()) => ({
      request_id,
      kind,
      content_version: n.message.sha256,
    });
    await assert.rejects(
      a.client.command("deliveries/" + aid + "/ack", ack("presented")),
      /ACK_PRECONDITION/,
    );
    const request = ack("received");
    await a.client.command("deliveries/" + aid + "/ack", request);
    const committed = app.store.sequence;
    await a.client.command("deliveries/" + aid + "/ack", request);
    assert.equal(app.store.sequence, committed);
    await assert.rejects(
      a.client.command("deliveries/" + aid + "/ack", {
        ...request,
        kind: "read",
      }),
      /REQUEST_CONFLICT/,
    );
    assert(
      !app.store.logs.some((e) => e.event_type === "notification.presented"),
    );
    await a.client.command("deliveries/" + aid + "/ack", ack("presented"));
    const evidence = app.store.logs.find(
      (e) => e.event_type === "notification.presented",
    )!;
    assert.equal(presentedNotification(app.store, evidence)?.id, n.id);
    const rev = app.store.get<NotificationDelivery>(
      "NotificationDelivery",
      aid,
    ).revision;
    await a.client.command("deliveries/" + aid + "/ack", ack("presented"));
    assert.equal(
      app.store.get<NotificationDelivery>("NotificationDelivery", aid).revision,
      rev,
    );
    await a.client.command("deliveries/" + aid + "/ack", ack("read"));
    assert.equal(presentedNotification(app.store, evidence)?.id, n.id); // later read doesn't invalidate evidence
    assert.equal(
      (await b.client.query<any>("deliveries/" + bid)).received_at,
      null,
    );
    const changesA = await drain(a.client, startA.cursor),
      changesB = await drain(b.client, startB.cursor);
    assert(
      changesA.batches
        .flatMap((b) => b.changes)
        .filter((v) => v.resource_type === "delivery")
        .every((v) => v.client_id === a.id),
    );
    assert(
      changesB.batches
        .flatMap((b) => b.changes)
        .filter((v) => v.resource_type === "delivery")
        .every((v) => v.client_id === b.id),
    );
    assert.equal(app.store.get("Notification", n.id).revision, 1);
    const d = app.store.get<NotificationDelivery>("NotificationDelivery", aid);
    assert.throws(
      () => app.store.commit([{ ...d, id: id(), revision: 1 }]),
      /DUPLICATE_DELIVERY/,
    );
    assert.throws(
      () => app.store.commit([revise(d, { received_at: null })]),
      /DELIVERY_FACT_IMMUTABLE/,
    );
    assert.throws(
      () => app.store.commit([revise(d, { client_id: b.id })]),
      /DELIVERY_IDENTITY_CHANGED/,
    );
  }));
test("N03/N04: historical evidence is untouched, new unrouted intents are explicitly claimed once", () =>
  fixture(async (app, server, c) => {
    const ns = new NotificationService(app.store);
    const old = ns.create(app.host.sessionID, "Historical queued", id());
    const sent = ns.create(app.host.sessionID, "Historical sent", id());
    app.store.commit([
      revise(sent, {
        state: "SENT",
        receipt: app.store.put({
          delivery_key: sent.delivery_key,
          presented: true,
        }),
      }),
    ]);
    const frozen = hash(JSON.stringify(app.store.all("Notification")));
    const init = { request_id: id() };
    await c.command("sync/initialize", init);
    await c.command("sync/initialize", init);
    assert.equal(hash(JSON.stringify(app.store.all("Notification"))), frozen);
    const recent = ns.create(app.host.sessionID, "New unrouted", id());
    const a = await target(c, "A");
    assert.equal((await a.client.query<any>("deliveries")).items.length, 0);
    await a.client.command("deliveries/claim", { request_id: id() });
    const ds: any = await a.client.query("deliveries");
    assert.equal(ds.items.length, 1);
    assert.equal(ds.items[0].notification_id, recent.id);
    const b = await target(c, "B");
    await b.client.command("deliveries/claim", { request_id: id() });
    assert.equal((await b.client.query<any>("deliveries")).items.length, 0);
    assert.equal((await c.query<any>("notifications/" + old.id)).legacy, true);
    assert.equal(
      (await c.query<any>("notifications/" + recent.id)).legacy,
      false,
    );
    await c.command("clients/" + a.id + "/notification-target", {
      request_id: id(),
      enabled: false,
    });
    const next = ns.create(app.host.sessionID, "B only", id());
    assert.equal(
      app.store
        .all<NotificationDelivery>("NotificationDelivery")
        .filter((d) => d.notification_id === next.id).length,
      1,
    );
    assert.equal((await a.client.query<any>("deliveries")).items.length, 1);
  }));
test("S06: notification text chunks preserve Unicode and full content, never leak CAS paths", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const body = "中😀e\u0301".repeat(14000);
    const n = new NotificationService(app.store).create(
      app.host.sessionID,
      body,
      id(),
    );
    let text = "",
      cursor: string | null = null;
    do {
      const p: any = await c.query(
        "notifications/" +
          n.id +
          "/content" +
          (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      validate("NotificationContent", p);
      assert(Buffer.byteLength(p.text) < 32769);
      assert(!JSON.stringify(p).includes("objects/"));
      text += p.text;
      cursor = p.next_cursor;
    } while (cursor);
    assert.equal(text, body);
  }));
