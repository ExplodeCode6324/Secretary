import fs from "node:fs";
import path from "node:path";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type { Execution } from "../../../src/pi_secretary/src/contracts.ts";
import type { StreamFn } from "../../../src/pi_secretary/src/model.ts";
import type { Fixture } from "../issue9/helpers.ts";
export async function pending(f: Fixture, options = {}) {
  const p = f.app.scheduler.propose(
    "Observe task streaming",
    id(),
    f.app.host.sessionID,
    {
      ...options,
      acceptance: ["report evidence"],
      preconditions: [
        {
          condition_id: id(),
          kind: "RESOURCE_PRESENT",
          target: "gate",
          required_revision: null,
        },
      ],
    },
  );
  f.app.scheduler.tick();
  await f.app.scheduler.idle();
  return f.app.store
    .all<Execution>("Execution")
    .find((e) => e.task_id === p.id)!;
}
export function run(f: Fixture, e: Execution, stream: StreamFn) {
  Object.assign(f.app.scheduler, { stream });
  fs.writeFileSync(path.join(f.app.scheduler.rootFor(e), "gate"), "evidence");
  f.app.scheduler.ready(e.id);
  return f.app.scheduler.run(e.id);
}
export const result = () => ({
  type: "toolCall" as const,
  id: "result",
  name: "submit_result",
  arguments: {
    outcome: "SUCCEEDED",
    summary: "Observed evidence",
    criteria: [{ id: "C1", met: true, evidence: "observed" }],
    artifacts: [],
    limitations: [],
  },
});
