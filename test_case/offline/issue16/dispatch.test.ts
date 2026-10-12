import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, directory, executions, approve } from "./helpers.ts";
import { id, revise, now } from "../../../src/pi_secretary/src/store.ts";
import {
  replyStream,
  fixtureStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { scopeOf } from "../../../src/pi_secretary/src/scheduler.ts";
import type {
  Operation,
  Execution,
} from "../../../src/pi_secretary/src/contracts.ts";
const shell: StreamFn = (m, c, o) => {
  if (
    !JSON.stringify(c.messages.filter((x) => x.role === "system")).includes(
      "TASK_EXECUTOR",
    )
  )
    return fixtureStream(m, c, o);
  if (!c.messages.some((x) => x.role === "toolResult"))
    return replyStream(
      [
        {
          type: "toolCall",
          id: "shell",
          name: "bash",
          arguments: {
            command: JSON.stringify(c).includes("timeout-task")
              ? "echo first > first-proof; sleep 10"
              : "echo second > second-proof",
            timeout: JSON.stringify(c).includes("timeout-task") ? 0.1 : 5,
          },
        },
      ],
      m,
    );
  return fixtureStream(m, c, o);
};
test("stopped unknown shell releases DIRECTORY slot and other execution may shell, unresolved file stays blocked", () =>
  fixture(async (a, api, root) => {
    const project = directory(root);
    const s = a.scheduler.scopes.save({
      name: "Shared",
      kind: "DIRECTORY",
      root_path: project,
    });
    a.scheduler.propose("timeout-task", id(), a.host.sessionID, {
      scopeID: s.id,
    });
    a.scheduler.propose("next-task", id(), a.host.sessionID, { scopeID: s.id });
    a.scheduler.tick();
    await a.scheduler.idle();
    approve(a);
    a.scheduler.tick();
    await a.scheduler.idle();
    let es = executions(a);
    assert.equal(es[0].state, "RESULT_UNKNOWN");
    assert.equal(a.scheduler.processStopped(es[0].id), true);
    a.scheduler.tick();
    await a.scheduler.idle();
    assert.equal(executions(a)[1].state, "WAIT_AUTH");
    approve(a);
    a.scheduler.tick();
    await a.scheduler.idle();
    assert.equal(fs.existsSync(path.join(project, "second-proof")), true);
    const unknown = a.store
      .all<Operation>("Operation")
      .find((o) => o.scope.execution_id === es[0].id)!;
    const write = a.authorization.prepare(
      scopeOf(es[0]),
      "file.write",
      path.join(project, "blocked"),
      { path: "blocked", content: "synthetic" },
    );
    a.store.commit([
      revise(write, { state: "RESULT_UNKNOWN", effect: "UNKNOWN" }),
    ]);
    assert.throws(
      () =>
        a.authorization.prepare(
          scopeOf(es[1]),
          "file.write",
          path.join(project, "blocked"),
          { path: "blocked", content: "next" },
        ),
      /RELATED_EFFECT_UNKNOWN/,
    );
    api.command(api.principal, `operations/${unknown.id}/resolve`, {
      request_id: id(),
      expected_revision: String(unknown.revision),
      outcome: "UNVERIFIED",
      note: "Accept uncertainty",
    });
    assert.equal(executions(a)[0].state, "RESULT_UNKNOWN");
  }, shell));

test("unconfirmed process survives owner resolution and keeps same DIRECTORY occupied", () =>
  fixture(async (a, api, root) => {
    const s = a.scheduler.scopes.save({
      name: "Held",
      kind: "DIRECTORY",
      root_path: directory(root),
    });
    const p = a.scheduler.propose("blocked", id(), a.host.sessionID, {
      scopeID: s.id,
      preconditions: [
        {
          condition_id: id(),
          kind: "RESOURCE_PRESENT",
          target: "never",
          required_revision: null,
        },
      ],
    });
    a.scheduler.tick();
    await a.scheduler.idle();
    const e = executions(a)[0];
    a.store.commit([revise(e, { state: "RUNNING", started_at: now() })]);
    const op = a.authorization.prepare(scopeOf(e), "shell.run", s.root_path!, {
      command: "synthetic",
    });
    approve(a);
    a.authorization.dispatch(op.id);
    a.authorization.finish(op.id, { interrupted: true }, "UNKNOWN");
    let current = a.store.get<Operation>("Operation", op.id);
    a.store.commit([
      revise(current, { process: { token: id(), state: "UNCONFIRMED" } }),
      revise(a.store.get<Execution>("Execution", e.id), {
        state: "RESULT_UNKNOWN",
      }),
    ]);
    current = a.store.get<Operation>("Operation", op.id);
    api.command(api.principal, `operations/${op.id}/resolve`, {
      request_id: id(),
      expected_revision: String(current.revision),
      outcome: "UNVERIFIED",
      note: "Outcome only",
    });
    a.scheduler.propose("second", id(), a.host.sessionID, { scopeID: s.id });
    a.scheduler.tick();
    await a.scheduler.idle();
    assert.equal(
      executions(a)[1].condition_results.at(-1)?.reason,
      "SCOPE_BUSY",
    );
    current = a.store.get<Operation>("Operation", op.id);
    a.store.commit([
      revise(current, { process: { ...current.process!, state: "STOPPED" } }),
    ]);
    a.scheduler.settleUnknownExecution(e.id);
    a.scheduler.tick();
    await a.scheduler.idle();
    assert.equal(executions(a)[0].state, "FAILED");
    assert.equal(executions(a)[1].state, "SUCCEEDED");
  }));

test("run acquires synchronously, and all active DIRECTORY states exclude a competing READY execution", () =>
  fixture(async (a, _api, root) => {
    const s = a.scheduler.scopes.save({
      name: "States",
      kind: "DIRECTORY",
      root_path: directory(root),
    });
    for (let n = 0; n < 2; n++)
      a.scheduler.propose("queued", id(), a.host.sessionID, {
        scopeID: s.id,
        preconditions: [
          {
            condition_id: id(),
            kind: "RESOURCE_PRESENT",
            target: "never",
            required_revision: null,
          },
        ],
      });
    a.scheduler.tick();
    await a.scheduler.idle();
    const [first, second] = executions(a);
    for (const state of [
      "DISPATCHING",
      "RUNNING",
      "WAIT_AUTH",
      "WAIT_DECISION",
      "CANCEL_REQUESTED",
    ] as const) {
      a.store.commit([
        revise(a.store.get<Execution>("Execution", first.id), {
          state,
          started_at: now(),
        }),
        revise(a.store.get<Execution>("Execution", second.id), {
          state: "READY",
        }),
      ]);
      await a.scheduler.run(second.id);
      assert.equal(
        a.store.get<Execution>("Execution", second.id).condition_results.at(-1)
          ?.reason,
        "SCOPE_BUSY",
      );
    }
  }));
