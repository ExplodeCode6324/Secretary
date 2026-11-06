import test from "node:test";
import assert from "node:assert/strict";
import { fixture, until } from "../issue9/helpers.ts";
import { pending } from "./helpers.ts";
import { TaskBrowserWindow } from "../../../src/pi_secretary/src/tui/task-browser.ts";
import {
  parseInput,
  commandCompletion,
} from "../../../src/pi_secretary/src/tui/input.ts";
import {
  DocumentView,
  AnchoredScroll,
} from "../../../src/pi_secretary/src/tui/view.ts";
import { Text } from "@earendil-works/pi-tui";
import type {
  Message,
  TaskBrowserMessages,
} from "../../../src/pi_secretary/src/api/contracts.ts";
import { revise } from "../../../src/pi_secretary/src/store.ts";
import type { Execution } from "../../../src/pi_secretary/src/contracts.ts";

test("latest seeks past 125 messages and hydrates true long tail in one read; anchored reading and reconnect stay fixed", () =>
  fixture(async (f) => {
    const e = await pending(f),
      scope = { session_id: null, task_id: e.task_id, execution_id: e.id };
    const events = Array.from({ length: 126 }, (_, i) =>
      f.app.store.event(
        "agent.message",
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text:
                i === 125
                  ? "START\n" + "😀界\n".repeat(35000) + "TAIL-125"
                  : `M-${i}`,
            },
            { type: "thinking", thinking: "visible thoughts" },
            { type: "thinking", thinking: "SECRET", redacted: true },
          ],
        },
        scope,
        "EXECUTOR",
      ),
    );
    f.app.store.commit([], events);
    const route = `task-browser/${e.task_id}/executions/${e.id}/messages`;
    const latest = await f.client.query<TaskBrowserMessages>(
      route + "?position=latest",
    );
    assert.equal(latest.items.length, 50);
    assert.equal(latest.items[0].id, events[76].event_id);
    assert.equal(latest.items.at(-1)!.id, events[125].event_id);
    assert(latest.before);
    assert.equal(latest.after, null);
    const tail = await f.client.query<Message>(
      route +
        "/" +
        events[125].event_id +
        "/content?position=latest&thinking=true",
    );
    assert(tail.text.endsWith("TAIL-125"));
    assert(tail.body_offset! > 100000);
    assert.equal(tail.next_cursor, null);
    assert(!tail.thinking?.includes("SECRET"));
    assert(tail.text.length <= 32768);
    const reads: string[] = [];
    let thinking = false;
    const b = new TaskBrowserWindow(
      {
        query: async <T>(r: string) => {
          reads.push(r);
          return f.client.query<T>(r);
        },
      },
      () => thinking,
    );
    try {
      await b.open(e.task_id);
      reads.length = 0;
      await b.follow();
      await until(
        () =>
          !!b.bodies
            .get(e.id + ":" + events[125].event_id)
            ?.body.text.endsWith("TAIL-125"),
      );
      assert.equal(b.followTarget, e.id);
      assert.equal(reads.filter((r) => r.includes("/content")).length, 1);
      assert(!reads.some((r) => r.startsWith("task-browser?")));
      const body = b.bodies.get(e.id + ":" + events[125].event_id)!;
      assert(body.body.before);
      assert(body.body.contextBoundary);
      thinking = true;
      await b.setThinking();
      assert.equal(b.followTarget, e.id);
      assert.equal(
        b.bodies.get(e.id + ":" + events[125].event_id)!.thinking.text,
        "visible thoughts",
      );
      const next = new TaskBrowserWindow(f.client, () => thinking);
      next.inherit(b);
      await next.refresh();
      assert.equal(next.followTarget, e.id);
      next.stop();
      b.stopFollowing();
      const kept = b.groups.get(e.id)!.items.map((m) => m.id);
      const newer = f.app.store.event(
        "agent.message",
        { role: "assistant", content: "NEW" },
        scope,
        "EXECUTOR",
      );
      f.app.store.commit([], [newer]);
      b.refreshMessages([e.id]);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(b.followTarget, undefined);
      assert.deepEqual(
        b.groups.get(e.id)!.items.map((m) => m.id),
        kept,
      );
      await b.follow(e.id);
      await until(
        () => b.groups.get(e.id)?.items.at(-1)?.id === newer.event_id,
      );
      f.app.scheduler.cancel(e.id);
      await b.refresh();
      assert.equal(b.followTarget, e.id);
      b.followed();
      assert.equal(b.followTarget, undefined);
    } finally {
      b.stop();
    }
  }));

test("follow command is local, strict, detail-only and completes execution IDs", async () => {
  assert.equal(parseInput("/follow", "Main").kind, "error");
  assert.equal(parseInput("/follow", "Task").kind, "error");
  assert.deepEqual(parseInput("/follow", "Task", true), { kind: "follow" });
  assert.deepEqual(parseInput("/follow off", "Task", true), {
    kind: "follow",
    id: "off",
  });
  assert.equal(parseInput("/follow off\n", "Task", true).kind, "error");
  let command = "";
  const complete = commandCompletion(
    () => "Task",
    () => true,
    undefined,
    async (p, c) => {
      command = c!;
      return ["abcdef"];
    },
    () => true,
    () => true,
  );
  const suggestions = await complete.getSuggestions(["/follow a"], 0, 9, {
    signal: new AbortController().signal,
  });
  assert.equal(command, "follow");
  assert.equal(suggestions?.items[0].value, "abcdef");
});

test("Task follows a selected section tail rather than the global document bottom and reading stops it", () => {
  const d = new DocumentView(),
    s = new AnchoredScroll(d);
  d.entries = [
    {
      id: "target:m",
      version: "1",
      component: new Text("target\n".repeat(30), 0, 0),
    },
    {
      id: "other:m",
      version: "1",
      component: new Text("other\n".repeat(50), 0, 0),
    },
  ];
  const lines = d.render(80);
  s.following = true;
  s.followRow = () => d.lastRowFor("target");
  s.onReading = () => {
    s.following = false;
  };
  s.updateLayout(lines.length, 10, () => {});
  assert(s.scrollTop < 35);
  assert(s.scrollTop > 15);
  s.scrollToEnd();
  assert.equal(s.following, false);
  s.updateLayout(lines.length, 10, () => {});
  assert.equal(s.following, false);
});
