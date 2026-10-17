import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../issue23/helpers.ts";
import { interrupted } from "../issue18/helpers.ts";
import { base, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  Operation,
  Notification,
} from "../../../src/pi_secretary/src/contracts.ts";

test("startup process recovery visits same-execution history linearly", () =>
  fixture(async ({ app }) => {
    const { op } = interrupted(app);
    const count = 200;
    app.store.commit(
      Array.from({ length: count - 1 }, () => ({ ...op, ...base() })),
    );
    const indexed = app.store.indexed.bind(app.store);
    let visited = 0;
    app.store.indexed = ((...args: Parameters<typeof indexed>) => {
      const result = indexed(...args);
      if (args[0] === "Operation") visited += result.length;
      return result;
    }) as typeof indexed;
    await (app.scheduler as any).recoverProcesses(true);
    assert(
      visited <= count * 4,
      `visited ${visited} operations for ${count} records`,
    );
  }));

test("empty process checks advance the five-second gate", () =>
  fixture(async ({ app }) => {
    await app.settings.tick();
    const indexed = app.store.indexed.bind(app.store);
    let checks = 0;
    app.store.indexed = ((...args: Parameters<typeof indexed>) => {
      if (args[0] === "Operation" && args[1] === "process.state") checks++;
      return indexed(...args);
    }) as typeof indexed;
    const at = Date.now() + 10000;
    app.scheduler.tick(at);
    for (let n = 1; n < 10; n++) app.scheduler.tick(at + n * 300);
    assert.equal(checks, 1);
    app.scheduler.tick(at + 5000);
    assert.equal(checks, 2);
  }));

test("full startup recovery scans Operation history only once across executions", () =>
  fixture(async ({ app }) => {
    for (let n = 0; n < 5; n++) interrupted(app);
    const all = app.store.all.bind(app.store);
    let scans = 0;
    app.store.all = ((...args: Parameters<typeof all>) => {
      if (args[0] === "Operation") scans++;
      assert(
        !["ModelCall", "Feedback"].includes(args[0] as string),
        `full ${args[0]} scan`,
      );
      return all(...args);
    }) as typeof all;
    await app.scheduler.recover();
    assert.equal(scans, 1);
  }));

test("a newly pending process is recovered when the next five-second gate opens", () =>
  fixture(async ({ app }) => {
    await app.settings.tick();
    const at = Date.now() + 10000;
    app.scheduler.tick(at);
    const { op } = interrupted(app, "shell.run", "/synthetic/new", false);
    app.scheduler.tick(at + 4999);
    assert.equal((app.scheduler as any).processWork, undefined);
    assert.equal(
      app.store.get<Operation>("Operation", op.id).revision,
      op.revision,
    );
    app.scheduler.tick(at + 5000);
    await (app.scheduler as any).processWork;
    assert.equal(
      app.store.get<Operation>("Operation", op.id).revision,
      op.revision + 1,
    );
    assert(
      app.store
        .all<Notification>("Notification")
        .some((n) => app.store.read<any>(n.message).operation_id === op.id),
    );
  }));

test("process indexes match scans after revisions, failed commits and legacy replay", () =>
  fixture(async (f) => {
    const { op, e } = interrupted(
      f.app,
      "shell.run",
      "/synthetic/project",
      false,
    );
    const legacy = { ...op, ...base(), process: undefined };
    f.app.store.commit([legacy]);
    const check = () => {
      const all = f.app.store.all<Operation>("Operation");
      assert.deepEqual(
        f.app.store.indexed<Operation>("Operation", "scope.execution_id", [
          e.id,
        ]),
        all.filter((o) => o.scope.execution_id === e.id),
      );
      assert.deepEqual(
        f.app.store.indexed<Operation>(
          "Operation",
          "process.state",
          [undefined, "STOPPED"],
          true,
        ),
        all.filter((o) => o.process && o.process.state !== "STOPPED"),
      );
    };
    check();
    f.app.store.commit([
      revise(op, { process: { ...op.process!, state: "STOPPED" } }),
    ]);
    assert.throws(
      () =>
        f.app.store.commit([
          revise(op, { process: { ...op.process!, state: "RUNNING" } }),
        ]),
      /REVISION_CONFLICT/,
    );
    check();
    assert.equal(f.app.scheduler.processStopped(e.id), false);
    await f.restart();
    check();
    assert.equal(f.app.scheduler.processStopped(e.id), false);
  }));

test("recovery leaves the scheduler's currently running execution alone", () =>
  fixture(async ({ app }) => {
    const { e, op } = interrupted(
      app,
      "shell.run",
      "/synthetic/running",
      false,
    );
    const running = (app.scheduler as any).running as Map<string, unknown>;
    running.set(e.id, {});
    try {
      await (app.scheduler as any).recoverProcesses(true);
      await (app.scheduler as any).recoverProcesses();
      assert.deepEqual(app.store.get<Operation>("Operation", op.id), op);
      assert.equal(app.store.all<Notification>("Notification").length, 0);
    } finally {
      running.delete(e.id);
    }
  }));

test("recovery probes each process but only notifies genuinely unresolved operations", () =>
  fixture(async ({ app }) => {
    const { op, e } = interrupted(app);
    const unknown = {
      ...op,
      ...base(),
      process: { ...op.process!, state: "UNCONFIRMED" as const },
    };
    const starting = {
      ...op,
      ...base(),
      process: { ...op.process!, state: "STARTING" as const },
    };
    const legacy = { ...op, ...base(), process: undefined };
    app.store.commit([unknown, starting, legacy]);
    await (app.scheduler as any).recoverProcesses(true);
    assert.equal(
      app.store.get<Operation>("Operation", starting.id).process?.state,
      "STOPPED",
    );
    assert.equal(app.scheduler.processStopped(e.id), false);
    const notices = () =>
      app.store
        .all<Notification>("Notification")
        .map((n) => app.store.read<any>(n.message).operation_id)
        .filter(Boolean)
        .sort();
    assert.deepEqual(notices(), [unknown.id, legacy.id].sort());
    await (app.scheduler as any).recoverProcesses(true);
    assert.deepEqual(notices(), [unknown.id, legacy.id].sort());
  }));
