import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  ActivityHistory,
  activityHistoryFor,
} from "../../../src/pi_secretary/src/activity-history.ts";
import { conversation, serve } from "../../../src/pi_secretary/src/backend.ts";
import { api } from "../../../src/pi_secretary/src/ui-client.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { base, id } from "../../../src/pi_secretary/src/store.ts";
import type { CompactionJob } from "../../../src/pi_secretary/src/contracts.ts";
import type {
  Execution,
  ModelCall,
} from "../../../src/pi_secretary/src/contracts.ts";
import { revise } from "../../../src/pi_secretary/src/store.ts";
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "secretary-history-"));
const stream: StreamFn = (m, c, o) =>
  c.messages.at(-1)?.role === "toolResult"
    ? fixtureStream(m, c, o)
    : replyStream([
        { type: "text", text: "synthetic pre-tool reply" },
        {
          type: "toolCall",
          id: id(),
          name: "memory_read",
          arguments: { source: "consciousness" },
        },
        { type: "toolCall", id: id(), name: "task_query", arguments: {} },
      ]);

test("durable history reconstructs real tools once, associates batched inputs and survives restart", async () => {
  const dir = temp();
  let app = await App.open(dir, { model: fixtureModel, stream });
  try {
    app.host.accept("PRIVATE_SYNTHETIC_INPUT_ONE");
    app.host.accept("PRIVATE_SYNTHETIC_INPUT_TWO");
    await app.host.drain();
    const history = activityHistoryFor(app.store),
      page = history.page(app.host.sessionID);
    const tools = page.items.filter((a) => a.kind === "tool");
    assert.equal(tools.length, 2);
    assert(tools.every((a) => a.status === "succeeded"));
    assert(tools.every((a) => !a.timing_known));
    assert(!JSON.stringify(page).includes("PRIVATE_SYNTHETIC"));
    const messages = conversation(app);
    const before = messages.find((m) => m.text === "synthetic pre-tool reply")!;
    assert(before);
    const models = page.items
      .filter((a) => a.kind === "model")
      .sort((a, b) => a.order - b.order);
    assert.equal(
      models[0].anchor_id,
      messages.filter((m) => m.role === "master").at(-1)!.id,
    );
    for (const tool of tools) {
      assert.equal(tool.call_id, before.call_id);
      assert(tool.order > before.order!);
      assert(tool.order < models.at(-1)!.order);
    }
    const expected = page.items.map(
      ({ id, status, order, phase, started_at, ended_at }) => ({
        id,
        status,
        order,
        phase,
        started_at,
        ended_at,
      }),
    );
    await app.close();
    app = await App.open(dir, { model: fixtureModel, stream });
    assert.deepEqual(
      activityHistoryFor(app.store)
        .page(app.host.sessionID)
        .items.map(({ id, status, order, phase, started_at, ended_at }) => ({
          id,
          status,
          order,
          phase,
          started_at,
          ended_at,
        })),
      expected,
    );
    assert.equal(activityHistoryFor(app.store).page(id()).items.length, 0);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("API v1 timeline authenticates, rejects bad cursors and locates activity details", async () => {
  const dir = temp(),
    app = await App.open(dir, { model: fixtureModel, stream }),
    server = await serve(app);
  try {
    app.host.accept("synthetic");
    await app.host.drain();
    const client = new CoreClient(server.endpoint);
    assert.equal(
      (await fetch(server.endpoint.url + "/api/v1/timeline")).status,
      401,
    );
    await assert.rejects(
      client.query("timeline?cursor=invalid"),
      /CURSOR_EXPIRED/,
    );
    await assert.rejects(client.query("timeline?limit=10000"), /INVALID_LIMIT/);
    const first: any = await client.query("timeline?limit=2");
    assert.equal(first.items.length, 2);
    assert(first.before);
    const next: any = await client.query(
      "timeline?limit=2&cursor=" + encodeURIComponent(first.before),
    );
    assert(
      !next.items.some((x: any) => first.items.some((y: any) => x.id === y.id)),
    );
    const whole: any = await client.query("timeline");
    assert(whole.items.length >= 4);
    for (const item of whole.items.filter((x: any) => x.kind === "activity")) {
      const selected: any = await client.query("activities/" + item.id);
      assert.equal(selected.id, item.id);
    }
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tool failure and authorization wait are not reported as successful execution", async () => {
  const dir = temp();
  const app = await App.open(dir, {
    main: {
      model: fixtureModel,
      stream: (m, c, o) =>
        c.messages.at(-1)?.role === "toolResult"
          ? fixtureStream(m, c, o)
          : replyStream([
              {
                type: "toolCall",
                id: id(),
                name: "memory_read",
                arguments: { source: "world" },
              },
            ]),
    },
    task: {
      model: fixtureModel,
      stream: () =>
        replyStream([
          {
            type: "toolCall",
            id: id(),
            name: "bash",
            arguments: { command: "PRIVATE_COMMAND_MUST_NOT_RUN" },
          },
        ]),
    },
  });
  try {
    app.host.accept("synthetic failed read");
    await app.host.drain();
    app.scheduler.propose(
      "synthetic authorization wait",
      id(),
      app.host.sessionID,
    );
    app.scheduler.tick();
    await app.scheduler.idle();
    const e = app.store.all<Execution>("Execution")[0];
    assert.equal(e.state, "WAIT_AUTH");
    const page = activityHistoryFor(app.store).page(app.host.sessionID);
    assert(
      page.items.some(
        (a) => a.kind === "tool" && a.scope === "main" && a.status === "failed",
      ),
    );
    const shell = page.items.find(
      (a) => a.kind === "tool" && a.execution_id === e.id,
    )!;
    assert.equal(shell.status, "waiting");
    assert.match(shell.phase, /等待 Master 授权/);
    assert.equal(shell.ended_at, null);
    assert(!JSON.stringify(page).includes("PRIVATE_COMMAND"));
    assert.equal(
      app.store.all<
        import("../../../src/pi_secretary/src/contracts.ts").Operation
      >("Operation")[0].state,
      "WAIT_AUTH",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unexecuted tool request and old inflight call remain unconfirmed after restart", async () => {
  const dir = temp();
  let app = await App.open(dir);
  try {
    app.host.accept("synthetic baseline");
    await app.host.drain();
    const c = app.store.all<ModelCall>("ModelCall")[0];
    app.store.commit([
      revise(c, { state: "IN_FLIGHT", response: null, completed_at: null }),
    ]);
    const other = {
      ...c,
      ...base(),
      state: "RESPONSE_SAVED" as const,
      response: app.store.put({
        content: [
          {
            type: "toolCall",
            id: id(),
            name: "bash",
            arguments: { command: "PRIVATE_NEVER_EXECUTED" },
          },
        ],
      }),
    };
    app.store.commit([other]);
    await app.close();
    app = await App.open(dir);
    const page = activityHistoryFor(app.store).page(app.host.sessionID);
    const call = page.items.find((a) => a.id === "model:" + c.id)!;
    assert.notEqual(call.status, "running");
    const tool = page.items.find((a) => a.kind === "tool")!;
    assert.equal(tool.status, "interrupted");
    assert.match(tool.phase, /结果未记录/);
    assert(!JSON.stringify(page).includes("PRIVATE_NEVER_EXECUTED"));
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("long conversation polling reads only new messages and returns caller-safe snapshots", async () => {
  const dir = temp(),
    app = await App.open(dir);
  try {
    const scope = {
      session_id: app.host.sessionID,
      task_id: null,
      execution_id: null,
    };
    // Repeated fixed-size synthetic messages isolate query cost from seed fsync cost.
    for (let batch = 0; batch < 100; batch++)
      app.store.commit(
        [],
        Array.from({ length: 100 }, () =>
          app.store.event(
            "main.message",
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "synthetic long conversation ".repeat(20),
                },
              ],
            },
            scope,
          ),
        ),
      );
    let reads = 0;
    const read = app.store.read.bind(app.store);
    app.store.read = ((ref) => {
      reads++;
      return read(ref);
    }) as typeof app.store.read;
    const coldStart = performance.now();
    const first = conversation(app);
    const coldMs = performance.now() - coldStart;
    assert.equal(first.length, 10000);
    reads = 0;
    first[0].text = "caller edit";
    const repeatedStart = performance.now();
    const repeated = conversation(app);
    const warmMs = performance.now() - repeatedStart;
    assert.equal(reads, 0);
    assert.notEqual(repeated[0].text, "caller edit");
    app.store.commit(
      [],
      [
        app.store.event(
          "main.message",
          {
            role: "assistant",
            content: [{ type: "text", text: "new message" }],
          },
          scope,
        ),
      ],
    );
    reads = 0;
    const incrementalStart = performance.now();
    assert.equal(conversation(app).length, 10001);
    const incrementalMs = performance.now() - incrementalStart;
    // The activity projection inspects structured messages once; conversation reads the new message once.
    assert(reads <= 2);
    app.store.read = read;
    console.log(
      "CONVERSATION_PERFORMANCE " +
        JSON.stringify({
          messages: 10000,
          cold_ms: coldMs,
          warm_ms: warmMs,
          warm_cas_reads: 0,
          incremental_ms: incrementalMs,
          incremental_cas_reads: reads,
          json_bytes: Buffer.byteLength(JSON.stringify(repeated)),
          limitation:
            "full state response and DOM still scale with chat length",
        }),
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("long history uses incremental CAS reads and indexed pagination with stable cursors", async () => {
  const dir = temp(),
    app = await App.open(dir);
  try {
    const source = app.store.put({ synthetic: true });
    const create = (): CompactionJob => ({
      schema_version: 1,
      record_type: "CompactionJob",
      ...base(),
      state: "COMMITTED",
      session_id: app.host.sessionID,
      base_revision: 1,
      source_event_ids: [],
      source_refs: [source],
      candidate_ref: null,
      covered_event_ids: [],
      validation_errors: [],
    });
    let count = 0;
    const measurements = [];
    for (const size of (process.env.ACTIVITY_HISTORY_BENCH ?? "1000")
      .split(",")
      .map(Number)) {
      while (count < size) {
        const batch = Array.from(
          { length: Math.min(100, size - count) },
          create,
        );
        app.store.commit(batch);
        count += batch.length;
      }
      global.gc?.();
      const heapBefore = process.memoryUsage().heapUsed,
        start = performance.now();
      const history = new ActivityHistory(app.store);
      history.sync();
      const coldMs = performance.now() - start;
      global.gc?.();
      const heapDelta = process.memoryUsage().heapUsed - heapBefore;
      let reads = 0;
      const read = app.store.read.bind(app.store);
      app.store.read = ((ref) => {
        reads++;
        return read(ref);
      }) as typeof app.store.read;
      const times = [];
      let cursor: string | undefined;
      const ids = new Set<string>();
      const first = history.page(app.host.sessionID);
      for (let page = 0; page < size / 50; page++) {
        const t = performance.now();
        history.sync();
        const result = history.page(app.host.sessionID, cursor);
        times.push(performance.now() - t);
        for (const row of result.items) {
          assert(!ids.has(row.id));
          ids.add(row.id);
        }
        cursor = result.next_cursor ?? undefined;
      }
      assert.equal(ids.size, size);
      assert.equal(cursor, undefined);
      assert.equal(reads, 0);
      app.store.read = read;
      const fresh = create();
      app.store.commit([fresh]);
      count++;
      reads = 0;
      app.store.read = ((ref) => {
        reads++;
        return read(ref);
      }) as typeof app.store.read;
      const updateStart = performance.now();
      history.sync();
      const incrementalMs = performance.now() - updateStart;
      assert.equal(reads, 1);
      app.store.read = read;
      assert(
        !history
          .page(app.host.sessionID, first.next_cursor!)
          .items.some((a) => a.id === "compaction:" + fresh.id),
      );
      times.sort((a, b) => a - b);
      assert(times.at(-1)! < 1000);
      measurements.push({
        activities: size,
        cold_ms: coldMs,
        heap_delta_bytes: heapDelta,
        page_p50_ms: times[Math.floor(times.length * 0.5)],
        page_p95_ms: times[Math.floor(times.length * 0.95)],
        page_max_ms: times.at(-1),
        steady_cas_reads: 0,
        incremental_ms: incrementalMs,
        incremental_cas_reads: reads,
        postgres_connection_configured: false,
        gc_available: !!global.gc,
      });
    }
    console.log("HISTORY_PERFORMANCE " + JSON.stringify(measurements));
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
