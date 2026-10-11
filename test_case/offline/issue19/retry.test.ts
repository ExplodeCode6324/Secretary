import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import {
  normalizeContext,
  createAssistantMessageEventStream,
  contentText,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  roleModel,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import {
  retryRuntime,
  retryAfter,
} from "../../../src/pi_secretary/src/model-retry.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  ModelCall,
  CompactionJob,
  Consciousness,
  MemoryExtractionJob,
  Notification,
} from "../../../src/pi_secretary/src/contracts.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import {
  enqueueExtractions,
  runExtraction,
  mergeExtraction,
  restoreExtractions,
} from "../../../src/pi_secretary/src/memory-extraction.ts";

export async function fixture(
  run: (
    app: App,
    clock: { now: number; waits: number[] },
    dir: string,
  ) => Promise<void>,
  stream: StreamFn = fixtureStream,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue19-"));
  const app = await App.open(dir, { model: fixtureModel, stream });
  const clock = { now: Date.now(), waits: [] as number[] };
  retryRuntime.set(app.store, {
    now: () => clock.now,
    wait: async (ms) => {
      clock.waits.push(ms);
      clock.now += ms;
    },
  });
  try {
    await run(app, clock, dir);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function failed(
  text: string,
): ReturnType<typeof createAssistantMessageEventStream> {
  const s = createAssistantMessageEventStream();
  const m: AssistantMessage = {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "never",
        name: "MasterInteract",
        arguments: { message: "never execute" },
      },
    ],
    api: fixtureModel.api,
    provider: fixtureModel.provider,
    model: fixtureModel.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: text,
    timestamp: 0,
  };
  s.push({ type: "error", reason: "error", error: m });
  s.end(m);
  return s;
}
const context = normalizeContext({
  messages: [
    { role: "user" as const, content: "synthetic request", timestamp: 0 },
  ],
});
for (const purpose of ["MAIN", "TASK", "COMPACTION"] as const)
  test(`${purpose}: saved failure diagnostics permit exactly three sends and success replay`, () =>
    fixture(async (app, clock) => {
      let sends = 0;
      const scope = {
          session_id: app.host.sessionID,
          task_id: null,
          execution_id: null,
        },
        loop = id();
      const stream: StreamFn = () =>
        ++sends < 3
          ? failed("HTTP 529 overloaded_error")
          : replyStream([{ type: "text", text: "done" }]);
      const call = durableStream(app.store, stream, scope, loop, purpose);
      assert.equal(
        (await (await call(fixtureModel, context)).result()).stopReason,
        "stop",
      );
      assert.equal(sends, 3);
      assert.deepEqual(clock.waits, [2000, 10000]);
      const calls = app.store.all<ModelCall>("ModelCall");
      assert.deepEqual(
        calls.map((c) => c.transport_attempt),
        [1, 2, 3],
      );
      assert.deepEqual(
        calls.map((c) => c.state),
        ["FAILED", "FAILED", "RESPONSE_SAVED"],
      );
      assert(calls.every((c) => c.response));
      assert.equal(new Set(calls.map((c) => c.logical_key)).size, 1);
      await durableStream(
        app.store,
        stream,
        scope,
        loop,
        purpose,
      )(fixtureModel, context);
      assert.equal(sends, 3);
      assert.equal(app.store.all("Notification").length, 0);
    }));
for (const status of [400, 401, 403])
  test(`HTTP ${status} is not retried`, () =>
    fixture(async (app) => {
      let sends = 0;
      await assert.rejects(
        async () =>
          await durableStream(
            app.store,
            () => {
              sends++;
              throw Object.assign(Error("bad request"), { status });
            },
            {
              session_id: app.host.sessionID,
              task_id: null,
              execution_id: null,
            },
            id(),
            "MAIN",
          )(fixtureModel, context),
      );
      assert.equal(sends, 1);
    }));
