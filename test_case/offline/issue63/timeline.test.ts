import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { timelineFor } from "../../../src/pi_secretary/src/timeline.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";

test("assistant outcomes preserve source events, and evicted retry previews become expired with a new revision", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue63-"));
  const app = await App.open(dir);
  try {
    const session = app.host.sessionID;
    const scope = { session_id: session, task_id: null, execution_id: null };
    const reasons = ["stop", "toolUse", "length", "error", "aborted", "future"];
    const outcomes = [
      "completed",
      "continued",
      "truncated",
      "failed",
      "interrupted",
      "unknown",
    ];
    const events = reasons.map((stopReason) =>
      app.store.event(
        "main.message",
        {
          role: "assistant",
          display_call_id: id(),
          stopReason,
          content: [{ type: "text", text: "body" }],
        },
        scope,
      ),
    );
    app.store.commit([], events);
    const rows = timelineFor(app)
      .query(session)
      .items.filter((r: any) => r.kind === "message");
    assert.deepEqual(
      rows.map((r: any) => r.outcome),
      outcomes,
    );
    assert.deepEqual(
      rows.map((r: any) => r.source_event_id),
      events.map((e) => e.event_id),
    );
    assert(rows.every((r: any) => r.source_kind === "assistant_response"));
    assert.deepEqual(
      rows.map((r: any) => !!r.incomplete),
      [false, false, true, true, true, false],
    );
    const call = id();
    app.host.previews.update({
      type: "start",
      id: call,
      loop: "main",
      session,
    });
    app.host.previews.update({
      type: "event",
      id: call,
      event: {
        type: "text_delta",
        contentIndex: 0,
        delta: "retry preview",
        partial: { content: [{ type: "text", text: "retry preview" }] },
      } as any,
    });
    const active = timelineFor(app).query(session, {
      fragment: "message:" + call,
      streaming: true,
    }).items[0];
    assert.equal(active.preview_availability, "active");
    for (let i = 0; i < 9; i++)
      app.host.previews.update({
        type: "start",
        id: id(),
        loop: "main",
        session,
      });
    const expired = timelineFor(app).query(session, {
      fragment: active.id,
      streaming: true,
    }).items[0];
    assert.equal(expired.preview_availability, "expired");
    assert(expired.revision > active.revision);
    assert.equal(expired.persistence, "transient");
    assert.equal(expired.text, "");
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
