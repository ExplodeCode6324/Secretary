import { contentText } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentMessage } from "./model.ts";
import type { Consciousness, Context, Input } from "./contracts.ts";
import { budgetConfig, requestBudget } from "./budget.ts";
import { migrateCommitments } from "./memory.ts";
import { historicalMasterMessages } from "./historical-inputs.ts";
import { hash, type Store } from "./store.ts";

/** Exact prefix shared with the host working-memory header format. */
export const WORKING_MEMORY_PREFIX =
  "Working memory (source history remains queryable): ";

export type ProjectContextArgs = {
  store: Store;
  /** Logical session whose Input records anchor verbatim user messages. */
  sessionID: string;
  consciousness: Consciousness;
  /** Complete checkpoint messages; never mutated. */
  messages: AgentMessage[];
};

export type BuildCompactionArgs = ProjectContextArgs & {
  /**
   * Persisted index into the complete checkpoint. Everything from this index on
   * (the current loop tail) is never cropped; tool groups that straddle the
   * boundary are pulled into the protected region.
   */
  protectedFromIndex: number;
  model: Model<Api>;
};

export type ProjectionCandidate = {
  /** Complete-checkpoint prefix that the crop mapping would replace. */
  source: AgentMessage[];
  /** Cropped source: system messages, every real Input anchor, and the kept suffix. */
  replacement: AgentMessage[];
  /** Resulting next-request view, including existing header normalization. */
  projected: AgentMessage[];
  /** True when the chosen cut already reached the occupancy target. */
  targetReached: boolean;
};

type CropMapping = NonNullable<Consciousness["context_compaction"]>;

type HeaderIdentity = {
  version: 1;
  session_id: string;
  consciousness_id: string;
  revision: number;
  content_sha256: string;
};
type HeaderMessage = Extract<AgentMessage, { role: "user" }> & {
  secretary_memory_header: HeaderIdentity;
};

type HeaderIndex = {
  sessionID: string;
  consciousnessID: string;
  revision: number;
  /** Text hashes of every real Input of the session (all producers). */
  anchors: Set<string>;
  /** Input record counts per `<payload sha256>:<received_at ms>` source identity. */
  counts: Map<string, number>;
  textCounts: Map<string, number>;
  canonical: string;
  enabled: boolean;
  timestamp: number;
};

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(length, Math.trunc(value)));
}

