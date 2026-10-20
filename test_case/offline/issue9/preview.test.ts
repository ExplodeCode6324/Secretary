import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";

test("PRE: high-frequency previews stay transient; persisted final call identity replaces preview once", () =>
  fixture(async (f) => {
    const p = f.app.host.previews,
      call = id(),
      sid = f.app.host.sessionID,
      sequence = f.app.store.sequence;
    p.update({ type: "start", id: call, session: sid, loop: id() });
    for (let n = 0; n < 2000; n++)
      p.update({
        type: "event",
        id: call,
        event: {
          type: "text_end",
          content: "😀中".repeat(20000),
          contentIndex: 0,
          partial: { content: [{ type: "text", text: "x" }] },
        } as AssistantMessageEvent,
      });
    assert.equal(f.app.store.sequence, sequence);
    const before: any = await f.client.query("timeline?streaming=false");
    const inflight = before.items.find((m: any) => m.call_id === call);
    assert.equal(inflight.persistence, "transient");
    assert.equal(inflight.preview_status, "running");
    assert.equal(inflight.text, "");
    assert.equal(inflight.truncated, true);
    assert(p.snapshot(sid, false)[0].truncated);
    f.app.store.commit(
      [],
      [
        f.app.store.event(
          "main.message",
          {
            role: "assistant",
            display_call_id: call,
            content: [{ type: "text", text: "😀中".repeat(1500) }],
            timestamp: Date.now(),
          },
          { session_id: sid, task_id: null, execution_id: null },
          "MAIN",
        ),
      ],
    );
    p.update({ type: "saved", id: call });
    const timeline: any = await f.client.query("timeline?streaming=true");
    const messages = timeline.items.filter(
      (m: any) => m.id === "message:" + call,
    );
    assert.equal(messages.length, 1);
    const message = messages[0];
    assert.equal(message.persistence, "durable");
    let text = message.text,
      cursor = message.next_cursor;
    while (cursor) {
      const fragment: any = await f.client.query(
        `messages/${message.id}/content?cursor=${cursor}`,
      );
      text += fragment.text;
      cursor = fragment.next_cursor;
    }
    assert.equal(text, "😀中".repeat(1500));
  }));
