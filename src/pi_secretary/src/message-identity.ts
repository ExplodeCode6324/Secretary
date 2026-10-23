import type { AgentMessage } from "./model.ts";
import { hash } from "./store.ts";

/** Match a Context occurrence to its event without treating UI metadata as content.
 * Event IDs, not this fingerprint, distinguish repeated messages. */
export function messageIdentityHash(message: AgentMessage): string {
  const tag = (
    message as unknown as {
      secretary_input?: {
        version: number;
        session_id: string;
        input_id: string;
        input_content_digest: string;
      };
    }
  ).secretary_input;
  // Candidate key only: callers must authenticate v2 forms against Store evidence.
  if (
    message.role === "user" &&
    tag?.version === 2 &&
    /^[a-f0-9]{64}$/.test(tag.input_content_digest) &&
    typeof tag.session_id === "string" &&
    typeof tag.input_id === "string"
  )
    return hash(
      JSON.stringify({
        version: 2,
        role: message.role,
        timestamp: message.timestamp,
        session_id: tag.session_id,
        input_id: tag.input_id,
        input_content_digest: tag.input_content_digest,
      }),
    );
  const value = { ...message } as AgentMessage & { display_call_id?: string };
  if (value.role === "assistant") delete value.display_call_id;
  delete (value as AgentMessage & { secretary_input?: unknown })
    .secretary_input;
  return hash(JSON.stringify(value));
}
