import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";

test("wakeup public queries, cancellation admission, pagination and pure reads", () =>
  fixture(async (f) => {
    const sources = f.source(),
      timers = Array.from({ length: 3 }, () =>
        f.app.host.wakeups.schedule(id(), f.args(), sources),
      );
    const sequence = f.app.store.sequence;
    const first: any = await f.client.query("wakeups?state=PENDING&limit=1");
    validate("WakeupPage", { ...first });
    assert.equal(first.items.length, 1);
    assert(first.next_cursor);
    const second: any = await f.client.query(
      "wakeups?state=PENDING&limit=1&cursor=" +
        encodeURIComponent(first.next_cursor),
    );
    assert.notEqual(first.items[0].id, second.items[0].id);
    await assert.rejects(
      f.client.query(
        "wakeups?state=CANCELLED&cursor=" +
          encodeURIComponent(first.next_cursor),
      ),
      /CURSOR/,
    );
    await assert.rejects(
      f.client.query("wakeups?state=UNKNOWN"),
      /INVALID_QUERY/,
    );
    await assert.rejects(
      f.client.query("wakeups?state=PENDING&state=FIRED"),
      /INVALID_QUERY/,
    );
    await assert.rejects(f.client.query("wakeups?limit=101"), /INVALID_LIMIT/);
    const detail = await f.client.query("wakeups/" + timers[0].timer_id);
    validate("Wakeup", detail);
    assert.equal(f.app.store.sequence, sequence);
    assert.equal(
      (await fetch(f.server.endpoint.url + "/api/v1/wakeups")).status,
      401,
    );
    const call = id(),
      route = "wakeups/" + timers[0].timer_id + "/cancel";
    const receipt = await f.client.command(route, { request_id: call });
    assert.deepEqual(receipt.resource_ids, [
      { type: "WakeTimer", id: timers[0].timer_id },
    ]);
    const frame = f.app.store.projectionFrames.find((f) =>
      f.mutations.some((m) => m.object_id === call),
    )!;
    assert(frame.mutations.some((m) => m.object_type === "WakeTimer"));
    assert.deepEqual(
      await f.client.command(route, { request_id: call }),
      receipt,
    );
    await assert.rejects(
      f.client.command("wakeups/" + timers[1].timer_id + "/cancel", {
        request_id: call,
      }),
      /REQUEST_CONFLICT/,
    );
    const noop = await f.client.command(route, { request_id: id() });
    assert.deepEqual(noop.resource_ids, receipt.resource_ids);
    const missing = id();
    await assert.rejects(
      f.client.command("wakeups/" + id() + "/cancel", { request_id: missing }),
      /NOT_FOUND/,
    );
    assert.equal(f.app.store.find("ApiCommand", missing), undefined);
    // A lost response is reconciled using requests, not a new command identity.
    const reconciled: any = await f.client.query("requests/" + call);
    assert.equal(reconciled.receipt.request_id, call);
    await f.restart();
    assert.deepEqual(
      await f.client.command(route, { request_id: call }),
      receipt,
    );
    await assert.rejects(
      f.client.query(
        "wakeups?state=PENDING&cursor=" + encodeURIComponent(first.next_cursor),
      ),
      /CURSOR_EXPIRED/,
    );
  }));

test("wakeup changes invalidate filtered lists; SSE and durable cursor resume across restart", () =>
  fixture(async (f) => {
    const sources = f.source(),
      cursor = await f.client.syncCursor();
    const a = f.app.host.wakeups.schedule(id(), f.args(), sources);
    const b = f.app.host.wakeups.schedule(id(), f.args(), sources);
    f.app.host.wakeups.cancel(a.timer_id);
    f.time += 2000;
    f.app.host.wakeups.fireDue();
    const changes = await f.client.changes(cursor.cursor);
    for (const timer of [a, b])
      assert(
        changes.transactions.some((t) =>
          t.changes.some(
            (c) =>
              c.kind === "record" &&
              c.resource_type === "wakeups" &&
              c.resource_id === timer.timer_id,
          ),
        ),
      );
    assert(
      changes.transactions.some((t) =>
        t.changes.some((c) => c.kind === "invalidate" && c.query === "wakeups"),
      ),
    );
    const controller = new AbortController();
    const reader = (
      await f.client.stream(cursor.cursor, controller.signal)
    ).getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /event: change/,
    );
    controller.abort();
    await f.restart();
    const resumed = await f.client.changes(cursor.cursor);
    assert.deepEqual(
      resumed.transactions.slice(0, changes.transactions.length),
      changes.transactions,
    );
    const fired: any = await f.client.query("wakeups?state=FIRED");
    assert.deepEqual(
      fired.items.map((t: any) => t.id),
      [b.timer_id],
    );
  }));
