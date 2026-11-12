import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { recall } from "../../../src/pi_secretary/src/world-recall.ts";
import { recallFixture, asOf, fid } from "./recall-fixture.ts";
const fixture = JSON.parse(
  fs.readFileSync(new URL("./heldout.json", import.meta.url), "utf8"),
);
test("40 fixed held-out probes after policy freeze: categorical gates and retrieval metrics", () => {
  assert.equal(fixture.probes.length, 40);
  const snapshot = recallFixture(),
    forbidden = ["old", "retracted", "future", "expired", "withdrawn"].map(fid),
    metrics: Record<
      string,
      {
        cases: number;
        passed: number;
        tp: number;
        returned: number;
        expected: number;
        bytes: number;
        latency_ms: number;
      }
    > = {};
  for (const p of fixture.probes) {
    const start = performance.now(),
      r = recall(snapshot, p.query, {}, asOf),
      ms = performance.now() - start,
      expected = p.expected.map(fid);
    assert(r.bytes <= 1536, p.query);
    assert.equal(Buffer.byteLength(r.text), r.bytes);
    assert(!r.fact_ids.some((id) => forbidden.includes(id)), p.query);
    for (const h of r.hits) if (h.stale) assert.match(r.text, /STALE as of/);
    const pass =
      expected.every((id: string) => r.fact_ids.includes(id)) &&
      (!p.ambiguity ||
        r.ambiguities.some((a) => a.entity_ids.length === p.ambiguity)) &&
      (!p.text || r.text.includes(p.text)) &&
      (!p.stale || r.hits.some((h) => h.fact_id === fid(p.stale) && h.stale)) &&
      (!p.empty || r.status === "no_hit");
    const m = (metrics[p.category] ??= {
      cases: 0,
      passed: 0,
      tp: 0,
      returned: 0,
      expected: 0,
      bytes: 0,
      latency_ms: 0,
    });
    m.cases++;
    m.passed += Number(pass);
    m.tp += r.fact_ids.filter((id) => expected.includes(id)).length;
    m.returned += r.fact_ids.length;
    m.expected += expected.length;
    m.bytes += r.bytes;
    m.latency_ms += ms;
    console.log(
      JSON.stringify({
        query: p.query,
        category: p.category,
        pass,
        expected_ids: expected,
        returned_ids: r.fact_ids,
        status: r.status,
        bytes: r.bytes,
        latency_ms: ms,
      }),
    );
  }
  const report = Object.fromEntries(
    Object.entries(metrics).map(([c, m]) => [
      c,
      {
        ...m,
        precision_at_k: m.returned ? m.tp / m.returned : null,
        recall_at_k: m.expected ? m.tp / m.expected : null,
      },
    ]),
  );
  console.log(
    "HELDOUT_METRICS " +
      JSON.stringify({
        freeze: fixture.policy_freeze_commit,
        K: "actual returned rows, capped at 12",
        metrics: report,
        arch: process.arch,
        platform: process.platform,
      }),
  );
  assert(metrics.name.passed >= 9);
  assert(metrics.empty.passed >= 7);
  for (const c of [
    "ambiguity",
    "negation",
    "history",
    "time",
    "conflict",
    "onehop",
  ])
    assert.equal(metrics[c].passed, metrics[c].cases, c);
});
