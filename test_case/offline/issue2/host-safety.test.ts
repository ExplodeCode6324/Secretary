import { revise } from "../../../src/pi_secretary/src/store.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  replyStream,
  type AgentMessage,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  CompactionJob,
  Consciousness,
  Context,
  Input,
  ModelCall,
} from "../../../src/pi_secretary/src/contracts.ts";
const large = { ...fixtureModel, contextWindow: 1_000_000, maxTokens: 65536 };
const item = {
  tier: "ACTIVE",
  summary: "Synthetic: preserve the amber precondition.",
  goals: [],
  constraints: [],
  decisions: [],
  open_questions: [],
  unfulfilled_commitments: [],
  task_refs: [],
  pending_owner: "MAIN",
};
function kind(context: Parameters<StreamFn>[1]) {
  const system = context.messages
    .filter((m) => m.role === "system")
    .map((m) => contentText(m.content))
    .join("\n");
  return system.includes("COMMITMENT_EXTRACTION:")
    ? "extraction"
    : system.includes("CONSCIOUSNESS:")
      ? "summary"
      : "main";
}
const synthetic: StreamFn = (m, context) =>
  replyStream(
    [
      {
        type: "text",
        text:
          kind(context) === "summary"
            ? JSON.stringify({ items: [item] })
            : kind(context) === "extraction"
              ? '{"quotes":[]}'
              : "Synthetic acknowledgement",
      },
    ],
    m,
  );
