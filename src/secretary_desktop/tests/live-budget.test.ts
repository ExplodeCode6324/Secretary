import test from "node:test";
import assert from "node:assert/strict";
import { LiveBudget } from "../scripts/live-budget";
test("provider starts serialize, retries/background share caps, and deadlines reject before spend", async () => {
  const b = new LiveBudget({
    scenarioCalls: 2,
    totalCalls: 3,
    scenarioMs: 1000,
    totalMs: 2000,
    spacingMs: 15,
  });
  const a = await b.enter("a");
  let entered = false;
  const p = b.enter("a").then((v) => {
    entered = true;
    return v;
  });
  await new Promise((r) => setTimeout(r, 5));
  assert(!entered);
  a.release();
  const second = await p;
  assert.equal(second.number, 2);
  second.release();
  await assert.rejects(b.enter("a"), /EXHAUSTED/);
  const third = await b.enter("background");
  third.release();
  await assert.rejects(b.enter("retry"), /EXHAUSTED/);
  const expired = new LiveBudget({
    scenarioCalls: 2,
    totalCalls: 3,
    scenarioMs: 1,
    totalMs: 1,
    spacingMs: 0,
  });
  await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(expired.enter("a"), /EXHAUSTED/);
});
test("restoring a ledger cannot reset spend, spacing or scenario deadline", async () => {
  const limits = {
    scenarioCalls: 2,
    totalCalls: 2,
    scenarioMs: 1000,
    totalMs: 2000,
    spacingMs: 0,
  };
  const origin = Date.now();
  const history = [
    {
      run_started_at: origin,
      scenario: "a",
      started_at: new Date().toISOString(),
      deadline: Date.now() + 1000,
    },
    {
      run_started_at: origin,
      scenario: "a",
      started_at: new Date().toISOString(),
      deadline: Date.now() + 1000,
    },
  ];
  await assert.rejects(
    new LiveBudget(limits, history).enter("new"),
    /EXHAUSTED/,
  );
  await assert.rejects(
    new LiveBudget({ ...limits, totalCalls: 3 }, history).enter("a"),
    /EXHAUSTED/,
  );
  await assert.rejects(
    new LiveBudget(limits, [
      {
        run_started_at: Date.now() - 3000,
        scenario: "a",
        started_at: new Date(Date.now() - 2000).toISOString(),
        deadline: Date.now() - 1,
      },
    ]).enter("a"),
    /EXHAUSTED/,
  );
});
test("restored global deadline includes startup before the first provider call", async () => {
  const limits = {
    scenarioCalls: 12,
    totalCalls: 48,
    scenarioMs: 1000,
    totalMs: 100,
    spacingMs: 0,
  };
  const origin = Date.now() - 200;
  const history = [
    {
      scenario: "a",
      run_started_at: origin,
      started_at: new Date(Date.now() - 10).toISOString(),
      deadline: Date.now() + 500,
    },
  ];
  const b = new LiveBudget(limits, history);
  assert.equal(b.started, origin);
  await assert.rejects(b.enter("new"), /EXHAUSTED/);
  assert.throws(
    () =>
      new LiveBudget(limits, [
        { ...history[0], run_started_at: undefined as any },
      ]),
    /LEDGER_ORIGIN/,
  );
});
test("an interrupted preflight with no calls still retains the global deadline", async () => {
  const limits = {
    scenarioCalls: 12,
    totalCalls: 48,
    scenarioMs: 1000,
    totalMs: 100,
    spacingMs: 0,
  };
  await assert.rejects(
    new LiveBudget(limits, [], Date.now() - 200).enter("a"),
    /EXHAUSTED/,
  );
});
