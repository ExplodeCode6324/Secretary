import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.ts";
import { base, id, now, revise } from "../../../src/pi_secretary/src/store.ts";
import { SYNC_PAGE_BYTES } from "../../../src/pi_secretary/src/sync-service.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
import type { SyncTransaction } from "../../../src/pi_secretary/src/api/contracts.ts";
import type {
  Notification,
  Execution,
} from "../../../src/pi_secretary/src/contracts.ts";

test("FEED: exact final JSON byte boundary includes false, UTF-8 and commas without dropping a transaction", () =>
  fixture(async (f) => {
    const sync = f.server.service.changes,
      after = f.cursor(),
      start = f.app.store.sequence;
    f.app.store.commit([]);
    f.app.store.commit([]);
    // Isolate response packing from projection generation; both transactions fit its per-transaction bound.
    const changes = [1, 2].map(() => ({
      kind: "invalidate" as const,
      resource_type: "notifications",
      query: "😀".repeat(30000),
    }));
    const transactions: SyncTransaction[] = changes.map((change, i) => ({
      cursor: sync.cursor(start + i + 1),
      changes: [change],
    }));
    const final = {
      api_version: "1",
      data: {
        transactions,
        next_cursor: transactions[1].cursor,
        has_more: false,
      },
    };
    const padding = SYNC_PAGE_BYTES - Buffer.byteLength(JSON.stringify(final));
    changes[0].query += "x".repeat(Math.floor(padding / 2));
    changes[1].query += "x".repeat(Math.ceil(padding / 2));
    sync.transaction = (sequence) => transactions[sequence - start - 1];
    const exact = sync.changes(after);
    assert.equal(exact.transactions.length, 2);
    assert.equal(exact.has_more, false);
    assert.equal(
      Buffer.byteLength(JSON.stringify({ api_version: "1", data: exact })),
      SYNC_PAGE_BYTES,
    );
    changes[1].query += "x";
    const first = sync.changes(after);
    assert.equal(first.transactions.length, 1);
    assert.equal(first.has_more, true);
    assert(
      Buffer.byteLength(JSON.stringify({ api_version: "1", data: first })) <=
        SYNC_PAGE_BYTES,
    );
    const rest = sync.changes(first.next_cursor);
    assert.deepEqual(rest.transactions, [transactions[1]]);
    assert.equal(rest.next_cursor, f.cursor());
    assert.equal(rest.has_more, false);
  }));

test("FEED: mutation-only, log-only and private transactions are ordered and bounded by inspected count", () =>
  fixture(async (f) => {
    const after = f.cursor(),
      s = f.app.store;
    f.notice();
    s.commit(
      [],
      [
        s.event(
          "main.message",
          {
            role: "assistant",
            content: [{ type: "text", text: "synthetic final" }],
            timestamp: Date.now(),
          },
          {
            session_id: f.app.host.sessionID,
            task_id: null,
            execution_id: null,
          },
          "MAIN",
        ),
      ],
    );
    s.commit(
      [],
      [
        s.event("internal.synthetic", {
          credential: "PRIVATE_SYNTHETIC_VALUE",
        }),
      ],
    );
    s.commit(
      [],
      [
        s.event("world.change_applied", {
          internal: "PRIVATE_SYNTHETIC_VALUE",
        }),
      ],
    );
    const sync = f.server.service.changes;
    const page = sync.changes(after, 3);
    validate("SyncPage", { ...page });
    assert.equal(page.transactions.length, 3);
    assert(page.has_more);
    assert.deepEqual(page.transactions[2].changes, []);
    assert(
      page.transactions[0].changes.some(
        (c) => c.kind === "record" && c.resource_type === "notifications",
      ),
    );
    assert(
      page.transactions[1].changes.some(
        (c) => c.kind === "invalidate" && c.query === "timeline",
      ),
    );
    const rest = sync.changes(page.next_cursor);
    assert.equal(rest.transactions.length, 1);
    assert(
      rest.transactions[0].changes.some((c) => c.resource_type === "world"),
    );
    assert(!JSON.stringify(page).includes("PRIVATE_SYNTHETIC_VALUE"));
    assert(!JSON.stringify(page).includes("objects/"));
    assert.equal(sync.position(rest.next_cursor), s.sequence);
    assert(!rest.has_more);
    const q: any = await f.client.query(
      "sync/changes?after=" + after + "&limit=1",
    );
    assert.equal(q.transactions.length, 1);
  }));
