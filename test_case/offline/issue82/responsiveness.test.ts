import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { once } from "node:events";
import {
  StateWriter,
  writerPath,
} from "../../../src/pi_secretary/src/tui/writer.ts";
import { ClientStore } from "../../../src/pi_secretary/src/tui/state.ts";
import { Outbox } from "../../../src/pi_secretary/src/tui/outbox.ts";
import { MainSync } from "../../../src/pi_secretary/src/tui/sync.ts";
import { InputProtocol } from "../../../src/pi_secretary/src/tui/input.ts";
import type { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import type {
  Core,
  Receipt,
} from "../../../src/pi_secretary/src/api/contracts.ts";
const evidence = path.resolve(".demo-data/issue82-tui/implementation");
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
test(
  "200 sync transactions/s for 30s with 20ms per fsync keeps input and attempt ACKs bounded",
  { timeout: 45000 },
  async () => {
    const run = fs.mkdtempSync(path.join(evidence, "responsiveness-"));
    const helper = path.join(run, "delayed-writer.py");
    fs.writeFileSync(
      helper,
      fs
        .readFileSync(writerPath, "utf8")
        .replace(
          "import sys",
          `import sys
import time
import atexit
import platform
fsync_samples = []
sleep_samples = []
sleep_cpu_ns = 0
delay_method = "time.sleep"
delay_queue = None
trace_epoch = time.monotonic_ns()
def trace_now():
    return time.monotonic_ns() - trace_epoch
trace_operations = []
trace_fsync = []
trace_current = None
trace_overflow = 0
trace_cost_ns = 0
def trace_append(items, value):
    global trace_overflow, trace_cost_ns
    started = trace_now()
    if len(items) < 20000:
        items.append(value)
    else:
        trace_overflow += 1
    trace_cost_ns += trace_now() - started

def trace_phase(name, function):
    def measured(*args, **kwargs):
        global trace_cost_ns
        current = trace_current
        begin = trace_now()
        cpu = time.thread_time_ns()
        try:
            return function(*args, **kwargs)
        finally:
            ended = trace_now()
            used_cpu = time.thread_time_ns() - cpu
            overhead = trace_now()
            if current is not None:
                phase = current["phases"].setdefault(name, {"count": 0, "totalNs": 0, "maxNs": 0, "cpuNs": 0})
                phase["count"] += 1
                phase["totalNs"] += ended - begin
                phase["maxNs"] = max(phase["maxNs"], ended - begin)
                phase["cpuNs"] += used_cpu
            trace_cost_ns += trace_now() - overhead
    return measured

# Inclusive phase totals intentionally overlap; never add atomic and its fsyncs.
def install_trace():
    for name in ("atomic", "usage", "read", "regular", "names", "cleanup", "references", "json_bytes", "blob_read"):
        globals()[name] = trace_phase(name, globals()[name])
    for name in ("open", "stat", "listdir", "rename", "unlink"):
        setattr(os, name, trace_phase("os." + name, getattr(os, name)))
if sys.platform == "darwin":
    import select
    delay_queue = select.kqueue()
    delay_method = "kqueue.EVFILT_TIMER.NOTE_CRITICAL"
real_fsync = os.fsync
def delayed_fsync(fd):
    global sleep_cpu_ns
    cpu = time.process_time_ns()
    begin = trace_now()
    if delay_queue is not None:
        # Apple sys/event.h: default timer data is milliseconds; 0x20 is
        # NOTE_CRITICAL (minimal coalescing). Only this test timer changes.
        events = delay_queue.control([select.kevent(1, filter=select.KQ_FILTER_TIMER,
            flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT, fflags=0x20, data=20)], 1, None)
        if len(events) != 1 or events[0].ident != 1 or events[0].filter != select.KQ_FILTER_TIMER or events[0].flags & select.KQ_EV_ERROR:
            raise RuntimeError("INVALID_DELAY_TIMER_EVENT:" + repr(events))
    else:
        time.sleep(0.020)
    slept = trace_now()
    sleep_cpu_ns += time.process_time_ns() - cpu
    if slept - begin < 20000000:
        raise RuntimeError("INJECTED_DELAY_UNDERRUN:" + str(slept - begin))
    result = real_fsync(fd)
    ended = trace_now()
    fsync_samples.append((ended - slept) / 1000000)
    trace_append(trace_fsync, {"id": trace_current["id"] if trace_current else None,
        "beginNs": begin, "sleptNs": slept, "endNs": ended})
    sleep_samples.append((slept - begin) / 1000000)
    return result
def save_timing():
    if delay_queue is not None:
        delay_queue.close()
    with open(${JSON.stringify(path.join(run, "fsync-metrics.json"))}, "w") as target:
        json.dump({"fsync": fsync_samples, "sleep": sleep_samples,
            "method": delay_method, "platform": platform.platform(), "python": sys.version,
            "sleepCpuMs": sleep_cpu_ns / 1000000,
            "trace": {"operations": trace_operations, "fsync": trace_fsync,
                "overflow": trace_overflow, "recordingCostNs": trace_cost_ns,
                "clock": "Python monotonic_ns relative to helper start; separate origin from Node performance.now",
                "phases": "inclusive; nested totals must not be added"}}, target)
atexit.register(save_timing)
os.fsync = delayed_fsync`,
        )
        .replace(
          'if reply({"ready": True',
          'install_trace()\nif reply({"ready": True',
        )
        .replace(
          "raw = sys.stdin.buffer.readline(MAX_LINE + 1)",
          "raw = sys.stdin.buffer.readline(MAX_LINE + 1)\n        received_ns = trace_now()",
        )
        .replace(
          'op = request["op"]',
          `op = request["op"]
            trace_current = {"id": seq, "op": op, "receivedNs": received_ns,
                "startedNs": trace_now(), "cpuStartNs": time.thread_time_ns(), "phases": {}}
            trace_append(trace_operations, trace_current)`,
        )
        .replace(
          "if not reply(response):\n            break",
          `if trace_current is not None:
            trace_current["processedNs"] = trace_now()
            trace_current["cpuNs"] = time.thread_time_ns() - trace_current.pop("cpuStartNs")
        replied = reply(response)
        if trace_current is not None:
            trace_current["flushedNs"] = trace_now()
        trace_current = None
        if not replied:
            break`,
        ),
      { mode: 0o600 },
    );
    const writer = new StateWriter(path.join(run, "tui-v1"), undefined, {
        helperPath: helper,
      }),
      store = new ClientStore(writer);
    await store.open();
    const binding = {
      api_version: "1",
      data_domain_id: "latency",
      mode: "fixture",
    } as const;
    await store.bind(binding);
    const core = { ...binding, instance_id: "latency-instance" } as Core;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined,
      emitted = 0,
      seq = 0;
    const page = {
      items: [],
      version: "1",
      generation: "g",
      before: null,
      after: null,
    };
    const receipts = new Map<string, Receipt>();
    const client = {
      async query(route: string) {
        if (route === "core") return core;
        if (route === "sync/cursor")
          return {
            cursor: String(seq),
            sequence: String(seq),
            instance_id: core.instance_id,
          };
        if (route.startsWith("timeline")) return page;
        if (route === "session")
          return {
            id: "s",
            revision: "1",
            state: "IDLE",
            recovery_error: null,
          };
        if (route.startsWith("sync/changes"))
          return {
            transactions: [],
            next_cursor: String(seq),
            has_more: false,
          };
        if (route.startsWith("requests/"))
          return {
            receipt: receipts.get(route.slice(9)),
            result: null,
            resources: [],
          };
        throw Error("unexpected route " + route);
      },
      async commandFrozen(_route: string, _body: string, id: string) {
        const receipt: Receipt = {
          request_id: id,
          command: "messages",
          acceptance: "ACCEPTED",
          state: "ACCEPTED",
          revision: "1",
          resource_ids: [],
          error_code: null,
        };
        receipts.set(id, receipt);
        return receipt;
      },
      async stream(_cursor: string, signal: AbortSignal) {
        return new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
            signal.addEventListener(
              "abort",
              () => {
                controller = undefined;
                value.close();
              },
              { once: true },
            );
          },
        });
      },
    } as unknown as CoreClient;
    // Numeric, bounded C5 observations; never change the fixture or sync policy.
    // Kinds: 1 overload, 2 attach, 3 stream attempt, 4 actual open,
    // 5 catchup, 6 refresh, 7 checkpoint, 8 count reset, 9 byte reset,
    // 10 actual reconnect wait. Phases: 0 begin, 1 end.
    const syncEvents: Array<Record<string, number>> = [];
    let syncSerial = 0,
      syncOverflow = 0,
      syncCostMs = 0;
    let lastResetAt = performance.now(),
      activeStream = 0;
    const observe = (kind: number, fields: Record<string, number> = {}) => {
      const started = performance.now(),
        id = ++syncSerial;
      if (syncEvents.length < 20000)
        syncEvents.push({ kind, id, at: started, ...fields });
      else syncOverflow++;
      syncCostMs += performance.now() - started;
      return id;
    };
    const attachSync = { run: async () => ({ client, core }) };
    const sync = new MainSync(
        store,
        () => attachSync.run(),
        (event) => {
          observe(10, {
            phase: event.phase,
            timerAt: event.at,
            delayMs: event.delayMs,
            aborted: event.aborted,
          });
        },
      ),
      outbox = new Outbox(store, async () => ({ client, core }));
    const watch = (target: any, name: string, kind: number) => {
      const original = target[name];
      target[name] = function (...args: any[]) {
        const id = observe(kind, { phase: 0 });
        if (kind === 3) activeStream = id;
        const end = (outcome: number, error?: unknown) => {
          const cause = String(error).includes("SYNC_OVERLOAD_CATCHUP_REQUIRED")
            ? 1
            : outcome && kind === 6
              ? 3
              : outcome
                ? 4
                : 0;
          observe(kind, {
            phase: 1,
            start: id,
            outcome,
            cause,
            aborted: (sync as any).stop.signal.aborted ? 1 : 0,
          });
        };
        try {
          const value = original.apply(this, args);
          // Observe settlement but return the original promise/value unchanged.
          if (value && typeof value.then === "function")
            value.then(
              () => end(0),
              (error: unknown) => end(1, error),
            );
          else end(0);
          return value;
        } catch (error) {
          end(1, error);
          throw error;
        }
      };
    };
    watch(attachSync, "run", 2);
    watch(sync, "readStream", 3);
    watch(client, "stream", 4);
    watch(sync, "catchup", 5);
    watch(sync, "refresh", 6);
    watch(sync, "persist", 7);
    const apply = (sync as any).apply;
    (sync as any).apply = function (...args: any[]) {
      try {
        return apply.apply(this, args);
      } catch (error) {
        if (String(error).includes("SYNC_OVERLOAD_CATCHUP_REQUIRED"))
          observe(1, {
            stream: activeStream,
            count: this.count,
            bytes: this.bytes,
            resetAt: lastResetAt,
            windowMs: performance.now() - lastResetAt,
          });
        throw error;
      }
    };
    for (const [name, kind] of [
      ["count", 8],
      ["bytes", 9],
    ] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(sync, name)!;
      assert.ok(
        descriptor.configurable && descriptor.writable && "value" in descriptor,
      );
      let value = descriptor.value;
      Object.defineProperty(sync, name, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get() {
          return value;
        },
        set(next: number) {
          const previous = value;
          value = next;
          if (next === 0) {
            const at = performance.now();
            observe(kind, {
              previous,
              count: (sync as any).count,
              bytes: (sync as any).bytes,
              windowMs: at - lastResetAt,
            });
            if (kind === 8) lastResetAt = at;
          }
        },
      });
    }
    outbox.connect(1);
    const input = new InputProtocol(() => store.editors.Main);
    const attempt: number[] = [],
      drafts: number[] = [],
      render: number[] = [];
    const update = store.update;
    store.update = async function (...args) {
      const begin = performance.now();
      const value = await update.apply(this, args);
      if (value.state === "ATTEMPTED") attempt.push(performance.now() - begin);
      return value;
    };
    // Observation only: retain real wire ids, not an op-name guess. Timestamps
    // have process-local origins; Python/Node absolute values are never subtracted.
    const trace: {
      requests: any[];
      transactions: any[];
      drafts: any[];
      overflow: number;
      recordingCostMs: number;
    } = {
      requests: [],
      transactions: [],
      drafts: [],
      overflow: 0,
      recordingCostMs: 0,
    };
    const retain = (items: any[], value: any) => {
      const started = performance.now();
      if (items.length < 20000) items.push(value);
      else trace.overflow++;
      trace.recordingCostMs += performance.now() - started;
    };
    const storeQueueMs: number[] = [],
      captureMs: number[] = [];
    let lastCaptureMs = 0,
      transactionSerial = 0,
      activeDraft: number | undefined,
      activeTransaction: number | undefined;
    const capture = (store as any).capture;
    (store as any).capture = function (...args: any[]) {
      const start = performance.now();
      const value = capture.apply(this, args);
      lastCaptureMs = performance.now() - start;
      captureMs.push(lastCaptureMs);
      return value;
    };
    const transaction = (store as any).transaction;
    (store as any).transaction = function (
      change: (...args: any[]) => any,
      ...metadata: any[]
    ) {
      const marker = {
        id: ++transactionSerial,
        draft: activeDraft,
        queued: performance.now(),
        started: undefined as number | undefined,
        completed: undefined as number | undefined,
      };
      retain(trace.transactions, marker);
      return transaction
        .call(
          this,
          (...args: any[]) => {
            marker.started = performance.now();
            activeTransaction = marker.id;
            storeQueueMs.push(
              Math.max(0, marker.started - marker.queued - lastCaptureMs),
            );
            return change(...args);
          },
          ...metadata,
        )
        .finally(() => {
          marker.completed = performance.now();
        });
    };
    const writerPhases: Record<
      string,
      { queue: number[]; execution: number[] }
    > = {};
    const byBody = new Map<object, any>(),
      byId = new Map<number, any>();
    const request = (writer as any).request;
    (writer as any).request = async function (
      body: { op: string },
      low: boolean,
      ...metadata: any[]
    ) {
      const marker = {
        op: body.op,
        queued: performance.now(),
        transaction: body.op === "commit" ? activeTransaction : undefined,
        dispatched: undefined as number | undefined,
        completed: undefined as number | undefined,
        outcome: "pending",
      };
      if (body.op === "commit") activeTransaction = undefined;
      retain(trace.requests, marker);
      byBody.set(body, marker);
      try {
        const value = await request.call(this, body, low, ...metadata);
        marker.outcome = "resolved";
        return value;
      } catch (error) {
        marker.outcome =
          error instanceof Error && error.message === "CHECKPOINT_COALESCED"
            ? "coalesced"
            : "rejected";
        throw error;
      } finally {
        marker.completed = performance.now();
        if (marker.dispatched !== undefined) {
          const phases = (writerPhases[marker.op] ??= {
            queue: [],
            execution: [],
          });
          phases.queue.push(marker.dispatched - marker.queued);
          phases.execution.push(marker.completed - marker.dispatched);
        }
        byBody.delete(body);
      }
    };
    const write = writer.child.stdin.write.bind(writer.child.stdin);
    writer.child.stdin.write = ((chunk: any, ...args: any[]) => {
      const body = JSON.parse(String(chunk));
      const marker = byBody.get((writer as any).current?.request);
      if (!marker) throw Error("TRACE_DISPATCH_WITHOUT_REQUEST");
      marker.id = body.id;
      marker.dispatched = performance.now();
      if (byId.size >= 20000) throw Error("TRACE_REQUEST_BOUND");
      byId.set(body.id, marker);
      return (write as any)(chunk, ...args);
    }) as typeof writer.child.stdin.write;
    let traceIncoming = "";
    writer.child.stdout.on("data", (chunk: Buffer) => {
      const arrived = performance.now();
      traceIncoming += chunk.toString("utf8");
      let newline: number;
      while ((newline = traceIncoming.indexOf("\n")) >= 0) {
        const reply = JSON.parse(traceIncoming.slice(0, newline));
        traceIncoming = traceIncoming.slice(newline + 1);
        const marker = byId.get(reply.id);
        if (marker) {
          marker.replyArrived = arrived;
          marker.replyCount = (marker.replyCount ?? 0) + 1;
        } else trace.overflow++; // Explicit coverage gap; never silently discard it.
      }
    });
    await sync.start();
    while (sync.stale) await new Promise((resolve) => setTimeout(resolve, 5));
    let checkpointMax = 0,
      failure: unknown;
    const begin = performance.now(),
      encoder = new TextEncoder();
    const burst = setInterval(() => {
      try {
        const target = Math.min(
          6000,
          Math.floor((performance.now() - begin) / 5),
        );
        while (emitted < target && controller) {
          seq++;
          emitted++;
          controller.enqueue(
            encoder.encode(
              `event: change\nid: ${seq}\ndata: ${JSON.stringify({ cursor: String(seq), changes: [{ kind: "invalidate", resource_type: "timeline", query: "timeline" }] })}\n\n`,
            ),
          );
        }
        checkpointMax = Math.max(checkpointMax, writer.checkpointQueue);
      } catch (error) {
        failure = error;
      }
    }, 5);
    try {
      let lastSend = 0;
      while (performance.now() - begin < 30000) {
        const before = performance.now();
        input.apply({
          type: "insert",
          revision: store.editors.Main.draft.revision,
          text: "字",
        });
        // Model publication latency; native/browser paint is a separate acceptance measurement.
        store.onChange();
        render.push(performance.now() - before);
        const save = performance.now();
        const draft = { id: drafts.length + 1, queued: save, completed: 0 };
        retain(trace.drafts, draft);
        activeDraft = draft.id;
        const saved = store.save();
        activeDraft = undefined;
        await saved;
        draft.completed = performance.now();
        drafts.push(draft.completed - save);
        if (performance.now() - lastSend > 1000) {
          lastSend = performance.now();
          const editor = store.editors.Main;
          await store.enqueue(
            "Main",
            editor.draft.nodes.map((n) => n.text).join(""),
            binding,
            editor.draft.revision,
          );
          outbox.kick();
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      await outbox.idle();
      const settleDeadline = performance.now() + 5000;
      while (
        ((sync as any).cursor !== "6000" ||
          (sync as any).durable?.cursor !== "6000" ||
          Object.keys((sync as any).dirty).length) &&
        performance.now() < settleDeadline
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
    } catch (error) {
      failure ??= error;
    } finally {
      clearInterval(burst);
      sync.close();
      outbox.close();
      const exit = once(writer.child, "exit");
      await store.close();
      await exit;
    }
    const disk = JSON.parse(
      fs.readFileSync(path.join(run, "fsync-metrics.json"), "utf8"),
    ) as {
      fsync: number[];
      sleep: number[];
      method: string;
      platform: string;
      python: string;
      sleepCpuMs: number;
      trace: {
        operations: any[];
        fsync: any[];
        overflow: number;
        recordingCostNs: number;
      };
    };
    const distribution = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        count: values.length,
        minMs: Math.min(...values),
        meanMs: values.reduce((a, b) => a + b, 0) / values.length,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        maxMs: Math.max(...values),
      };
    };
    const syncPairGaps = syncEvents
      .filter((x) => x.phase === 0 && x.kind !== 10)
      .filter(
        (begin) =>
          syncEvents.filter((end) => end.phase === 1 && end.start === begin.id)
            .length !== 1,
      ).length;
    const waitEvents = syncEvents.filter((x) => x.kind === 10);
    const syncWaitGaps =
      (waitEvents.length % 2) +
      waitEvents.filter(
        (event, index) =>
          event.phase !== index % 2 ||
          (index % 2 === 1 && event.delayMs !== waitEvents[index - 1].delayMs),
      ).length;
    const sorted = [...render].sort((a, b) => a - b),
      result = {
        durationMs: performance.now() - begin,
        emitted,
        samples: drafts.length,
        attemptSamples: attempt.length,
        draftMaxMs: Math.max(...drafts),
        attemptMaxMs: Math.max(...attempt),
        modelPublishP95Ms: sorted[Math.floor(sorted.length * 0.95)],
        modelPublishMaxMs: Math.max(...render),
        checkpointMax,
        syncRegime: {
          overloads: syncEvents.filter((x) => x.kind === 1),
          recurrenceObserved: syncEvents.filter((x) => x.kind === 1).length > 1,
          streamAttempts: syncEvents.filter(
            (x) => x.kind === 3 && x.phase === 0,
          ).length,
          actualOpens: syncEvents.filter(
            (x) => x.kind === 4 && x.phase === 1 && !x.outcome,
          ).length,
          resets: syncEvents.filter((x) => x.kind === 8).length,
          checkpoints: syncEvents
            .filter((x) => x.kind === 7 && x.phase === 1 && !x.outcome)
            .map((x) => x.at),
          reconnectWaits: syncEvents.filter((x) => x.kind === 10),
          overflow: syncOverflow,
          spanCoverageGaps: syncPairGaps,
          reconnectCoverageGaps: syncWaitGaps,
          recordingCostMs: syncCostMs,
          interpretation:
            "Numeric observations only. Recurrence means multiple observed overloads; ordered stream/reconnect events show context. Cause0 unknown/normal,1 directly observed overload,3 refresh failure,4 other error. Abort state is not an inferred watchdog/timer cause. Timer times exclude earlier checkpointWork wait. Costs are not subtracted.",
        },
        nativePaint: "NOT_TESTED",
        writerQos: writer.qos,
        finalCursor: (sync as any).cursor,
        finalDurableCursor: (sync as any).durable?.cursor,
        finalDirty: (sync as any).dirty,
        businessQueue: distribution(storeQueueMs),
        capture: distribution(captureMs),
        writerPhases: Object.fromEntries(
          Object.entries(writerPhases).map(([op, phases]) => [
            op,
            {
              queue: distribution(phases.queue),
              execution: distribution(phases.execution),
            },
          ]),
        ),
        realFsync: distribution(disk.fsync),
        injectedSleep: distribution(disk.sleep),
        delayCalibration: {
          method: disk.method,
          platform: disk.platform,
          python: disk.python,
          cpuMs: disk.sleepCpuMs,
        },
      };
    fs.writeFileSync(
      path.join(run, "metrics.json"),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    // Hosted runners discard the working directory; retain numeric first-failure evidence in CI logs.
    console.log(JSON.stringify({ issue82Responsiveness: result }));
    const firstObservedId = Math.min(...byId.keys());
    const startupHelperIds = disk.trace.operations
      .filter((value) => value.id < firstObservedId)
      .map((value) => value.id);
    const diagnostic = {
      node: trace,
      sync: syncEvents,
      helper: disk.trace,
      startupHelperIds,
      interpretation:
        "Recording costs measure bookkeeping only, not all wrapper overhead. Startup helper ids precede Node instrumentation. Separate clock origins. Helper phases overlap. Node execution minus helper duration is combined communication/scheduling residual, not one-way pipe time. No costs are subtracted from acceptance.",
    };
    fs.writeFileSync(
      path.join(run, "request-trace.json"),
      JSON.stringify(diagnostic),
      { mode: 0o600 },
    );
    // Bounded per-record output survives runner disposal and failure; numeric only.
    for (const record of syncEvents)
      console.log(JSON.stringify({ issue82Sync: record }));
    for (const record of trace.requests)
      console.log(JSON.stringify({ issue82Request: record }));
    for (const record of trace.transactions)
      console.log(JSON.stringify({ issue82Transaction: record }));
    for (const record of trace.drafts)
      console.log(JSON.stringify({ issue82Draft: record }));
    for (const record of disk.trace.operations)
      console.log(JSON.stringify({ issue82Helper: record }));
    for (const record of disk.trace.fsync)
      console.log(JSON.stringify({ issue82Fsync: record }));
    console.log(
      JSON.stringify({
        issue82TraceCoverage: {
          nodeOverflow: trace.overflow,
          helperOverflow: disk.trace.overflow,
          nodeRecordingCostMs: trace.recordingCostMs,
          helperRecordingCostNs: disk.trace.recordingCostNs,
          startupHelperIds,
          interpretation: diagnostic.interpretation,
        },
      }),
    );
    assert.equal(syncOverflow, 0);
    const syncBegins = new Map(
      syncEvents
        .filter((x) => x.phase === 0 && x.kind !== 10)
        .map((x) => [x.id, x]),
    );
    const syncEnds = syncEvents.filter((x) => x.phase === 1 && x.kind !== 10);
    assert.equal(syncEnds.length, syncBegins.size, "C5 span coverage gap");
    for (const end of syncEnds) {
      const begin = syncBegins.get(end.start);
      assert.ok(begin && begin.kind === end.kind && begin.at <= end.at);
      syncBegins.delete(end.start);
    }
    assert.equal(syncBegins.size, 0);
    const waits = syncEvents.filter((x) => x.kind === 10);
    assert.equal(waits.length % 2, 0, "C5 reconnect coverage gap");
    for (let i = 0; i < waits.length; i += 2) {
      assert.equal(waits[i].phase, 0);
      assert.equal(waits[i + 1].phase, 1);
      assert.equal(waits[i].delayMs, waits[i + 1].delayMs);
      assert.ok(waits[i].timerAt <= waits[i + 1].timerAt);
    }
    assert.equal(
      syncEvents.filter((x) => x.kind === 8).length,
      syncEvents.filter((x) => x.kind === 9).length,
    );
    assert.equal(trace.overflow, 0);
    assert.equal(disk.trace.overflow, 0);
    assert.equal(disk.trace.fsync.length, disk.sleep.length);
    const helperIds = new Map(
      disk.trace.operations.map((record) => [record.id, record]),
    );
    assert.equal(helperIds.size, disk.trace.operations.length);
    assert.equal(
      disk.trace.operations.filter((value) => value.id >= firstObservedId)
        .length,
      byId.size,
    );
    for (const operation of disk.trace.operations) {
      for (const key of [
        "receivedNs",
        "startedNs",
        "processedNs",
        "flushedNs",
        "cpuNs",
      ])
        assert.ok(Number.isSafeInteger(operation[key]) && operation[key] >= 0);
    }
    for (const marker of trace.requests) {
      assert.ok(marker.completed >= marker.queued);
      if (marker.id === undefined) {
        assert.equal(marker.outcome, "coalesced");
        assert.equal(marker.dispatched, undefined);
        continue;
      }
      assert.equal(marker.replyCount, 1);
      assert.ok(
        marker.queued <= marker.dispatched &&
          marker.dispatched <= marker.replyArrived &&
          marker.replyArrived <= marker.completed,
      );
      const helper = helperIds.get(marker.id);
      assert.ok(helper && helper.op === marker.op);
      assert.ok(
        helper.receivedNs <= helper.startedNs &&
          helper.startedNs <= helper.processedNs &&
          helper.processedNs <= helper.flushedNs,
      );
      if (marker.op === "checkpoint")
        assert.equal(
          disk.trace.fsync.filter((value) => value.id === marker.id).length,
          4,
        );
    }
    for (const draft of trace.drafts) {
      const transactions = trace.transactions.filter(
        (value) => value.draft === draft.id,
      );
      assert.equal(transactions.length, 1);
      const transaction = transactions[0];
      assert.ok(
        draft.queued <= transaction.queued &&
          transaction.queued <= transaction.started &&
          transaction.started <= transaction.completed &&
          transaction.completed <= draft.completed,
      );
      assert.equal(
        trace.requests.filter((value) => value.transaction === transaction.id)
          .length,
        1,
      );
    }
    for (const sample of disk.trace.fsync) {
      assert.ok(
        sample.beginNs <= sample.sleptNs && sample.sleptNs <= sample.endNs,
      );
      if (sample.id !== null) {
        const operation = helperIds.get(sample.id);
        assert.ok(
          operation &&
            operation.startedNs <= sample.beginNs &&
            sample.endNs <= operation.processedNs,
        );
      }
    }
    assert.ok(disk.sleep.length > 0, JSON.stringify(result));
    assert.equal(disk.sleep.length, disk.fsync.length, JSON.stringify(result));
    assert.ok(
      disk.sleep.every((ms) => ms >= 20),
      JSON.stringify(result),
    );
    assert.equal(failure, undefined);
    assert.equal(emitted, 6000);
    assert.equal(result.finalCursor, "6000", JSON.stringify(result));
    assert.equal(result.finalDurableCursor, "6000", JSON.stringify(result));
    assert.deepEqual(result.finalDirty, {}, JSON.stringify(result));
    assert.ok(attempt.length >= 20, JSON.stringify(result));
    assert.ok(result.draftMaxMs <= 500, JSON.stringify(result));
    assert.ok(result.attemptMaxMs <= 500, JSON.stringify(result));
    assert.ok(
      result.modelPublishP95Ms <= 100 && result.modelPublishMaxMs <= 250,
    );
    assert.ok(checkpointMax <= 1);
  },
);
