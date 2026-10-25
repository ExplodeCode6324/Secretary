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
          "import sys\nimport time\nreal_fsync = os.fsync\ndef delayed_fsync(fd):\n    time.sleep(0.020)\n    return real_fsync(fd)\nos.fsync = delayed_fsync",
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
    const sync = new MainSync(store, async () => ({ client, core })),
      outbox = new Outbox(store, async () => ({ client, core }));
    outbox.connect(1);
    const input = new InputProtocol(() => store.editors.Main);
    const attempt: number[] = [],
      drafts: number[] = [],
      render: number[] = [];
    const update = store.update.bind(store);
    store.update = async (...args) => {
      const begin = performance.now();
      const value = await update(...args);
      if (value.state === "ATTEMPTED") attempt.push(performance.now() - begin);
      return value;
    };
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
        await store.save();
        drafts.push(performance.now() - save);
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
    } finally {
      clearInterval(burst);
      sync.close();
      outbox.close();
      const exit = once(writer.child, "exit");
      await store.close();
      await exit;
    }
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
        nativePaint: "NOT_TESTED",
      };
    fs.writeFileSync(
      path.join(run, "metrics.json"),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    assert.equal(failure, undefined);
    assert.equal(emitted, 6000);
    assert.ok(attempt.length >= 20);
    assert.ok(result.draftMaxMs <= 500, JSON.stringify(result));
    assert.ok(result.attemptMaxMs <= 500, JSON.stringify(result));
    assert.ok(
      result.modelPublishP95Ms <= 100 && result.modelPublishMaxMs <= 250,
    );
    assert.ok(checkpointMax <= 1);
  },
);
