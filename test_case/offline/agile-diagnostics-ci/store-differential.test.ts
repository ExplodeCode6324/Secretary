// @ts-nocheck -- CI-only real Store differential; excluded from the local file-only test glob.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fixture } from "../agile-diagnostics/fixtures.mjs";
import { readSnapshot } from "../../../scripts/agile-diagnostics/snapshot-reader.mjs";
import { usageReport } from "../../../scripts/agile-diagnostics/reports.mjs";
import { sha } from "../../../scripts/agile-diagnostics/io.mjs";
import path from "node:path";
test(
  "CI real Store journal and read-only projection agree after model call revisions/reopen",
  { skip: !process.env.CI },
  async () => {
    const { Store, base, revise } =
      await import("../../../src/pi_secretary/src/store.ts");
    const f = fixture();
    let store;
    try {
      store = await Store.open(f.core);
      const c = f.make("ModelCall", {
          state: "PREPARED",
          response: null,
          started_at: null,
          completed_at: null,
          error: null,
          logical_key: "1".repeat(64),
        }),
        ctx = f.make("Context", { id: c.context_id });
      const ctx2 = f.make("Context");
      store.commit(
        [ctx, ctx2, c],
        [f.event("model.payload", { call_id: c.id, synthetic: true })],
      );
      store.commit([revise(ctx, {})]);
      const started = revise(c, {
        state: "IN_FLIGHT",
        started_at: new Date().toISOString(),
      });
      store.commit([started]);
      const complete = revise(started, {
        state: "RESPONSE_SAVED",
        response: store.put({
          model: "synthetic",
          provider: "fixture",
          usage: { input: 4, output: 2, totalTokens: 6 },
        }),
        completed_at: new Date().toISOString(),
      });
      store.commit([complete]);
      await store.close();
      store = await Store.open(f.core);
      const expected = store.all("ModelCall"),
        contexts = store.all("Context"),
        events = store.events("model.payload"),
        sequence = store.sequence,
        digest = store.digest;
      await store.close();
      store = undefined;
      const b = fs.readFileSync(path.join(f.core, "journal.jsonl"));
      f.seal(); // Replace helper's synthetic initial frame below with original Store bytes.
      fs.writeFileSync(path.join(f.core, "journal.jsonl"), b);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(f.root, "manifest.json")),
      );
      manifest.journal = { sha256: sha(b), bytes: b.length, sequence, digest };
      manifest.as_of = new Date().toISOString();
      fs.writeFileSync(
        path.join(f.root, "manifest.json"),
        JSON.stringify(manifest),
      );
      const s = await readSnapshot(f.root);
      assert.deepEqual(s.all("ModelCall"), expected);
      assert.deepEqual(s.all("Context"), contexts);
      assert.deepEqual(s.events, events);
      assert.equal(
        s.frames.get(1),
        JSON.parse(b.toString().split("\n")[0]).sha256,
      );
      assert.equal(s.metrics().sequence, sequence);
      const report = usageReport(s);
      assert.equal(report.payload_prepared_count, 1);
      assert.equal(report.attempts, 1);
      assert.equal(report.saved_successes, 1);
      assert.equal(report.usage.input.sum, 4);
    } finally {
      await store?.close();
      f.cleanup();
    }
  },
);
