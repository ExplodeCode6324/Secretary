import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContext } from "@earendil-works/pi-ai";
import { boundedTools } from "../../online/tool-budget.ts";
import {
  fixtureModel,
  replyStream,
} from "../../../src/pi_secretary/src/model.ts";

test("live budget counts the final tool call before delivery and preserves provider events", async () => {
  const source = replyStream([
    {
      type: "toolCall",
      id: "last",
      name: "submit_result",
      arguments: { summary: "real response unchanged" },
    },
  ]);
  const original = await source.result();
  const events = [];
  for await (const event of source) events.push(event);
  const budget = { used: 0, limit: 1 };
  const wrapped = boundedTools(() => replyStream(original.content), budget);
  const output = await wrapped(
    fixtureModel,
    normalizeContext({ messages: [] }),
  );
  const forwarded = [];
  for await (const event of output) forwarded.push(event);
  const result = await output.result();
  assert.deepEqual(result.content, original.content);
  assert.equal(forwarded.length, events.length);
  assert.equal(budget.used, 1);
  await assert.rejects(
    () =>
      Promise.resolve(
        wrapped(fixtureModel, normalizeContext({ messages: [] })),
      ),
    /LIVE_TOOL_LIMIT/,
  );
  assert.equal(budget.used, 1);
});
