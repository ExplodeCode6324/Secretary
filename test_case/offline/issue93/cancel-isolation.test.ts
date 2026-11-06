import test from "node:test";
import assert from "node:assert/strict";
import { fixture, until, type Fixture } from "../issue9/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type {
  ApiCommand,
  Execution,
  TaskPlan,
} from "../../../src/pi_secretary/src/contracts.ts";

async function request(f: Fixture, goal: string, interval_seconds?: number) {
  const request_id = id();
  const accepted = await f.client.command("task-requests", {
    request_id,
    goal,
    ...(interval_seconds ? { interval_seconds } : {}),
    preconditions: [
      {
        condition_id: id(),
        kind: "RESOURCE_PRESENT",
        target: "issue84-boundary-deliberately-absent",
        required_revision: null,
      },
    ],
  });
  const task = accepted.resource_ids.find((r) => r.type === "TaskPlan")!.id;
  return { request: request_id, task };
}
const plan = (f: Fixture, task: string) =>
  f.app.store.get<TaskPlan>("TaskPlan", task);
const executions = (f: Fixture, task: string) =>
  f.app.store.all<Execution>("Execution").filter((e) => e.task_id === task);

test("Core HTTP: exact pending-request cancellation preserves the adjacent request and periodic plan", () =>
  fixture(async (f) => {
    const target = await request(f, "cancel this request");
    const neighbour = await request(f, "keep this request");
    const periodic = await request(f, "keep future scheduling", 3600);
    const neighbourBefore = structuredClone(plan(f, neighbour.task));
    const periodicBefore = structuredClone(plan(f, periodic.task));
    const command = { request_id: id() };
    const route = `task-requests/${target.request}/cancel`;
    const receipt = await f.client.command(route, command);
    await until(
      () =>
        f.app.store.get<ApiCommand>("ApiCommand", command.request_id).state ===
        "COMPLETED",
    );
    const after = f.app.store.sequence;
    const replay = await f.client.command(route, command);
    assert.equal(replay.request_id, receipt.request_id);
    assert.equal(replay.acceptance, "ACCEPTED");
    assert.equal(replay.state, "COMPLETED");
    assert.deepEqual(replay.resource_ids, receipt.resource_ids);
    assert.equal(
      f.app.store.sequence,
      after,
      "exact receipt replay is read-only",
    );
    assert.equal(
      f.app.scheduler.requestStatus(target.request)?.state,
      "CANCELLED_OR_REJECTED",
    );
    assert.deepEqual(plan(f, neighbour.task), neighbourBefore);
    assert.deepEqual(plan(f, periodic.task), periodicBefore);
    assert(
      plan(f, neighbour.task).pending_requests!.some(
        (r) => r.request_id === neighbour.request,
      ),
    );
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    assert.equal(executions(f, target.task).length, 0);
    assert.equal(executions(f, neighbour.task).length, 1);
    assert.equal(executions(f, neighbour.task)[0].state, "WAIT_PRECONDITION");
    assert.equal(executions(f, periodic.task).length, 1);
    assert.equal(plan(f, periodic.task).state, "ACTIVE");
    assert.equal(f.app.store.all("ModelCall").length, 0);
  }));

test("Core HTTP: cancelling one periodic occurrence preserves its next due and the neighbour execution", () =>
  fixture(async (f) => {
    const target = await request(f, "periodic occurrence", 3600);
    const neighbour = await request(f, "independent waiting execution");
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const first = executions(f, target.task)[0];
    assert.equal(first.state, "WAIT_PRECONDITION");
    const neighbourBefore = structuredClone(executions(f, neighbour.task)[0]);
    const before = structuredClone(plan(f, target.task));
    assert(before.next_due_at);
    const command = { request_id: id() };
    await f.client.command(`executions/${first.id}/cancel`, command);
    await until(
      () =>
        f.app.store.get<ApiCommand>("ApiCommand", command.request_id).state ===
        "COMPLETED",
    );
    assert.equal(
      f.app.store.get<Execution>("Execution", first.id).state,
      "CANCELLED",
    );
    assert.deepEqual(executions(f, neighbour.task)[0], neighbourBefore);
    assert.equal(plan(f, target.task).state, "ACTIVE");
    assert.equal(plan(f, target.task).next_due_at, before.next_due_at);
    assert.deepEqual(plan(f, target.task).trigger, before.trigger);
    // Advance only this isolated scheduler's clock to its real next due time.
    f.app.scheduler.tick(Date.parse(before.next_due_at) + 1);
    await f.app.scheduler.idle();
    const later = executions(f, target.task);
    assert.equal(later.length, 2);
    const next = later.find((e) => e.id !== first.id)!;
    assert.equal(next.state, "WAIT_PRECONDITION");
    assert.equal(
      f.app.store.get<Execution>("Execution", first.id).state,
      "CANCELLED",
    );
    assert.equal(executions(f, neighbour.task).length, 1);
    assert.equal(executions(f, neighbour.task)[0].state, "WAIT_PRECONDITION");
    assert(
      Date.parse(plan(f, target.task).next_due_at!) >
        Date.parse(before.next_due_at),
    );
    assert.equal(f.app.store.all("ModelCall").length, 0);
  }));
