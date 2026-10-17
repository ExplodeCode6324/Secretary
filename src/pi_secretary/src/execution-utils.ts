import type { Execution, Scope } from "./contracts.ts";
import { hash } from "./store.ts";
export const stableID = (text: string) => {
  const h = hash(text);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export const scopeOf = (e: Execution): Scope => ({
  session_id: null,
  task_id: e.task_id,
  execution_id: e.id,
});
export const terminal = (e: Execution) =>
  ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(e.state);
