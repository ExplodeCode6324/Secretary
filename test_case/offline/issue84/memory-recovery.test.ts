import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
  type AgentMessage,
} from "../../../src/pi_secretary/src/model.ts";
import { retryRuntime } from "../../../src/pi_secretary/src/model-retry.ts";
import type {
  CompactionJob,
  Consciousness,
  Input,
  Execution,
  MemoryExtractionJob,
} from "../../../src/pi_secretary/src/contracts.ts";
import { hash, id, revise } from "../../../src/pi_secretary/src/store.ts";
import { summaryCoolingDown } from "../../../src/pi_secretary/src/memory-summary.ts";
import { testPostgres } from "../helpers/postgres.ts";

const model = { ...fixtureModel, contextWindow: 90_000, maxTokens: 8192 };
const item = {
  tier: "MINIMAL",
  summary: "Synthetic completed exchanges; no pending work.",
  goals: [],
  constraints: [],
  decisions: [],
  open_questions: [],
  unfulfilled_commitments: [],
  task_refs: [],
  pending_owner: null,
};
const memory = (app: App) =>
  app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
const jobs = (app: App) =>
  app.store
    .all<CompactionJob>("CompactionJob")
    .filter((j) => j.mode === "WORKING_MEMORY");
type Controls = {
  summary: number;
  main: number;
  onSummary?: (
    app: App,
    context: Parameters<StreamFn>[1],
  ) => string | undefined;
  onExtraction?: (context: Parameters<StreamFn>[1]) => string;
  mainText?: string;
  taskGate?: Promise<void>;
  releaseTasks?: () => void;
};
async function fixture(
  run: (
    app: App,
    counts: Controls,
    directory: string,
    stream: StreamFn,
  ) => Promise<void>,
  dsn?: string,
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-memory-"));
  const names = [
    "SECRETARY_MAX_OUTPUT_TOKENS",
    "SECRETARY_COMPACTION_OUTPUT_TOKENS",
    "SECRETARY_COMPACTION_RETRY_OUTPUT_TOKENS",
  ];
  const saved = names.map((n) => process.env[n]);
  names.forEach((n) => (process.env[n] = "8192"));
  const counts: Controls = { summary: 0, main: 0 };
  let app!: App;
  const stream: StreamFn = (m, c) => {
    const system = c.messages
      .filter((x) => x.role === "system")
      .map((x) => contentText(x.content))
      .join("\n");
    let text: string;
    if (system.includes("CONSCIOUSNESS:")) {
      counts.summary++;
      text =
        counts.onSummary?.(app, c) ??
        (counts.summary === 1
          ? '{"items":[]}'
          : JSON.stringify({ items: [item] }));
    } else if (system.includes("COMMITMENT_EXTRACTION:"))
      text = counts.onExtraction?.(c) ?? '{"quotes":[]}';
    else {
      counts.main++;
      text =
        counts.mainText ?? "Synthetic historical reply. " + "h".repeat(14000);
    }
    return replyStream([{ type: "text", text }], m);
  };
  app = await App.open(
    directory,
    {
      main: { model, stream },
      task: {
        model,
        stream: async (m, c, o) => {
          await counts.taskGate;
          return fixtureStream(m, c, o);
        },
      },
    },
    dsn,
  );
  try {
    await run(app, counts, directory, stream);
  } finally {
    counts.releaseTasks?.();
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
    names.forEach((n, i) =>
      saved[i] === undefined
        ? delete process.env[n]
        : (process.env[n] = saved[i]),
    );
  }
}
async function blocked(
  app: App,
  firstInput = "Synthetic first input, this turn only.",
  laterInput = "Synthetic later input 0",
) {
  app.host.accept(firstInput);
  await app.host.drain();
  await app.host.compact();
  const old = jobs(app)[0];
  assert.equal(old.state, "FAILED");
  for (
    let n = 0;
    n < 12 && app.host.session.state !== "CAPACITY_BLOCKED";
    n++
  ) {
    app.host.accept(n === 0 ? laterInput : `Synthetic later input ${n}`);
    await app.host.drain();
  }
  assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
  const pending = app.store
    .all<Input>("Input")
    .find((x) => x.state === "CLAIMED")!;
  assert(pending);
  return {
    old,
    pending,
    latestSource: memory(app).pending_raw_refs[0],
    target: app.store.events("input.handled").at(-1)!.sequence,
  };
}
async function recovered(app: App, state: Awaited<ReturnType<typeof blocked>>) {
  assert.equal(
    app.host.session.state,
    "IDLE",
    "one recovery must catch up before releasing the blocked request",
  );
  assert.equal(memory(app).covered_event_sequence, state.target);
  assert.equal(memory(app).pending_raw_refs.length, 1);
  assert.equal(
    memory(app).pending_raw_refs[0].sha256,
    state.latestSource.sha256,
  );
  const old = app.store.get<CompactionJob>("CompactionJob", state.old.id);
  assert.equal(old.state, "COMMITTED");
  assert(old.validation_errors.some((x) => x.includes("EMPTY_WORKING_MEMORY")));
  const next = jobs(app).find((x) => x.id !== old.id)!;
  assert.equal(next.source_start_sequence, old.source_end_sequence);
  assert.equal(next.source_end_sequence, state.target);
  assert.equal(next.source_refs[0].sha256, state.latestSource.sha256);
  assert(
    app.store
      .all<CompactionJob>("CompactionJob")
      .some((x) => x.mode === "CONTEXT_COMPACTION" && x.state === "COMMITTED"),
  );
  await app.host.drain();
  const handled = app.store.get<Input>("Input", state.pending.id);
  assert.equal(handled.state, "HANDLED");
  assert.equal(handled.loop_id, state.pending.loop_id);
}
test("issue84 one explicit maintenance catches up old failed source and completes the same claimed input", async () =>
  fixture(async (app) => {
    const state = await blocked(app);
    const first = app.host.compact();
    assert.equal(app.host.compact(), first);
    await first;
    await recovered(app, state);
    assert.equal(
      summaryCoolingDown({ store: app.store, sessionID: app.host.sessionID }),
      false,
      "committed recovery supersedes the older no-progress cooldown",
    );
  }));
