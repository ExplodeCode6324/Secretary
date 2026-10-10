import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAssistantMessageEventStream,
  normalizeContext,
} from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serve, conversation } from "../../../src/pi_secretary/src/backend.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import { Previews } from "../../../src/pi_secretary/src/preview.ts";
import {
  Agent,
  fixtureModel,
  replyStream,
} from "../../../src/pi_secretary/src/model.ts";
import { api } from "../../../src/pi_secretary/src/ui-client.ts";
import { delayedStream } from "./helpers/streaming.ts";
const directory = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "secretary-stream-"));

test("preview arrives before durable completion; final history is linked and thinking is opt-in", async () => {
  const dir = directory(),
    app = await App.open(dir, {
      model: fixtureModel,
      stream: delayedStream(100),
    }),
    server = await serve(app);
  try {
    const client = new CoreClient(server.endpoint);
    await client.command("messages", {
      request_id: crypto.randomUUID(),
      text: "test",
    });
    const draining = app.host.drain();
    for (
      let i = 0;
      i < 100 &&
      !app.host.previews
        .snapshot(app.host.sessionID, true)
        .some((p) => p.blocks.length);
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    const early = app.host.previews.snapshot(app.host.sessionID, true);
    assert(
      early.some(
        (p) =>
          p.status === "running" &&
          p.blocks.some((b) => b.type === "thinking" && b.text),
      ),
    );
    assert(!conversation(app, true).some((m) => m.role === "secretary"));
    const preview: any = await client.query(
      "timeline?streaming=true&thinking=true",
    );
    assert(preview.items.some((m: any) => m.call_id === early[0].id));
    assert(!JSON.stringify(preview).includes("PRIVATE_SIGNATURE"));
    await draining;
    const history = conversation(app, true).filter(
      (m) => m.role === "secretary",
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].thinking, "检查输入信息。");
    assert.equal(history[0].text, "这是逐段输出的正文。");
    assert.equal(history[0].call_id, early[0].id);
    const visible: any = await client.query("timeline?thinking=true");
    assert(visible.items.some((m: any) => m.thinking === "检查输入信息。"));
    const hidden: any = await new CoreClient(server.endpoint).query("timeline");
    assert(!JSON.stringify(hidden).includes("检查输入信息"));
    assert(!JSON.stringify(hidden).includes("PRIVATE_SIGNATURE"));
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tool execution waits for response persistence; observer failure cannot affect execution", async () => {
  const dir = directory();
  const app = await App.open(dir);
  try {
    let executed = false;
    const stream = durableStream(
      app.store,
      (_m, context) =>
        replyStream(
          context.messages.some((m) => m.role === "toolResult")
            ? [{ type: "text", text: "done" }]
            : [{ type: "toolCall", id: "call", name: "probe", arguments: {} }],
        ),
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      crypto.randomUUID(),
      "MAIN",
      {
        observe: () => {
          throw Error("display failure");
        },
      },
    );
    const agent = new Agent({
      initialState: {
        model: fixtureModel,
        tools: [
          {
            name: "probe",
            label: "probe",
            description: "probe",
            parameters: { type: "object", properties: {} } as any,
            execute: async () => {
              const calls = app.store.all("ModelCall") as any[];
              assert.equal(calls.at(-1).state, "RESPONSE_SAVED");
              executed = true;
              return {
                content: [{ type: "text", text: "ok" }],
                details: undefined,
              };
            },
          },
        ],
      },
      streamFn: stream,
    });
    await agent.prompt("test");
    assert(executed);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("save failure and cancellation never release a response to Agent", async () => {
  for (const failure of ["save", "abort", "timeout"]) {
    const dir = directory();
    const app = await App.open(dir);
    const previews = new Previews();
    const commit = app.store.commit.bind(app.store);
    try {
      if (failure === "save")
        app.store.commit = ((records: any[], ...rest: any[]) => {
          if (
            records.some(
              (r) =>
                r.record_type === "ModelCall" && r.state === "RESPONSE_SAVED",
            )
          )
            throw Error("disk failure");
          return (commit as any)(records, ...rest);
        }) as typeof app.store.commit;
      const abort = new AbortController();
      const wrapped = durableStream(
        app.store,
        failure === "save"
          ? () => replyStream([{ type: "text", text: "complete" }])
          : () => createAssistantMessageEventStream(),
        { session_id: app.host.sessionID, task_id: null, execution_id: null },
        crypto.randomUUID(),
        "MAIN",
        { observe: (u) => previews.update(u) },
      );
      const result = wrapped(
        fixtureModel,
        normalizeContext({
          messages: [{ role: "user", content: "test", timestamp: Date.now() }],
        }),
        {
          signal:
            failure === "timeout" ? AbortSignal.timeout(20) : abort.signal,
        },
      );
      if (failure === "abort") setTimeout(() => abort.abort(), 20);
      await assert.rejects(
        Promise.resolve(result),
        failure === "save" ? /disk failure/ : /abort|timeout/i,
      );
      assert.equal(
        previews.snapshot(app.host.sessionID, true)[0].status,
        "incomplete",
      );
      assert.equal((app.store.all("ModelCall")[0] as any).state, "INTERRUPTED");
    } finally {
      app.store.commit = commit;
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("preview has bounded text, ordered blocks, and session filtering", async () => {
  const previews = new Previews();
  const partial = await replyStream([{ type: "text", text: "" }]).result();
  for (let i = 0; i < 12; i++) {
    previews.update({
      type: "start",
      id: String(i),
      loop: "loop",
      session: "session",
    });
    previews.update({
      type: "event",
      id: String(i),
      event: {
        type: "text_delta",
        contentIndex: 0,
        delta: "x".repeat(40000),
        partial,
      },
    });
  }
  assert.equal(previews.snapshot("session", true).length, 8);
  assert(
    previews
      .snapshot("session", true)
      .every((p) => p.truncated && p.blocks[0].text.length === 32768),
  );
  assert.deepEqual(previews.snapshot("other", true), []);
});

test("multiple main calls have distinct identities and persisted thinking survives reopen", async () => {
  const dir = directory();
  let app = await App.open(dir, {
    model: fixtureModel,
    stream: (_m, context) =>
      replyStream(
        context.messages.some((m) => m.role === "toolResult")
          ? [
              { type: "thinking", thinking: "visible" },
              {
                type: "thinking",
                thinking: "REDACTED_SENTINEL",
                redacted: true,
                thinkingSignature: "PRIVATE_SIGNATURE",
              },
              { type: "text", text: "final" },
            ]
          : [
              { type: "text", text: "checking" },
              {
                type: "toolCall",
                id: "read",
                name: "memory_read",
                arguments: { source: "consciousness" },
              },
            ],
      ),
  });
  let server = await serve(app);
  try {
    const client = new CoreClient(server.endpoint);
    await client.command("messages", {
      text: "test",
      request_id: crypto.randomUUID(),
    });
    await app.host.drain();
    const history = conversation(app, true).filter(
      (m) => m.role === "secretary",
    );
    assert.equal(history.length, 2);
    assert.equal(new Set(history.map((m) => m.call_id)).size, 2);
    assert.equal(history[1].thinking, "visible");
    assert(!JSON.stringify(history).includes("REDACTED_SENTINEL"));
    await server.close();
    app = await App.open(dir);
    server = await serve(app);
    assert.deepEqual(
      conversation(app, true).filter((m) => m.role === "secretary"),
      history,
    );
    assert.deepEqual(app.host.previews.snapshot(app.host.sessionID, true), []);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("thinking-only and failed responses remain visible without pretending completion", async () => {
  for (const failed of [false, true]) {
    const dir = directory();
    const app = await App.open(dir, {
      model: fixtureModel,
      stream: () => {
        const stream = createAssistantMessageEventStream();
        void replyStream([{ type: "thinking", thinking: "visible partial" }])
          .result()
          .then((message) => {
            if (failed) {
              message.stopReason = "error";
              message.errorMessage = "synthetic failure";
              stream.push({ type: "error", reason: "error", error: message });
            } else stream.push({ type: "done", reason: "stop", message });
            stream.end(message);
          });
        return stream;
      },
    });
    const server = await serve(app);
    try {
      const client = new CoreClient(server.endpoint);
      await client.command("messages", {
        text: "test",
        request_id: crypto.randomUUID(),
      });
      await app.host.drain();
      const assistant = conversation(app, true).filter(
        (m) => m.role === "secretary",
      );
      assert.equal(assistant.length, 1);
      assert.equal(assistant[0].thinking, "visible partial");
      assert.equal(!!assistant[0].incomplete, failed);
      assert.equal(
        app.host.previews.snapshot(app.host.sessionID, true)[0].status,
        failed ? "incomplete" : "saved",
      );
    } finally {
      await server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
