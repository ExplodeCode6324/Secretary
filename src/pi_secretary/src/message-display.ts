import type { Store } from "./store.ts";
import type { DisplayBlock } from "./thinking-preview.ts";

export function hasDisplayContent(content: readonly DisplayBlock[]) {
  return content.some(
    (b) =>
      (b.type === "text" && b.text) ||
      (b.type === "thinking" && !b.redacted && b.thinking),
  );
}
export const abnormalReply = (reason: string | undefined) =>
  reason === "length" || reason === "error" || reason === "aborted";

type DisplayIdentity = { id: string; call_id?: string };
const registries = new WeakMap<Store, MessageDisplays>();
export function messageDisplaysFor(store: Store) {
  let value = registries.get(store);
  if (!value) {
    value = new MessageDisplays(store);
    registries.set(store, value);
  }
  value.sync();
  return value;
}

/** One incremental identity map shared by timeline, event locators and relations. */
class MessageDisplays {
  private position = 0;
  private identities = new Map<string, DisplayIdentity>();
  private events = new Map<string, string>();
  private calls = new Set<string>();
  constructor(private store: Store) {}
  sync() {
    for (
      ;
      this.position < this.store.projectionFrames.length;
      this.position++
    ) {
      for (const event of this.store.projectionFrames[this.position]
        .log_records) {
        if (event.event_type === "input.accepted") {
          this.identities.set(event.event_id, { id: event.event_id });
          this.events.set(event.event_id, event.event_id);
        } else if (event.event_type === "main.message") {
          const message = this.store.read<{
            role: string;
            content: DisplayBlock[];
            display_call_id?: string;
            stopReason?: string;
          }>(event.payload);
          if (message.role !== "assistant" || !Array.isArray(message.content))
            continue;
          let call = message.display_call_id;
          if (
            call &&
            this.calls.has(call) &&
            abnormalReply(message.stopReason) &&
            !hasDisplayContent(message.content)
          )
            call = undefined;
          const identity = {
            id: call ? "message:" + call : event.event_id,
            ...(call ? { call_id: call } : {}),
          };
          // Even an omitted tool-only response owns its call association.
          if (call) this.calls.add(call);
          this.identities.set(event.event_id, identity);
          this.events.set(identity.id, event.event_id);
        }
      }
    }
  }
  forEvent(event: string): DisplayIdentity | undefined {
    return this.identities.get(event);
  }
  eventFor(message: string) {
    return this.events.get(message);
  }
}
