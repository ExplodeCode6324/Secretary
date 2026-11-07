import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AcceptanceBudget } from "../../online/issue106-budget.ts";
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue106-budget-"));
  let time = 1000;
  const file = path.join(dir, "ledger.json");
  const b = new AcceptanceBudget(file, () => time);
  return {
    b,
    file,
    set: (n: number) => (time = n),
    clean: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
test("first explicit Master connect after automatic expiry gets full manual window, persisted restart/reconnect never resets it", () => {
  const x = setup();
  try {
    x.b.attempt("main");
    x.b.arm();
    x.set(9000000);
    assert.equal(x.b.expire(), false);
    assert.equal(x.b.value.phase, "ARMED_FOR_MASTER");
    x.b.connect(() => {});
    assert.equal(x.b.value.manual_deadline, 16200000);
    const started = x.b.value.manual_started_at;
    x.set(11000000);
    const restored = new AcceptanceBudget(x.file, () => 11000000);
    assert(restored.enabled());
    restored.connect(() => {
      throw Error("RECONNECT_NOT_INITIAL_RESERVE");
    });
    assert.equal(restored.value.manual_started_at, started);
    assert.equal(restored.value.manual_deadline, 16200000);
  } finally {
    x.clean();
  }
});
test("below handoff reserve and past 31 minutes remains active; actual physical cap refuses before transmission", () => {
  const x = setup();
  try {
    x.b.arm();
    x.b.connect(() => {});
    x.set(2000000);
    for (let i = 0; i < 65; i++) x.b.attempt(i % 2 ? "main" : "task");
    x.b.proposals(150);
    assert.throws(() => x.b.requireReserve(), /RESERVE/);
    x.b.connect(() => {});
    assert(x.b.enabled());
    for (let i = 65; i < 100; i++) x.b.attempt("task");
    assert.throws(() => x.b.attempt("main"), /REFUSED/);
    assert.equal(x.b.value.physical, 100);
    assert.equal(x.b.value.phase, "EXHAUSTED");
    const restored = new AcceptanceBudget(x.file, () => 2000000);
    assert.equal(restored.value.physical, 100);
  } finally {
    x.clean();
  }
});
test("sleep advances wall clock; extension and deadline/counters/event are one durable record", () => {
  const x = setup();
  try {
    x.b.arm();
    x.b.connect(() => {});
    x.set(8000000);
    assert(x.b.expire());
    assert.throws(() => x.b.connect(() => {}));
    x.b.extend({
      reason: "explicit test authorization",
      physical: 10,
      tools: 20,
      milliseconds: 3600000,
    });
    const disk = JSON.parse(fs.readFileSync(x.file, "utf8"));
    assert.equal(disk.phase, "ACTIVE");
    assert.equal(disk.manual_deadline, 11600000);
    assert.equal(disk.extensions.length, 1);
    assert.equal(disk.limits.physical, 110);
  } finally {
    x.clean();
  }
});
test("ARMED refuses out-of-band model attempts, records truthful evidence without starting manual clock", () => {
  const x = setup();
  try {
    x.b.arm();
    assert.throws(() => x.b.attempt("main"), /REFUSED/);
    assert.equal(x.b.value.physical, 0);
    assert.equal(x.b.value.manual_started_at, undefined);
    assert.equal(x.b.value.refusals[0].phase, "ARMED_FOR_MASTER");
  } finally {
    x.clean();
  }
});

test("late model proposals are charged durably even when execution is refused after deadline/exhaustion", () => {
  const x = setup();
  try {
    x.b.arm();
    x.b.connect(() => {});
    x.set(8000000);
    x.b.expire();
    assert.throws(() => x.b.proposals(3), /PHASE_CHANGED/);
    assert.equal(x.b.value.tools, 3);
    assert.equal(new AcceptanceBudget(x.file, () => 8000000).value.tools, 3);
  } finally {
    x.clean();
  }
});

test("corrupt phase/clock/counter ledger fails closed instead of resetting manual time or budget", () => {
  const x = setup();
  try {
    x.b.arm();
    x.b.connect(() => {});
    const original = JSON.parse(fs.readFileSync(x.file, "utf8"));
    for (const mutate of [
      (v: any) => (v.phase = "ARMED_FOR_MASTER"),
      (v: any) => delete v.manual_deadline,
      (v: any) => v.physical++,
      (v: any) => v.limits.physical++,
    ]) {
      const v = structuredClone(original);
      mutate(v);
      fs.writeFileSync(x.file, JSON.stringify(v));
      assert.throws(
        () => new AcceptanceBudget(x.file, () => 1000),
        /INVALID_BUDGET_LEDGER/,
      );
    }
  } finally {
    x.clean();
  }
});
