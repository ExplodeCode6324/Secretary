import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  recall,
  profiles,
  prepareRecall,
} from "../../../src/pi_secretary/src/world-recall.ts";
import { asOf, fid, recallFixture } from "./recall-fixture.ts";
const forbidden = ["old", "retracted", "future", "expired", "withdrawn"].map(
  fid,
);
const probes = [
  ...[
    "Alice",
    "alice",
    "小艾",
    "Bob",
    "小波",
    "Atlas",
    "星图",
    "Orion",
    "猎户",
    "Cedar",
  ].map((query, i) => ({
    category: "name",
    query,
    expected: [
      fid(
        [
          "tea",
          "tea",
          "tea",
          "quiet",
          "quiet",
          "atlas",
          "atlas",
          "orion",
          "orion",
          "cedar",
        ][i],
      ),
    ],
  })),
  ...[
    "Researcher",
    "researcher tea",
    "Researcher quiet",
    "Researcher forest",
  ].map((query) => ({
    category: "ambiguity",
    query,
    expected: [],
    ambiguous: true,
  })),
  ...["beverage", "focus", "map"].map((query, i) => ({
    category: "paraphrase",
    query,
    expected: [fid(["tea", "quiet", "atlas"][i])],
  })),
  ...["茶饮", "保密", "森林"].map((query, i) => ({
    category: "cross_language",
    query,
    expected: [fid(["tea", "atlas", "cedar"][i])],
  })),
  ...["Alice coffee", "Atlas publish"].map((query, i) => ({
    category: "negation",
    query,
    expected: [fid(["tea", "atlas"][i])],
  })),
  ...["Alice drinks", "Bob loud", "Alice superseded"].map((query) => ({
    category: "history",
    query,
    expected: [],
  })),
  ...["Alice future", "Bob expired", "Orion state"].map((query) => ({
    category: "time",
    query,
    expected: [],
  })),
  ...["Master English", "Master Chinese"].map((query) => ({
    category: "conflict",
    query,
    expected: [fid("conflict-a"), fid("conflict-b")],
  })),
  ...["Alice forests", "Atlas North"].map((query, i) => ({
    category: "onehop",
    query,
    expected: [fid(["cedar", "orion"][i])],
  })),
  ...[
    "zebra",
    "quantum mechanics",
    "weather tomorrow",
    "stock prices",
    "baking bread",
    "海洋潮汐",
    "太阳黑子",
    "volcano eruption",
  ].map((query) => ({ category: "empty", query, expected: [], empty: true })),
];
test("40 development retrieval probes preserve evidence, conflict groups and budgets", () => {
  assert.equal(probes.length, 40);
  const snapshot = recallFixture();
  for (const p of probes) {
    const r = recall(snapshot, p.query, {}, asOf);
    assert(r.bytes <= 1536, p.query);
    assert(!r.fact_ids.some((id) => forbidden.includes(id)), p.query);
    for (const id of p.expected)
      assert(r.fact_ids.includes(id), p.query + " missing " + id);
    if ("empty" in p) assert.equal(r.status, "no_hit", p.query);
    if ("ambiguous" in p)
      assert.equal(r.ambiguities[0]?.entity_ids.length, 2, p.query);
  }
});
test("profile keeps conflicting directives together and full negation is never truncated", () => {
  const snapshot = recallFixture(),
    p = profiles(snapshot, asOf);
  assert(
    p.fact_ids.includes(fid("conflict-a")) &&
      p.fact_ids.includes(fid("conflict-b")),
  );
  assert.match(p.text, /POSSIBLY-CONFLICTING/);
  const r = recall(snapshot, "Alice coffee", {}, asOf);
  assert.match(r.text, /does not drink coffee/);
  assert(!r.fact_ids.includes(fid("old")));
});
test("10000 facts bounded recall p95 below 50ms after index construction", () => {
  const snapshot = recallFixture(),
    sample = snapshot.facts[0];
  for (let i = 0; i < 10000; i++)
    snapshot.facts.push({
      ...sample,
      id: fid("load-" + i),
      subject_id: fid("Bob"),
      value: "Synthetic unrelated measurement " + i,
    });
  const start = performance.now();
  prepareRecall(snapshot);
  const buildMs = performance.now() - start,
    times: number[] = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    recall(snapshot, "Alice beverage", {}, asOf);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(
    JSON.stringify({
      fixture_facts: snapshot.facts.length,
      build_ms: buildMs,
      p95_ms: p95,
      rss: process.memoryUsage().rss,
      arch: process.arch,
      platform: process.platform,
    }),
  );
  assert(p95 <= 50, "p95=" + p95);
});
test("profile omits a whole conflict when source restrictions hide one member; oversized recall groups retain a pointer", () => {
  const snapshot = recallFixture();
  snapshot.facts.push({
    ...snapshot.facts.find((f) => f.id === fid("conflict-a"))!,
    id: fid("unsafe-inference"),
    source_kind: "MODEL_INFERENCE",
    value: "Untrusted alternative",
  });
  const profile = profiles(snapshot, asOf);
  assert(!profile.fact_ids.includes(fid("conflict-a")));
  assert(!profile.fact_ids.includes(fid("conflict-b")));
  assert.match(profile.text, /Omitted 3 rows/);
  const oversized = recallFixture();
  oversized.facts.find((f) => f.id === fid("conflict-a"))!.value =
    "Long qualified directive: " + "x".repeat(2000);
  const r = recall(oversized, "Master English", {}, asOf);
  assert(!r.fact_ids.includes(fid("conflict-b")));
  assert.match(r.text, /Omitted 2 rows/);
  assert(r.bytes <= 1536);
  assert.equal(r.status, "hit");
});
test("empty role profiles still expose host-owned Master and Secretary identities", () => {
  const snapshot = recallFixture();
  snapshot.facts = [];
  const p = profiles(snapshot, asOf);
  assert.match(p.text, /MASTER derived profile: Master/);
  assert.match(p.text, /SECRETARY derived profile: Secretary/);
  assert.deepEqual(p.fact_ids, []);
});
