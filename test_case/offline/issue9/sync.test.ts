import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { fixture } from "./helpers.ts";
test("S01/S02: bootstrap cut, records-only commit and read-only catch-up", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const snap: any = await c.query("sync/bootstrap");
    const before = app.store.sequence;
    app.store.commit([
      revise(app.host.session, { state: app.host.session.state }),
    ]);
    const tip = app.store.sequence;
    assert.equal(tip, before + 1);
    const changes: any = await c.query(
      "sync/changes?after=" + encodeURIComponent(snap.cursor),
    );
    assert(
      changes.batches.some((b: any) =>
        b.changes.some((v: any) => v.resource_type === "session"),
      ),
    );
    assert.notEqual(changes.next_cursor, snap.cursor);
    assert.equal(app.store.sequence, tip);
    const empty: any = await c.query(
      "sync/changes?after=" + encodeURIComponent(changes.next_cursor),
    );
    assert.equal(empty.batches.length, 0);
    assert.equal(app.store.sequence, tip);
  }));
import { createHmac } from "node:crypto";
import { target, drain } from "./helpers.ts";
import { base } from "../../../src/pi_secretary/src/store.ts";
import {
  syncMetadata,
  NotificationService,
} from "../../../src/pi_secretary/src/notification-service.ts";
import { validate as validateDTO } from "../../../src/pi_secretary/src/api/protocol.ts";
function validate(name: string, value: unknown) {
  validateDTO(name, value);
}
import type { Notification } from "../../../src/pi_secretary/src/contracts.ts";
function signed(app: App, token: string, patch: object) {
  const data = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()),
      ...patch,
    }),
  ).toString("base64url");
  return (
    data +
    "." +
    createHmac("sha256", syncMetadata(app.store)!.secret)
      .update(data)
      .digest("base64url")
  );
}
test("S01: logs-only and private transactions advance without leaking internal data", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const snap = await c.bootstrap();
    app.store.commit(
      [],
      [
        app.store.event("world.change_applied", {
          secret: "must not leave server",
        }),
      ],
    );
    app.store.commit(
      [],
      [app.store.event("private.hidden", { secret: "must not leave server" })],
    );
    app.store.commit([], [], {
      request: id(),
      hash: "0".repeat(64),
      value: id(),
    });
    const result = await drain(c, snap.cursor);
    assert.equal(result.batches.length, 3);
    assert.equal(result.batches[2].changes.length, 0);
    assert.equal(result.batches[1].changes.length, 0);
    assert(
      result.batches[0].changes.some((v: any) => v.resource_type === "world"),
    );
    assert(!JSON.stringify(result).includes("must not leave server"));
    assert.equal((await c.changes(result.cursor)).batches.length, 0);
  }));
test("S02: frozen snapshot pagination survives concurrent revisions and bounds new keys", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const ns = new NotificationService(app.store);
    for (let i = 0; i < 120; i++)
      ns.create(app.host.sessionID, "Synthetic " + i, id());
    const snap = await c.bootstrap();
    validate("SyncBootstrap", snap);
    const old = snap.journal.resources.items;
    const profile: any = await c.assistant();
    await c.command("assistant/profile", {
      request_id: id(),
      expected_revision: profile.revision,
      name: "changed",
    });
    ns.create(app.host.sessionID, "after cut", id());
    let cursor = snap.journal.resources.next_cursor;
    const seen = [...old];
    while (cursor) {
      const page: any = await c.query(
        "sync/snapshot?cursor=" + encodeURIComponent(cursor),
      );
      validate("SyncSnapshotPage", page);
      assert.equal(page.version, snap.journal.resources.version);
      seen.push(...page.items);
      cursor = page.next_cursor;
    }
    assert.equal(
      seen.filter((v) => v.resource_type === "notification").length,
      120,
    );
    assert.equal(
      seen.find((v) => v.resource_type === "assistant")!.revision,
      profile.revision,
    );
    const changes = await drain(c, snap.cursor);
    assert(
      changes.batches.some((b) =>
        b.changes.some((v: any) => v.resource_type === "assistant"),
      ),
    );
    const token = snap.journal.resources.next_cursor!;
    await assert.rejects(
      c.query(
        "sync/snapshot?cursor=" +
          encodeURIComponent(signed(app, token, { expires: 0 })),
      ),
      /SNAPSHOT_EXPIRED/,
    );
  }));
