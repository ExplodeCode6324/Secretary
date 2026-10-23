import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAssistantMessageEventStream,
  normalizeContext,
} from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  Agent,
  fixtureModel,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import { activityHistoryFor } from "../../../src/pi_secretary/src/activity-history.ts";
import {
  modelLifetime,
  retryRuntime,
} from "../../../src/pi_secretary/src/model-retry.ts";
import { timelineFor } from "../../../src/pi_secretary/src/timeline.ts";
import { id, base } from "../../../src/pi_secretary/src/store.ts";
import type {
  ModelCall,
  Context,
} from "../../../src/pi_secretary/src/contracts.ts";
import { fixture, until } from "../issue9/helpers.ts";

const lengthStream: StreamFn = () => {
  const stream = createAssistantMessageEventStream();
  void replyStream([{ type: "text", text: "incomplete body" }])
    .result()
    .then((message) => {
      message.stopReason = "length";
      stream.push({ type: "done", reason: "length", message });
      stream.end(message);
    });
  return stream;
};

// Issue #80: response persistence is success, but a length-limited model activity is not a complete answer.
for (const purpose of ["MAIN", "TASK", "COMPACTION"] as Context["purpose"][])
  test("length activity is truncated live and after reopen: " + purpose, () =>
    fixture(async (f) => {
      const wrapped = durableStream(
        f.app.store,
        lengthStream,
        { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
        id(),
        purpose,
        { observe: (u) => f.app.host.previews.update(u) },
      );
      const result = await wrapped(
        fixtureModel,
        normalizeContext({
          messages: [{ role: "user", content: "fixture", timestamp: 1 }],
        }),
      );
      assert.equal((await result.result()).stopReason, "length");
      const call = f.app.store.all<ModelCall>("ModelCall").at(-1)!;
      assert.equal(call.state, "RESPONSE_SAVED");
      const recent = f.app
        .activitySnapshot()
        .recent.filter((a) => a.id === "model:" + call.id)
        .at(-1)!;
      assert.equal(recent.status, "truncated");
      assert.equal(recent.phase, "输出已截断");
      assert(recent.ended_at);
      assert(
        !f.app.activitySnapshot().activities.some((a) => a.id === recent.id),
      );
      for (let reopen = 0; reopen < 2; reopen++) {
        const history = activityHistoryFor(f.app.store).selected(
          f.app.host.sessionID,
          [recent.id],
        )[0];
        assert.equal(history.status, "truncated");
        assert.equal(history.phase, recent.phase);
        assert(history.ended_at);
        const detail: any = await f.client.query("activities/" + recent.id);
        assert.equal(detail.status, "truncated");
        const page: any = await f.client.query("timeline");
        assert.equal(
          page.items.find((r: any) => r.id === recent.id).activity.status,
          "truncated",
        );
        if (!reopen) await f.restart();
      }
    }),
  );

// The real Main/Agent boundary reaches MODEL_CALL_LIMIT before another start event. No paid model is used.
test("forward display association is consumed before a later pre-call failure", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-issue80-limit-"),
  );
  let calls = 0;
  const app = await App.open(dir, {
    model: { ...fixtureModel, contextWindow: 1_000_000 },
    stream: () =>
      replyStream([
        { type: "text", text: "reply " + ++calls },
        {
          type: "toolCall",
          id: id(),
          name: "memory_read",
          arguments: { source: "consciousness" },
        },
      ]),
  });
  try {
    app.host.accept("fixture call limit");
    await app.host.drain();
    assert.equal(calls, 20);
    const messages = app.store.logs
      .filter((e) => e.event_type === "main.message")
      .map((e) => ({ event: e, message: app.store.read<any>(e.payload) }))
      .filter((e) => e.message.role === "assistant");
    const last = messages.at(-1)!;
    assert.equal(last.message.stopReason, "error");
    assert.match(last.message.errorMessage, /MODEL_CALL_LIMIT/);
    assert.equal(
      last.message.display_call_id,
      undefined,
      "pre-call error must not inherit a previous call ID",
    );
    const rows = timelineFor(app)
      .query(app.host.sessionID, { limit: 200 })
      .items.filter((r: any) => r.kind === "message" && r.role === "secretary");
    assert.equal(rows.length, 21);
    assert.equal(rows.at(-2).text, "reply 20");
    assert.equal(rows.at(-1).id, last.event.event_id);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const ordering of ["lifetime-first", "agent-first", "backoff"] as const)
  test("deterministic stop and reopen projection: " + ordering, async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "secretary-issue80-stop-"),
    );
    let starts = 0,
      waiting = false;
    let app = await App.open(dir, {
      model: fixtureModel,
      stream: () => {
        starts++;
        if (ordering === "backoff")
          throw Error("connection error: synthetic fixture");
        return createAssistantMessageEventStream();
      },
    });
    try {
      if (ordering === "backoff")
        retryRuntime.set(app.store, {
          wait: async (_ms, signal) => {
            waiting = true;
            await new Promise<void>((_resolve, reject) => {
              if (signal?.aborted) reject(signal.reason);
              else
                signal?.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                });
            });
          },
        });
      app.host.accept("fixture shutdown");
      const draining = app.host.drain();
      await until(() => (ordering === "backoff" ? waiting : starts === 1));
      if (ordering === "agent-first")
        (app.host as unknown as { agent: Agent }).agent.abort();
      else modelLifetime(app.store).abort(Error("CORE_STOPPING"));
      await draining;
      const call = app.store.all<ModelCall>("ModelCall").at(-1)!;
      assert.equal(starts, 1);
      assert.equal(call.state, "INTERRUPTED");
      assert.equal(
        call.failure_kind,
        ordering === "backoff" ? "TRANSIENT" : "CANCELLED",
      );
      const event = app.store.logs
        .filter((e) => e.event_type === "main.message")
        .at(-1)!;
      const raw = app.store.read<any>(event.payload);
      assert.equal(
        raw.stopReason,
        ordering === "agent-first" ? "aborted" : "error",
      );
      const expected = ordering === "backoff" ? "failed" : "interrupted";
      for (let reopen = 0; reopen < 2; reopen++) {
        const row = timelineFor(app)
          .query(app.host.sessionID)
          .items.find((r: any) => r.source_event_id === event.event_id);
        assert(row, "synthetic failure must remain visible");
        assert.equal(row.outcome, expected);
        assert.equal(row.incomplete, true);
        assert.equal(
          activityHistoryFor(app.store).selected(app.host.sessionID, [
            "model:" + call.id,
          ])[0].status,
          expected,
        );
        if (!reopen) {
          await app.close();
          app = await App.open(dir);
        }
      }
      // Observe the existing recovery policy, without making it an #80 pass/fail condition.
      console.log(
        JSON.stringify({
          issue80: ordering,
          reopened_session_state: app.host.session.state,
          call_state: call.state,
          failure_kind: call.failure_kind,
          stored_stop_reason: raw.stopReason,
        }),
      );
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test("empty error cancellation override requires an unclaimed same-session cancelled call; abort itself remains interrupted", () =>
  fixture(async (f) => {
    f.app.host.accept("seed call");
    await f.app.host.drain();
    const seed = f.app.store.all<ModelCall>("ModelCall").at(-1)!;
    const cases = [
      {
        state: "INTERRUPTED",
        kind: "CANCELLED",
        same: true,
        reason: "error",
        expected: "interrupted",
      },
      {
        state: "INTERRUPTED",
        kind: "TRANSIENT",
        same: true,
        reason: "error",
        expected: "failed",
      },
      {
        state: "INTERRUPTED",
        kind: "CANCELLED",
        same: false,
        reason: "error",
        expected: "failed",
      },
    ] as const;
    for (const c of cases) {
      const call: ModelCall = {
        ...seed,
        ...base(),
        state: c.state,
        failure_kind: c.kind,
        response: null,
        scope: {
          ...seed.scope,
          session_id: c.same ? f.app.host.sessionID : id(),
        },
      };
      f.app.store.commit([call]);
      const event = f.app.store.event(
        "main.message",
        {
          role: "assistant",
          content: [],
          stopReason: c.reason,
          display_call_id: call.id,
        },
        { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
      );
      f.app.store.commit([], [event]);
      const row: any = await f.client.query(
        "messages/message:" + call.id + "/content",
      );
      assert.equal(row.outcome, c.expected);
    }
    for (const [reason, expected] of [
      ["error", "failed"],
      ["aborted", "interrupted"],
    ]) {
      const event = f.app.store.event(
        "main.message",
        { role: "assistant", content: [], stopReason: reason },
        { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
      );
      f.app.store.commit([], [event]);
      const row: any = await f.client.query(
        "messages/" + event.event_id + "/content",
      );
      assert.equal(row.outcome, expected);
    }
  }));

test("collision resolution precedes cancellation attribution, including an earlier session owner", () =>
  fixture(async (f) => {
    f.app.host.accept("seed cancellation fixture");
    await f.app.host.drain();
    const seed = f.app.store.all<ModelCall>("ModelCall").at(-1)!;
    for (const earlierSession of [f.app.host.sessionID, id()]) {
      const call: ModelCall = {
        ...seed,
        ...base(),
        state: "INTERRUPTED",
        failure_kind: "CANCELLED",
        response: null,
      };
      f.app.store.commit([call]);
      const first = f.app.store.event(
        "main.message",
        {
          role: "assistant",
          content: [{ type: "text", text: "first" }],
          stopReason: "error",
          display_call_id: call.id,
        },
        { session_id: earlierSession, task_id: null, execution_id: null },
      );
      const second = f.app.store.event(
        "main.message",
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          display_call_id: call.id,
        },
        { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
      );
      f.app.store.commit([], [first, second]);
      const before = timelineFor(f.app)
        .query(earlierSession)
        .items.find((r: any) => r.source_event_id === first.event_id);
      assert(before);
      assert.equal(before.text, "first");
      assert.equal(before.outcome, "failed");
      const row: any = await f.client.query(
        "messages/" + second.event_id + "/content",
      );
      assert.equal(row.call_id, null);
      assert.equal(row.outcome, "failed");
      assert.equal(row.id, second.event_id);
    }
  }));

test("length compaction under settings preserves its parent state", () =>
  fixture(async (f) => {
    const parent = {
      schema_version: 1 as const,
      record_type: "SettingsApplication" as const,
      ...base(),
      session_id: f.app.host.sessionID,
      state: "FAILED" as const,
      payload_ref: f.app.store.put({
        instructions: null,
        edits: [],
        command_ids: [],
      }),
      source_ref: null,
      candidate_ref: null,
      error: "fixture parent",
      request_id: id(),
      request_hash: "a".repeat(64),
      context_id: null,
      runtime_settings_hash: "b".repeat(64),
    };
    f.app.store.commit([parent]);
    const wrapped = durableStream(
      f.app.store,
      lengthStream,
      { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
      parent.id,
      "COMPACTION",
    );
    await (
      await wrapped(
        fixtureModel,
        normalizeContext({
          messages: [{ role: "user", content: "fixture", timestamp: 1 }],
        }),
      )
    ).result();
    const call = f.app.store.all<ModelCall>("ModelCall").at(-1)!;
    const row = activityHistoryFor(f.app.store).selected(f.app.host.sessionID, [
      "model:" + call.id,
    ])[0];
    assert.equal(row.parent_id, "settings:" + parent.id);
    assert.equal(row.status, "truncated");
    assert.equal(row.phase, "输出已截断");
    assert.deepEqual(f.app.store.get("SettingsApplication", parent.id), parent);
  }));
