import test from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./helpers.ts";
import { readLog } from "../../../src/pi_secretary/src/memory-search.ts";
import {
  replyStream,
  fixtureStream,
  fixtureModel,
} from "../../../src/pi_secretary/src/model.ts";
import { requestBudget } from "../../../src/pi_secretary/src/budget.ts";

test("S5: unconfigured search is explicit and the ordinary main loop still finishes", () =>
  scenario(
    undefined,
    async (app) => {
      app.host.accept("Search a past synthetic fact");
      await app.host.drain();
      assert.equal(app.host.session.state, "IDLE");
      const tool = app.store.logs.find(
        (e) => e.event_type === "main.tool.result",
      )!;
      assert(tool);
      assert.equal(
        JSON.parse(app.store.read<any>(tool.payload).result.content[0].text)
          .status,
        "not_configured",
      );
    },
    (model, context, options) =>
      context.messages.at(-1)?.role === "user"
        ? replyStream(
            [
              {
                type: "toolCall",
                id: "search",
                name: "memory_search",
                arguments: { query: "杭州" },
              },
            ],
            model,
          )
        : fixtureStream(model, context, options),
  ));

test("S2: log reads stay bounded without PG, preserve Unicode and reject invalid ranges", () =>
  scenario(undefined, async (app) => {
    const event = app.store.event("synthetic.evidence", "😀杭州".repeat(2000));
    app.store.commit([], [event]);
    const page = readLog(app.store, event.event_id, 1, 3);
    assert("body" in page);
    assert.equal(page.body, "杭州😀");
    assert.equal(page.next_offset, 4);
    assert.throws(
      () => readLog(app.store, event.event_id, -1),
      /INVALID_LOG_SLICE/,
    );
    assert.throws(
      () => readLog(app.store, event.event_id, 0, 4001),
      /INVALID_LOG_SLICE/,
    );
    assert.throws(
      () => readLog(app.store, event.event_id, 6001),
      /INVALID_LOG_OFFSET/,
    );
    assert.throws(() => readLog(app.store, "missing"), /LOG_EVENT_NOT_FOUND/);
    for (let n = 0; n < 30; n++)
      app.store.commit([], [app.store.event("synthetic.evidence", "row " + n)]);
    const recent = readLog(app.store);
    assert("events" in recent);
    assert.equal(recent.events!.length, 20);
    assert.equal(recent.truncated, true);
  }));

test("S2: actual Host tool slice shrinks to the remaining request budget with a continuation offset", async () => {
  let eventID = "",
    requests = 0;
  await scenario(
    undefined,
    async (app) => {
      const event = app.store.event("synthetic.evidence", "😀中".repeat(5000));
      app.store.commit([], [event]);
      eventID = event.event_id;
      app.host.accept("Read evidence, then say done. " + "x".repeat(40000));
      await app.host.drain();
      assert.equal(
        app.host.session.state,
        "IDLE",
        app.host.session.recovery_error ?? "",
      );
      const receipt = app.store.logs.find(
        (e) => e.event_type === "main.tool.result",
      )!;
      assert(receipt);
      const page = JSON.parse(
        app.store.read<any>(receipt.payload).result.content[0].text,
      );
      assert(page.body && Array.from(page.body).length < 4000);
      assert.equal(page.truncated, true);
      assert.equal(page.next_offset, Array.from(page.body).length);
      assert.equal(requests, 2);
    },
    (model, context) => {
      const budget = requestBudget(model, context.messages);
      assert(budget.estimated_tokens <= budget.usable_input_tokens);
      requests++;
      return replyStream(
        context.messages.at(-1)?.role === "user"
          ? [
              {
                type: "toolCall",
                id: "read",
                name: "memory_read",
                arguments: { source: "log", event_id: eventID, length: 4000 },
              },
            ]
          : [{ type: "text", text: "done" }],
        model,
      );
    },
    { ...fixtureModel, contextWindow: 65536 },
  );
});
