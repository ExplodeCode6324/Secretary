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
    const response = await invoke();
    const kinds = [];
    for await (const event of response) kinds.push(event.type);
    assert.deepEqual(kinds, ["done"]);
    assert.equal(calls, 1);
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

test("Feedback terminal suppression cannot be revived by an illegal transition", () =>
  fixture(async (f) => {
    const e = await pending(f),
      at = new Date().toISOString();
    const f1: Feedback = {
      ...base(),
      schema_version: 1,
      record_type: "Feedback",
      scope_id: e.scope_id,
      task_id: e.task_id,
      execution_id: e.id,
      state: "SUPPRESSED",
      kind: "AUTHORIZATION_REQUIRED",
      authorization_id: id(),
      summary: "fixture",
      detail_ref: f.app.store.put("fixture"),
      result_id: null,
      decision_request_id: null,
      input_id: null,
      created_at: at,
      suppressed_at: at,
      suppressed_reason: "fixture",
    };
    f.app.store.commit([f1]);
    assert.throws(
      () => f.app.store.commit([revise(f1, { state: "QUEUED" })]),
      /INVALID_FEEDBACK_TRANSITION/,
    );
  }));