testPostgres(
  "issue84 natural due retry catches up a capacity-blocked Main with PostgreSQL",
  async (dsn) =>
    fixture(async (app, counts) => {
      const state = await blocked(app);
      const before = counts.summary;
      for (let i = 0; i < 5; i++) {
        app.host.maintainIfNeeded();
        await (app.host as unknown as { maintenance?: Promise<void> })
          .maintenance;
      }
      assert.equal(
        counts.summary,
        before,
        "not before the persisted retry deadline",
      );
      retryRuntime.set(app.store, {
        now: () => Date.parse(state.old.next_attempt_at!),
      });
      app.host.maintainIfNeeded();
      await (app.host as unknown as { maintenance?: Promise<void> })
        .maintenance;
      assert.equal(
        app.store.get<CompactionJob>("CompactionJob", state.old.id)
          .retry_generation,
        0,
      );
      await recovered(app, state);
    }, dsn),
);

const tick = async (app: App) => {
  app.host.maintainIfNeeded();
  await (app.host as unknown as { maintenance?: Promise<void> }).maintenance;
};

test("issue84 no-op compact never throttles the next critical or in-loop summary", async () =>
  fixture(async (app, counts) => {
    counts.mainText = "Synthetic completed reply.";
    counts.onSummary = () => JSON.stringify({ items: [item] });
    await app.host.compact(); // Fresh session, no source.
    assert.equal(
      app.store.events("consciousness.maintenance_stalled").length,
      0,
    );
    app.host.accept("Synthetic completed turn");
    await app.host.drain();
    await app.host.compact();
    await app.host.compact(); // Memory is already current.
    assert.equal(
      app.store.events("consciousness.maintenance_stalled").length,
      0,
    );
    const scope = {
      session_id: app.host.sessionID,
      task_id: null,
      execution_id: null,
    };
    app.store.commit([], [app.store.event("feedback.delivered", {}, scope)]);
    const before = counts.summary;
    app.host.accept("Synthetic critical follow-up");
    await app.host.drain();
    assert.equal(counts.summary, before + 1);
    await app.host.compact();
    app.host.accept("Synthetic later uncovered turn");
    await app.host.drain();
    const second = counts.summary;
    await (
      app.host as unknown as { maintain(inLoop: boolean): Promise<unknown> }
    ).maintain(true);
    assert.equal(counts.summary, second + 1);
    assert.equal(
      app.store.events("consciousness.maintenance_stalled").length,
      0,
    );
  }));

