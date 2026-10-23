import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeContext } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { thinkingPreview } from "../../../src/pi_secretary/src/thinking-preview.ts";
import { timelineFor } from "../../../src/pi_secretary/src/timeline.ts";
import { activityHistoryFor } from "../../../src/pi_secretary/src/activity-history.ts";
import {
  fixtureModel,
  replyStream,
} from "../../../src/pi_secretary/src/model.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import { retryRuntime } from "../../../src/pi_secretary/src/model-retry.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  Context,
  ModelCall,
} from "../../../src/pi_secretary/src/contracts.ts";
import { fixture } from "../issue9/helpers.ts";

test("I1: segmentation consumes only the display prefix and one lookahead", () => {
  const original = Intl.Segmenter.prototype.segment;
  let visited = 0;
  Intl.Segmenter.prototype.segment = function (
    this: Intl.Segmenter,
    input: string,
  ) {
    const segments = original.call(this, input);
    return new Proxy(segments, {
      get(target, property, receiver) {
        if (property === Symbol.iterator)
          return function* () {
            for (const segment of target) {
              visited++;
              yield segment;
            }
          };
        return Reflect.get(target, property, receiver);
      },
    });
  };
  try {
    for (const text of [
      "中".repeat(8000),
      "a".repeat(8000),
      "😀".repeat(8000),
    ]) {
      visited = 0;
      const value = thinkingPreview([{ type: "thinking", thinking: text }]);
      assert(value?.truncated);
      assert(
        visited <= 21,
        `segmented ${visited} clusters for a 20-cluster display`,
      );
    }
  } finally {
    Intl.Segmenter.prototype.segment = original;
  }
});

test("I1: window-edge and separator semantics survive lazy segmentation", () => {
  const cases: [string[], string, boolean][] = [
    [["a".repeat(4097)], "a".repeat(20) + "…", true],
    [["a".repeat(4097), "z"], "a".repeat(20) + "…", true],
    [["a".repeat(19), "z"], "a".repeat(19) + "\n…", true],
    [["a".repeat(19), ""], "a".repeat(19), false],
    [["\r\n".repeat(21)], "\r\n".repeat(20) + "…", true],
    [
      ["x".repeat(19) + "a" + "\u0301".repeat(5000)],
      "x".repeat(19) + "…",
      true,
    ],
    [
      [("a" + "\u0301".repeat(100)).repeat(21)],
      ("a" + "\u0301".repeat(100)).repeat(20) + "…",
      true,
    ],
    [["a" + "\u0301".repeat(4096)], "", true],
  ];
  for (const [parts, text, truncated] of cases)
    assert.deepEqual(
      thinkingPreview(
        parts.map((thinking) => ({ type: "thinking", thinking })),
      ),
      { text, truncated },
    );
});

test("I1: collided historical failure follows the real reply and executed tool", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-issue80-order-"),
  );
  let calls = 0;
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: () =>
      ++calls === 1
        ? replyStream([
            { type: "text", text: "first reply" },
            {
              type: "toolCall",
              id: id(),
              name: "memory_read",
              arguments: { source: "consciousness" },
            },
          ])
        : replyStream([{ type: "text", text: "final reply" }]),
  });
  try {
    app.host.accept("fixture historical order");
    await app.host.drain();
    const first = app.store.logs
      .filter((e) => e.event_type === "main.message")
      .map((e) => app.store.read<any>(e.payload))
      .find((m) => m.role === "assistant" && m.stopReason === "toolUse");
    assert(first?.display_call_id);
    const failure = app.store.event(
      "main.message",
      {
        role: "assistant",
        content: [],
        stopReason: "error",
        display_call_id: first.display_call_id,
      },
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
    );
    app.store.commit([], [failure]);
    const rows = timelineFor(app).query(app.host.sessionID).items;
    const replyIndex = rows.findIndex(
      (r: any) => r.id === "message:" + first.display_call_id,
    );
    const toolIndex = rows.findIndex(
      (r: any) => r.kind === "activity" && r.activity.kind === "tool",
    );
    const failureIndex = rows.findIndex((r: any) => r.id === failure.event_id);
    assert(replyIndex >= 0 && toolIndex >= 0 && failureIndex >= 0);
    assert(
      failureIndex > replyIndex,
      "later failure must follow the earlier reply",
    );
    assert(
      failureIndex > toolIndex,
      "later failure must follow the executed tool",
    );
    assert.equal(rows[toolIndex].activity.status, "succeeded");
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("I1: replay keeps a process-interrupted attempt interrupted while retrying", () =>
  fixture(async (f) => {
    f.app.host.accept("seed frozen transport request");
    await f.app.host.drain();
    const call = f.app.store.all<ModelCall>("ModelCall").at(-1)!;
    const context = f.app.store.get<Context>("Context", call.context_id);
    f.app.store.commit([
      revise(call, { state: "IN_FLIGHT", response: null, completed_at: null }),
    ]);
    await f.restart();
    assert.equal(
      activityHistoryFor(f.app.store).selected(f.app.host.sessionID, [
        "model:" + call.id,
      ])[0].status,
      "interrupted",
    );
    let observed = false;
    retryRuntime.set(f.app.store, {
      wait: async () => {
        observed = true;
        const interrupted = f.app.store.get<ModelCall>("ModelCall", call.id);
        assert.equal(interrupted.state, "INTERRUPTED");
        assert.equal(interrupted.failure_kind, "TRANSIENT");
        assert.equal(interrupted.error, "PROCESS_INTERRUPTED");
        const row = activityHistoryFor(f.app.store).selected(
          f.app.host.sessionID,
          ["model:" + call.id],
        )[0];
        assert.equal(row.status, "interrupted");
        assert.equal(row.phase, "模型调用结果未记录");
      },
    });
    const resume = durableStream(
      f.app.store,
      () => replyStream([{ type: "text", text: "retry succeeds" }]),
      call.scope,
      context.loop_id,
      context.purpose,
      { resumeCallID: call.id },
    );
    await (
      await resume(fixtureModel, normalizeContext({ messages: [] }))
    ).result();
    assert(observed);
    assert.equal(
      f.app.store.all<ModelCall>("ModelCall").at(-1)!.state,
      "RESPONSE_SAVED",
    );
    assert.equal(
      activityHistoryFor(f.app.store).selected(f.app.host.sessionID, [
        "model:" + call.id,
      ])[0].status,
      "interrupted",
    );
  }));
