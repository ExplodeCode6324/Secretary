import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fixture } from "./helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type { AuthorizationRule } from "../../../src/pi_secretary/src/contracts.ts";

test("NEW: real rule dispatch invalidates both aliases while unchanged rule revision gains match count; disable and operation resolution sync", () =>
  fixture(async (f) => {
    const scope = {
        session_id: f.app.host.sessionID,
        task_id: null,
        execution_id: null,
      },
      resource = path.join(f.dir, "synthetic-rule-target"),
      parameters = { text: "synthetic" };
    const rule = f.app.authorization.rule("file.write", resource, parameters),
      before = f.cursor();
    const op = f.app.authorization.prepare(
      scope,
      "file.write",
      resource,
      parameters,
    );
    assert.equal(op.rule_id, rule.id);
    f.app.authorization.dispatch(op.id);
    f.app.authorization.finish(op.id, { synthetic: true }, "UNKNOWN");
    const changes = f.server.service.changes
      .changes(before)
      .transactions.flatMap((t) => t.changes);
    for (const query of [
      "authorization-rules",
      "admin/authorization-rules",
      "attention",
      "tasks",
    ])
      assert(
        changes.some((c) => c.kind === "invalidate" && c.query === query),
        query,
      );
    const updated = f.app.store.get<AuthorizationRule>(
      "AuthorizationRule",
      rule.id,
    );
    assert.equal(updated.revision, rule.revision);
    for (const route of ["authorization-rules", "admin/authorization-rules"]) {
      const page: any = await f.client.query(route);
      assert.equal(page.items[0].match_count, 1);
    }
    const boundary = f.cursor();
    await f.client.command(`admin/authorization-rules/${rule.id}/disable`, {
      request_id: id(),
      expected_revision: String(updated.revision),
    });
    const current: any = f.app.store.get("Operation", op.id);
    await f.client.command(`operations/${op.id}/resolve`, {
      request_id: id(),
      expected_revision: String(current.revision),
      outcome: "NOT_APPLIED",
      note: "Synthetic controlled unknown outcome",
    });
    const subsequent = f.server.service.changes
      .changes(boundary)
      .transactions.flatMap((t) => t.changes);
    assert(
      subsequent.some(
        (c) => c.kind === "record" && c.resource_type === "authorization-rules",
      ),
    );
    assert(
      subsequent.some(
        (c) => c.kind === "record" && c.resource_type === "operations",
      ),
    );
  }));

test("NEW: ModelCall-only history updates and log-only notification/feedback/tool history invalidate timeline without exposing private requests", () =>
  fixture(async (f) => {
    await f.client.command("messages", {
      request_id: id(),
      text: "Synthetic activity projection",
    });
    await f.app.host.drain();
    const call = f.app.store.all<any>("ModelCall")[0],
      after = f.cursor();
    f.app.store.commit([revise(call, {})]);
    let page = f.server.service.changes.changes(after);
    for (const resource of ["timeline", "activities"])
      assert(
        page.transactions[0].changes.some(
          (c) => c.kind === "invalidate" && c.resource_type === resource,
        ),
      );
    assert(!JSON.stringify(page).includes("objects/"));
    assert(!page.transactions[0].changes.some((c) => c.kind === "record"));
    for (const kind of [
      "notification.queued",
      "feedback.delivered",
      "agent.message",
      "main.tool.result",
    ]) {
      const cursor = f.cursor();
      f.app.store.commit(
        [],
        [
          f.app.store.event(
            kind,
            { synthetic: true },
            {
              session_id: f.app.host.sessionID,
              task_id: null,
              execution_id: null,
            },
          ),
        ],
      );
      page = f.server.service.changes.changes(cursor);
      assert(
        page.transactions[0].changes.some(
          (c) => c.kind === "invalidate" && c.query === "timeline",
        ),
        kind,
      );
    }
  }));
