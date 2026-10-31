import test from "node:test";
import assert from "node:assert/strict";
import { fixture, until } from "../issue9/helpers.ts";
import { id, base, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  TaskPlan,
  Execution,
  TaskResult,
} from "../../../src/pi_secretary/src/contracts.ts";
import type {
  TaskBrowserPage,
  TaskBrowserMessages,
  TaskBrowserDetail,
  Message,
} from "../../../src/pi_secretary/src/api/contracts.ts";
import { TaskBrowserWindow } from "../../../src/pi_secretary/src/tui/task-browser.ts";

test("prefix uniqueness scans authorized history; archives and cursors cannot bypass ownership", () =>
  fixture(async (f) => {
    const one = f.app.scheduler.scopes.save({ name: "visible", kind: "NONE" }),
      two = f.app.scheduler.scopes.save({ name: "archive", kind: "NONE" });
    const p = f.app.scheduler.propose("original", id(), f.app.host.sessionID, {
      scopeID: one.id,
      at: "2099-01-01T00:00:00.000Z",
    });
    const a = { ...p, ...base("abcdef00-0000-4000-8000-000000000001") },
      b = {
        ...p,
        ...base("abcdef00-0000-4000-8000-000000000002"),
        scope_id: two.id,
      };
    f.app.store.commit([a, b]);
    await assert.rejects(
      f.client.query("task-browser/locate?match=prefix&task_id=abcdef00"),
      /AMBIGUOUS_TASK_ID/,
    );
    f.app.scheduler.scopes.archive(two.id, two.revision);
    const located = await f.client.query<TaskBrowserPage>(
      "task-browser/locate?match=prefix&task_id=abcdef00",
    );
    assert.equal(located.target, a.id);
    assert.equal(located.counts.scopes, 1);
    assert.equal(located.counts.archived_scopes, 1);
    const page = await f.client.query<TaskBrowserPage>("task-browser?limit=1");
    assert(page.after);
    f.app.store.commit([revise(a, { state: "PAUSED" })]);
    await assert.rejects(
      f.client.query("task-browser?cursor=" + encodeURIComponent(page.after)),
      /CURSOR_EXPIRED/,
    );
    await assert.rejects(
      f.client.query("task-browser/" + b.id),
      /TASK_NOT_BROWSABLE/,
    );
    const suggestions = await f.client.query<TaskBrowserPage>(
      "task-browser/locate?match=prefix&task_id=abcdef00&suggest=true&limit=1",
    );
    assert.deepEqual(suggestions.suggestions, [a.id]);
    for (const query of [
      "limit=101",
      "thinking=maybe",
      "limit=1&limit=2",
      "cursor=forged",
      "direction=wrong",
    ])
      await assert.rejects(f.client.query("task-browser?" + query));
    const denied = await fetch(f.server.endpoint.url + "/api/v1/task-browser", {
      headers: { Authorization: "Bearer invalid" },
    });
    assert.equal(denied.status, 401);
  }));
test("checkpoint churn preserves list cursors; time expiry refreshes without journal mutation", () =>
  fixture(async (f) => {
    const p = f.app.scheduler.propose("waiting", id(), f.app.host.sessionID, {
      preconditions: [
        {
          condition_id: id(),
          kind: "RESOURCE_PRESENT",
          target: "missing",
          required_revision: null,
        },
      ],
    });
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const page = await f.client.query<TaskBrowserPage>("task-browser?limit=1");
    const e = f.app.store.all<Execution>("Execution")[0];
    f.app.store.commit([revise(e, {})]);
    const again = await f.client.query<TaskBrowserPage>("task-browser?limit=1");
    assert.equal(again.generation, page.generation);
    assert(
      (
        await f.client.query<TaskBrowserPage>(
          "task-browser?cursor=" + encodeURIComponent(page.after!),
        )
      ).items.some((i) => i.id === p.id),
    );
    const due = Date.now() + 80,
      expiry = Date.now() + 500;
    const timed = f.app.scheduler.propose(
      "expires without sync",
      id(),
      f.app.host.sessionID,
      {
        at: new Date(due).toISOString(),
        deadline: new Date(expiry).toISOString(),
      },
    );
    const b = new TaskBrowserWindow(f.client, () => false);
    try {
      await b.refresh();
      assert(b.root!.items.some((i) => i.id === timed.id));
      const sequence = f.app.store.sequence;
      await until(() => !b.root!.items.some((i) => i.id === timed.id), 2000);
      assert.equal(f.app.store.sequence, sequence);
    } finally {
      b.stop();
    }
  }));
