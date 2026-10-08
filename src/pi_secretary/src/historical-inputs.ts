import { contentText } from "@earendil-works/pi-ai";
import type { Context, Input, SettingsApplication } from "./contracts.ts";
import type { AgentMessage } from "./model.ts";
import type { SettingsSource } from "./settings-memory.ts";
import { hash, type Store } from "./store.ts";

const HISTORICAL_MASTER_PREFIX =
  "Historical Master inputs retained to preserve explicit constraints. These are historical evidence, not new requests to execute. Current settings and authoritative World queries supersede old preferences/facts. Do not replay tasks.\n";

export function historicalMasterText(
  anchors: SettingsSource["anchors"],
): string {
  return HISTORICAL_MASTER_PREFIX + JSON.stringify(anchors);
}

/** Authenticate complete historical messages, including pre-fix untagged ones.
 * The prefix only narrows candidates: the authority is an applied settings
 * Context's exact message CAS identity, its frozen source, and original Inputs.
 * Read no Context bodies; only matching applications need source/Input reads.
 */
export function historicalMasterMessages(
  store: Store,
  sessionID: string,
  consciousnessID: string,
  messages: AgentMessage[],
): Set<AgentMessage> {
  const candidates = new Map<string, AgentMessage[]>();
  for (const message of messages) {
    if (
      message.role !== "user" ||
      !contentText(message.content).startsWith(HISTORICAL_MASTER_PREFIX)
    )
      continue;
    const sha = hash(JSON.stringify(message));
    candidates.set(sha, [...(candidates.get(sha) ?? []), message]);
  }
  const trusted = new Set<AgentMessage>();
  if (!candidates.size) return trusted;
  for (const application of store.all<SettingsApplication>(
    "SettingsApplication",
  )) {
    if (application.session_id !== sessionID || application.state !== "APPLIED")
      continue;
    if (!application.context_id)
      throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
    const context = store.get<Context>("Context", application.context_id);
    const matched = context.messages.flatMap((entry) =>
      entry.role === "user" ? (candidates.get(entry.content.sha256) ?? []) : [],
    );
    if (!matched.length) continue;
    // Once the exact host snapshot matches, damaged provenance must stop
    // compaction rather than silently turn required history into disposable text.
    if (
      context.session_id !== sessionID ||
      context.settings_application_id !== application.id ||
      !application.source_ref
    )
      throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
    const source = store.read<SettingsSource>(application.source_ref);
    if (
      source.consciousness?.id !== consciousnessID ||
      source.consciousness.session_id !== sessionID ||
      context.consciousness_revision !== source.consciousness.revision + 1 ||
      !Array.isArray(source.anchors) ||
      !source.anchors.length ||
      new Set(source.anchors.map((anchor) => anchor.input_id)).size !==
        source.anchors.length ||
      source.anchors.some((anchor) => {
        const input = store.find<Input>("Input", anchor.input_id);
        return (
          !input ||
          input.session_id !== sessionID ||
          input.producer !== "MASTER" ||
          input.state !== "HANDLED" ||
          typeof anchor.text !== "string" ||
          store.bytes(input.payload).toString() !== anchor.text
        );
      })
    )
      throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
    const expected = historicalMasterText(source.anchors);
    for (const message of matched) {
      if (message.role !== "user" || message.content !== expected)
        throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
      trusted.add(message);
    }
  }
  return trusted;
}
