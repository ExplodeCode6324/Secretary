import test from "node:test";
import assert from "node:assert/strict";
import { fixture, executions } from "../issue16/helpers.ts";
import { base, id } from "../../../src/pi_secretary/src/store.ts";
import {
  effectiveSchedule,
  applicableAuthorization,
  applicableDecision,
} from "../../../src/pi_secretary/src/task-browser.ts";
import { actionableFailure } from "../../../src/pi_secretary/src/execution-utils.ts";
import type {
  TaskPlan,
  Execution,
  AuthorizationRequest,
  DecisionRequest,
} from "../../../src/pi_secretary/src/contracts.ts";
import type { TaskBrowserPage } from "../../../src/pi_secretary/src/api/contracts.ts";
const at = "2030-01-01T00:00:00.000Z";
test("schedule is a display predicate: deadlines, IMMEDIATE, EVENT, invalid/missing dates and paused plans", () => {
  const p = {
    state: "ACTIVE",
    trigger: { kind: "AT" },
    next_due_at: "2031-01-01T00:00:00.000Z",
    deadline: null,
  } as TaskPlan;
  assert(effectiveSchedule(p, at));
  for (const patch of [
    { state: "PAUSED" },
    { state: "CLOSED" },
    { next_due_at: null },
    { next_due_at: "invalid" },
    { trigger: { kind: "EVENT" } },
    { trigger: { kind: "IMMEDIATE" } },
    { deadline: at },
    { deadline: p.next_due_at },
    { deadline: "2030-06-01T00:00:00.000Z" },
  ])
    assert(!effectiveSchedule({ ...p, ...patch } as TaskPlan, at));
  assert(
    effectiveSchedule(
      {
        ...p,
        next_due_at: "2029-01-01T00:00:00.000Z",
        deadline: "2030-01-01T00:00:00.001Z",
      },
      at,
    ),
  );
  assert(
    !effectiveSchedule(
      { ...p, next_due_at: "2029-01-01T00:00:00.000Z", deadline: at },
      at,
    ),
  );
});
test("existing attention predicates include unconsumed APPROVED on ended executions; decisions require WAIT_DECISION; FAILED ignores retirement", () => {
  const a = { state: "APPROVED", expires_at: null } as AuthorizationRequest;
  assert(applicableAuthorization(a, at));
  assert(!applicableAuthorization({ ...a, expires_at: at }, at));
  assert(!applicableAuthorization({ ...a, state: "CONSUMED" }, at));
  const d = { state: "OPEN", deadline: null } as DecisionRequest,
    e = { id: "e1", task_id: "t", state: "WAIT_DECISION" } as Execution;
  assert(applicableDecision(d, e, at));
  assert(!applicableDecision(d, { ...e, state: "SUCCEEDED" }, at));
  assert(!applicableDecision({ ...d, deadline: at }, e, at));
  assert(
    !applicableDecision(
      { ...d, state: "OBSOLETE" },
      () => {
        throw Error("must not resolve obsolete ownership");
      },
      at,
    ),
  );
  const failed = {
    ...e,
    state: "FAILED",
    retention_state: "RETIRED",
  } as Execution;
  assert(actionableFailure(failed, [failed]));
  assert(
    !actionableFailure(failed, [
      failed,
      {
        ...e,
        id: "e2",
        state: "SUCCEEDED",
        started_at: "1900-01-01T00:00:00Z",
      },
    ]),
  );
  assert(actionableFailure(failed, [failed, { ...e, task_id: "other" }]));
});
test("SEEDED projection: paused/CLOSED retain own work; cross-task followup alone never adds a terminal task", () =>
  fixture(async (a, api) => {
    const completed = a.scheduler.propose(
      "seed template",
      id(),
      a.host.sessionID,
    );
    a.scheduler.tick();
    await a.scheduler.idle();
    const source = executions(a)[0],
      plan = a.store.get<TaskPlan>("TaskPlan", completed.id);
    const cases: {
      state: TaskPlan["state"];
      execution?: Execution["state"];
      requests?: boolean;
      occurrences?: boolean;
      followups?: boolean;
      current: boolean;
    }[] = [
      { state: "PAUSED", current: false },
      { state: "CLOSED", current: false },
      { state: "PAUSED", execution: "RUNNING", current: true },
      { state: "CLOSED", execution: "RESULT_UNKNOWN", current: true },
      { state: "PAUSED", requests: true, current: true },
      { state: "CLOSED", occurrences: true, current: true },
      { state: "CLOSED", followups: true, current: false },
      { state: "INIT_FAILED", current: true },
      { state: "INITIALIZING", current: true },
    ];
    const ids = new Map<string, boolean>();
    for (const c of cases) {
      const p = {
        ...plan,
        ...base(),
        state: c.state,
        pending_requests: c.requests
          ? [
              {
                request_id: id(),
                due_at: at,
                occurrence_key: id(),
                proposal_ref: plan.proposal_ref,
              },
            ]
          : [],
        pending_occurrences: c.occurrences ? [at] : [],
      } as TaskPlan;
      a.store.commit([p]);
      if (c.execution || c.followups)
        a.store.commit([
          {
            ...source,
            ...base(),
            task_id: p.id,
            plan_revision: p.revision,
            state: c.execution ?? "SUCCEEDED",
            pending_followup_ids: c.followups ? [completed.id] : [],
            result_id: c.execution ? null : source.result_id,
            ended_at: c.execution ? null : source.ended_at,
          },
        ]);
      ids.set(p.id, c.current);
    }
    const page = (await api.query(
      api.principal,
      "task-browser",
    )) as TaskBrowserPage;
    const shown = new Set(
      page.items.filter((r) => r.kind === "task").map((r) => r.id),
    );
    for (const [id, current] of ids) assert.equal(shown.has(id), current, id);
  }));

test("latest failure lookup stays linear for a long-lived same-task history", () => {
  const n = 10000,
    rows = Array.from(
      { length: n },
      (_, i) =>
        ({
          id: String(i),
          task_id: "periodic",
          state: i === n - 1 ? "FAILED" : "SUCCEEDED",
        }) as Execution,
    );
  let reads = 0;
  const observed = new Proxy(rows, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) {
        reads++;
        assert(reads <= n * 4, "quadratic execution rescanning");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  assert(actionableFailure(rows[n - 1], observed));
  assert(reads <= n * 4);
});
