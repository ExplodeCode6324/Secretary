import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Issue84Budget, wireBound } from "../../online/issue84-budget.ts";
import { totals, estimatedCost } from "../../online/issue84-usage.ts";
import { hash } from "../../../src/pi_secretary/src/store.ts";
const wire = () =>
  wireBound(
    JSON.stringify({
      model: "deepseek-flash",
      stream: true,
      max_tokens: 8192,
      messages: [{ role: "user", content: "synthetic" }],
    }),
  );

test("observe removes cumulative quotas but preserves policy and usage integrity", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-observe-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const b = new Issue84Budget(path.join(dir, "usage.json"), false, "observe");
  for (let i = 0; i < 125; i++) {
    const a = b.admit("main", wire(), []);
    b.end(a, a.started + 120_000, "observed");
  }
  b.state.attempts[0].started -= 8_000_000;
  b.state.attempts[0].nanoUSD = 6_000_000_000;
  const a = b.admit("main", wire(), []);
  b.tools("main", Array(12).fill("task_propose"), a);
  assert.throws(() => b.tools("task", ["bash"], a), /TOOLS_OR_PROPOSALS/);
  const usage = {
    input: 100,
    cacheRead: 200,
    cacheWrite: 0,
    output: 50,
    reasoning: 40,
    totalTokens: 350,
    cost: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 },
  };
  b.finish(a, a.started + 1, "response", 300, 50, usage);
  const report = totals(b.state.attempts);
  assert.equal(report.physicalRequests, 126);
  assert.equal(report.unknownUsageRequests, 125);
  assert.equal(report.reportedInput, 300);
  assert.equal(report.reportedOutput, 50);
  assert.equal(report.cacheRead, 200);
  assert.equal(report.reasoningWithinOutput, 40);
  const cost = estimatedCost({
    ...a,
    started: Date.parse("2026-11-05T14:00:00Z"),
  })!;
  assert.equal(cost.timestampEstimateUSD, cost.peakUSD / 2);
  assert.throws(
    () => new Issue84Budget(b.file, true, "bounded"),
    /POLICY_CHANGED/,
  );
  b.advance("vision");
  assert.equal(
    new Issue84Budget(b.file, true, "observe").state.attempts.length,
    126,
  );
});

test("refused proposals remain generated under the historical bounded policy", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-generated-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const b = new Issue84Budget(path.join(dir, "usage.json"), false);
  b.advance("vision");
  b.advance("shared");
  const a = b.admit("main", wire(), []);
  assert.throws(
    () => b.tools("main", ["task_propose", "task_propose"], a, false),
    /TOOLS_OR_PROPOSALS/,
  );
  assert.throws(
    () => b.tools("main", ["task_propose", "task_propose"], a),
    /TOOLS_OR_PROPOSALS/,
  );
  assert.equal(b.state.batches.flatMap((b) => b.names).length, 4);
});

test("history import verifies frozen files, retains failed batches, and rejects unfinished attempts", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-import-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const old = new Issue84Budget(path.join(dir, "old.json"), false);
  const a = old.admit("main", wire(), []);
  assert.throws(() => old.tools("main", ["task_propose"], a, false));
  const files = [
    old.file,
    ...Array.from({ length: 4 }, (_, i) => path.join(dir, `evidence${i}.json`)),
  ];
  for (const file of files.slice(1)) fs.writeFileSync(file, "{}");
  const freeze = () => {
    const bytes = JSON.stringify({
      head: "synthetic-old",
      ledger: old.file,
      evidence: files.map((file) => ({
        path: file,
        sha256: hash(fs.readFileSync(file)),
      })),
    });
    const file = path.join(dir, "frozen.json");
    fs.writeFileSync(file, bytes);
    return { path: file, sha256: hash(bytes) };
  };
  let history = freeze();
  assert.throws(
    () =>
      new Issue84Budget(path.join(dir, "new.json"), false, "observe", history),
    /HISTORY_ATTEMPT/,
  );
  old.end(a, a.started + 1, "observed");
  old.state.attempts.push(structuredClone(a));
  old.save(); // The same identified physical attempt is imported exactly once.
  history = freeze();
  const current = new Issue84Budget(
    path.join(dir, "new.json"),
    false,
    "observe",
    history,
  );
  assert.equal(current.state.attempts.length, 1);
  assert.equal(current.state.attempts[0].attemptId, a.attemptId);
  assert.equal(current.state.phase, "main");
  assert.equal(current.state.batches[0].admitted, false);
  assert.equal(current.state.provenance![0].policy, "bounded");
  assert.throws(
    () =>
      new Issue84Budget(path.join(dir, "bad.json"), false, "observe", {
        ...history,
        sha256: "wrong",
      }),
    /HISTORY_HASH/,
  );
  fs.writeFileSync(files[1], "changed");
  assert.throws(
    () =>
      new Issue84Budget(path.join(dir, "bad.json"), false, "observe", history),
    /HISTORY_EVIDENCE_CHANGED/,
  );
});