test("S05/S09: malformed, stale, wrong target/history/digest/projection and future cursors fail closed", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const a = await target(c, "A"),
      b = await target(c, "B");
    const snap = await a.client.bootstrap();
    await assert.rejects(b.client.changes(snap.cursor), /RESYNC_REQUIRED/);
    for (const cursor of ["garbage", snap.cursor + "x", "x".repeat(9000)])
      await assert.rejects(a.client.changes(cursor), /INVALID_SYNC_CURSOR/);
    for (const patch of [
      { sequence: "9007199254740992" },
      { digest: "0".repeat(64) },
      { history: id() },
      { v: "future" },
      { sequence: String(app.store.sequence + 1) },
    ])
      await assert.rejects(
        a.client.changes(signed(app, snap.cursor, patch)),
        /RESYNC_REQUIRED|INVALID_SYNC_CURSOR/,
      );
    await c.command("sync/reset-history", { request_id: id() });
    await assert.rejects(a.client.changes(snap.cursor), /RESYNC_REQUIRED/);
    await assert.rejects(c.query("sync/changes"), /SYNC_CURSOR_REQUIRED/);
  }));
test("S06: oversized transaction fragments resume only at complete cursor with bounded pages", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const snap = await c.bootstrap();
    const message = app.store.put(
      "Synthetic bounded notification",
      "text/plain",
    );
    const records: Notification[] = Array.from({ length: 3200 }, () => ({
      ...base(),
      record_type: "Notification",
      schema_version: 1,
      state: "QUEUED",
      session_id: app.host.sessionID,
      channel: "fixture",
      message,
      delivery_key: id(),
      receipt: null,
      requested_at: new Date().toISOString(),
    }));
    app.store.commit(records);
    await new Promise((r) => setTimeout(r, 20));
    const first = await c.changes(snap.cursor);
    validate("SyncPage", first);
    assert(first.has_more);
    assert(first.next_page);
    assert.equal(first.next_cursor, snap.cursor);
    assert(first.batches.every((b) => !b.final && b.cursor === null));
    assert(Buffer.byteLength(JSON.stringify(first)) <= 512 * 1024);
    const second = await c.changes(first.next_cursor, first.next_page!);
    console.info(
      "ISSUE9_FRAGMENT",
      JSON.stringify({
        resources: 3200,
        first_page_bytes: Buffer.byteLength(JSON.stringify(first)),
        second_page_bytes: Buffer.byteLength(JSON.stringify(second)),
        fragments: first.batches.length + second.batches.length,
      }),
    );
    assert(second.batches.at(-1)!.final);
    assert.notEqual(second.next_cursor, snap.cursor);
    const combined = [...first.batches, ...second.batches].flatMap(
      (b) => b.changes,
    );
    assert.equal(
      new Set(
        combined
          .filter((v) => v.resource_type === "notification")
          .map((v) => v.resource_id),
      ).size,
      3200,
    );
    assert.deepEqual(await c.changes(snap.cursor), first); // interrupted client replays exactly.
  }));
test("V01/R01: public invalidations and queries never write, deliver, invoke model or extend retention", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const snap = await c.bootstrap();
    await c.command("messages", {
      request_id: id(),
      text: "Synthetic queued input",
    });
    const before = app.store.sequence,
      inputs = app.store.all("Input"),
      calls = app.store.all("ModelCall"),
      exec = app.store.all("Execution");
    for (let i = 0; i < 5; i++) {
      await c.bootstrap();
      await drain(c, snap.cursor);
      await c.query("notifications");
      await c.query("attention");
    }
    assert.equal(app.store.sequence, before);
    assert.deepEqual(app.store.all("Input"), inputs);
    assert.deepEqual(app.store.all("ModelCall"), calls);
    assert.deepEqual(app.store.all("Execution"), exec);
    const profile = await c.assistant();
    await c.command("assistant/profile", {
      request_id: id(),
      name: "synthetic name",
      expected_revision: profile.revision,
    });
    const changes = await drain(c, snap.cursor);
    assert(
      changes.batches.some((b) =>
        b.changes.some((v: any) => v.resource_type === "assistant"),
      ),
    );
    assert.equal((await c.assistant()).actor_id, "assistant");
    assert.deepEqual(app.store.all("ModelCall"), calls);
  }));

test("C01/V01: task execution, artifact/attention relations and request resources converge through the same feed", () =>
  fixture(async (app, server, c) => {
    await c.command("sync/initialize", { request_id: id() });
    const snap = await c.bootstrap();
    const body = { request_id: id(), goal: "Synthetic feed task" };
    const [a, b] = await Promise.all([
      c.command("task-requests", body),
      c.command("task-requests", body),
    ]);
    assert.deepEqual(a, b);
    await app.settle();
    const events = (await drain(c, snap.cursor)).batches.flatMap(
      (b) => b.changes,
    );
    for (const kind of ["task", "execution", "result", "request", "activity"])
      assert(
        events.some((v) => v.resource_type === kind),
        kind,
      );
    for (const route of ["artifacts", "related", "attention"])
      assert(
        events.some(
          (v) => v.resource_type === "invalidation" && v.query === route,
        ),
        route,
      );
    const receipt: any = await c.query("requests/" + body.request_id);
    assert.deepEqual(receipt.receipt.resource_ids, a.resource_ids);
    assert.equal(app.store.all("TaskPlan").length, 1);
  }));