test("issue84 failed catch-up retains its boundary/backoff and never crops uncovered source", async () =>
  fixture(async (app, counts) => {
    const state = await blocked(app);
    counts.onSummary = (_app, c) => {
      const body = JSON.parse(contentText(c.messages.at(-1)!.content));
      return body.source_end_sequence === state.target
        ? '{"items":[]}'
        : undefined;
    };
    await app.host.compact();
    assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
    assert.equal(
      memory(app).covered_event_sequence,
      state.old.source_end_sequence,
    );
    const failed = jobs(app).at(-1)!;
    assert.equal(failed.state, "FAILED");
    assert.equal(failed.source_end_sequence, state.target);
    assert.equal(failed.retry_generation, 0);
    assert(failed.next_attempt_at);
    const before = counts.summary;
    for (let i = 0; i < 20; i++) await tick(app);
    await (
      app.host as unknown as { maintain(inLoop: boolean): Promise<unknown> }
    ).maintain(true);
    assert.equal(counts.summary, before);
    assert.equal(
      app.store.get<Input>("Input", state.pending.id).state,
      "CLAIMED",
    );
    assert(
      !app.store
        .all<CompactionJob>("CompactionJob")
        .some((j) => j.mode === "CONTEXT_COMPACTION"),
    );
  }));

