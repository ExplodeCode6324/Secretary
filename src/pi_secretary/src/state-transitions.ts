import { readFileSync } from "node:fs";
import type { Contract } from "./contracts.ts";

const machines = JSON.parse(
  readFileSync(
    new URL("../../state_machine/catalog.json", import.meta.url),
    "utf8",
  ),
).machines as Record<
  string,
  { transitions: { from: string; event: string; to: string }[] }
>;

export function next(machine: string, state: string, event: string): string {
  const edge = machines[machine]?.transitions.find(
    (t) => t.from === state && t.event === event,
  );
  if (!edge) throw Error(`INVALID_TRANSITION ${machine} ${state} ${event}`);
  return edge.to;
}

const managed = ["Execution", "Operation", "Input"] as const;
const pairs = new Map(
  managed.map((name) => [
    name,
    new Set(machines[name].transitions.map((t) => `${t.from}:${t.to}`)),
  ]),
);

export function validateStateTransition(previous: Contract, current: Contract) {
  if (
    previous.record_type !== current.record_type ||
    !("state" in previous) ||
    !("state" in current)
  )
    return;
  const allowed = pairs.get(current.record_type as (typeof managed)[number]);
  if (
    allowed &&
    previous.state !== current.state &&
    !allowed.has(`${previous.state}:${current.state}`)
  )
    throw Error(
      `INVALID_${current.record_type.toUpperCase()}_TRANSITION ${previous.state} -> ${current.state}`,
    );
}
