import test from "node:test";
import assert from "node:assert/strict";
import {
  createAssistantMessageEventStream,
  normalizeContext,
} from "@earendil-works/pi-ai";
import { boundedTools } from "../../online/tool-budget.ts";
import {
  fixtureModel,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { fixture } from "../issue9/helpers.ts";
const context = normalizeContext({
  messages: [{ role: "user", content: "test", timestamp: 0 }],
});
test("tool budget relays partial preview before completion but rejects a tool result before Agent can receive success", () =>
  fixture(async (f) => {
    const message = await replyStream([
      {
        type: "toolCall",
        id: "call",
        name: "write",
        arguments: { path: "never", content: "never" },
      },
      {
        type: "toolCall",
        id: "second",
        name: "write",
        arguments: { path: "also-never", content: "never" },
      },
    ]).result();
    let finish!: () => void,
      preview!: () => void,
      sends = 0;
    const seen = new Promise<void>((r) => {
      preview = r;
    });
    const raw: StreamFn = () => {
      sends++;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() =>
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "preview",
          partial: message,
        }),
      );
      finish = () => {
        stream.push({ type: "done", reason: "toolUse", message });
        stream.end(message);
      };
      return stream;
    };
    const budget = { used: 0, limit: 1 };
    const call = durableStream(
      f.app.store,
      boundedTools(raw, budget),
      { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
      id(),
      "MAIN",
      {
        observe: (u) => {
          if (u.type === "event" && u.event.type === "text_delta") preview();
        },
      },
    );
    let returned = false;
    const work = Promise.resolve(call(fixtureModel, context)).then((stream) => {
      returned = true;
      return stream.result();
    });
    await seen;
    assert.equal(returned, false);
    finish();
    const rejected = await work;
    assert.equal(rejected.stopReason, "error");
    assert.match(rejected.errorMessage ?? "", /BUDGET_/);
    assert.equal(sends, 1);
    assert.equal(budget.used, 2);
    assert.equal(f.app.store.all("Operation").length, 0);
    assert.equal(f.app.store.all<any>("ModelCall")[0].failure_kind, "LOCAL");
  }));
test("successful response remains replayable with no extra physical request", () =>
  fixture(async (f) => {
    let sends = 0;
    const stream = boundedTools(
      () => {
        sends++;
        return replyStream([{ type: "text", text: "done" }]);
      },
      { used: 0, limit: 1 },
    );
    const loop = id(),
      scope = {
        session_id: f.app.host.sessionID,
        task_id: null,
        execution_id: null,
      };
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await (
            await durableStream(
              f.app.store,
              stream,
              scope,
              loop,
              "MAIN",
            )(fixtureModel, context)
          ).result()
        ).stopReason,
        "stop",
      );
    assert.equal(sends, 1);
  }));