test("issue84 terminal failed source and recovery blocks are never automatically reset", async () =>
  fixture(async (app, counts) => {
    const state = await blocked(app);
    app.store.commit([
      revise(app.store.get<CompactionJob>("CompactionJob", state.old.id), {
        next_attempt_at: null,
      }),
    ]);
    retryRuntime.set(app.store, { now: () => Date.now() + 86_400_000 });
    const before = counts.summary;
    for (let i = 0; i < 10; i++) await tick(app);
    assert.equal(counts.summary, before);
    assert.equal(jobs(app).length, 1);
    app.store.commit([
      revise(app.host.session, {
        state: "RECOVERY_BLOCKED",
        recovery_error: "synthetic unrelated recovery block",
      }),
    ]);
    await assert.rejects(app.host.compact(), /SESSION_RECOVERY_BLOCKED/);
    const server = await serveCore(app, 0, undefined, { pump: false });
    try {
      const client = new CoreClient(server.endpoint);
      const request = id();
      await client.command("session/compact", { request_id: request });
      for (let n = 0; n < 100; n++) {
        const status: any = await client.query("requests/" + request);
        if (status.receipt.state === "UNKNOWN") {
          assert.match(JSON.stringify(status), /SESSION_RECOVERY_BLOCKED/);
          break;
        }
        assert(n < 99, "compact command must fail explicitly");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await tick(app);
      assert.equal(counts.summary, before);
      assert.equal(app.host.session.state, "RECOVERY_BLOCKED");
      assert.equal(jobs(app)[0].retry_generation, 0);
    } finally {
      await server.close();
    }
  }));

test("issue84 fixed catch-up endpoint excludes newly accepted inputs", async () =>
  fixture(async (app, counts) => {
    const state = await blocked(app);
    let queued: Input | undefined;
    counts.onSummary = () => {
      queued ??= app.host.accept(
        "Synthetic later arrival; do not summarize before it is handled.",
      );
      return undefined;
    };
    await app.host.compact();
    assert.equal(memory(app).covered_event_sequence, state.target);
    assert.equal(app.store.get<Input>("Input", queued!.id).state, "ACCEPTED");
    for (const j of jobs(app)) assert(j.source_end_sequence! <= state.target);
  }));

test("issue84 persisted failed retry recovers the same claimed input after restart", async () =>
  fixture(async (app, counts, directory, stream) => {
    const state = await blocked(app);
    const fingerprint = app.settings.runtimeHash;
    await app.close();
    const restored = await App.open(directory, { model, stream });
    try {
      assert.equal(restored.settings.runtimeHash, fingerprint);
      assert.equal(restored.settings.blocked, false);
      const before = counts.summary;
      await tick(restored);
      assert.equal(counts.summary, before);
      retryRuntime.set(restored.store, {
        now: () => Date.parse(state.old.next_attempt_at!),
      });
      await tick(restored);
      await recovered(restored, state);
      assert.equal(
        restored.store.get<CompactionJob>("CompactionJob", state.old.id)
          .retry_generation,
        0,
      );
    } finally {
      await restored.close();
    }
  }));

test("issue84 genuinely oversized protected input stays blocked without repeated summaries", async () =>
  fixture(async (app, counts) => {
    counts.mainText = "Synthetic short reply";
    counts.onSummary = () => JSON.stringify({ items: [item] });
    app.host.accept("Synthetic initial source");
    await app.host.drain();
    await app.host.compact();
    app.host.accept("x".repeat(100000));
    await app.host.drain();
    assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
    const before = counts.summary;
    await app.host.compact();
    for (let i = 0; i < 10; i++) {
      retryRuntime.set(app.store, { now: () => Date.now() + i * 120_001 });
      await tick(app);
    }
    assert.equal(counts.summary, before);
    assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
  }));

test("issue84 explicit target pins new summary but never rewrites a pending job end", async () =>
  fixture(async (app, counts) => {
    counts.mainText = "Synthetic short reply";
    counts.onSummary = () => JSON.stringify({ items: [item] });
    app.host.accept("First completed source");
    await app.host.drain();
    const target = app.store.events("input.handled").at(-1)!.sequence;
    app.host.accept("Second completed source");
    await app.host.drain();
    const maintain = (
      app.host as unknown as {
        maintain: (
          inLoop: boolean,
          target: number,
        ) => Promise<CompactionJob | undefined>;
      }
    ).maintain.bind(app.host);
    await maintain(false, target);
    assert.equal(memory(app).covered_event_sequence, target);
    const eventIds = new Set(
      app.store.logs.filter((e) => e.sequence <= target).map((e) => e.event_id),
    );
    assert(jobs(app)[0].source_event_ids.every((id) => eventIds.has(id)));
    const latest = app.store.events("input.handled").at(-1)!.sequence;
    counts.onSummary = () => '{"items":[]}';
    await maintain(false, latest);
    const pending = jobs(app).at(-1)!;
    counts.onSummary = () => JSON.stringify({ items: [item] });
    retryRuntime.set(app.store, {
      now: () => Date.parse(pending.next_attempt_at!),
    });
    await maintain(false, target);
    assert.equal(
      app.store.get<CompactionJob>("CompactionJob", pending.id)
        .source_end_sequence,
      latest,
    );
    assert.equal(memory(app).covered_event_sequence, latest);
  }));

test("issue84 stale runtime changes throttle critical feedback and pressure across restart", async () =>
  fixture(async (app, counts, directory, stream) => {
    counts.mainText = "Synthetic short reply";
    app.host.accept("Synthetic source");
    await app.host.drain();
    counts.taskGate = new Promise<void>((resolve) => {
      counts.releaseTasks = resolve;
    });
    // Real planner creates a queued execution; the test changes its revision during
    // summary, equivalent to scheduler progress racing a frozen Task snapshot.
    app.scheduler.propose(
      "Synthetic concurrent task",
      id(),
      app.host.sessionID,
    );
    app.scheduler.tick();
    await new Promise((resolve) => setImmediate(resolve));
    const execution = app.store.all<Execution>("Execution")[0];
    assert(execution);
    assert.equal(execution.state, "RUNNING");
    let summaryApp = app;
    counts.onSummary = () => {
      const current = summaryApp;
      const e = current.store.get<Execution>("Execution", execution.id);
      current.store.commit([
        revise(e, {
          updated_at: new Date(Date.parse(e.updated_at) + 1).toISOString(),
        }),
      ]);
      return JSON.stringify({ items: [item] });
    };
    // Critical delivery belongs to the uncovered completed range.
    app.store.commit(
      [],
      [
        app.store.event(
          "feedback.delivered",
          {},
          { session_id: app.host.sessionID, task_id: null, execution_id: null },
        ),
        app.store.event(
          "input.handled",
          {},
          { session_id: app.host.sessionID, task_id: null, execution_id: null },
        ),
      ],
    );
    await app.host.compact();
    assert.equal(jobs(app).at(-1)!.state, "STALE");
    const before = counts.summary;
    for (let i = 0; i < 20; i++) await tick(app);
    await (
      app.host as unknown as { maintain(inLoop: boolean): Promise<unknown> }
    ).maintain(true);
    assert.equal(counts.summary, before);
    assert(
      summaryCoolingDown({ store: app.store, sessionID: app.host.sessionID }),
    );
    counts.releaseTasks?.();
    await app.scheduler.idle();
    await app.close();
    const restored = await App.open(directory, { model, stream });
    summaryApp = restored;
    try {
      await tick(restored);
      assert.equal(counts.summary, before);
      retryRuntime.set(restored.store, { now: () => Date.now() + 120_001 });
      await tick(restored);
      assert.equal(counts.summary, before + 1);
      assert.equal(jobs(restored).at(-1)!.state, "STALE");
    } finally {
      await restored.close();
    }
  }));

test("issue84 oversized historical source retains one failed job and exhausts only scheduled retries", async () =>
  fixture(async (app, counts) => {
    // Synthetic legacy-sized assistant output, never a real-provider request.
    counts.mainText = "x".repeat(1_100_000);
    app.host.accept("Synthetic oversized historical reply fixture");
    await app.host.drain();
    await app.host.compact();
    const first = jobs(app)[0];
    assert.equal(first.state, "FAILED");
    assert(
      first.validation_errors.some((e) => e.includes("SUMMARY_SEGMENT_LIMIT")),
    );
    assert.equal(counts.summary, 0);
    for (let round = 1; round <= 3; round++) {
      const pending = app.store.get<CompactionJob>("CompactionJob", first.id);
      assert(pending.next_attempt_at);
      await tick(app);
      assert.equal(
        app.store.get<CompactionJob>("CompactionJob", first.id).retry_round,
        round - 1,
      );
      const due = Date.parse(pending.next_attempt_at);
      retryRuntime.set(app.store, { now: () => due });
      await tick(app);
      assert.equal(
        app.store.get<CompactionJob>("CompactionJob", first.id).retry_round,
        round,
      );
    }
    assert.equal(
      app.store.get<CompactionJob>("CompactionJob", first.id).next_attempt_at,
      null,
    );
    for (let i = 0; i < 10; i++) await tick(app);
    assert.equal(jobs(app).length, 1);
    assert.equal(counts.summary, 0);
    assert.equal(memory(app).covered_event_sequence ?? 0, 0);
    assert(
      !app.store
        .all<CompactionJob>("CompactionJob")
        .some((j) => j.mode === "CONTEXT_COMPACTION"),
    );
  }));

test("issue84 a stale capacity recovery waits one interval then handles the original input", async () =>
  fixture(async (app, counts) => {
    const state = await blocked(app);
    counts.taskGate = new Promise<void>((resolve) => {
      counts.releaseTasks = resolve;
    });
    app.scheduler.propose(
      "Synthetic concurrent recovery task",
      id(),
      app.host.sessionID,
    );
    app.scheduler.tick();
    await new Promise((resolve) => setImmediate(resolve));
    const execution = app.store.all<Execution>("Execution")[0];
    assert.equal(execution.state, "RUNNING");
    counts.onSummary = () => {
      const e = app.store.get<Execution>("Execution", execution.id);
      app.store.commit([
        revise(e, {
          updated_at: new Date(Date.parse(e.updated_at) + 1).toISOString(),
        }),
      ]);
      return JSON.stringify({ items: [item] });
    };
    await app.host.compact();
    assert.equal(jobs(app).at(-1)!.state, "STALE");
    assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
    // Extraction freezes valid completed source before the summary CAS check.
    // STALE rejects the summary candidate, not the independent source extraction.
    const staleExtractions = structuredClone(
      app.store.all<MemoryExtractionJob>("MemoryExtractionJob"),
    );
    assert.equal(staleExtractions.length, 1);
    assert.equal(staleExtractions[0].owner_id, jobs(app).at(-1)!.id);
    assert.equal(staleExtractions[0].state, "SUCCEEDED");
    assert.equal(staleExtractions[0].merged, true);
    const before = counts.summary;
    for (let n = 0; n < 10; n++) await tick(app);
    await (
      app.host as unknown as { maintain(inLoop: boolean): Promise<unknown> }
    ).maintain(true);
    assert.equal(counts.summary, before);
    counts.onSummary = () => JSON.stringify({ items: [item] });
    const realNow = Date.now;
    const expired = realNow() + 120_001;
    // Existing ordinary maintenance timers use wall time; retry timers use
    // retryRuntime. Advance both only for this deterministic expiry check.
    Date.now = () => expired;
    retryRuntime.set(app.store, { now: () => expired });
    try {
      await tick(app);
    } finally {
      Date.now = realNow;
    }
    assert.equal(app.host.session.state, "IDLE");
    assert.equal(memory(app).covered_event_sequence, state.target);
    const recoveredExtractions = app.store.all<MemoryExtractionJob>(
      "MemoryExtractionJob",
    );
    assert.equal(recoveredExtractions.length, 2);
    assert.deepEqual(recoveredExtractions[0], staleExtractions[0]);
    const sourceKeys = recoveredExtractions.flatMap((job) => job.source_keys);
    assert.equal(new Set(sourceKeys).size, sourceKeys.length);
    const sourceIDs = recoveredExtractions.flatMap(
      (job) => job.source_event_ids,
    );
    assert.equal(new Set(sourceIDs).size, sourceIDs.length);
    const eligibleIDs = app.store
      .events("main.message")
      .filter(
        (event) =>
          event.scope.session_id === app.host.sessionID &&
          event.sequence <= state.target,
      )
      .filter((event) => {
        const message = app.store.read<AgentMessage>(event.payload);
        return (
          (message.role === "user" || message.role === "assistant") &&
          !!contentText(message.content)
        );
      })
      .map((event) => event.event_id);
    assert.deepEqual(new Set(sourceIDs), new Set(eligibleIDs));
    assert(
      recoveredExtractions.every(
        (job) => job.state === "SUCCEEDED" && job.merged,
      ),
    );
    await app.host.drain();
    const handled = app.store.get<Input>("Input", state.pending.id);
    assert.equal(handled.state, "HANDLED");
    assert.equal(handled.loop_id, state.pending.loop_id);
  }));

test("issue84 recovery preserves commitment source batches and extracts each completed message once across restart", async () =>
  fixture(async (app, counts, directory, stream) => {
    const quotes = [
      "I will independently check the synthetic old-prefix report tomorrow.",
      "I will independently check the synthetic catch-up report tomorrow.",
    ];
    let extractionCalls = 0;
    counts.onExtraction = (context) => {
      extractionCalls++;
      const body = JSON.parse(contentText(context.messages.at(-1)!.content));
      return JSON.stringify({
        quotes: quotes.filter((quote) =>
          body.source.some((message: { text: string }) =>
            message.text.includes(quote),
          ),
        ),
      });
    };
    const state = await blocked(app, quotes[0], quotes[1]);
    assert.equal(app.store.all("MemoryExtractionJob").length, 0);
    assert.deepEqual(memory(app).commitments ?? [], []);
    const eligible = app.store
      .events("main.message")
      .filter(
        (event) =>
          event.scope.session_id === app.host.sessionID &&
          event.sequence <= state.target,
      )
      .flatMap((event) => {
        const message = app.store.read<AgentMessage>(event.payload);
        return (message.role === "user" || message.role === "assistant") &&
          contentText(message.content)
          ? [
              {
                id: event.event_id,
                role: message.role,
                text: contentText(message.content),
              },
            ]
          : [];
      });
    assert(eligible.length > 2);
    await app.host.compact();
    assert.equal(memory(app).covered_event_sequence, state.target);
    const summaries = jobs(app);
    assert.equal(summaries.length, 2);
    assert(summaries.every((job) => job.state === "COMMITTED"));
    const extractions = app.store.all<MemoryExtractionJob>(
      "MemoryExtractionJob",
    );
    assert.equal(extractions.length, 2);
    assert.deepEqual(
      new Set(extractions.map((job) => job.owner_id)),
      new Set(summaries.map((job) => job.id)),
    );
    assert(extractions.every((job) => job.state === "SUCCEEDED" && job.merged));
    const keys = extractions.flatMap((job) => job.source_keys);
    assert.equal(
      new Set(keys).size,
      keys.length,
      "old-prefix and catch-up source keys must be disjoint",
    );
    assert.deepEqual(
      new Set(keys),
      new Set(
        eligible.map((message) =>
          hash(
            JSON.stringify({
              id: message.id,
              text: message.text,
              role: message.role,
            }),
          ),
        ),
      ),
    );
    assert.deepEqual(
      new Set(extractions.flatMap((job) => job.source_event_ids)),
      new Set(eligible.map((message) => message.id)),
    );
    for (const job of extractions) {
      const summary = summaries.find(
        (candidate) => candidate.id === job.owner_id,
      )!;
      const events = app.store
        .events("main.message")
        .filter(
          (event) =>
            event.sequence > summary.source_start_sequence! &&
            event.sequence <= summary.source_end_sequence! &&
            eligible.some((message) => message.id === event.event_id),
        );
      assert.deepEqual(
        new Set(job.source_event_ids),
        new Set(events.map((event) => event.event_id)),
      );
      assert.deepEqual(
        app.store.read(job.source_ref),
        eligible.filter((message) => job.source_event_ids.includes(message.id)),
      );
    }
    const ledger = structuredClone(memory(app).commitments!);
    assert.equal(ledger.length, 2);
    assert.equal(new Set(ledger.map((entry) => entry.id)).size, 2);
    assert.deepEqual(
      new Set(ledger.map((entry) => entry.text)),
      new Set(quotes),
    );
    for (const [index, quote] of quotes.entries()) {
      const entry = ledger.find((candidate) => candidate.text === quote)!;
      const extraction = extractions.find(
        (job) => job.owner_id === summaries[index].id,
      )!;
      assert.equal(entry.state, "OPEN");
      assert.deepEqual(entry.resolution_event_ids, []);
      assert.deepEqual(entry.source_refs, [extraction.evidence_ref]);
      assert.deepEqual(entry.source_batch, {
        owner_type: "MemoryExtractionJob",
        owner_id: extraction.id,
        source_event_ids: extraction.source_event_ids,
        source_end_sequence: extraction.source_end_sequence,
      });
    }
    const savedJobs = structuredClone(extractions);
    const calls = extractionCalls;
    await app.close();
    const restored = await App.open(directory, { model, stream });
    try {
      assert.equal(restored.settings.blocked, false);
      assert.equal(memory(restored).covered_event_sequence, state.target);
      for (let n = 0; n < 5; n++) await tick(restored);
      await restored.host.compact();
      assert.deepEqual(
        restored.store.all<MemoryExtractionJob>("MemoryExtractionJob"),
        savedJobs,
      );
      assert.deepEqual(memory(restored).commitments, ledger);
      assert.equal(
        extractionCalls,
        calls,
        "restart/ticks/current-memory compact must not re-extract",
      );
      assert.equal(jobs(restored).length, 2);
      counts.mainText = "Synthetic resumed reply.";
      await recovered(restored, state);
      assert.deepEqual(memory(restored).commitments, ledger);
    } finally {
      await restored.close();
    }
  }));
