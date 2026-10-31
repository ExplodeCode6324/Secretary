import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Fixture, until } from "../issue9/helpers.ts";
import { replyStream } from "../../../src/pi_secretary/src/model.ts";
import { RemoteViews } from "../../../src/pi_secretary/src/tui/remote.ts";
import type { Message } from "../../../src/pi_secretary/src/api/contracts.ts";
import type { AssistantMessage } from "@earendil-works/pi-ai";

test("real Core oversized CJK previews supersede expired fragments and settle into complete durable body/CoT", async () => {
  const f = new Fixture();
  await f.open();
  const views = new RemoteViews(f.client);
  const call = randomUUID(),
    id = "message:" + call;
  const update = (partial: AssistantMessage) =>
    f.app.host.previews.update({
      type: "event",
      id: call,
      event: {
        type: "text_end",
        contentIndex: 0,
        content:
          partial.content[0].type === "text" ? partial.content[0].text : "",
        partial,
      },
    });
  f.app.host.previews.update({
    type: "start",
    id: call,
    loop: "main",
    session: f.app.host.sessionID,
  });
  const first = await replyStream([
    { type: "text", text: "初".repeat(22000) },
  ]).result();
  update(first);
  const second = await replyStream([
    { type: "text", text: "新".repeat(25000) },
  ]).result();
  const query = f.client.query.bind(f.client);
  let invalidate = true,
    fragments = 0;
  const trace: unknown[] = [];
  f.client.query = async <T>(
    route: string,
    options?: Parameters<typeof f.client.query>[1],
  ): Promise<T> => {
    if (route.startsWith("messages/") && route.includes("cursor=")) {
      fragments++;
      if (invalidate) {
        invalidate = false;
        update(second);
      }
    }
    const value = await query<T>(route, options).catch((e) => {
      trace.push({ route: route.split("?")[0], error: String(e) });
      throw e;
    });
    const candidate = value as unknown as Message;
    trace.push({
      route: route.split("?")[0],
      revision: candidate.revision,
      length: candidate.text?.length,
      next: !!candidate.next_cursor,
    });
    return value;
  };
  try {
    await views.refresh(["timeline"]);
    views.focus([id]);
    await until(() => !invalidate);
    await new Promise((r) => setTimeout(r, 30));
    assert(!views.notices.get(id)?.includes("读取失败"));
    await views.refresh(["timeline"]);
    views.focus([id]);
    await until(
      () => views.messages.get(id)?.text === "新".repeat(25000),
    ).catch((error) => {
      console.log(
        JSON.stringify({
          trace,
          error: views.error,
          notices: [...views.notices],
          meta: {
            revision: views.history.items.get(id)?.revision,
            length: (views.messages.get(id) as Message)?.text.length,
          },
        }),
      );
      throw error;
    });
    assert(fragments > 1);
    assert.equal(views.error, "");
    const text = "定".repeat(50000),
      thought = "公开思考".repeat(4000);
    const event = f.app.store.event(
      "main.message",
      {
        role: "assistant",
        content: [
          { type: "text", text },
          { type: "thinking", thinking: thought },
        ],
        stopReason: "stop",
        display_call_id: call,
      },
      { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
    );
    f.app.store.commit([], [event]);
    f.app.host.previews.update({ type: "saved", id: call });
    await views.refresh(["timeline"]);
    views.focus([id]);
    await until(() => views.messages.get(id)?.text === text);
    assert.equal((views.messages.get(id) as Message).persistence, "durable");
    views.history.setAnchor(id);
    await views.toggleThinking();
    views.focus([id]);
    await until(
      () => (views.messages.get(id) as Message)?.thinking === thought,
    );
    assert.equal(views.messages.get(id)?.text, text);
    await views.toggleThinking();
    views.focus([id]);
    await until(() => !(views.messages.get(id) as Message)?.thinking);
    assert((views.messages.get(id) as Message).thinking_preview);
  } finally {
    views.stop();
    await f.close();
  }
});
