import { attachmentMessage, attachmentForm } from "./attachment-form.ts";
import { isTimerMessage } from "./input-origin.ts";
import { contentText, type Api, type Model } from "@earendil-works/pi-ai";
import type { AgentMessage } from "./model.ts";
import type {
  Consciousness,
  Input,
  ObjectRef,
  CompactionJob,
  SettingsApplication,
} from "./contracts.ts";
import { hash, shapeDefinition, type Store } from "./store.ts";
import { requestBudget, budgetConfig } from "./budget.ts";
import {
  historicalMasterAnchors,
  historicalMasterText,
  historicalSubset,
} from "./historical-inputs.ts";
import type { SettingsSource } from "./settings-memory.ts";
import {
  authenticatedIdentityHash,
  typedMessageText,
} from "./attachment-form.ts";

export type CoverageSnapshot = {
  version: 1;
  session_id: string;
  journal_sequence: number;
  journal_digest: string;
  settings_application_id?: string;
};
export type InputProjectionReceipt = {
  version: 1;
  session_id: string;
  policy_id: string;
  considered_journal_sequence: number;
  coverage_ref: ObjectRef;
  window_input_ids: string[];
};
export function inputWindowConfig() {
  const count = Number(process.env.SECRETARY_RECENT_INPUT_MAX_COUNT ?? 12);
  const ratio = Number(process.env.SECRETARY_RECENT_INPUT_BUDGET_RATIO ?? 0.15);
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 100 ||
    !Number.isFinite(ratio) ||
    ratio < 0 ||
    ratio > 0.25 ||
    process.env.SECRETARY_RECENT_INPUT_MAX_COUNT?.trim() === "" ||
    process.env.SECRETARY_RECENT_INPUT_BUDGET_RATIO?.trim() === ""
  )
    throw Error("INPUT_WINDOW_CONFIG_INVALID");
  return { count, ratio };
}
export function inputMessage(
  store: Store,
  input: Input,
): Extract<AgentMessage, { role: "user" }> {
  if (input.attachments?.length)
    return attachmentMessage(store, input) as Extract<
      AgentMessage,
      { role: "user" }
    >;
  return {
    role: "user",
    content: store.bytes(input.payload).toString(),
    timestamp: Date.parse(input.received_at),
    secretary_input: {
      version: 1,
      session_id: input.session_id,
      input_id: input.id,
      content_sha256: input.payload.sha256,
    },
  } as Extract<AgentMessage, { role: "user" }>;
}
function inputs(store: Store, sessionID: string) {
  return store
    .all<Input>("Input")
    .filter((i) => i.session_id === sessionID && i.producer === "MASTER");
}
// Untagged legacy messages require a unique occurrence identity. Text alone is never authority.
function identify(
  store: Store,
  sessionID: string,
  message: AgentMessage,
): Input | undefined {
  if (message.role !== "user") return;
  const tag = (
    message as unknown as {
      secretary_input?: {
        version: number;
        session_id: string;
        input_id: string;
        content_sha256: string;
      };
    }
  ).secretary_input;
  const form = attachmentForm(store, message);
  if (form) return form.input.session_id === sessionID ? form.input : undefined;
  const text = contentText(message.content);
  if (tag) {
    const input = store.find<Input>("Input", tag.input_id);
    if (
      tag.version === 1 &&
      tag.session_id === sessionID &&
      input?.session_id === sessionID &&
      input.producer === "MASTER" &&
      !input.attachments?.length &&
      tag.content_sha256 === input.payload.sha256 &&
      hash(text) === input.payload.sha256 &&
      message.timestamp === Date.parse(input.received_at)
    )
      return input;
    return;
  }
  const candidates = store
    .all<Input>("Input")
    .filter(
      (i) =>
        i.session_id === sessionID &&
        !i.attachments?.length &&
        i.payload.sha256 === hash(text) &&
        Date.parse(i.received_at) === message.timestamp,
    );
  if (candidates.length === 1 && candidates[0].producer === "MASTER")
    return candidates[0];
}
function verifySnapshot(store: Store, value: CoverageSnapshot) {
  shapeDefinition("InputCoverageSnapshot", value);
  const digest =
    value.journal_sequence === 0
      ? "0".repeat(64)
      : store.projectionFrames.find(
          (f) => f.sequence === value.journal_sequence,
        )?.digest;
  if (digest !== value.journal_digest)
    throw Error("INPUT_COVERAGE_SOURCE_MISMATCH");
}
// At most two immutable proof views per Store; never persisted as another ledger.
const coverageCache = new WeakMap<Store, Map<string, Set<string>>>();
function coveredInputs(
  store: Store,
  snapshot: CoverageSnapshot,
  pending?: { id: string; source: SettingsSource },
): Set<string> {
  verifySnapshot(store, snapshot);
  if (
    snapshot.settings_application_id &&
    pending?.id !== snapshot.settings_application_id &&
    store.find<SettingsApplication>(
      "SettingsApplication",
      snapshot.settings_application_id,
    )?.state !== "APPLIED"
  )
    throw Error("INPUT_PROJECTION_OWNER_NOT_APPLIED");
  const key = hash(JSON.stringify(snapshot));
  let cache = coverageCache.get(store);
  if (!cache) coverageCache.set(store, (cache = new Map()));
  const cached = cache.get(key);
  if (cached) return cached;
  const result = new Set<string>();
  const events = new Map(store.logs.map((e) => [e.event_id, e]));
  const observe = (message: AgentMessage) => {
    const input = identify(store, snapshot.session_id, message);
    if (input && input.state !== "WITHDRAWN") result.add(input.id);
  };
  // Inspect immutable owner snapshots at the frozen boundary, never a mutable watermark alone.
  const owners = new Map<string, CompactionJob | SettingsApplication>();
  for (const frame of store.projectionFrames) {
    if (frame.sequence > snapshot.journal_sequence) break;
    for (const mutation of frame.mutations) {
      if (
        !["CompactionJob", "SettingsApplication"].includes(mutation.object_type)
      )
        continue;
      const owner = store.read<CompactionJob | SettingsApplication>(
        mutation.snapshot,
      );
      if (owner.session_id === snapshot.session_id) owners.set(owner.id, owner);
    }
  }
  const settingsEvidence = (source: SettingsSource) => {
    if (source.consciousness.session_id !== snapshot.session_id)
      throw Error("INVALID_INPUT_SETTINGS_COVERAGE");
    // Old sources without frozen extraction identities do not grant exit eligibility.
    if (!source.plan || !Array.isArray(source.extraction_messages)) return;
    const ref = source.refs.at(-1);
    if (!ref) throw Error("INVALID_INPUT_SETTINGS_COVERAGE");
    const raw = store
      .read<AgentMessage[]>(ref)
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          !isTimerMessage(store, m) &&
          !!typedMessageText(store, m),
      );
    if (raw.length !== source.extraction_messages.length)
      throw Error("INVALID_INPUT_SETTINGS_COVERAGE");
    raw.forEach((message, index) => {
      const form = attachmentForm(store, message, source.attachment_boundary);
      if (form && !source.attachment_boundary)
        throw Error("INVALID_INPUT_SETTINGS_COVERAGE");
      const entry = source.extraction_messages[index];
      const event = events.get(entry.id);
      const exact = /^[a-f0-9]{64}:\d+$/.test(entry.id)
        ? authenticatedIdentityHash(store, message) === entry.id.slice(0, 64)
        : !!event &&
          event.event_type === "main.message" &&
          event.scope.session_id === snapshot.session_id &&
          event.sequence <= source.end_sequence &&
          authenticatedIdentityHash(
            store,
            store.read<AgentMessage>(event.payload),
          ) === authenticatedIdentityHash(store, message);
      if (
        !exact ||
        entry.role !== message.role ||
        entry.text !== typedMessageText(store, message)
      )
        throw Error("INVALID_INPUT_SETTINGS_COVERAGE");
      observe(message);
    });
    // Image-only inputs have summary metadata but deliberately no quote source.
    for (const message of store.read<AgentMessage[]>(ref)) {
      const form = attachmentForm(store, message, source.attachment_boundary);
      if (form) {
        if (!source.attachment_boundary)
          throw Error("INVALID_INPUT_SETTINGS_COVERAGE");
        observe(message);
      }
    }
  };
  for (const owner of owners.values()) {
    if (
      owner.record_type === "CompactionJob" &&
      owner.state === "COMMITTED" &&
      owner.mode === "WORKING_MEMORY" &&
      owner.candidate_ref
    ) {
      const evidence = new Set(
        owner.source_refs.flatMap((ref) =>
          store
            .read<AgentMessage[]>(ref)
            .map((m) => authenticatedIdentityHash(store, m)),
        ),
      );
      for (const eventID of owner.source_event_ids) {
        const event = events.get(eventID);
        if (
          !event ||
          event.event_type !== "main.message" ||
          event.scope.session_id !== snapshot.session_id ||
          event.sequence > (owner.source_end_sequence ?? 0)
        )
          throw Error("INVALID_INPUT_SUMMARY_COVERAGE");
        const message = store.read<AgentMessage>(event.payload);
        if (
          !evidence.has(authenticatedIdentityHash(store, message)) ||
          !owner.covered_event_ids.includes(eventID)
        )
          throw Error("INVALID_INPUT_SUMMARY_COVERAGE");
        observe(message);
      }
    } else if (
      owner.record_type === "SettingsApplication" &&
      owner.state === "APPLIED" &&
      owner.source_ref
    )
      settingsEvidence(store.read<SettingsSource>(owner.source_ref));
  }
  if (snapshot.settings_application_id) {
    if (pending?.id === snapshot.settings_application_id)
      settingsEvidence(pending.source);
    else {
      const app = store.find<SettingsApplication>(
        "SettingsApplication",
        snapshot.settings_application_id,
      );
      if (
        !app ||
        app.state !== "APPLIED" ||
        app.session_id !== snapshot.session_id ||
        !app.source_ref
      )
        throw Error("INPUT_PROJECTION_OWNER_NOT_APPLIED");
      settingsEvidence(store.read<SettingsSource>(app.source_ref));
    }
  }
  cache.set(key, result);
  if (cache.size > 2) cache.delete(cache.keys().next().value!);
  return result;
}
function receipt(
  store: Store,
  cs: Consciousness,
): InputProjectionReceipt | undefined {
  if (!cs.input_projection_ref) return;
  const value = store.read<InputProjectionReceipt>(cs.input_projection_ref);
  shapeDefinition("InputProjectionReceipt", value);
  if (value.session_id !== cs.session_id)
    throw Error("INPUT_PROJECTION_SESSION_MISMATCH");
  return value;
}
function rewrite(
  store: Store,
  sessionID: string,
  csID: string,
  messages: AgentMessage[],
  keep: (input: Input, index: number) => boolean,
  pending?: SettingsSource,
): AgentMessage[] {
  const historical = pending
    ? new Map(
        messages
          .filter(
            (m) =>
              m.role === "user" &&
              m.content === historicalMasterText(pending.anchors),
          )
          .map((m) => [m, pending.anchors]),
      )
    : historicalMasterAnchors(store, sessionID, csID, messages);
  return messages.flatMap((message, index) => {
    const anchors = historical.get(message);
    if (anchors) {
      const selected = anchors.filter((a) =>
        keep(store.get<Input>("Input", a.input_id), index),
      );
      return selected.length
        ? [
            selected.length === anchors.length
              ? message
              : pending
                ? ({
                    ...message,
                    content: historicalMasterText(selected),
                  } as AgentMessage)
                : historicalSubset(store, message, selected),
          ]
        : [];
    }
    const input = identify(store, sessionID, message);
    return !input || keep(input, index) ? [message] : [];
  });
}
export function applyInputProjection(
  store: Store,
  cs: Consciousness,
  messages: AgentMessage[],
): AgentMessage[] {
  const previous = receipt(store, cs);
  if (!previous) return messages;
  const coverage = coveredInputs(
    store,
    store.read<CoverageSnapshot>(previous.coverage_ref),
  );
  const kept = new Set(previous.window_input_ids);
  return rewrite(
    store,
    cs.session_id,
    cs.id,
    messages,
    (i) =>
      !coverage.has(i.id) ||
      store.firstSequence("Input", i.id) >
        previous.considered_journal_sequence ||
      kept.has(i.id),
  );
}
export function selectInputProjection(args: {
  store: Store;
  consciousness: Consciousness;
  messages: AgentMessage[];
  model: Model<Api>;
  protectedFromIndex: number;
  searchReady: boolean;
  pending?: { id: string; source: SettingsSource };
}): { messages: AgentMessage[]; receiptRef?: ObjectRef } {
  const { store, consciousness: cs, model, protectedFromIndex, pending } = args;
  const protectedIDs = new Set<string>();
  rewrite(
    store,
    cs.session_id,
    cs.id,
    args.messages,
    (i, index) => {
      if (index >= protectedFromIndex) protectedIDs.add(i.id);
      return true;
    },
    pending?.source,
  );
  let messages = pending
    ? args.messages
    : applyInputProjection(store, cs, args.messages);
  if (!args.searchReady) {
    if (pending) {
      const prev = receipt(store, cs);
      if (prev) {
        const covered = coveredInputs(
          store,
          store.read<CoverageSnapshot>(prev.coverage_ref),
        );
        const window = new Set(prev.window_input_ids);
        messages = rewrite(
          store,
          cs.session_id,
          cs.id,
          messages,
          (i) =>
            !covered.has(i.id) ||
            store.firstSequence("Input", i.id) >
              prev.considered_journal_sequence ||
            window.has(i.id),
          pending.source,
        );
      }
    }
    return { messages, receiptRef: cs.input_projection_ref };
  }
  const snapshot: CoverageSnapshot = {
    version: 1,
    session_id: cs.session_id,
    journal_sequence: store.sequence,
    journal_digest: store.digest,
    ...(pending ? { settings_application_id: pending.id } : {}),
  };
  const coverage = coveredInputs(store, snapshot, pending);
  const previous = receipt(store, cs);
  const priorCoverage = previous
    ? coveredInputs(store, store.read<CoverageSnapshot>(previous.coverage_ref))
    : new Set<string>();
  const resident = new Set(previous?.window_input_ids ?? []);
  const eligible = inputs(store, cs.session_id).filter(
    (i) =>
      i.state === "HANDLED" &&
      coverage.has(i.id) &&
      !(
        previous &&
        store.firstSequence("Input", i.id) <=
          previous.considered_journal_sequence &&
        priorCoverage.has(i.id) &&
        !resident.has(i.id)
      ),
  );
  // Only inputs actually present in this projection may consume the window. Never resurrect removed raw text.
  const present = new Set<string>();
  rewrite(
    store,
    cs.session_id,
    cs.id,
    messages,
    (i, index) => {
      if (!protectedIDs.has(i.id)) present.add(i.id);
      return true;
    },
    pending?.source,
  );
  const config = inputWindowConfig(),
    selected = new Set<string>();
  const mandatory = rewrite(
    store,
    cs.session_id,
    cs.id,
    messages,
    (i, index) =>
      protectedIDs.has(i.id) || i.state !== "HANDLED" || !coverage.has(i.id),
    pending?.source,
  );
  const baseBudget = requestBudget(model, mandatory);
  const allowance = Math.min(
    baseBudget.usable_input_tokens * config.ratio,
    Math.max(
      0,
      baseBudget.usable_input_tokens * budgetConfig().target -
        baseBudget.estimated_tokens,
    ),
  );
  for (const input of eligible.sort(
    (a, b) =>
      store.firstSequence("Input", b.id) - store.firstSequence("Input", a.id),
  )) {
    if (selected.size >= config.count) break;
    if (!present.has(input.id)) continue;
    const trial = new Set([...selected, input.id]);
    const next = rewrite(
      store,
      cs.session_id,
      cs.id,
      messages,
      (i, index) =>
        protectedIDs.has(i.id) ||
        i.state !== "HANDLED" ||
        !coverage.has(i.id) ||
        trial.has(i.id),
      pending?.source,
    );
    const cost =
      requestBudget(model, next).estimated_tokens - baseBudget.estimated_tokens;
    if (cost <= allowance) selected.add(input.id);
  }
  messages = rewrite(
    store,
    cs.session_id,
    cs.id,
    messages,
    (i, index) =>
      protectedIDs.has(i.id) ||
      i.state !== "HANDLED" ||
      !coverage.has(i.id) ||
      selected.has(i.id),
    pending?.source,
  );
  const value: InputProjectionReceipt = {
    version: 1,
    session_id: cs.session_id,
    policy_id: hash(JSON.stringify({ config, budget: baseBudget.policy_id })),
    considered_journal_sequence: store.sequence,
    coverage_ref: store.put(snapshot),
    window_input_ids: [...selected],
  };
  shapeDefinition("InputProjectionReceipt", value);
  return { messages, receiptRef: store.put(value) };
}