test("FEED: oversized complete transaction falls back to bounded collection invalidations without fragments", () =>
  fixture(async (f) => {
    const after = f.cursor(),
      s = f.app.store,
      ref = s.put("synthetic");
    const records: Notification[] = Array.from({ length: 1500 }, () => ({
      ...base(),
      record_type: "Notification",
      schema_version: 1,
      session_id: f.app.host.sessionID,
      channel: "local-ui",
      state: "QUEUED",
      message: ref,
      receipt: null,
      delivery_key: id(),
      requested_at: now(),
    }));
    s.commit(records);
    const page = f.server.service.changes.changes(after);
    assert.equal(page.transactions.length, 1);
    assert.deepEqual(page.transactions[0].changes, [
      {
        kind: "invalidate",
        resource_type: "notifications",
        query: "notifications",
      },
    ]);
    assert.equal(page.next_cursor, f.cursor());
    assert(
      Buffer.byteLength(JSON.stringify({ api_version: "1", data: page })) <=
        SYNC_PAGE_BYTES,
    );
  }));
test("VIEW/NEW: Execution-only change invalidates Task despite same root revision, Scope and operation stats/attention refresh", () =>
  fixture(async (f) => {
    const taskReceipt = await f.client.command("task-requests", {
      request_id: id(),
      goal: "Synthetic sync contract",
    });
    const task = taskReceipt.resource_ids.find(
      (r) => r.type === "TaskPlan",
    )!.id;
    await f.app.settle();
    const before: any = await f.client.query("tasks/" + task),
      e = f.app.store.all<Execution>("Execution")[0],
      after = f.cursor();
    f.app.store.commit([revise(e, { last_activity_at: now() })]);
    const page = f.server.service.changes.changes(after);
    assert(
      page.transactions[0].changes.some(
        (c) => c.kind === "invalidate" && c.query === "tasks",
      ),
    );
    const fresh: any = await f.client.query("tasks/" + task);
    assert.equal(fresh.revision, before.revision);
    const boundary = f.cursor();
    const scope = await f.client.command("scopes", {
      request_id: id(),
      name: "Synthetic scope",
      kind: "NONE",
      description: "sync",
    });
    const scopeID = scope.resource_ids.find((r) => r.type === "Scope")!.id;
    await f.client.command(`scopes/${scopeID}/archive`, {
      request_id: id(),
      expected_revision: "1",
    });
    const op = f.app.authorization.prepare(
      { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
      "file.write",
      "synthetic.txt",
      { text: "x" },
    );
    const a: any = f.app.store.get(
      "AuthorizationRequest",
      op.authorization_id!,
    );
    await f.client.command(`authorizations/${a.id}/decision`, {
      request_id: id(),
      expected_revision: String(a.revision),
      display_hash: a.display_hash,
      decision: "REJECT",
    });
    f.app.store.commit(
      [],
      [f.app.store.event("operation.dispatched", { operation_id: op.id })],
    );
    const changes = f.server.service.changes
      .changes(boundary)
      .transactions.flatMap((t) => t.changes);
    for (const resource of [
      "scopes",
      "operations",
      "authorizations",
      "attention",
      "tasks",
      "authorization-rules",
      "admin/authorization-rules",
    ])
      assert(
        changes.some((c) => c.resource_type === resource),
        resource,
      );
  }));

test("FEED: page byte budget stops at prior complete transaction and next page includes all remaining items", () =>
  fixture(async (f) => {
    const after = f.cursor(),
      s = f.app.store,
      ref = s.put("synthetic"),
      expected: string[] = [];
    for (let tx = 0; tx < 5; tx++) {
      const records: Notification[] = Array.from({ length: 600 }, () => ({
        ...base(),
        record_type: "Notification",
        schema_version: 1,
        session_id: f.app.host.sessionID,
        channel: "local-ui",
        state: "QUEUED",
        message: ref,
        receipt: null,
        delivery_key: id(),
        requested_at: now(),
      }));
      expected.push(...records.map((r) => r.id));
      s.commit(records);
    }
    let cursor = after,
      seen: string[] = [],
      pages = 0;
    do {
      const page = f.server.service.changes.changes(cursor);
      assert(page.transactions.length > 0);
      assert(
        Buffer.byteLength(JSON.stringify({ api_version: "1", data: page })) <=
          SYNC_PAGE_BYTES,
      );
      for (const tx of page.transactions)
        seen.push(
          ...tx.changes.flatMap((c) =>
            c.kind === "record" && c.resource_type === "notifications"
              ? [c.resource_id]
              : [],
          ),
        );
      cursor = page.next_cursor;
      pages++;
      if (!page.has_more) break;
    } while (pages < 10);
    assert(pages > 1);
    assert.deepEqual(seen, expected);
    assert.equal(cursor, f.cursor());
  }));