for (const api of ["openai-completions", "openai-responses"] as const)
  test(`${api}: actual SDK HTTP error headers preserve Retry-After, with no nested retry`, () =>
    fixture(async (app, clock) => {
      let sends = 0;
      const server = http.createServer((req, res) => {
        req.resume();
        sends++;
        res.writeHead(529, {
          "content-type": "application/json",
          "retry-after":
            sends === 1 ? "3" : new Date(clock.now + 20_000).toUTCString(),
        });
        res.end(
          JSON.stringify({
            error: { message: "overloaded", type: "overloaded_error" },
          }),
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const model = {
          ...fixtureModel,
          provider: "openai",
          api,
          id: "gpt-4o",
          baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
        };
        const config = roleModel(model, "synthetic-local-key");
        await assert.rejects(
          async () =>
            await durableStream(
              app.store,
              config.stream,
              {
                session_id: app.host.sessionID,
                task_id: null,
                execution_id: null,
              },
              id(),
              "MAIN",
            )(model, context),
          /MODEL_TRANSPORT_TRANSIENT/,
        );
        assert.equal(sends, 3);
        assert.equal(clock.waits[0], 3000);
        assert(clock.waits[1] >= 19_000);
        assert(
          app.store
            .all<ModelCall>("ModelCall")
            .every((c) => c.response && c.failure_kind === "TRANSIENT"),
        );
      } finally {
        server.close();
        await once(server, "close");
      }
    }));
test("Retry-After rejects malformed values and retains longer dates", () => {
  assert.equal(retryAfter("junk", 0), 0);
  assert.equal(retryAfter("2", 0), 2000);
  assert.equal(retryAfter("Thu, 01 Jan 1970 00:00:10 GMT", 0), 10000);
});
test("explicit cancellation during backoff never sends attempt two", () =>
  fixture(async (app) => {
    const abort = new AbortController();
    let sends = 0;
    retryRuntime.set(app.store, {
      wait: async (_ms, signal) => {
        abort.abort();
        signal?.throwIfAborted();
      },
    });
    await assert.rejects(
      async () =>
        await durableStream(
          app.store,
          () => {
            sends++;
            return failed("HTTP 529");
          },
          { session_id: app.host.sessionID, task_id: null, execution_id: null },
          id(),
          "MAIN",
        )(fixtureModel, context, { signal: abort.signal }),
    );
    assert.equal(sends, 1);
  }));
test("main bounded failure persists, duplicate input cannot unlock, new Master input recovers old batch first", async () => {
  let fail = true,
    sends = 0;
  await fixture(async (app, _clock, dir) => {
    const request = id();
    app.host.accept("first", request);
    await app.host.drain();
    assert.equal(app.host.session.state, "RECOVERY_BLOCKED");
    assert.equal(sends, 3);
    assert.equal(app.store.all<Notification>("Notification").length, 1);
    app.host.accept("first", request);
    await app.host.drain();
    assert.equal(sends, 3);
    app.host.accept("feedback", id(), "SCHEDULER");
    await app.host.drain();
    assert.equal(sends, 3);
    await app.close();
    const reopened = await App.open(dir, { model: fixtureModel, stream });
    try {
      assert.equal(reopened.host.session.state, "RECOVERY_BLOCKED");
      await reopened.host.drain();
      assert.equal(sends, 3);
      fail = false;
      reopened.host.accept("next");
      await reopened.host.drain();
      assert.equal(reopened.host.session.state, "IDLE");
      assert.equal(sends, 5);
      reopened.store.commit([
        revise(reopened.host.session, {
          state: "CAPACITY_BLOCKED",
          model_blocked_call: null,
        }),
      ]);
      reopened.host.accept("does not unlock");
      await reopened.host.drain();
      assert.equal(sends, 5);
    } finally {
      await reopened.close();
    }
  }, stream);
  function stream(
    m: Parameters<StreamFn>[0],
    c: Parameters<StreamFn>[1],
    o: Parameters<StreamFn>[2],
  ) {
    sends++;
    return fail ? failed("HTTP 529 overloaded") : fixtureStream(m, c, o);
  }
});
test("summary retries initial plus three rounds without new inputs, then stops and manual compact resets", async () => {
  let summaries = 0;
  await fixture(
    async (app, clock) => {
      app.host.accept("remember synthetic source");
      await app.host.drain();
      await app.host.compact();
      let job = app.store
        .all<CompactionJob>("CompactionJob")
        .findLast((j) => j.mode === "WORKING_MEMORY")!;
      assert.equal(summaries, 1);
      assert.equal(job.state, "FAILED");
      for (const [round, delay] of [300_000, 1_800_000, 7_200_000].entries()) {
        assert.equal(Date.parse(job.next_attempt_at!) - clock.now, delay);
        await app.host.compact(false);
        assert.equal(summaries, round + 1);
        clock.now = Date.parse(job.next_attempt_at!);
        app.host.maintainIfNeeded();
        await app.host.settingsIdle();
        job = app.store.get("CompactionJob", job.id) as CompactionJob;
        assert.equal(summaries, round + 2);
        assert.equal(job.retry_round, round + 1);
      }
      assert.equal(job.next_attempt_at, null);
      assert.equal(app.store.all("Notification").length, 1);
      clock.now += 99_000_000;
      await app.host.compact(false);
      assert.equal(summaries, 4);
      await app.host.compact();
      assert.equal(summaries, 5);
      assert.equal(
        (app.store.get("CompactionJob", job.id) as CompactionJob).retry_round,
        0,
      );
    },
    (m, c, o) => {
      if (
        c.messages.some(
          (v) =>
            v.role === "system" &&
            contentText(v.content).includes("CONSCIOUSNESS:"),
        )
      ) {
        summaries++;
        return replyStream([{ type: "text", text: "bad JSON" }], m);
      }
      return fixtureStream(m, c, o);
    },
  );
});
test("summary coverage and Settings commit survive extraction failure; API retry merges current resolved ledger once", async () => {
  let fail = true,
    extractions = 0;
  const quote = "I will prepare the synthetic report.";
  const stream: StreamFn = (m, c, o) => {
    if (
      c.messages.some(
        (v) =>
          v.role === "system" &&
          contentText(v.content).includes("COMMITMENT_EXTRACTION:"),
      )
    ) {
      extractions++;
      return replyStream(
        [
          {
            type: "text",
            text: fail ? "invalid" : JSON.stringify({ quotes: [quote] }),
          },
        ],
        m,
      );
    }
    return fixtureStream(m, c, o);
  };
  await fixture(async (app, _clock, dir) => {
    app.host.accept(quote);
    await app.host.drain();
    await app.host.compact();
    assert.equal(app.host.memoryStatus().state, "COMMITTED");
    assert((app.host.memoryStatus().covered_event_sequence ?? 0) > 0);
    const sourceJobs = app.store.all<MemoryExtractionJob>(
      "MemoryExtractionJob",
    );
    assert(sourceJobs.some((j) => j.state === "FAILED"));
    for (const j of sourceJobs) assert(app.store.read(j.source_ref));
    const draft = app.settings.draft();
    app.settings.save(
      {
        ...emptySettings(),
        instructions: {
          content: "synthetic new instruction",
          expected_revision: 1,
        },
      },
      draft.revision,
    );
    const application = app.settings.request(
      app.settings.draft().revision,
      id(),
    ) as import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication;
    await app.settings.tick();
    assert.equal(
      app.store.get<
        import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication
      >("SettingsApplication", application.id).state,
      "APPLIED",
    );
    const cs = app.store.get<Consciousness>(
      "Consciousness",
      app.host.session.consciousness_id,
    );
    const resolved = {
      id: id(),
      text: quote,
      state: "COMPLETED" as const,
      source_refs: [sourceJobs[0].evidence_ref],
      task_refs: [],
      resolution_event_ids: [],
    };
    app.store.commit([revise(cs, { commitments: [resolved] })]);
    app.host.accept("continue after Settings");
    await app.host.drain();
    await app.close();
    const reopened = await App.open(dir, { model: fixtureModel, stream });
    const service = new ApplicationService(reopened);
    try {
      fail = false;
      const request = { request_id: id() };
      service.command(service.principal, "memory/extraction/retry", request);
      const frozen = reopened.store
        .all<MemoryExtractionJob>("MemoryExtractionJob")
        .map((j) => [j.id, j.generation]);
      service.command(service.principal, "memory/extraction/retry", request);
      assert.deepEqual(
        reopened.store
          .all<MemoryExtractionJob>("MemoryExtractionJob")
          .map((j) => [j.id, j.generation]),
        frozen,
      );
      await reopened.host.drain();
      const before = extractions;
      await reopened.host.extractPending();
      assert.equal(extractions, before);
      const ledger = reopened.host.memoryStatus().commitments;
      assert.equal(ledger.filter((c) => c.text === quote).length, 1);
      assert.equal(
        ledger.find((c) => c.id === resolved.id)?.state,
        "COMPLETED",
      );
      assert(
        reopened.store
          .all<MemoryExtractionJob>("MemoryExtractionJob")
          .every((j) => j.merged),
      );
      assert.throws(
        () =>
          service.command(service.principal, "memory/recovery", {
            request_id: id(),
          }),
        /NOT_FOUND/,
      );
    } finally {
      await service.close();
      await reopened.close();
    }
  }, stream);
});

test("single-attempt timeout retries twice; explicit capacity failure sends nothing", () =>
  fixture(async (app) => {
    let sends = 0;
    retryRuntime.set(app.store, { timeoutMs: 10, wait: async () => {} });
    const call = durableStream(
      app.store,
      () =>
        ++sends < 3
          ? createAssistantMessageEventStream()
          : replyStream([{ type: "text", text: "done" }]),
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      id(),
      "MAIN",
    );
    await call(fixtureModel, context);
    assert.equal(sends, 3);
    assert.deepEqual(
      app.store.all<ModelCall>("ModelCall").map((c) => c.state),
      ["INTERRUPTED", "INTERRUPTED", "RESPONSE_SAVED"],
    );
    await assert.rejects(
      async () =>
        await durableStream(
          app.store,
          () => {
            sends++;
            return replyStream([]);
          },
          { session_id: app.host.sessionID, task_id: null, execution_id: null },
          id(),
          "MAIN",
        )({ ...fixtureModel, contextWindow: 100 }, context),
      /CAPACITY/,
    );
    assert.equal(sends, 3);
  }));
test("extraction exhausts three delayed rounds independently of committed summary and manual requeue resets it", async () => {
  let sends = 0;
  await fixture(
    async (app, clock) => {
      app.host.accept("Synthetic extraction source");
      await app.host.drain();
      await app.host.compact();
      const job = app.store.all<MemoryExtractionJob>("MemoryExtractionJob")[0];
      assert.equal(sends, 1);
      for (let round = 1; round <= 3; round++) {
        const current = app.store.get<MemoryExtractionJob>(
          "MemoryExtractionJob",
          job.id,
        );
        assert(current.next_attempt_at);
        await app.host.extractPending();
        assert.equal(sends, round);
        clock.now = Date.parse(current.next_attempt_at);
        await app.host.extractPending();
        assert.equal(sends, round + 1);
      }
      assert.equal(
        app.store.get<MemoryExtractionJob>("MemoryExtractionJob", job.id)
          .next_attempt_at,
        null,
      );
      clock.now += 99_000_000;
      await app.host.extractPending();
      assert.equal(sends, 4);
      assert.equal(app.host.memoryStatus().state, "COMMITTED");
      const request = id();
      app.host.retryExtractions(request);
      app.host.retryExtractions(request);
      await app.host.extractPending();
      assert.equal(sends, 5);
      assert.equal(
        app.store.get<MemoryExtractionJob>("MemoryExtractionJob", job.id).round,
        0,
      );
    },
    (m, c, o) => {
      if (
        c.messages.some(
          (v) =>
            v.role === "system" &&
            contentText(v.content).includes("COMMITMENT_EXTRACTION:"),
        )
      ) {
        sends++;
        return replyStream([{ type: "text", text: "invalid" }], m);
      }
      return fixtureStream(m, c, o);
    },
  );
});

test("extraction resumes only the failed segment and retains frozen task associations", () =>
  fixture(async (app, clock) => {
    const first = "Synthetic first future promise.";
    const second = "Synthetic second future promise.";
    const taskID = id();
    const [job] = enqueueExtractions({
      store: app.store,
      sessionID: app.host.sessionID,
      source: null,
      taskRefs: [taskID],
      completeMessages: [
        { id: "source-one", role: "user", text: first + " x".repeat(7500) },
        { id: "source-two", role: "user", text: second + " y".repeat(7500) },
      ],
    });
    const seen: string[][] = [];
    const stream: StreamFn = (model, context) => {
      const { source } = JSON.parse(
        contentText(context.messages.at(-1)!.content),
      );
      seen.push(source.map((m: { id: string }) => m.id));
      return replyStream(
        [
          {
            type: "text",
            text:
              seen.length === 2
                ? "invalid"
                : JSON.stringify({
                    quotes: [source[0].id === "source-one" ? first : second],
                  }),
          },
        ],
        model,
      );
    };
    const cs = app.store.get<Consciousness>(
      "Consciousness",
      app.host.session.consciousness_id,
    );
    const options = {
      store: app.store,
      model: fixtureModel,
      stream,
      existing: [],
      consciousnessRevision: cs.revision,
    };
    const failed = await runExtraction(options, job);
    assert.equal(failed.state, "FAILED");
    assert.deepEqual(seen, [["source-one"], ["source-two"]]);
    assert.equal(
      app.store.read<{ completed: number }>(failed.progress_ref!).completed,
      1,
    );
    clock.now = Date.parse(failed.next_attempt_at!);
    const completed = await runExtraction(options, failed);
    assert.equal(completed.state, "SUCCEEDED");
    assert.deepEqual(seen, [["source-one"], ["source-two"], ["source-two"]]);
    mergeExtraction(app.store, completed);
    const commitments = app.store.get<Consciousness>(
      "Consciousness",
      cs.id,
    ).commitments!;
    assert.deepEqual(
      commitments.map((c) => c.text),
      [first, second],
    );
    assert(
      commitments.every(
        (c) => c.task_refs.length === 1 && c.task_refs[0] === taskID,
      ),
    );
    assert.equal(
      app.store.get<MemoryExtractionJob>("MemoryExtractionJob", job.id).merged,
      true,
    );
  }));

test("unresolved historical source stays visible and manual requeue cannot send fabricated evidence", () =>
  fixture(async (app) => {
    app.store.commit(
      [],
      [
        app.store.event(
          "memory.extraction.failed",
          {
            key: "synthetic-unresolved-legacy-source",
            source_ref: app.store.put({ old_shape: "unlinked source" }),
          },
          { session_id: app.host.sessionID, task_id: null, execution_id: null },
        ),
      ],
    );
    restoreExtractions(app.store, app.host.sessionID);
    restoreExtractions(app.store, app.host.sessionID);
    assert.equal(
      app.store.all<MemoryExtractionJob>("MemoryExtractionJob").length,
      1,
    );
    assert.equal(app.host.memoryStatus().extraction_failed_count, 1);
    app.host.retryExtractions(id());
    await app.host.extractPending();
    const job = app.store.all<MemoryExtractionJob>("MemoryExtractionJob")[0];
    assert.equal(job.state, "FAILED");
    assert.equal(job.next_attempt_at, null);
    assert.match(job.error!, /EXTRACTION_SOURCE_MISSING/);
    assert.equal(app.store.all<ModelCall>("ModelCall").length, 0);
    assert.equal(app.host.memoryStatus().extraction_failed_count, 1);
  }));

test("post-commit extraction merge failure cannot roll back applied Settings", () =>
  fixture(async (app) => {
    app.host.accept("Synthetic source before a settings change.");
    await app.host.drain();
    const extract = app.host.extractPending.bind(app.host);
    app.host.extractPending = async () => {
      throw Error("synthetic local merge failure");
    };
    try {
      app.settings.save(
        {
          ...emptySettings(),
          instructions: {
            content: "Synthetic applied instruction.",
            expected_revision: 1,
          },
        },
        app.settings.draft().revision,
      );
      const request = app.settings.request(app.settings.draft().revision, id());
      assert("id" in request);
      await app.settings.tick();
      const saved = app.store.get<
        import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication
      >("SettingsApplication", request.id);
      assert.equal(saved.state, "APPLIED");
      assert.equal(app.settings.blocked, false);
      assert.equal(
        app.settings.status().effective_instructions.content,
        "Synthetic applied instruction.",
      );
      assert(
        app.store.logs.some(
          (e) => e.event_type === "memory.extraction.merge_failed",
        ),
      );
    } finally {
      app.host.extractPending = extract;
    }
    await app.host.extractPending();
    assert.equal(app.host.memoryStatus().extraction_pending_count, 0);
  }));
