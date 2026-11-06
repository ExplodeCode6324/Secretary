import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { fixture, until } from "../issue9/helpers.ts";
import { replyStream } from "../../../src/pi_secretary/src/model.ts";
import { pending, run, result } from "./helpers.ts";
import type {
  ModelCall,
  Execution,
  Input,
  Feedback,
} from "../../../src/pi_secretary/src/contracts.ts";
import type {
  Message,
  TaskBrowserMessages,
} from "../../../src/pi_secretary/src/api/contracts.ts";
import { taskMessagesFor } from "../../../src/pi_secretary/src/task-messages.ts";
import { RemoteViews } from "../../../src/pi_secretary/src/tui/remote.ts";

test("delayed real Store/HTTP/SSE Task preview is visible before save, quiet, bounded and replaced once durably", () =>
  fixture(async (f) => {
    const e = await pending(f),
      views = new RemoteViews(f.client);
    const route = `task-browser/${e.task_id}/executions/${e.id}/messages`;
    // Oversized legacy Main transient frames must not suppress independent Task SSE.
    const huge = await replyStream([
      { type: "text", text: "界".repeat(32768) },
    ]).result();
    for (let i = 0; i < 3; i++) {
      const id = "main-flood-" + i;
      f.app.host.previews.update({
        type: "start",
        id,
        loop: "main",
        session: f.app.host.sessionID,
      });
      f.app.host.previews.update({
        type: "event",
        id,
        event: {
          type: "text_end",
          contentIndex: 0,
          content: "界".repeat(32768),
          partial: huge,
        },
      });
    }
    const reads: string[] = [];
    const query = f.client.query.bind(f.client);
    f.client.query = async <T>(
      route: string,
      options?: Parameters<typeof f.client.query>[1],
    ) => {
      reads.push(route);
      return query<T>(route, options);
    };
    await views.start();
    await views.taskBrowser.open(e.task_id);
    await views.taskBrowser.follow(e.id);
    const full = await replyStream([
      { type: "text", text: "visible before persistence" },
      result(),
    ]).result();
    const partial = structuredClone(full);
    partial.content = [{ type: "text", text: "visible before persistence" }];
    const stream = createAssistantMessageEventStream();
    const job = run(f, e, () => stream);
    try {
      await until(() =>
        f.app.store
          .all<ModelCall>("ModelCall")
          .some((c) => c.state === "IN_FLIGHT"),
      );
      const call = f.app.store
        .all<ModelCall>("ModelCall")
        .find((c) => c.state === "IN_FLIGHT")!;
      const before = f.app.store.sequence;
      stream.push({
        type: "text_delta",
        contentIndex: 0,
        delta: "visible before persistence",
        partial,
      });
      await until(
        () => !!f.app.host.previews.get(call.id, false)?.blocks.length,
      );
      const page = await f.client.query<TaskBrowserMessages>(
        route + "?position=latest",
      );
      const preview = page.items.find((m) => m.model_call_id === call.id)!;
      const encoded = await f.client.query<Message>(
        route +
          "/" +
          encodeURIComponent(preview.id) +
          "/content?position=latest",
      );
      assert.equal(encoded.text, "visible before persistence");
      assert.equal(preview.text, "visible before persistence");
      assert.equal(preview.persistence, "transient");
      assert.equal(
        f.app.store.sequence,
        before,
        "no journal commits per delta",
      );
      assert.equal(
        f.app.store
          .all<Input>("Input")
          .filter((i) => i.producer === "SCHEDULER").length,
        0,
      );
      assert.equal(f.app.store.all<Feedback>("Feedback").length, 0);
      await until(
        () =>
          views.taskBrowser.groups
            .get(e.id)
            ?.items.some((m) =>
              m.text.includes("visible before persistence"),
            ) ?? false,
      );
      await until(
        () =>
          views.taskBrowser.bodies.get(e.id + ":" + preview.id)?.body.text ===
          "visible before persistence",
      );
      assert.equal(views.taskBrowser.error, "");
      assert.equal(
        f.app.store.get<ModelCall>("ModelCall", call.id).response,
        null,
      );
      await new Promise((r) => setTimeout(r, 250));
      reads.length = 0;
      for (let i = 0; i < 3; i++) {
        stream.push({
          type: "text_end",
          contentIndex: 0,
          content: "visible before persistence",
          partial,
        });
        await new Promise((r) => setTimeout(r, 250));
      }
      assert(
        reads.some((r) => r.includes("/content")),
        "changed preview is re-read",
      );
      assert(
        !reads.some(
          (r) =>
            r.startsWith("task-browser?") ||
            r === `task-browser/${e.task_id}` ||
            r.includes("/messages?"),
        ),
        "deltas only re-read affected body",
      );
      const index = taskMessagesFor(f.app.store),
        frames = index.framesVisited;
      for (let i = 0; i < 20; i++)
        await f.client.query(route + "?position=latest");
      assert.equal(
        index.framesVisited,
        frames,
        "token reads do not rescan frames",
      );
      stream.push({ type: "done", reason: "toolUse", message: full });
      stream.end(full);
      await job;
      const saved = await f.client.query<TaskBrowserMessages>(
        route + "?position=latest",
      );
      const canonical = saved.items.filter((m) => m.model_call_id === call.id);
      assert.equal(canonical.length, 1);
      assert.equal(canonical[0].id, preview.id);
      assert.equal(canonical[0].persistence, "durable");
      const event = f.app.store
        .executionEvents(e.id)
        .find(
          (x) => x.event_type === "agent.message" && x.causation_id === call.id,
        )!;
      assert(event);
      const aliased = await f.client.query<Message>(
        route + "/" + event.event_id + "/content",
      );
      assert.equal(aliased.id, preview.id);
      assert.equal(
        f.app.store.get<Execution>("Execution", e.id).state,
        "SUCCEEDED",
      );
      assert.equal(
        f.app.store.all<Feedback>("Feedback").filter((f) => f.kind === "RESULT")
          .length,
        1,
      );
    } finally {
      stream.end(full);
      await job;
      views.stop();
    }
  }));

test("success then pre-transport failure keeps synthetic assistant error separate", () =>
  fixture(async (f) => {
    const e = await pending(f);
    let calls = 0;
    await run(f, e, () => {
      if (calls++ === 0)
        return replyStream([
          { type: "text", text: "first-success" },
          {
            type: "toolCall",
            id: "read-gate",
            name: "read",
            arguments: { path: "gate" },
          },
        ]);
      throw Error("invalid API key scripted failure");
    });
    const events = f.app.store
      .executionEvents(e.id)
      .filter((x) => x.event_type === "agent.message");
    const assistant = events.filter(
      (x) => f.app.store.read<any>(x.payload).role === "assistant",
    );
    assert(assistant.length >= 2);
    assert(assistant[0].causation_id);
    assert.equal(assistant.at(-1)!.causation_id, null);
    const page = await f.client.query<TaskBrowserMessages>(
      `task-browser/${e.task_id}/executions/${e.id}/messages?position=latest`,
    );
    assert.equal(
      page.items.filter((m) => m.text.includes("first-success")).length,
      1,
    );
    assert(page.items.some((m) => m.id === assistant.at(-1)!.event_id));
  }));
