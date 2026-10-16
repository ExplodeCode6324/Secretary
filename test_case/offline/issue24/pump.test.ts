import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../../../src/pi_secretary/src/world.ts";
import { fixture } from "../issue23/helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  Input,
  TaskPlan,
  Execution,
} from "../../../src/pi_secretary/src/contracts.ts";
test("idle pump avoids historical record and log scans; state indexes survive revisions and reopen", () =>
  fixture(async (f) => {
    const { app } = f;
    await app.settings.tick();
    const i = app.host.accept("synthetic index transition");
    assert.equal(
      app.store.indexed<Input>("Input", "state", ["ACCEPTED"]).length,
      1,
    );
    const claimed = revise(i, { state: "CLAIMED" as const });
    app.store.commit([claimed]);
    assert.equal(
      app.store.indexed<Input>("Input", "state", ["ACCEPTED"]).length,
      0,
    );
    app.store.commit([revise(claimed, { state: "HANDLED" })]);
    assert.throws(
      () => app.store.commit([revise(claimed, { state: "HANDLED" })]),
      /REVISION_CONFLICT/,
    );
    const p = app.scheduler.propose(
      "Synthetic completed report",
      id(),
      app.host.sessionID,
    );
    app.scheduler.tick();
    await app.scheduler.idle();
    for (const feedback of app.store.all<any>("Feedback"))
      app.store.commit([revise(feedback, { state: "HANDLED" })]);
    const plan = app.store.get<TaskPlan>("TaskPlan", p.id);
    app.store.commit([revise(plan, { state: "CLOSED" })]);
    for (const e of app.store.all<Execution>("Execution"))
      app.store.commit([revise(e, { retention_state: "RETIRED" })]);
    const execution = app.store.all<Execution>("Execution")[0];
    assert.equal(
      app.store.indexed<Execution>("Execution", "task_occurrence", [
        JSON.stringify([p.id, execution.occurrence_key]),
      ])[0].id,
      execution.id,
    );
    await f.restart();
    assert.equal(
      f.app.store.indexed<Input>("Input", "state", ["ACCEPTED", "CLAIMED"])
        .length,
      0,
    );
    const all = f.app.store.all.bind(f.app.store);
    f.app.store.all = ((type: any) => {
      if (!["PushTarget", "Session"].includes(type))
        throw Error("historical scan " + type);
      return all(type);
    }) as typeof all;
    // Any iteration over the complete log array is forbidden in a warmed idle pump.
    const banned = new Set<PropertyKey>([
      "filter",
      "find",
      "findLast",
      "findIndex",
      "findLastIndex",
      "some",
      "every",
      "forEach",
      "reduce",
      "reduceRight",
      "map",
      "slice",
      "values",
      "entries",
      "keys",
      Symbol.iterator,
    ]);
    const guard = <T>(array: T[]) =>
      new Proxy(array, {
        get(target, key, receiver) {
          if (banned.has(key))
            throw Error("historical traversal " + String(key));
          return Reflect.get(target, key, receiver);
        },
      });
    const logs = f.app.store.logs;
    Object.defineProperty(f.app.store, "logs", { value: guard(logs) });
    Object.defineProperty(f.app.store, "projectionFrames", {
      value: guard(f.app.store.projectionFrames),
    });
    assert.throws(
      () => f.app.store.logs.findLast(() => true),
      /historical traversal/,
    );
    assert.throws(
      () => f.app.store.projectionFrames.slice(),
      /historical traversal/,
    );
    await World.prototype.drain.call({
      store: f.app.store,
      export: async () => {},
    } as unknown as World);
    for (let n = 0; n < 5; n++) {
      await f.app.pump();
      await f.app.host.drain();
      f.app.host.maintainIfNeeded();
    }
  }));

test("missed trigger and input share a transaction; old events recover once by receipt", () =>
  fixture(async (f) => {
    await f.app.settings.tick();
    const p = f.app.scheduler.propose(
      "Synthetic missed timer",
      id(),
      f.app.host.sessionID,
    );
    const due = new Date(Date.now() - 60000).toISOString();
    f.app.store.commit([
      revise(p, {
        trigger: { ...p.trigger, kind: "AT", at: due },
        next_due_at: due,
      }),
    ]);
    await f.app.scheduler.recover();
    const event = f.app.store.events("trigger.missed").at(-1)!;
    const frame = f.app.store.projectionFrames.find((frame) =>
      frame.log_records.some((log) => log.event_id === event.event_id),
    )!;
    assert(frame.mutations.some((m) => m.object_type === "Input"));
    assert(
      frame.log_records.some((log) => log.event_type === "input.accepted"),
    );
    const before = f.app.store.all<Input>("Input").length;
    f.app.host.deliverFeedback();
    f.app.host.deliverFeedback();
    assert.equal(f.app.store.all<Input>("Input").length, before);
    const legacy = f.app.store.event("trigger.missed", {
      task_id: p.id,
      due,
      policy: "REPORT_ONLY",
    });
    f.app.store.commit([], [legacy]);
    f.app.host.deliverFeedback();
    assert.equal(f.app.store.all<Input>("Input").length, before + 1);
    await f.restart();
    f.app.host.deliverFeedback();
    assert.equal(f.app.store.all<Input>("Input").length, before + 1);
  }));