function inputIndex(
  store: Store,
  sessionID: string,
): {
  anchors: Set<string>;
  counts: Map<string, number>;
  textCounts: Map<string, number>;
} {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  const textCounts = new Map<string, number>();
  for (const input of store.all<Input>("Input")) {
    if (input.session_id !== sessionID) continue;
    anchors.add(input.payload.sha256);
    textCounts.set(
      input.payload.sha256,
      (textCounts.get(input.payload.sha256) ?? 0) + 1,
    );
    const received = Date.parse(input.received_at);
    if (!Number.isFinite(received)) continue;
    const key = `${input.payload.sha256}:${received}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { anchors, counts, textCounts };
}

function isHeaderShaped(text: string): boolean {
  if (!text.startsWith(WORKING_MEMORY_PREFIX)) return false;
  try {
    const parsed: unknown = JSON.parse(
      text.slice(WORKING_MEMORY_PREFIX.length),
    );
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function canonicalHeader(consciousness: Consciousness): string {
  return (
    WORKING_MEMORY_PREFIX +
    JSON.stringify({
      revision: consciousness.revision,
      items: consciousness.items,
      commitments: migrateCommitments(consciousness),
    })
  );
}

function headerIndex(
  store: Store,
  sessionID: string,
  consciousness: Consciousness,
): HeaderIndex {
  const inputs = inputIndex(store, sessionID);
  return {
    sessionID,
    consciousnessID: consciousness.id,
    revision: consciousness.revision,
    anchors: inputs.anchors,
    counts: inputs.counts,
    textCounts: inputs.textCounts,
    canonical: canonicalHeader(consciousness),
    // Only version 3 flows carry host-attested headers; legacy arrays stay untouched.
    enabled:
      typeof consciousness.id === "string" &&
      consciousness.id.length > 0 &&
      consciousness.maintenance_version === 3 &&
      (!!consciousness.last_job_id || !!consciousness.settings_application_id),
    timestamp: Date.parse(
      consciousness.memory_updated_at ?? consciousness.updated_at,
    ),
  };
}

/**
 * Apply the persisted crop mapping only on an exact prefix match. A mismatch
 * never falls back to guessing a shorter or fuzzy crop. Old mappings cannot
 * bypass the preservation rule for authenticated historical Master inputs.
 */
function applyCrop(
  store: Store,
  messages: AgentMessage[],
  mapping: CropMapping,
  index: HeaderIndex,
): AgentMessage[] {
  const prefix = store.read<AgentMessage[]>(mapping.source_ref);
  if (!prefix.length || prefix.length > messages.length) return messages;
  if (
    hash(JSON.stringify(messages.slice(0, prefix.length))) !==
    mapping.source_ref.sha256
  )
    return messages;
  const replacement = store.read<AgentMessage[]>(mapping.messages_ref);
  const historical = historicalMasterMessages(
    store,
    index.sessionID,
    index.consciousnessID,
    prefix,
  );
  if (historical.size) {
    const retained = new Set(
      replacement.map((message) => hash(JSON.stringify(message))),
    );
    for (const message of historical)
      if (!retained.has(hash(JSON.stringify(message)))) return messages;
  }
  return [...replacement, ...messages.slice(prefix.length)];
}

/**
 * Match unresolved header candidates against persisted host snapshots by CAS
 * hash only (no body reads), stopping as soon as every candidate is resolved.
 */
function evidencedShas(
  store: Store,
  sessionID: string,
  wanted: Set<string>,
): Set<string> {
  const matched = new Set<string>();
  if (!wanted.size) return matched;
  for (const context of store.all<Context>("Context")) {
    if (
      context.session_id !== sessionID ||
      context.consciousness_revision === null
    )
      continue;
    for (const entry of context.messages) {
      if (entry.role !== "user") continue;
      const sha = entry.content.sha256;
      if (!wanted.has(sha)) continue;
      matched.add(sha);
      if (matched.size === wanted.size) return matched;
    }
  }
  return matched;
}

/**
 * This metadata is written only on host-created message objects. Master text
 * becomes content of a new plain UserMessage; it cannot set these object fields.
 * Keep the identity in ordinary JSON so a CAS read/restart cannot turn our own
 * header into an Input just because some historical Input has identical text.
 * Providers select their supported role/content fields; this tag is local evidence.
 */
function isOwnedHeader(index: HeaderIndex, message: AgentMessage): boolean {
  if (message.role !== "user") return false;
  const marker = (message as Partial<HeaderMessage>).secretary_memory_header;
  if (!marker || typeof marker !== "object") return false;
  const text = contentText(message.content);
  return (
    marker.version === 1 &&
    marker.session_id === index.sessionID &&
    marker.consciousness_id === index.consciousnessID &&
    Number.isSafeInteger(marker.revision) &&
    marker.revision > 0 &&
    marker.content_sha256 === hash(text) &&
    isHeaderShaped(text) &&
    JSON.parse(text.slice(WORKING_MEMORY_PREFIX.length)).revision ===
      marker.revision
  );
}

/**
 * Keep exactly one current memory header: remove the stale host header(s),
 * never remove a real Input (source identity: payload hash + received time),
 * never guess from the prefix alone. A user message that byte-equals the
 * canonical header while carrying real Input identity is kept; hidden
 * provenance is only used to find removals, never to preserve a header.
 */
function normalizeHeaders(
  store: Store,
  sessionID: string,
  index: HeaderIndex,
  messages: AgentMessage[],
): AgentMessage[] {
  if (!index.enabled) return messages;
  type Entry = {
    text: string;
    canonical: boolean;
    certified: boolean;
    shaped: boolean;
    sha: string | null;
  };
  const owned = messages.map((message) => isOwnedHeader(index, message));
  const entries: (Entry | null)[] = messages.map((message, position) => {
    // An unfamiliar or damaged explicit identity is not legacy evidence.
    // Preserve it rather than reinterpret it by text and accidentally delete it.
    if (
      message.role !== "user" ||
      owned[position] ||
      "secretary_memory_header" in message
    )
      return null;
    const text = contentText(message.content);
    if (!text.startsWith(WORKING_MEMORY_PREFIX)) return null;
    return {
      text,
      canonical: text === index.canonical,
      certified: false,
      shaped: isHeaderShaped(text),
      sha: null,
    };
  });
  // Certified real inputs: per source identity (text, timestamp) at most one
  // occurrence per Input record; the latest occurrences are protected so an
  // injected header that byte-equals an input is never certified as its own.
  const groups = new Map<string, number[]>();
  for (let i = 0; i < messages.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const timestamp = messages[i].timestamp;
    if (!Number.isFinite(timestamp)) continue;
    const key = `${hash(entry.text)}:${timestamp}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  for (const [key, indices] of groups) {
    const records = index.counts.get(key) ?? 0;
    const protectedCount = Math.min(records, indices.length);
    for (let n = 0; n < protectedCount; n++) {
      const entry = entries[indices[indices.length - 1 - n]];
      if (entry) entry.certified = true;
    }
  }
  // Legacy snapshots may not use Input.received_at as their timestamp. Preserve
  // legacy occurrences conservatively by text count, preferring the latest.
  // Explicit host identities were excluded above: unused historical Input
  // counts can never certify newly injected headers on a later projection.
  // Ambiguous old unmarked copies may remain; deleting real input is worse.
  const textGroups = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!entry) continue;
    const key = hash(entry.text),
      group = textGroups.get(key) ?? [];
    group.push(entry);
    textGroups.set(key, group);
  }
  for (const [key, group] of textGroups) {
    let remaining = Math.max(
      0,
      (index.textCounts.get(key) ?? 0) -
        group.filter((e) => e.certified).length,
    );
    for (let i = group.length - 1; i >= 0 && remaining > 0; i--)
      if (!group[i].certified) {
        group[i].certified = true;
        remaining--;
      }
  }
  // Lazy evidence: only unresolved, non-canonical, header-shaped candidates are
  // matched against persisted snapshots; with no candidates nothing is scanned.
  const wanted = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const entry = entries[i];
    if (!entry || entry.certified || entry.canonical || !entry.shaped) continue;
    entry.sha = hash(JSON.stringify(messages[i]));
    wanted.add(entry.sha);
  }
  const evidenced = wanted.size
    ? evidencedShas(store, sessionID, wanted)
    : new Set<string>();
  const kept: AgentMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (owned[i]) continue;
    const entry = entries[i];
    if (entry && !entry.certified) {
      if (entry.canonical) continue;
      if (entry.sha !== null && evidenced.has(entry.sha)) continue;
    }
    kept.push(messages[i]);
  }
  const header: HeaderMessage = {
    role: "user",
    content: index.canonical,
    timestamp: index.timestamp,
    secretary_memory_header: {
      version: 1,
      session_id: index.sessionID,
      consciousness_id: index.consciousnessID,
      revision: index.revision,
      content_sha256: hash(index.canonical),
    },
  };
  const first = kept.findIndex((message) => message.role !== "system");
  const at = first < 0 ? kept.length : first;
  return [...kept.slice(0, at), header, ...kept.slice(at)];
}

