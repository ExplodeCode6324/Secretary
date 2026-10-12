import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.ts";
import { Cursors } from "../../../src/pi_secretary/src/api/protocol.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";

test("LOAD: common tuple pagination sorts a copy, binds filters, survives unrelated writes", () =>
  fixture(async (f) => {
    const ids = Array.from({ length: 7 }, (_, i) => f.notice(String(i)).id);
    let route = "notifications?limit=2",
      seen: string[] = [];
    while (route) {
      const page: any = await f.client.query(route);
      seen.push(...page.items.map((n: any) => n.id));
      await f.client.command("assistant/profile", {
        request_id: id(),
        expected_revision: String(
          f.app.store.all("AssistantProfile")[0].revision,
        ),
        name: "Synthetic",
      });
      route = page.next_cursor
        ? "notifications?limit=2&cursor=" + page.next_cursor
        : "";
    }
    assert.deepEqual(seen, ids);
    const old = f.app.store.firstSequence("Notification", ids[0]);
    const n = f.app.store.get<any>("Notification", ids[0]);
    f.app.store.commit([revise(n, { read_at: new Date().toISOString() })]);
    assert.equal(f.app.store.firstSequence("Notification", ids[0]), old);
    await f.restart();
    assert.equal(f.app.store.firstSequence("Notification", ids[0]), old);
    const cursors = new Cursors("synthetic"),
      values = [{ id: "c" }, { id: "a" }, { id: "b" }],
      key = (v: { id: string }) => [v.id];
    const first = cursors.page(
      "scope",
      values,
      new URLSearchParams("limit=1&kind=a"),
      key,
    );
    assert.deepEqual(
      values.map((v) => v.id),
      ["c", "a", "b"],
    );
    assert.equal(first.items[0].id, "a");
    const q = new URLSearchParams({
      limit: "1",
      kind: "a",
      cursor: first.next_cursor!,
    });
    assert.equal(
      cursors.page("scope", [{ id: "0" }, { id: "c" }, { id: "b" }], q, key)
        .items[0].id,
      "b",
    );
    assert.throws(
      () =>
        cursors.page(
          "scope",
          values,
          new URLSearchParams({ ...Object.fromEntries(q), kind: "b" }),
          key,
        ),
      /CURSOR_EXPIRED/,
    );
    assert.throws(
      () => cursors.page("other", values, q, key),
      /CURSOR_EXPIRED/,
    );
  }));
test("LOAD: scopes, requests, memory, attention, rules, artifacts and related use the shared paginator", () =>
  fixture(async (f) => {
    for (const route of [
      "scopes",
      "tasks",
      "decisions",
      "authorizations",
      "operations",
      "admin/programs",
      "authorization-rules",
      "admin/authorization-rules",
      "artifacts",
      "related",
      "memory/summary",
      "memory/commitments",
      "attention",
    ]) {
      const page: any = await f.client.query(route + "?limit=1");
      assert(Array.isArray(page.items), route);
    }
    const cursor = f.cursor();
    f.notice("created during initial loading");
    assert(
      f.server.service.changes
        .changes(cursor)
        .transactions.some((t) =>
          t.changes.some((c) => c.resource_type === "notifications"),
        ),
    );
  }));
