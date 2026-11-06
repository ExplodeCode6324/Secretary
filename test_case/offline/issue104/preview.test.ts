import test from "node:test";
import assert from "node:assert/strict";
import { Previews } from "../../../src/pi_secretary/src/preview.ts";
import { replyStream } from "../../../src/pi_secretary/src/model.ts";

test("Task eviction/tail is bounded independently of Main; task SSE carries no text or CoT", async () => {
  const p = new Previews(),
    message = await replyStream([
      { type: "text", text: "首" + "😀界".repeat(14000) + "TAIL" },
      { type: "thinking", thinking: "VISIBLE" },
    ]).result();
  for (let i = 0; i < 8; i++)
    p.update({ type: "start", id: "main" + i, loop: "main", session: "s" });
  for (let i = 0; i < 40; i++) {
    p.update({
      type: "start",
      id: "task" + i,
      loop: "task",
      session: "s",
      task_id: "t",
      execution_id: "e",
      transport_attempt: 1,
      attempt_id: "a",
    });
    p.update({
      type: "event",
      id: "task" + i,
      event: {
        type: "text_end",
        contentIndex: 0,
        content: (message.content[0] as any).text,
        partial: message,
      },
    });
  }
  const state = p.taskSnapshot("s");
  assert(state.previews.length <= 32);
  assert.equal(p.snapshot("s", false).length, 8);
  assert(Buffer.byteLength(JSON.stringify(state)) <= 65536);
  assert(!JSON.stringify(state).includes("VISIBLE"));
  assert(!JSON.stringify(state).includes("TAIL"));
  let bytes = 0;
  for (const m of state.previews) {
    const preview = p.get(m.id, true)!;
    bytes += preview.blocks.reduce((n, b) => n + Buffer.byteLength(b.text), 0);
    assert(preview.blocks.reduce((n, b) => n + b.text.length, 0) <= 32768);
    assert(preview.blocks[0].text.endsWith("TAIL"));
    assert(preview.truncated);
    assert(!/^[\uDC00-\uDFFF]/u.test(preview.blocks[0].text));
  }
  assert(bytes <= 1048576);
  const version = state.version;
  p.update({
    type: "event",
    id: "main0",
    event: {
      type: "text_end",
      contentIndex: 0,
      content: "main updated",
      partial: message,
    },
  });
  assert.equal(p.taskSnapshot("s").version, version);
  p.update({ type: "saved", id: "task39" });
  const saved = p.get("task39", false);
  p.update({
    type: "event",
    id: "task39",
    event: {
      type: "text_end",
      contentIndex: 0,
      content: "late",
      partial: message,
    },
  });
  assert.deepEqual(p.get("task39", false), saved);
});
