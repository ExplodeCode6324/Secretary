import type { Store } from "./store.ts";
import type { Input } from "./contracts.ts";

/** Use durable input identity, not a textual prefix a Master might also quote. */
export function isTimerMessage(store: Store, value: unknown): boolean {
  return messageProducer(store, value) === "TIMER";
}
export function isHostNoticeMessage(store: Store, value: unknown): boolean {
  return ["TIMER", "ENVIRONMENT"].includes(messageProducer(store, value) ?? "");
}
export function messageProducer(
  store: Store,
  value: unknown,
): Input["producer"] | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("role" in value) ||
    value.role !== "user" ||
    !("secretary_input" in value)
  )
    return;
  const identity = value.secretary_input as
    { input_id?: string; session_id?: string } | undefined;
  if (!identity?.input_id) return;
  const input = store.find<Input>("Input", identity.input_id);
  return input?.session_id === identity.session_id
    ? input?.producer
    : undefined;
}
