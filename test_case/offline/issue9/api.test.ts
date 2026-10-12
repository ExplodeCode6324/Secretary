import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fixture } from "./helpers.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";

test("API: new synthetic public examples, OpenAPI SSE media and typed CoreClient reads agree", () =>
  fixture(async (f) => {
    const examples = JSON.parse(
      fs.readFileSync("docs/api/v1/examples.json", "utf8"),
    );
    for (const [key, type] of [
      ["sync_cursor", "SyncCursor"],
      ["sync_page", "SyncPage"],
      ["notification", "Notification"],
    ])
      validate(type, examples[key]);
    const openapi = JSON.parse(
      fs.readFileSync("docs/api/v1/openapi.json", "utf8"),
    );
    assert(
      openapi.paths["/api/v1/sync/stream"].get.responses[200].content[
        "text/event-stream"
      ],
    );
    const cursor = await f.client.syncCursor();
    f.notice();
    validate("SyncPage", { ...(await f.client.changes(cursor.cursor)) });
    const list = await f.client.notifications();
    assert.equal(list.items.length, 1);
    assert.equal(
      (await f.client.notification(list.items[0].id)).id,
      list.items[0].id,
    );
    const controller = new AbortController();
    const reader = (
      await f.client.stream(cursor.cursor, controller.signal)
    ).getReader();
    assert(
      new TextDecoder()
        .decode((await reader.read()).value)
        .includes("event: change"),
    );
    controller.abort();
  }));
