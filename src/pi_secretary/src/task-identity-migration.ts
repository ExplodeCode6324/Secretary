import type { Execution, TaskPlan, TaskProposal } from "./contracts.ts";
import { Store, revise } from "./store.ts";
import { allocateTaskTitle, IDENTITY_ACTIVATED } from "./task-identity.ts";

/** Startup only, before business recovery. Every batch remains valid on full replay. */
export function ensureTaskIdentities(store: Store) {
  if (store.taskIdentities.activated) return;
  // Store's insertion order is committed frame + mutation order, independent of clocks.
  for (let p of store.all<TaskPlan>("TaskPlan")) {
    if (p.identity_version === 1) continue;
    const executions = store.indexed<Execution>("Execution", "task_id", [p.id]);
    const goal = store.read<TaskProposal>(p.proposal_ref).goal;
    for (const [i, e] of executions.entries())
      if (e.execution_round !== undefined && e.execution_round !== i + 1)
        throw Error("INVALID_EXECUTION_BACKFILL");
    if (p.title === undefined) {
      p = revise(p, {
        title: allocateTaskTitle(goal, undefined, (title) =>
          store.taskIdentities.hasTitle(title),
        ),
        execution_round_high_water: executions.length,
      });
      store.commit([p]);
    }
    const missing = executions.flatMap((e, i) =>
      e.execution_round === undefined
        ? [revise(e, { execution_round: i + 1 })]
        : [],
    );
    for (let offset = 0; offset < missing.length; offset += 128)
      store.commit(missing.slice(offset, offset + 128));
    store.commit([revise(p, { identity_version: 1 })]);
  }
  store.commit([], [store.event(IDENTITY_ACTIVATED, { version: 1 })]);
}