function memory(app: App) {
  return app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
}
async function turn(app: App, text = "Synthetic amber condition") {
  app.host.accept(text);
  await app.host.drain();
  assert.equal(
    app.host.session.state,
    "IDLE",
    app.host.session.recovery_error ?? "",
  );
}
async function fixture(
  body: (app: App) => Promise<void>,
  stream: StreamFn = synthetic,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-host-safety-"));
  const app = await App.open(dir, { model: large, stream });
  try {
    await body(app);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function twoTools(m = large) {
  return replyStream(
    [
      {
        type: "toolCall",
        id: "synthetic-lookup-a",
        name: "task_query",
        arguments: {},
      },
      {
        type: "toolCall",
        id: "synthetic-lookup-b",
        name: "task_query",
        arguments: {},
      },
    ],
    m,
  );
}

test("HOST giant current-loop tool results persist before capacity block and never reexecute on reopen", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-tool-capacity-"),
  );
  const model = { ...large, contextWindow: 65536, maxTokens: 4096 };
  let queries = 0,
    requests = 0;
  const stream: StreamFn = (m, c, o) => {
    if (kind(c) !== "main") return synthetic(m, c, o);
    requests++;
    return twoTools(m);
  };
  let app = await App.open(dir, { model, stream });
  const stub = () => {
    app.scheduler.query = (() => ({
      synthetic: "x".repeat(100000),
      order: ++queries,
    })) as unknown as typeof app.scheduler.query;
  };
  try {
    stub();
    app.host.accept("Synthetic tools, preserve full evidence");
    await app.host.drain();
    assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
    assert.equal(queries, 2);
    assert.equal(requests, 1);
    const cp = app.store.get<Context>(
      "Context",
      app.host.session.last_context_id!,
    );
    assert.equal(cp.capture_kind, "CHECKPOINT");
    const raw = app.store.read<AgentMessage[]>(cp.raw_context);
    assert.equal(raw.filter((m) => m.role === "toolResult").length, 2);
    assert(
      raw
        .filter((m) => m.role === "toolResult")
        .every((m) => contentText(m.content).includes("x".repeat(100000))),
    );
    assert.equal(
      app.store
        .all<ModelCall>("ModelCall")
        .filter((call) => call.state === "RESPONSE_SAVED").length,
      1,
    );
    assert.equal(
      app.store.select<Input>("Input", (i) => i.state === "CLAIMED", 10).length,
      1,
    );
    await app.close();
    app = await App.open(dir, { model, stream });
    stub();
    await app.host.drain();
    assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
    assert.equal(
      queries,
      2,
      "recovery must consume durable results without rerunning tools",
    );
    assert.equal(
      requests,
      1,
      "same oversized projected request remains unsent",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("HOST two tools retain canonical identity and MODEL_REQUEST links across recoverable interruption", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-tool-recovery-"),
  );
  let queries = 0,
    interrupt = true;
  const stream: StreamFn = (m, c, o) => {
    if (kind(c) !== "main") return synthetic(m, c, o);
    if (!c.messages.some((message) => message.role === "toolResult"))
      return twoTools(m);
    if (interrupt)
      throw Error(
        "CAPACITY_BLOCKED: synthetic interruption after durable tools",
      );
    return replyStream(
      [{ type: "text", text: "Recovered synthetic results" }],
      m,
    );
  };
  let app = await App.open(dir, { model: large, stream });
  const stub = () => {
    app.scheduler.query = (() => ({
      synthetic: "small result",
      order: ++queries,
    })) as unknown as typeof app.scheduler.query;
  };
  try {
    stub();
    app.host.accept("Synthetic two-tool loop");
    await app.host.drain();
    assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
    assert.equal(queries, 2);
    const beforeKeys = app.store.logs
      .filter((event) => event.event_type === "main.tool.result")
      .map((event) => app.store.read<{ key: string }>(event.payload).key);
    const beforeCP = app.store.get<Context>(
      "Context",
      app.host.session.last_context_id!,
    );
    const before = app.store.read<AgentMessage[]>(beforeCP.raw_context);
    const toolIndex = before.findIndex(
      (m) =>
        m.role === "assistant" && m.content.some((p) => p.type === "toolCall"),
    );
    assert(toolIndex >= 0);
    assert(beforeCP.protected_from_index! <= toolIndex);
    for (const request of app.store
      .all<Context>("Context")
      .filter((c) => c.capture_kind === "MODEL_REQUEST")) {
      assert(request.source_context_id);
      const source = app.store.get<Context>(
        "Context",
        request.source_context_id!,
      );
      assert.equal(source.capture_kind, "CHECKPOINT");
      assert.equal(source.loop_id, request.loop_id);
    }
    await app.close();
    interrupt = false;
    app = await App.open(dir, { model: large, stream });
    stub();
    await app.host.drain();
    assert.equal(app.host.session.state, "IDLE");
    assert.equal(queries, 2);
    assert.deepEqual(
      app.store.logs
        .filter((event) => event.event_type === "main.tool.result")
        .map((event) => app.store.read<{ key: string }>(event.payload).key),
      beforeKeys,
    );
    const after = app.store.read<AgentMessage[]>(
      app.store.get<Context>("Context", app.host.session.last_context_id!)
        .raw_context,
    );
    assert.equal(
      after.findIndex(
        (m) =>
          m.role === "assistant" &&
          m.content.some((p) => p.type === "toolCall"),
      ),
      toolIndex,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("HOST eighth completed turn updates memory before queued ninth turn and retains ninth as uncovered", async () => {
  let app!: App,
    main = 0;
  const order: string[] = [];
  const stream: StreamFn = (m, c, o) => {
    const type = kind(c);
    order.push(type);
    if (type === "main" && ++main === 8)
      app.host.accept("Synthetic queued ninth source");
    return synthetic(m, c, o);
  };
  await fixture(async (opened) => {
    app = opened;
    for (let i = 0; i < 8; i++) await turn(app, `Synthetic turn ${i + 1}`);
    assert.equal(main, 9);
    const eighth = order
      .map((type, index) => (type === "main" ? index : -1))
      .filter((index) => index >= 0)[7];
    const ninth = order
      .map((type, index) => (type === "main" ? index : -1))
      .filter((index) => index >= 0)[8];
    assert(
      order.indexOf("summary") > eighth && order.indexOf("summary") < ninth,
    );
    const end = memory(app).covered_event_sequence!;
    const handled = app.store.logs.filter(
      (event) => event.event_type === "input.handled",
    );
    assert(end >= handled[7].sequence && end < handled[8].sequence);
    assert.equal(
      app.store
        .all<CompactionJob>("CompactionJob")
        .filter(
          (job) => job.mode === "WORKING_MEMORY" && job.state === "COMMITTED",
        ).length,
      1,
    );
  }, stream);
});

async function withOneTurnTrigger(fn: () => Promise<void>) {
  const old = process.env.SECRETARY_MEMORY_UPDATE_TURNS;
  process.env.SECRETARY_MEMORY_UPDATE_TURNS = "1";
  try {
    await fn();
  } finally {
    if (old === undefined) delete process.env.SECRETARY_MEMORY_UPDATE_TURNS;
    else process.env.SECRETARY_MEMORY_UPDATE_TURNS = old;
  }
}
test("HOST ordinary maintenance cooldown coalesces new completed turns", async () =>
  withOneTurnTrigger(async () => {
    let summaries = 0;
    await fixture(
      async (app) => {
        await turn(app);
        assert.equal(summaries, 1);
        const covered = memory(app).covered_event_sequence;
        for (let i = 0; i < 9; i++) await turn(app, `Synthetic new turn ${i}`);
        assert.equal(summaries, 1);
        assert.equal(memory(app).covered_event_sequence, covered);
      },
      (m, c, o) => {
        if (kind(c) === "summary") summaries++;
        return synthetic(m, c, o);
      },
    );
  }));

test("HOST appended new inputs cannot replay a failed source prefix automatically", async () =>
  withOneTurnTrigger(async () => {
    let summaries = 0;
    await fixture(
      async (app) => {
        await turn(app);
        assert.equal(summaries, 2);
        assert.equal(
          app.store.all<CompactionJob>("CompactionJob").at(-1)?.state,
          "FAILED",
        );
        const covered = memory(app).covered_event_sequence;
        for (let i = 0; i < 9; i++)
          await turn(app, `Synthetic appended source ${i}`);
        app.host.maintainIfNeeded();
        await app.host.close();
        assert.equal(summaries, 2);
        assert.equal(memory(app).covered_event_sequence, covered);
        assert.equal(app.store.all<CompactionJob>("CompactionJob").length, 1);
      },
      (m, c, o) =>
        kind(c) === "summary"
          ? (summaries++,
            replyStream([{ type: "text", text: "invalid JSON" }], m))
          : synthetic(m, c, o),
    );
  }));

test("HOST explicit maintenance queued during a turn runs before continuously arriving later turns", async () => {
  let app!: App,
    mains = 0,
    requested: Promise<void> | undefined;
  const order: string[] = [];
  const stream: StreamFn = (m, c, o) => {
    const type = kind(c);
    order.push(type);
    if (type === "main") {
      mains++;
      if (mains === 1) requested = app.host.compact();
      if (mains < 6) app.host.accept(`Synthetic continuous input ${mains}`);
    }
    return synthetic(m, c, o);
  };
  await fixture(async (opened) => {
    app = opened;
    app.host.accept("Synthetic first turn triggering manual maintenance");
    await app.host.drain();
    await requested;
    await app.host.drain();
    assert.equal(mains, 6);
    assert.equal(app.host.session.state, "IDLE");
    assert(
      order.indexOf("summary") < order.indexOf("main", 1),
      "manual maintenance must run at the first completed boundary, not after the pending queue empties",
    );
  }, stream);
});

test("HOST maintenance cleanup releases its promise even when final capacity history read fails", async () => {
  await fixture(async (app) => {
    await turn(app);
    app.store.commit([
      revise(app.host.session, {
        state: "CAPACITY_BLOCKED",
        recovery_error: "Synthetic prior capacity block",
      }),
    ]);
    const host = app.host as unknown as { history: () => AgentMessage[] };
    const original = host.history;
    host.history = () => {
      throw Error("SYNTHETIC_FINAL_CAPACITY_READ_FAILURE");
    };
    const first = app.host.compact();
    try {
      await first;
    } catch {
      /* The read failure may be propagated or reported; it must not poison future work. */
    }
    host.history = original;
    const retry = app.host.compact();
    if (retry === first) {
      await retry.catch(() => {});
      // Test-only cleanup of the proven poisoned handle lets App.close release SQLite.
      (app.host as unknown as { maintenance?: Promise<void> }).maintenance =
        undefined;
      assert.fail(
        "failed finalizer must release the queued maintenance promise",
      );
    }
    await retry;
    assert.equal(app.host.session.state, "IDLE");
  });
});