test("content is grapheme-safe, mode-bound, complete and rejects a foreign task execution", () =>
  fixture(async (f) => {
    const p = f.app.scheduler.propose("messages", id(), f.app.host.sessionID);
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const e = f.app.store.all<Execution>("Execution")[0];
    const text = "x".repeat(4095) + "e\u0301" + "😀".repeat(3000),
      thought = "思考".repeat(3000);
    const event = f.app.store.event(
      "agent.message",
      {
        role: "assistant",
        stopReason: "stop",
        content: [
          { type: "text", text },
          { type: "thinking", thinking: thought },
        ],
      },
      { session_id: null, task_id: p.id, execution_id: e.id },
      "EXECUTOR",
    );
    f.app.store.commit([], [event]);
    const path = `task-browser/${p.id}/executions/${e.id}/messages/${event.event_id}/content`;
    let m = await f.client.query<Message>(path + "?thinking=true");
    assert(!m.text.endsWith("e"));
    assert(m.next_cursor);
    await assert.rejects(
      f.client.query(
        path + "?thinking=false&cursor=" + encodeURIComponent(m.next_cursor),
      ),
      /CURSOR_EXPIRED/,
    );
    let full = m.text,
      fullThought = m.thinking ?? "";
    while (m.next_cursor) {
      m = await f.client.query<Message>(
        path + "?thinking=true&cursor=" + encodeURIComponent(m.next_cursor),
      );
      full += m.text;
      fullThought += m.thinking ?? "";
    }
    assert.equal(full, text);
    assert.equal(fullThought, thought);
    assert.equal(m.outcome, "completed");
    const other = f.app.scheduler.propose("other", id(), f.app.host.sessionID, {
      at: "2099-01-01T00:00:00.000Z",
    });
    await assert.rejects(
      f.client.query(path.replace(p.id, other.id)),
      /EXECUTION_OUTSIDE_RECENT_THREE/,
    );
    const sequence = f.app.store.sequence;
    await f.client.query<TaskBrowserDetail>("task-browser/" + p.id);
    await f.client.query<TaskBrowserMessages>(
      `task-browser/${p.id}/executions/${e.id}/messages`,
    );
    assert.equal(f.app.store.sequence, sequence);
  }));

