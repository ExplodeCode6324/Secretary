import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Issue84Budget, wireBound } from "../../online/issue84-budget.ts";

const sample = (content = "isolated synthetic prompt") =>
  JSON.stringify({
    model: "deepseek-flash",
    stream: true,
    max_tokens: 8192,
    messages: [{ role: "user", content }],
  });

test("abandoned provider attempts retain the full reservation after reopen", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-budget-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "ledger.json");
  const wire = wireBound(sample());
  const budget = new Issue84Budget(file, false);
  assert.throws(() => budget.admit("task", wire, []), /PATH_CALLS/);
  budget.admit("main", wire, ["synthetic-input"]);
  const resumed = new Issue84Budget(file, true);
  assert.equal(resumed.state.attempts[0].ms, 120_000);
  for (let i = 0; i < 7; i++) {
    const attempt = resumed.admit("main", wire, [], "summary");
    resumed.end(attempt, attempt.started + 1, "observed_http_error");
  }
  assert.throws(() => resumed.admit("main", wire, []), /PATH_CALLS/);
  assert.throws(() => resumed.advance("redo"), /PHASE_ORDER/);
  resumed.releaseReserve();
  const attempt = resumed.admit("main", wire, []);
  assert.equal(attempt.phase, "reserve");
  assert.throws(
    () => resumed.tools("task", ["bash"], attempt),
    /TOOLS_OR_PROPOSALS/,
  );
  assert.equal(resumed.state.batches[0].admitted, false);
  assert.throws(
    () =>
      resumed.finish(
        attempt,
        attempt.started + 1,
        "synthetic-response",
        wire.input + 1,
        1,
      ),
    /UNVERIFIED_PROVIDER_USAGE/,
  );
  assert.throws(
    () => new Issue84Budget(file, true).admit("main", wire, []),
    /HALTED/,
  );
});

test("three concurrent requests reserve globally; observed errors release time but retain cost", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "issue84-concurrent-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const b = new Issue84Budget(path.join(directory, "ledger.json"), false);
  b.advance("vision");
  b.advance("shared");
  const attempts = [
    b.admit("task", wireBound(sample()), []),
    b.admit("task", wireBound(sample()), []),
    b.admit("main", wireBound(sample()), []),
  ];
  assert.equal(
    attempts.reduce((n, a) => n + a.ms, 0),
    360_000,
  );
  assert.throws(() => b.advance("matters"), /UNFINISHED_ATTEMPTS/);
  const cost = attempts[0].nanoUSD;
  for (const a of attempts) b.end(a, a.started + 25, "http_error");
  assert.equal(attempts[0].ms, 25);
  assert.equal(attempts[0].nanoUSD, cost);
  b.advance("matters");
  assert.equal(new Issue84Budget(b.file, true).state.phase, "matters");
});

test("phase boundary protects future allocations even when current call capacity remains", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-future-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const b = new Issue84Budget(path.join(directory, "ledger.json"), false);
  for (let i = 0; i < 2; i++) {
    const a = b.admit("main", wireBound(sample()), []);
    b.end(a, a.started + 100_000, "http_error");
  }
  assert.throws(() => b.advance("vision"), /FUTURE_PATH_TIME/);
  assert.equal(b.state.phase, "main");
});

test("wire accounting refuses unsupported destinations embedded as image URLs and oversize payloads", () => {
  const text = JSON.parse(sample());
  text.messages[0].content = [
    { type: "image_url", image_url: { url: "https://example.test/photo.png" } },
  ];
  assert.throws(() => wireBound(JSON.stringify(text)), /INVALID_IMAGE_BLOCK/);
  assert.throws(() => wireBound(sample("中".repeat(34_000))), /WIRE_INPUT/);
  assert.throws(
    () => wireBound(sample().replace("8192", "8193")),
    /WIRE_SHAPE/,
  );
});

test("normal Main calls preserve two maintenance slots; restart closes unknown holds without reducing exposure", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-recovery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const b = new Issue84Budget(path.join(directory, "ledger.json"), false);
  for (let i = 0; i < 6; i++) {
    const a = b.admit("main", wireBound(sample()), []);
    b.end(a, a.started + 1, "observed");
  }
  assert.throws(
    () => b.admit("main", wireBound(sample()), []),
    /MAINTENANCE_HEADROOM/,
  );
  const unknown = b.admit("main", wireBound(sample()), [], "summary");
  const reservation = unknown.nanoUSD;
  const r = new Issue84Budget(b.file, true);
  assert.equal(r.state.attempts.at(-1)!.termination, "unknown_after_restart");
  assert.equal(r.state.attempts.at(-1)!.ms, 120_000);
  assert.equal(r.state.attempts.at(-1)!.nanoUSD, reservation);
  r.advance("vision");
  assert.equal(r.state.phase, "vision");
});

test("observed timeout handling latency is recorded without adding a competing deadline", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-timeout-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const b = new Issue84Budget(path.join(directory, "ledger.json"), false);
  const a = b.admit("main", wireBound(sample()), []);
  const cost = a.nanoUSD;
  b.end(a, a.started + 120_005, "Core_timeout");
  assert.equal(a.ms, 120_000);
  assert.equal(a.observedMs, 120_005);
  assert.equal(a.nanoUSD, cost);
  assert.equal(b.state.halted, null);
});

test("final native handoff reuses the original vision balance and cannot restart phase allocations", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-native-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const b = new Issue84Budget(path.join(directory, "ledger.json"), false);
  b.advance("vision");
  const a = b.admit("main", wireBound(sample()), []);
  b.end(a, a.started + 1, "observed");
  b.advance("shared");
  b.advance("matters");
  b.advance("redo");
  b.revisitNativeVision();
  assert.equal(b.state.attempts.length, 1);
  for (let i = 0; i < 3; i++) {
    const next = b.admit("main", wireBound(sample()), []);
    b.end(next, next.started + 1, "observed");
  }
  assert.throws(
    () => b.admit("main", wireBound(sample()), []),
    /MAINTENANCE_HEADROOM/,
  );
  assert.throws(() => b.advance("shared"), /FINAL_NATIVE_ONLY/);
});
