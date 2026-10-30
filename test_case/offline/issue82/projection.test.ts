import test from "node:test";
import assert from "node:assert/strict";
import { fixture, executions } from "../issue16/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
import type { TaskPage } from "../../../src/pi_secretary/src/api/contracts.ts";

test("Task summary projects actual waiting execution separately from ACTIVE plan, without treating active IDs as running", () =>
  fixture(async (a, api) => {
    a.scheduler.propose("Synthetic waiting task", id(), a.host.sessionID, {
      preconditions: [
        {
          condition_id: id(),
          kind: "RESOURCE_PRESENT",
          target: "missing",
          required_revision: null,
        },
      ],
    });
    a.scheduler.tick();
    await a.scheduler.idle();
    const es = executions(a);
    assert.equal(es.length, 1);
    const execution = es[0];
    const page = (await api.query(api.principal, "tasks")) as TaskPage;
    validate("TaskPage", page);
    const task = page.items[0];
    assert.equal(task.state, "ACTIVE");
    assert.notEqual(execution.state, "RUNNING");
    assert.equal(task.latest_execution_id, execution.id);
    assert.equal(task.latest_execution_state, execution.state);
    assert.deepEqual(task.active_executions, [
      { id: execution.id, state: execution.state },
    ]);
    assert.equal(task.pending_request_count, 0);
  }));