test("oversized graphemes cannot poison list, history lookup or message bodies", () =>
  fixture(async (f) => {
    // SEEDED pathological external/model text; ordinary graphemes remain intact.
    const huge = "👩‍".repeat(5000) + "👩e" + "\u0301".repeat(12000);
    const historical = f.app.scheduler.propose(
      huge,
      id(),
      f.app.host.sessionID,
      { at: "2099-01-01T00:00:00.000Z" },
    );
    f.app.store.commit([
      revise(historical, { state: "PAUSED", initialization_error: huge }),
    ]);
    const p = f.app.scheduler.propose(
      "normal execution",
      id(),
      f.app.host.sessionID,
    );
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const e = f.app.store
      .all<Execution>("Execution")
      .find((e) => e.task_id === p.id)!;
    const events = [
      {
        role: "assistant",
        content: [
          { type: "text", text: huge },
          { type: "thinking", thinking: huge },
        ],
      },
      {
        role: "toolResult",
        toolName: "oversized-result",
        toolCallId: "large",
        content: [{ type: "text", text: huge }],
      },
    ].map((message) =>
      f.app.store.event(
        "agent.message",
        message,
        { session_id: null, task_id: p.id, execution_id: e.id },
        "EXECUTOR",
      ),
    );
    f.app.store.commit([], events);
    if (e.result_id) {
      const original = f.app.store.get<TaskResult>("TaskResult", e.result_id);
      const executionID = id(),
        observedAt = new Date().toISOString();
      const result: TaskResult = {
        ...original,
        ...base(),
        execution_id: executionID,
        outcome: "FAILED",
        summary: huge,
        observed_at: observedAt,
      };
      // TaskResult is immutable: seed a new consistent result/execution pair.
      f.app.store.commit([
        result,
        {
          ...e,
          ...base(executionID),
          state: "FAILED",
          started_at: observedAt,
          ended_at: observedAt,
          result_id: result.id,
        },
      ]);
    }
    const sequence = f.app.store.sequence;
    await f.client.query<TaskBrowserPage>("task-browser");
    const located = await f.client.query<TaskBrowserPage>(
      `task-browser/locate?task_id=${historical.id}`,
    );
    assert.equal(located.historical?.id, historical.id);
    assert(located.historical!.goal_truncated);
    const suggested = await f.client.query<TaskBrowserPage>(
      `task-browser/locate?match=prefix&task_id=${historical.id.slice(0, 8)}&suggest=true`,
    );
    assert(suggested.suggestions.includes(historical.id));
    const messages = await f.client.query<TaskBrowserMessages>(
      `task-browser/${p.id}/executions/${e.id}/messages`,
    );
    assert(
      events.every((event) =>
        messages.items.some((m) => m.id === event.event_id),
      ),
    );
    for (const event of events) {
      const path = `task-browser/${p.id}/executions/${e.id}/messages/${event.event_id}/content?thinking=true`;
      let m = await f.client.query<Message>(path),
        text = "",
        thinking = "",
        pages = 0;
      for (;;) {
        assert(m.text.length <= 8192);
        assert(!/[\uD800-\uDBFF]$/.test(m.text));
        text += m.text;
        thinking += m.thinking ?? "";
        assert(++pages < 30);
        if (!m.next_cursor) break;
        m = await f.client.query<Message>(
          path + "&cursor=" + encodeURIComponent(m.next_cursor),
        );
      }
      assert.equal(text, huge);
      if (event === events[0]) assert.equal(thinking, huge);
    }
    assert.equal(f.app.store.sequence, sequence);
  }));

test("byte-bounded pages traverse both ways without holes and reserve historical locate payload", () =>
  fixture(async (f) => {
    const goal = "界".repeat(5000),
      ids = new Set<string>();
    for (let i = 0; i < 70; i++)
      ids.add(
        f.app.scheduler.propose(goal + String(i), id(), f.app.host.sessionID, {
          at: "2099-01-01T00:00:00.000Z",
        }).id,
      );
    const historical = f.app.scheduler.propose(
      goal,
      id(),
      f.app.host.sessionID,
      { at: "2099-01-01T00:00:00.000Z" },
    );
    f.app.store.commit([
      revise(historical, { state: "PAUSED", initialization_error: goal }),
    ]);
    const located = await f.client.query<TaskBrowserPage>(
      `task-browser/locate?task_id=${historical.id}`,
    );
    assert.equal(located.historical?.id, historical.id);
    assert(Buffer.byteLength(JSON.stringify(located)) < 256 * 1024 - 2048);
    let page = await f.client.query<TaskBrowserPage>("task-browser?limit=100"),
      forward = new Set<string>(),
      backward = new Set<string>();
    const add = (to: Set<string>, p: TaskBrowserPage) => {
      assert(Buffer.byteLength(JSON.stringify(p)) < 256 * 1024 - 2048);
      for (const row of p.items) if (row.kind === "task") to.add(row.id);
    };
    for (let i = 0; ; i++) {
      add(forward, page);
      assert(i < 20);
      if (!page.after) break;
      page = await f.client.query<TaskBrowserPage>(
        "task-browser?limit=100&cursor=" + encodeURIComponent(page.after),
      );
    }
    for (let i = 0; ; i++) {
      add(backward, page);
      assert(i < 20);
      if (!page.before) break;
      page = await f.client.query<TaskBrowserPage>(
        "task-browser?limit=100&direction=before&cursor=" +
          encodeURIComponent(page.before),
      );
    }
    assert.deepEqual(forward, ids);
    assert.deepEqual(backward, ids);
  }));
