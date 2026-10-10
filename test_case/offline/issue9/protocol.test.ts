import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
test("public sync examples, named SSE schemas and complete operation routes remain reviewable", () => {
  const samples = JSON.parse(
    fs.readFileSync("docs/api/v1/sync-examples.json", "utf8"),
  );
  for (const [key, type] of Object.entries({
    bootstrap: "SyncBootstrap",
    batch: "SyncBatch",
    delivery: "DeliveryInfo",
    content: "NotificationContent",
  }))
    validate(type, samples[key]);
  const openapi = JSON.parse(
    fs.readFileSync("docs/api/v1/openapi.json", "utf8"),
  );
  const stream = openapi.paths["/api/v1/sync/stream"].get;
  assert(stream.responses["200"].content["text/event-stream"]);
  assert.equal(
    stream["x-event-schema"].$ref,
    "./schema.json#/$defs/SyncStreamEvent",
  );
  assert(stream.parameters.some((p: any) => p.name === "Last-Event-ID"));
  assert(stream.parameters.some((p: any) => p.name === "X-Secretary-Client"));
});
