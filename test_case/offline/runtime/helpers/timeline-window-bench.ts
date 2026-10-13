import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { serve } from "../../../../src/pi_secretary/src/backend.ts";
import { timelineFor } from "../../../../src/pi_secretary/src/timeline.ts";
import { base } from "../../../../src/pi_secretary/src/store.ts";
import type { CompactionJob } from "../../../../src/pi_secretary/src/contracts.ts";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-window-bench-"));
const app = await App.open(dir),
  server = await serve(app);
const headers = {
  Authorization: `Bearer ${server.endpoint.token}`,
  "Content-Type": "application/json",
  "X-Secretary-API-Version": "1",
};
const session = app.host.sessionID,
  scope = { session_id: session, task_id: null, execution_id: null },
  ref = app.store.put({ synthetic: true });
const ids: string[] = [],
  measurements: any[] = [];
let count = 0;
const output = process.argv[2];
const save = () =>
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        node: process.version,
        platform: os.platform(),
        arch: os.arch(),
        cpu: os.cpus()[0].model,
        gc: !!global.gc,
        message_lengths:
          "90% messages, 10% compaction activities; message body 128-2048 characters",
        measurements,
      },
      null,
      2,
    ),
  );
try {
  for (const size of (process.env.WINDOW_BENCH ?? "1000,10000,100000")
    .split(",")
    .map(Number)) {
    const seedStart = performance.now();
    while (count < size) {
      const jobs: CompactionJob[] = Array.from({ length: 10 }, () => ({
        schema_version: 1,
        record_type: "CompactionJob",
        ...base(),
        state: "COMMITTED",
        session_id: session,
        base_revision: 1,
        source_event_ids: [],
        source_refs: [ref],
        candidate_ref: null,
        covered_event_ids: [],
        validation_errors: [],
      }));
      const events = Array.from({ length: 90 }, (_, j) =>
        app.store.event(
          "main.message",
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "synthetic 中文 ".repeat(j % 10 ? 10 : 150),
              },
            ],
          },
          scope,
        ),
      );
      app.store.commit(jobs, events);
      count += 100;
      ids.push(
        ...jobs.map((j) => "compaction:" + j.id),
        ...events.map((e) => e.event_id),
      );
      if (count % 2000 === 0) await new Promise<void>((r) => setImmediate(r));
    }
    const seedMs = performance.now() - seedStart;
    let reads = 0;
    const read = app.store.read.bind(app.store);
    app.store.read = ((ref) => {
      reads++;
      return read(ref);
    }) as typeof read;
    global.gc?.();
    const before = process.memoryUsage().heapUsed,
      coldStart = performance.now();
    const timeline = timelineFor(app);
    const coldMs = performance.now() - coldStart,
      coldReads = reads;
    global.gc?.();
    const heapDelta = process.memoryUsage().heapUsed - before;
    const cases = [];
    for (const concurrency of [1, 4]) {
      const times: number[] = [],
        payloads: number[] = [];
      reads = 0;
      // Deterministic, scattered deep positions; each case has 100 genuine HTTP queries.
      for (let offset = 0; offset < 100; offset += concurrency) {
        await Promise.all(
          Array.from({ length: concurrency }, async (_, worker) => {
            const n = offset + worker,
              locate =
                ids[
                  ((Math.imul(n + 37, 7919) >>> 0) % (ids.length - 200)) + 100
                ];
            const start = performance.now();
            const response = await fetch(
              server.endpoint.url +
                "/api/v1/timeline/around?" +
                new URLSearchParams({
                  message_id: locate,
                  thinking: "true",
                  limit: "200",
                }),
              { headers },
            );
            const body = await response.text();
            times.push(performance.now() - start);
            payloads.push(Buffer.byteLength(body));
            assert(response.ok, body);
            const page = JSON.parse(body).data;
            assert(page.items.length <= 200);
            assert(page.items.some((m: any) => m.id === locate));
            assert(Buffer.byteLength(body) <= 1048576);
          }),
        );
      }
      times.sort((a, b) => a - b);
      cases.push({
        concurrency,
        queries: times.length,
        api_p50_ms: times[50],
        api_p95_ms: times[95],
        api_max_ms: times.at(-1),
        cas_reads: reads,
        max_payload_bytes: Math.max(...payloads),
        pass: times[95] <= 100,
      });
    }
    app.store.read = read;
    measurements.push({
      size,
      seed_ms: seedMs,
      incremental_index_ms: coldMs,
      incremental_cas_reads: coldReads,
      incremental_index_heap_bytes: heapDelta,
      diagnostics: timeline.diagnostics(),
      cases,
    });
    save();
    console.log(JSON.stringify(measurements.at(-1)));
  }
} finally {
  save();
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
assert(
  measurements.every((m) => m.cases.every((c: any) => c.pass)),
  "API P95 exceeded 100 ms; evidence retained",
);
