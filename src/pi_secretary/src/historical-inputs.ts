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
export function historicalMasterAnchors(
  store: Store,
  sessionID: string,
  consciousnessID: string,
  messages: AgentMessage[],
): Map<AgentMessage, SettingsSource["anchors"]> {
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
  const trusted = new Map<AgentMessage, SettingsSource["anchors"]>();
  if (!candidates.size) return trusted;
  for (const application of store.all<SettingsApplication>(
    "SettingsApplication",
  )) {
    if (application.session_id !== sessionID || application.state !== "APPLIED")
      continue;
    if (!application.context_id)
      throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
    const context = store.get<Context>("Context", application.context_id);
    const matched = messages.filter((message) => {
      if (
        message.role !== "user" ||
        !contentText(message.content).startsWith(HISTORICAL_MASTER_PREFIX)
      )
        return false;
      const tag = (
        message as unknown as {
          secretary_historical_inputs?: HistoricalInputTag;
        }
      ).secretary_historical_inputs;
      return context.messages.some(
        (entry) =>
          entry.role === "user" &&
          (entry.content.sha256 === hash(JSON.stringify(message)) ||
            (!!tag &&
              tag.version === 1 &&
              tag.application_id === application.id &&
              tag.source_message_sha256 === entry.content.sha256 &&
              tag.content_sha256 === hash(contentText(message.content)))),
      );
    });
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
    for (const message of matched) {
      if (message.role !== "user" || typeof message.content !== "string")
        throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
      const selected: SettingsSource["anchors"] = JSON.parse(
        message.content.slice(HISTORICAL_MASTER_PREFIX.length),
      );
      if (
        !Array.isArray(selected) ||
        new Set(selected.map((a) => a.input_id)).size !== selected.length ||
        selected.some(
          (a) =>
            !source.anchors.some(
              (original) =>
                original.input_id === a.input_id && original.text === a.text,
            ),
        ) ||
        historicalMasterText(selected) !== message.content
      )
        throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
      const tag = (
        message as unknown as {
          secretary_historical_inputs?: HistoricalInputTag;
        }
      ).secretary_historical_inputs;
      if (tag) {
        const origin = context.messages.find(
          (entry) =>
            entry.content.sha256 === tag.source_message_sha256 &&
            entry.role === "user",
        );
        if (!origin) throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
        const original = store.read<AgentMessage>(origin.content);
        if (
          original.role !== "user" ||
          typeof original.content !== "string" ||
          !original.content.startsWith(HISTORICAL_MASTER_PREFIX)
        )
          throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
        const allowed: SettingsSource["anchors"] = JSON.parse(
          original.content.slice(HISTORICAL_MASTER_PREFIX.length),
        );
        if (
          !Array.isArray(allowed) ||
          selected.some(
            (a) =>
              !allowed.some(
                (origin) =>
                  origin.input_id === a.input_id && origin.text === a.text,
              ),
          )
        )
          throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
      }
      trusted.set(message, selected);
    }
  }
  return trusted;
}

export function historicalMasterMessages(
  store: Store,
  sessionID: string,
  consciousnessID: string,
  messages: AgentMessage[],
): Set<AgentMessage> {
  return new Set(
    historicalMasterAnchors(store, sessionID, consciousnessID, messages).keys(),
  );
}

type HistoricalInputTag = {
  version: 1;
  application_id: string;
  source_message_sha256: string;
  content_sha256: string;
};
/** Attest a subset of an already authenticated APPLIED wrapper. The origin CAS
 * remains immutable and the tag cannot be supplied by text-only Master Inputs. */
export function historicalSubset(
  store: Store,
  original: AgentMessage,
  anchors: SettingsSource["anchors"],
): AgentMessage {
  if (original.role !== "user")
    throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
  const existing = (
    original as unknown as { secretary_historical_inputs?: HistoricalInputTag }
  ).secretary_historical_inputs;
  let owner = existing?.application_id,
    origin = existing?.source_message_sha256;
  if (!owner) {
    const digest = hash(JSON.stringify(original));
    for (const app of store.all<SettingsApplication>("SettingsApplication")) {
      if (app.state !== "APPLIED" || !app.context_id) continue;
      if (
        store
          .get<Context>("Context", app.context_id)
          .messages.some(
            (entry) => entry.role === "user" && entry.content.sha256 === digest,
          )
      ) {
        owner = app.id;
        origin = digest;
        break;
      }
    }
  }
  if (!owner || !origin) throw Error("INVALID_HISTORICAL_MASTER_EVIDENCE");
  const content = historicalMasterText(anchors);
  return {
    ...original,
    content,
    secretary_historical_inputs: {
      version: 1,
      application_id: owner,
      source_message_sha256: origin,
      content_sha256: hash(content),
    },
  } as AgentMessage;
}
