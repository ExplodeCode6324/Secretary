import type { Store } from "./store.ts";
import type { Input } from "./contracts.ts";

/** Use durable input identity, not a textual prefix a Master might also quote. */
export function isTimerMessage(store: Store, value: unknown): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    !("role" in value) ||
    value.role !== "user" ||
    !("secretary_input" in value)
  )
    return false;
  const identity = value.secretary_input as
    { input_id?: string; session_id?: string } | undefined;
  if (!identity?.input_id) return false;
  const input = store.find<Input>("Input", identity.input_id);
  return (
    input?.producer === "TIMER" && input.session_id === identity.session_id
  );
}