function isMandatory(
  index: HeaderIndex,
  message: AgentMessage,
  historical: Set<AgentMessage>,
): boolean {
  return (
    message.role === "system" ||
    historical.has(message) ||
    (message.role === "user" &&
      !isOwnedHeader(index, message) &&
      index.anchors.has(hash(contentText(message.content))))
  );
}

function completedSequence(store: Store, sessionID: string): number {
  let sequence = 0;
  for (const event of store.logs)
    if (
      event.scope.session_id === sessionID &&
      event.event_type === "input.handled"
    )
      sequence = Math.max(sequence, event.sequence);
  return sequence;
}

/**
 * Move the croppable limit backwards so no tool call inside the croppable
 * region is separated from its result (result in the protected tail or with no
 * result at all). The limit only ever shrinks; the loop reaches a fixpoint.
 */
function toolSafeLimit(messages: AgentMessage[], limit: number): number {
  let safe = clampIndex(limit, messages.length);
  for (;;) {
    let moved = false;
    for (let i = 0; i < safe && !moved; i++) {
      const message = messages[i];
      if (message.role !== "assistant") continue;
      for (const part of message.content) {
        if (part.type !== "toolCall") continue;
        let answered = false;
        for (let r = i + 1; r < safe; r++) {
          const result = messages[r];
          if (result.role === "toolResult" && result.toolCallId === part.id) {
            answered = true;
            break;
          }
        }
        if (!answered) {
          safe = i;
          moved = true;
          break;
        }
      }
    }
    if (!moved) return safe;
  }
}

/** Candidate cut positions: user messages that start a completed round, plus the limit. */
function cutBoundaries(source: AgentMessage[]): number[] {
  const boundaries: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const message = source[i];
    if (message.role !== "user") continue;
    if (i === 0) {
      boundaries.push(i);
      continue;
    }
    const previous = source[i - 1];
    if (previous.role === "assistant" && previous.stopReason === "stop")
      boundaries.push(i);
  }
  boundaries.push(source.length);
  return boundaries;
}

