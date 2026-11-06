import { next } from "../../../src/pi_secretary/src/state-transitions.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeContext,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { fixture } from "../issue9/helpers.ts";
import { pending } from "./helpers.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import {
  fixtureModel,
  replyStream,
} from "../../../src/pi_secretary/src/model.ts";
import { base, id } from "../../../src/pi_secretary/src/store.ts";
import type {
  ModelCall,
  Execution,
  Feedback,
} from "../../../src/pi_secretary/src/contracts.ts";
import type { TaskBrowserMessages } from "../../../src/pi_secretary/src/api/contracts.ts";
import { taskMessagesFor } from "../../../src/pi_secretary/src/task-messages.ts";
import { revise } from "../../../src/pi_secretary/src/store.ts";

test("saved response precedes Agent handoff, done-only replay survives restart, and legacy completed rows keep event identities", () =>
  fixture(async (f) => {
    const e = await pending(f),
      scope = { session_id: null, task_id: e.task_id, execution_id: e.id };
    const context = normalizeContext({
      messages: [
        { role: "user", content: "saved response fallback", timestamp: 0 },
      ],
    });
    const complete = await replyStream([
      { type: "text", text: "SAVED-FALLBACK" },
    ]).result();
    let calls = 0,
      saved = "";
    const invoke = () =>
      durableStream(
        f.app.store,
        () => {
          calls++;
          const s = createAssistantMessageEventStream();
          queueMicrotask(() => {
            s.push({
              type: "text_delta",
              contentIndex: 0,
              delta: "SAVED-FALLBACK",
              partial: complete,
            });
            s.push({ type: "done", reason: "stop", message: complete });
            s.end(complete);
          });
          return s;
        },
        scope,
        e.id,
        "TASK",
        {
          onSaved: (c, r) => {
            assert(c.response);
            assert.equal(c.state, "RESPONSE_SAVED");
            assert.deepEqual(r, complete);
            saved = c.id;
          },
        },
      )(fixtureModel, context);
    const syncBefore = f.cursor();
    const response = await invoke();
    const kinds = [];
    for await (const event of response) kinds.push(event.type);
    assert.deepEqual(kinds, ["done"]);
    assert.equal(calls, 1);
    const changes = f.server.service.changes
      .changes(syncBefore)
      .transactions.flatMap((t) => t.changes);
    assert(
      changes.some(
        (c) =>
          c.kind === "invalidate" &&
          c.query === `task-messages/${e.task_id}/${e.id}`,
      ),
    );
    assert(
      changes.some((c) => c.kind === "invalidate" && c.query === "timeline"),
    );
    assert(
      changes.some((c) => c.kind === "invalidate" && c.query === "activities"),
    );
    const route = `task-browser/${e.task_id}/executions/${e.id}/messages?position=latest`;
    let page = await f.client.query<TaskBrowserMessages>(route);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].text, "SAVED-FALLBACK");
    assert.equal(page.items[0].id, "call:" + saved);
    assert.equal(page.items[0].persistence, "durable");
    const first = saved;
    await f.restart();
    await invoke();
    assert.equal(calls, 1, "replay cannot re-contact provider");
    assert.equal(saved, first);
    page = await f.client.query<TaskBrowserMessages>(route);
    assert.equal(page.items.length, 1);
    // Legacy snapshots have no display marker and no proven causal link.
    const old: ModelCall = {
      ...f.app.store.get<ModelCall>("ModelCall", saved),
      ...base(),
      logical_key: undefined,
    };
    const event = f.app.store.event(
      "agent.message",
      { ...complete, content: [{ type: "text", text: "LEGACY" }] },
      scope,
      "EXECUTOR",
    );
    f.app.store.commit([old], [event]);
    page = await f.client.query<TaskBrowserMessages>(route);
    assert.equal(page.items.length, 2);
    assert.equal(page.items.at(-1)!.id, event.event_id);
    assert(!page.items.some((m) => m.model_call_id === old.id));
    const before = taskMessagesFor(f.app.store).framesVisited;
    for (let i = 0; i < 25; i++) await f.client.query(route);
    assert.equal(taskMessagesFor(f.app.store).framesVisited, before);
  }));

test("Feedback catalog rejects re-delivery of terminal suppression", () => {
  assert.equal(next("Feedback", "QUEUED", "suppress"), "SUPPRESSED");
  assert.throws(
    () => next("Feedback", "SUPPRESSED", "deliver"),
    /INVALID_TRANSITION/,
  );
});

test("old-runtime IN_FLIGHT rows are interrupted rather than waiting forever", () =>
  fixture(async (f) => {
    const e = await pending(f);
    const scope = { session_id: null, task_id: e.task_id, execution_id: e.id };
    await assert.rejects(
      Promise.resolve(
        durableStream(f.app.store, () => replyStream([]), scope, e.id, "TASK", {
          onPrepared: () => {
            throw Error("PROCESS_LOSS");
          },
        })(
          fixtureModel,
          normalizeContext({
            messages: [{ role: "user", content: "lost process", timestamp: 0 }],
          }),
        ),
      ),
      /PROCESS_LOSS/,
    );
    const call = f.app.store.all<ModelCall>("ModelCall")[0];
    const event = {
      ...f.app.store.event(
        "model.task_preview",
        { call_id: call.id, preview_epoch: "old-process" },
        scope,
      ),
      causation_id: call.id,
    };
    f.app.store.commit([revise(call, { state: "IN_FLIGHT" })], [event]);
    await f.restart();
    const page = await f.client.query<TaskBrowserMessages>(
      `task-browser/${e.task_id}/executions/${e.id}/messages?position=latest`,
    );
    assert.match(page.items[0].text, /已中断/);
    assert.equal(page.items[0].outcome, "interrupted");
    assert.equal(page.items[0].persistence, "transient");
  }));
