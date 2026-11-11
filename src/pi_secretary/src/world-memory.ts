import type { World } from "./world.ts";
import type { Scope, Operation } from "./contracts.ts";
import type { WorldEdit } from "./world-accept.ts";
import { stableID } from "./execution-utils.ts";
export const resolveEntity = (world: World, selector: string) =>
  world.resolve(selector);
export async function readWorld(
  world: World,
  options: {
    subject?: string | null;
    predicate?: string | null;
    topic?: string;
    fact_id?: string;
    history?: boolean;
    catalog?: string;
    cursor?: string | null;
    limit?: number;
  },
) {
  if (options.catalog)
    return world.catalogPage(
      options.catalog,
      options.cursor ?? undefined,
      options.limit,
    );
  if (options.subject) {
    const resolved = world.resolve(options.subject, !!options.history);
    if (resolved.status !== "resolved") return resolved;
  }
  return {
    status: "ready",
    ...(await world.browse({
      ...options,
      subject: options.subject ?? undefined,
      predicate: options.predicate ?? undefined,
      cursor: options.cursor ?? undefined,
    })),
  };
}
export type ProposalIntent = { changes: WorldEdit[] };
export function recoveredWorldProposal(world: World, callID: string) {
  const batchID = stableID(callID + ":world-batch");
  const op = world.store
    .all<Operation>("Operation")
    .find(
      (o) =>
        o.action.intent_id === batchID && o.action.action === "world.change",
    );
  return op ? world.batch(batchID, op.scope.session_id) : undefined;
}
export async function proposeWorld(
  world: World,
  scope: Scope,
  args: ProposalIntent,
  callID: string,
  currentMasterEvents: string[],
) {
  const changes = args.changes.map((c) => ({
    ...c,
    source_event_ids: c.source_event_ids?.length
      ? c.source_event_ids
      : currentMasterEvents.length === 1
        ? currentMasterEvents
        : [],
  }));
  return world.propose(
    { version: 1, batch_id: stableID(callID + ":world-batch"), changes },
    scope,
  );
}
