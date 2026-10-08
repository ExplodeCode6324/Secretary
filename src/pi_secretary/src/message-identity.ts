import type { AgentMessage } from "./model.ts";
import { hash } from "./store.ts";

/** Match a Context occurrence to its event without treating UI metadata as content.
 * Event IDs, not this fingerprint, distinguish repeated messages. */
export function messageIdentityHash(message: AgentMessage): string {
  const value = { ...message } as AgentMessage & { display_call_id?: string };
  if (value.role === "assistant") delete value.display_call_id;
  return hash(JSON.stringify(value));
}
