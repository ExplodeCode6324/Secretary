import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  Input,
  WakeTimer,
} from "../../../src/pi_secretary/src/contracts.ts";
import { inputMessage } from "../../../src/pi_secretary/src/input-projection.ts";

test("wakeup validates dates, source, note and capacity; pending-only scans and failure isolation", () =>
  fixture(async (f) => {
    const w = f.app.host.wakeups,
      sources = f.source();
    for (const at of [
      "2026-02-30T00:00:00Z",
      "2030-01-01T00:00:00",
      "invalid",
      new Date(f.time).toISOString(),
    ])
      assert.throws(
        () => w.schedule(id(), { ...f.args(), at }, sources),
        /INVALID_WAKEUP_TIME/,
      );
    for (const note of [" ", "😀".repeat(1025)])
      assert.throws(
        () => w.schedule(id(), { ...f.args(), note }, sources),
        /INVALID_WAKEUP_NOTE/,
      );
    assert.throws(
      () => w.schedule(id(), f.args(), []),
      /WAKEUP_SOURCE_REQUIRED/,
    );
    assert.throws(
      () => w.schedule(id(), f.args(), [id()]),
      /INVALID_WAKEUP_SOURCE/,
    );
    const call = id(),
      args = { ...f.args(), note: "😀".repeat(1024) };
    const timer = w.schedule(call, args, sources);
    f.time += 2000;
    assert.deepEqual(w.schedule(call, args, []), timer); // Replay precedes future-time/source checks.
    w.fireDue();
    assert.equal(w.get(timer.timer_id).state, "FIRED");
    assert.deepEqual(w.recovered("schedule_wakeup", call, args), timer); // Original PENDING receipt.
    for (let n = 0; n < 100; n++) w.schedule(id(), f.args(), sources);
    assert.throws(
      () => w.schedule(id(), f.args(), sources),
      /WAKEUP_LIMIT_EXCEEDED/,
    );
    const pending = f.app.store
      .all<WakeTimer>("WakeTimer")
      .filter((t) => t.state === "PENDING");
    for (const t of pending) w.cancel(t.id);
    w.schedule(id(), f.args(), sources);
    const all = f.app.store.all.bind(f.app.store);
    let scans = 0;
    f.app.store.all = ((type: string) => {
      if (type === "WakeTimer") scans++;
      return all(type as never);
    }) as typeof f.app.store.all;
    for (let n = 0; n < 20; n++) {
      w.fireDue();
      w.hasDue();
    }
    assert.equal(scans, 0);
    await f.restart();
    assert.equal(
      f.app.store
        .all<WakeTimer>("WakeTimer")
        .filter((t) => t.state === "PENDING").length,
      1,
    );
  }));

test("wakeup atomically queues one sourced TIMER input; due/restart/cancel races and terminal guards", () =>
  fixture(async (f) => {
    const w = f.app.host.wakeups,
      sources = f.source();
    const cancelled = w.schedule(id(), f.args(), sources);
    w.cancel(cancelled.timer_id);
    const timer = w.schedule(id(), f.args(), sources);
    f.time += 2000;
    const commit = f.app.store.commit.bind(f.app.store);
    f.app.store.commit = () => {
      throw Error("synthetic commit failure");
    };
    assert.throws(() => w.fireDue(), /synthetic commit failure/);
    f.app.store.commit = commit;
    assert.equal(w.get(timer.timer_id).state, "PENDING");
    assert(w.hasDue());
    w.fireDue();
    w.fireDue();
    const inputs = f.app.store
      .all<Input>("Input")
      .filter((i) => i.producer === "TIMER");
    assert.equal(inputs.length, 1);
    const payload = f.app.store.bytes(inputs[0].payload).toString();
    assert.match(payload, /not a new Master instruction/);
    assert.match(payload, /"late_by_ms":1000/);
    assert.equal(inputMessage(f.app.store, inputs[0]).content, payload);
    const frame = f.app.store.projectionFrames.find((f) =>
      f.mutations.some(
        (m) => m.object_type === "Input" && m.object_id === inputs[0].id,
      ),
    )!;
    assert(
      frame.mutations.some(
        (m) => m.object_type === "WakeTimer" && m.object_id === timer.timer_id,
      ),
    );
    assert(
      frame.log_records.some(
        (e) => e.event_type === "input.accepted" && e.actor === "HOST",
      ),
    );
    assert.equal(w.cancel(timer.timer_id).state, "FIRED");
    assert.throws(
      () =>
        f.app.store.commit([
          revise(w.get(timer.timer_id), { state: "PENDING" }),
        ]),
      /INVALID_WAKEUP_TRANSITION/,
    );
    const call = id();
    const original = w.cancel(cancelled.timer_id, call);
    assert(f.app.store.hasReceipt(call));
    await f.restart();
    assert.deepEqual(
      f.app.host.wakeups.cancel(cancelled.timer_id, call),
      original,
    );
    f.app.host.wakeups.fireDue();
    assert.equal(
      f.app.store.all<Input>("Input").filter((i) => i.producer === "TIMER")
        .length,
      1,
    );
  }));

test("clock moves backward/forward; settle does not wait for future timers; source/state invariants", () =>
  fixture(async (f) => {
    const sources = f.source(),
      w = f.app.host.wakeups;
    const t = w.schedule(id(), f.args(), sources);
    f.time -= 10000;
    w.fireDue();
    assert.equal(w.get(t.timer_id).state, "PENDING");
    await f.app.settle();
    assert.equal(w.get(t.timer_id).state, "PENDING");
    assert.throws(
      () =>
        f.app.store.commit([
          revise(w.get(t.timer_id), {
            state: "FIRED",
            fired_at: new Date(f.time).toISOString(),
            input_id: id(),
          }),
        ]),
      /WAKEUP_INPUT_NOT_ATOMIC/,
    );
    f.time += 12000;
    await f.app.settle();
    assert.equal(w.get(t.timer_id).state, "FIRED");
    await f.app.settle();
    assert.equal(
      f.app.store.all<Input>("Input").filter((i) => i.producer === "TIMER")
        .length,
      1,
    );
    assert.equal(f.app.store.all("Execution").length, 0);
  }));
