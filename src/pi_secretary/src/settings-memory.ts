import { contentText } from "@earendil-works/pi-ai";
import { activitiesFor } from "./activity.ts";
import { extractNewCommitments } from "./memory-extraction.ts";
import { hash } from "./store.ts";
import { type AgentMessage } from "./model.ts";
import type { Host } from "./host.ts";
import type {
  Consciousness,
  CompactionJob,
  Context,
  Input,
  MemoryCommitment,
  ObjectRef,
  WorkItem,
} from "./contracts.ts";
import { migrateCommitments, reconcileCommitments } from "./memory.ts";
import {
  createSummaryPlan,
  runSummary,
  type SummaryPlan,
  type SummaryCandidate,
} from "./summary.ts";
import type { SettingsPayload } from "./settings-payload.ts";
export type SettingsSource = {
  consciousness: Consciousness;
  context_id: string | null;
  end_sequence: number;
  refs: ObjectRef[];
  message_hashes: string[];
  chunks: string[];
  plan: SummaryPlan;
  extraction_messages: {
    id: string;
    text: string;
    role?: "user" | "assistant";
  }[];
  anchors: { input_id: string; text: string }[];
  changes: unknown;
};
export type SettingsCandidate = SummaryCandidate & {
  items: WorkItem[];
  commitments: MemoryCommitment[];
  extraction_complete?: boolean;
};
export function settingsSource(host: Host, changes: unknown): SettingsSource {
  const store = host.store,
    session = host.session;
  const cs = store.get<Consciousness>(
    "Consciousness",
    session.consciousness_id,
  );
  const refs = [...cs.pending_raw_refs];
  if (session.last_context_id) {
    const context = store.get<Context>("Context", session.last_context_id);
    if (context.pending_tool_call_ids.length)
      throw Error("PENDING_TOOLS_REQUIRE_RECOVERY");
    refs.push(context.raw_context);
  }
  const covered = new Set(cs.covered_message_hashes ?? []);
  if (cs.last_job_id) {
    const job = store.get<CompactionJob>("CompactionJob", cs.last_job_id);
    for (const ref of job.source_refs)
      for (const message of store.read<AgentMessage[]>(ref))
        covered.add(hash(JSON.stringify(message)));
  }
  const uniqueRefs = [...new Map(refs.map((r) => [r.sha256, r])).values()];
  const messages = new Map<string, AgentMessage>();
  for (const ref of uniqueRefs) {
    const raw = store.read<AgentMessage[]>(ref);
    if (!Array.isArray(raw)) throw Error("INVALID_MEMORY_SOURCE");
    const occurrences = new Map<string, number>();
    for (const m of raw) {
      const key = hash(JSON.stringify(m));
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      if (m.role !== "system" && !covered.has(key))
        messages.set(`${key}:${occurrence}`, m);
    }
  }
  const snapshotKeys = new Map<string, string[]>();
  for (const key of messages.keys()) {
    const digest = key.slice(0, 64);
    const keys = snapshotKeys.get(digest) ?? [];
    keys.push(key);
    snapshotKeys.set(digest, keys);
  }
  // Include session events absent from the latest context/reference collection.
  for (const event of store.logs) {
    if (
      event.scope.session_id !== session.id ||
      event.event_type !== "main.message" ||
      event.sequence <= (cs.covered_event_sequence ?? 0)
    )
      continue;
    const m = store.read<AgentMessage>(event.payload);
    const key = hash(JSON.stringify(m));
    if (m.role !== "system") {
      // Replace at most one snapshot occurrence; retain every distinct event ID.
      const snapshotKey = snapshotKeys.get(key)?.pop();
      if (snapshotKey) messages.delete(snapshotKey);
      messages.set(event.event_id, m);
    }
  }
  // Keep event identities in new-policy stores, including identical message bodies.
  // The complete evidence snapshot backs extraction even for events absent from Context.
  const evidence = store.put([...messages.values()]);
  if (messages.size) uniqueRefs.push(evidence);
  const plan = createSummaryPlan({
    model: host.model,
    items: cs.items,
    commitments: migrateCommitments(cs),
    sources: [...messages].map(([id, message]) => ({
      id,
      text: JSON.stringify(message),
    })),
    extra: { settings_changes: settingsNotice(changes) },
  });
  const chunks = plan.chunks;
  return {
    consciousness: cs,
    context_id: session.last_context_id,
    end_sequence: store.eventSequence,
    refs: uniqueRefs,
    message_hashes: [
      ...new Set([
        ...covered,
        ...[...messages.values()].map((m) => hash(JSON.stringify(m))),
      ]),
    ],
    chunks,
    plan,
    extraction_messages: [...messages]
      .filter(([, m]) => m.role === "user" || m.role === "assistant")
      .map(([id, m]) => ({
        id,
        text: "content" in m ? contentText(m.content) : "",
        role: m.role as "user" | "assistant",
      })),
    anchors: store
      .all<Input>("Input")
      .filter(
        (i) =>
          i.session_id === session.id &&
          i.producer === "MASTER" &&
          i.state === "HANDLED",
      )
      .map((i) => ({
        input_id: i.id,
        text: store.bytes(i.payload).toString(),
      })),
    changes,
  };
}
export function settingsNotice(changes: unknown) {
  const value = changes as {
    world:
      | import("./contracts.ts").WorldChange[]
      | import("./contracts.ts").WorldCatalogChange[];
    instructions: SettingsPayload["instructions"];
    runtime_change?: string;
  };
  return {
    // expected_revision is a compare-and-swap precondition, not the active version.
    // Keep it in the durable settings payload, never present it as memory content.
    instructions: value.instructions
      ? { content: value.instructions.content }
      : null,
    runtime_change: value.runtime_change,
    world: value.world.map((c) =>
      c.record_type === "WorldChange"
        ? {
            mode: c.mode,
            subject_id: c.subject_id,
            predicate_key: c.predicate_key,
            scope_key: c.scope_key,
            value: c.value,
            object_entity_id: c.object_entity_id,
            assertion_id: c.assertion_id,
            replaces_assertion_id: c.replaces_assertion_id,
            valid_from: c.valid_from,
            valid_to: c.valid_to,
          }
        : {
            kind: c.kind,
            entity_id: c.entity_id,
            display_name: c.display_name,
          },
    ),
  };
}
export async function summarizeSettings(
  host: Host,
  applicationID: string,
  source: SettingsSource,
  candidate: SettingsCandidate | null,
  checkpoint: (candidate: SettingsCandidate) => void,
) {
  let current: SettingsCandidate = candidate ?? {
    items: source.consciousness.items,
    commitments: migrateCommitments(source.consciousness),
    completed: 0,
  };
  const activity = activitiesFor(host.store),
    activityID = "settings:" + applicationID;
  const summary = await runSummary({
    store: host.store,
    model: host.model,
    stream: host.stream,
    sessionID: host.sessionID,
    loopID: applicationID,
    consciousnessRevision: source.consciousness.revision,
    refs: source.refs,
    plan: source.plan,
    commitments: migrateCommitments(source.consciousness),
    candidate: current,
    checkpoint: (value) => {
      current = { ...current, ...value };
      checkpoint(current);
    },
    progress: (index, attempt, error) =>
      activity.step(
        activityID,
        attempt > 1
          ? `重试 2/2：${error ?? "上次摘要未完成"}`
          : "正在重建设置上下文",
        {
          current: index + 1,
          completed: current.completed,
          total: source.chunks.length,
          attempt,
          max_attempts: 2,
        },
      ),
  });
  current = { ...current, ...summary };
  if (!current.extraction_complete && source.chunks.length) {
    activity.step(activityID, "正在提取承诺", {
      current: source.chunks.length,
      completed: current.completed,
      total: source.chunks.length,
    });
    const quotes = await extractNewCommitments({
      store: host.store,
      model: host.model,
      stream: host.stream,
      sessionID: host.sessionID,
      loopID: applicationID,
      consciousnessRevision: source.consciousness.revision,
      source: null,
      completeMessages: source.extraction_messages,
      extractionKey: applicationID + ":" + source.plan.source_hash,
      existing: current.commitments,
    });
    const proposed = structuredClone(current.items);
    if (proposed.length) proposed[0].unfulfilled_commitments = quotes;
    let commitments = current.commitments;
    for (const ref of source.refs)
      commitments = reconcileCommitments(
        host.store,
        { ...source.consciousness, commitments },
        proposed,
        ref,
        current.resolutions ?? [],
        source.end_sequence,
      );
    current = { ...current, commitments, extraction_complete: true };
    checkpoint(current);
  }
  return current;
}
export function rebuiltMessages(
  source: SettingsSource,
  candidate: SettingsCandidate,
  applicationID: string,
  revision: number,
): AgentMessage[] {
  return [
    {
      role: "user",
      timestamp: Date.now(),
      content:
        "Working memory (source history remains queryable): " +
        JSON.stringify({
          revision,
          items: candidate.items,
          commitments: candidate.commitments,
        }),
    },
    {
      role: "user",
      timestamp: Date.now(),
      content:
        "Settings activation record (host-owned current versions; supersedes conflicting historical statements; retractions do not assert their opposite): " +
        JSON.stringify({
          application_id: applicationID,
          changes: settingsNotice(source.changes),
        }),
    },
    ...(source.anchors.length
      ? [
          {
            role: "user" as const,
            timestamp: Date.now(),
            content:
              "Historical Master inputs retained to preserve explicit constraints. These are historical evidence, not new requests to execute. Current settings and authoritative World queries supersede old preferences/facts. Do not replay tasks.\n" +
              JSON.stringify(source.anchors),
          },
        ]
      : []),
  ];
}