/** A cut may not drop a call while keeping its result. */
function cutSplitsToolPair(
  resultIndex: Map<string, number>,
  source: AgentMessage[],
  cut: number,
): boolean {
  for (let i = 0; i < cut; i++) {
    const message = source[i];
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "toolCall") continue;
      const result = resultIndex.get(part.id);
      if (result !== undefined && result >= cut) return true;
    }
  }
  return false;
}

function sameMessages(a: AgentMessage[], b: AgentMessage[]): boolean {
  return (
    a.length === b.length && hash(JSON.stringify(a)) === hash(JSON.stringify(b))
  );
}

/**
 * Next-request projection: apply an exact-prefix crop mapping, then keep a
 * single host-attested memory header. Pure; never mutates CAS objects or
 * commits, and classifies headers without reading stored Context bodies.
 */
export function projectContext({
  store,
  sessionID,
  consciousness,
  messages,
}: ProjectContextArgs): AgentMessage[] {
  const index = headerIndex(store, sessionID, consciousness);
  const mapping = consciousness.context_compaction;
  const view = mapping ? applyCrop(store, messages, mapping, index) : messages;
  return normalizeHeaders(store, sessionID, index, view);
}

/**
 * Build a context compaction candidate for a complete checkpoint. Returns the
 * prefix `source` and its cropped `replacement` for the root to persist, the
 * resulting `projected` view, and whether the cut reached the occupancy
 * target. Returns null when the request is below the normal threshold, when
 * committed memory does not cover the completed history, or when nothing can
 * be removed. Never deletes an anchor to reach the target: all anchors are
 * kept and `targetReached` stays false when they alone exceed it.
 */
export function buildCompaction({
  store,
  sessionID,
  consciousness,
  messages,
  protectedFromIndex,
  model,
}: BuildCompactionArgs): ProjectionCandidate | null {
  if (!messages.length) return null;
  const index = headerIndex(store, sessionID, consciousness);
  const config = budgetConfig();
  const mapping = consciousness.context_compaction;
  const current = normalizeHeaders(
    store,
    sessionID,
    index,
    mapping ? applyCrop(store, messages, mapping, index) : messages,
  );
  // An already small request is never compacted without need.
  if (requestBudget(model, current).occupancy < config.normal) return null;
  // Only history already covered by committed working memory may be cropped.
  if (
    (consciousness.covered_event_sequence ?? 0) <
      completedSequence(store, sessionID) ||
    !consciousness.memory_source_ref
  )
    return null;
  const limit = toolSafeLimit(
    messages,
    clampIndex(protectedFromIndex, messages.length),
  );
  const source = messages.slice(0, limit);
  if (!source.length) return null;
  const historical = historicalMasterMessages(
    store,
    sessionID,
    consciousness.id,
    source,
  );
  // If even the most aggressive cut (anchors only) cannot reach the target,
  // report that immediately instead of scanning every intermediate cut.
  const mandatoryOnly = source.filter((message) =>
    isMandatory(index, message, historical),
  );
  if (sameMessages(mandatoryOnly, source)) return null;
  const minimal = normalizeHeaders(store, sessionID, index, [
    ...mandatoryOnly,
    ...messages.slice(source.length),
  ]);
  if (requestBudget(model, minimal).occupancy > config.target)
    return {
      source,
      replacement: mandatoryOnly,
      projected: minimal,
      targetReached: false,
    };
  const resultIndex = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "toolResult" && !resultIndex.has(message.toolCallId))
      resultIndex.set(message.toolCallId, i);
  }
  // Least aggressive cut first: keep as much of the recent suffix as possible.
  let replacement = mandatoryOnly;
  let targetReached = false;
  for (const cut of cutBoundaries(source)) {
    if (cutSplitsToolPair(resultIndex, source, cut)) continue;
    const candidate = [
      ...source
        .slice(0, cut)
        .filter((message) => isMandatory(index, message, historical)),
      ...source.slice(cut),
    ];
    if (sameMessages(candidate, source)) continue;
    const projection = normalizeHeaders(store, sessionID, index, [
      ...candidate,
      ...messages.slice(source.length),
    ]);
    if (requestBudget(model, projection).occupancy <= config.target) {
      replacement = candidate;
      targetReached = true;
      break;
    }
  }
  return {
    source,
    replacement,
    projected: normalizeHeaders(store, sessionID, index, [
      ...replacement,
      ...messages.slice(source.length),
    ]),
    targetReached,
  };
}
