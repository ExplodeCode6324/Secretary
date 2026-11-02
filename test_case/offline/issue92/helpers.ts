import type { Fixture } from "../issue9/helpers.ts";
import { base, id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  DecisionRequest,
  Execution,
  TaskPlan,
  Scope,
} from "../../../src/pi_secretary/src/contracts.ts";
/** Seeded read-model/interaction fixtures: pump off; fixture provider only. */
export async function execution(
  f: Fixture,
  name = "seeded matter",
  session = f.app.host.sessionID,
) {
  const p = f.app.scheduler.propose(name, id(), session, {
    preconditions: [
      {
        condition_id: id(),
        kind: "RESOURCE_PRESENT",
        target: "missing-issue92",
        required_revision: null,
      },
    ],
  });
  f.app.scheduler.tick();
  await f.app.scheduler.idle();
  let e = f.app.store
    .all<Execution>("Execution")
    .find((e) => e.task_id === p.id)!;
  for (const state of ["READY", "DISPATCHING", "RUNNING"] as const) {
    e = revise(e, { state });
    f.app.store.commit([e]);
  }
  return e;
}
export async function decision(
  f: Fixture,
  question = "请输入 Master 的选择",
  options: string[] = [],
) {
  const e = await execution(f);
  const d: DecisionRequest = {
    ...base(),
    schema_version: 1,
    record_type: "DecisionRequest",
    state: "OPEN",
    task_id: e.task_id,
    execution_id: e.id,
    question,
    options,
    impact: "Synthetic pause",
    materials: [],
    deadline: null,
    answer: null,
    answered_by: null,
    answer_request_id: null,
  };
  f.app.store.commit([
    d,
    revise(e, { state: "WAIT_DECISION", waiting_request_ids: [d.id] }),
  ]);
  return d;
}
export function authorization(
  f: Fixture,
  scope: Scope = {
    session_id: f.app.host.sessionID,
    task_id: null as string | null,
    execution_id: null as string | null,
  },
) {
  return f.app.authorization.prepare(
    scope,
    "file.write",
    f.dir + "/harmless-" + id(),
    { text: "SEEDED scratch content" },
  );
}
