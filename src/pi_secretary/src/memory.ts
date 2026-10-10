import { presentedNotification } from "./notification-service.ts";
import { hash, type Store } from "./store.ts";
import { messageIdentityHash } from "./message-identity.ts";
import type { AgentMessage } from "./model.ts";
import type {
  Consciousness,
  MemoryCommitment,
  WorkItem,
  ObjectRef,
  Notification,
  TaskResult,
  Context,
  CompactionJob,
  SettingsApplication,
  OperationLogRecord,
  CommitmentSourceBatch,
} from "./contracts.ts";

// A quote blob alone is not provenance. Tie it back to a durable owner and
// verify that the exact snapshot was assembled from this session's events.
function sourcePrecedesDelivery(
  store: Store,
  cs: Consciousness,
  commitment: MemoryCommitment,
  delivery: OperationLogRecord,
) {
  const quoteIn = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(quoteIn);
    if (
      !value ||
      typeof value !== "object" ||
      !("role" in value) ||
      !["user", "assistant"].includes(String(value.role)) ||
      !("content" in value)
    )
      return false;
    const text =
      typeof value.content === "string"
        ? value.content
        : Array.isArray(value.content)
          ? value.content
              .filter((p) => p?.type === "text" && typeof p.text === "string")
              .map((p) => p.text)
              .join("\n")
          : "";
    return text.includes(commitment.text);
  };
  const deliveredAt = Date.parse(delivery.occurred_at);
  if (!commitment.source_refs.length || !Number.isFinite(deliveredAt))
    return false;
  const beforeDelivery = (time: string) => {
    const value = Date.parse(time);
    return Number.isFinite(value) && value < deliveredAt;
  };
  const earlier = (event: OperationLogRecord) =>
    event.event_type === "main.message" &&
    event.scope.session_id === cs.session_id &&
    event.sequence < delivery.sequence &&
    beforeDelivery(event.occurred_at);
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const eventByID = new Map(store.logs.map((event) => [event.event_id, event]));
  const batch = commitment.source_batch;
  if (batch) {
    // Content-addressed blobs can recur in unrelated later batches. Only the
    // owner that actually committed this ledger entry may vouch for its events.
    const owner =
      batch.owner_type === "CompactionJob"
        ? store.find<CompactionJob>("CompactionJob", batch.owner_id)
        : store.find<SettingsApplication>(
            "SettingsApplication",
            batch.owner_id,
          );
    if (
      !owner ||
      owner.session_id !== cs.session_id ||
      !owner.candidate_ref ||
      (owner.record_type === "CompactionJob"
        ? owner.state !== "COMMITTED" || owner.mode !== "WORKING_MEMORY"
        : owner.state !== "APPLIED")
    )
      return false;
    const saved = store.read<{ commitments?: MemoryCommitment[] }>(
      owner.candidate_ref,
    ).commitments;
    if (
      !saved?.some(
        (c) =>
          c.id === commitment.id &&
          c.text === commitment.text &&
          same(c.source_refs, commitment.source_refs) &&
          same(c.source_batch, batch),
      )
    )
      return false;
    let refs: ObjectRef[], ids: string[], end: number;
    if (owner.record_type === "CompactionJob") {
      refs = owner.source_refs;
      ids = owner.source_event_ids;
      end = owner.source_end_sequence ?? -1;
    } else {
      if (!owner.source_ref) return false;
      const source = store.read<import("./settings-memory.ts").SettingsSource>(
        owner.source_ref,
      );
      refs = source.refs;
      ids = source.extraction_messages
        .filter((m) => !/^[a-f0-9]{64}:\d+$/.test(m.id))
        .map((m) => m.id);
      end = source.end_sequence;
    }
    if (
      !same(ids, batch.source_event_ids) ||
      end !== batch.source_end_sequence ||
      !ids.length ||
      new Set(ids).size !== ids.length
    )
      return false;
    const events = ids.map((id) => eventByID.get(id));
    if (
      events.some(
        (event) =>
          !event ||
          event.event_type !== "main.message" ||
          event.scope.session_id !== cs.session_id ||
          event.sequence > end,
      )
    )
      return false;
    const actual = events as OperationLogRecord[];
    return commitment.source_refs.every((ref) => {
      if (!refs.some((source) => same(source, ref))) return false;
      const snapshot = store.read<unknown>(ref);
      if (!Array.isArray(snapshot) || !quoteIn(snapshot)) return false;
      if (
        owner.record_type === "CompactionJob" &&
        hash(
          JSON.stringify(actual.map((event) => store.read(event.payload))),
        ) !== ref.sha256
      )
        return false;
      const origins = snapshot
        .filter(quoteIn)
        .map((message) =>
          actual.filter(
            (event) =>
              messageIdentityHash(store.read<AgentMessage>(event.payload)) ===
              messageIdentityHash(message as AgentMessage),
          ),
        );
      return (
        origins.length > 0 &&
        origins.every((events) => events.length > 0 && events.every(earlier))
      );
    });
  }
  // A pre-field event blob has no durable link to the batch which introduced
  // this commitment. Do not reconstruct that missing identity by searching for
  // a convenient owner with the same content hash, even when a Context shares it.
  const eventSnapshotHashes = new Set<string>();
  const seenOwners = new Set<string>(),
    seenBatches = new Set<string>(),
    seenSources = new Set<string>();
  const payloads = new Map<string, unknown>();
  const payload = (ref: ObjectRef) => {
    if (!payloads.has(ref.sha256)) payloads.set(ref.sha256, store.read(ref));
    return payloads.get(ref.sha256);
  };
  // Classification is monotonic: retries or later owner revisions must never
  // erase the fact that these bytes were captured as an event batch. The Store
  // exposes only verified, committed immutable journal snapshots here.
  for (const frame of store.projectionFrames)
    for (const mutation of frame.mutations) {
      if (
        !["CompactionJob", "SettingsApplication"].includes(
          mutation.object_type,
        ) ||
        seenOwners.has(mutation.snapshot.sha256)
      )
        continue;
      seenOwners.add(mutation.snapshot.sha256);
      const owner = store.read<CompactionJob | SettingsApplication>(
        mutation.snapshot,
      );
      if (owner.session_id !== cs.session_id) continue;
      if (owner.record_type === "CompactionJob") {
        if (owner.mode !== "WORKING_MEMORY" || !owner.source_event_ids.length)
          continue;
        const key = JSON.stringify(owner.source_event_ids);
        if (seenBatches.has(key)) continue;
        seenBatches.add(key);
        const events = owner.source_event_ids.map((id) => eventByID.get(id));
        if (
          events.every(
            (event) =>
              event?.event_type === "main.message" &&
              event.scope.session_id === cs.session_id,
          )
        )
          eventSnapshotHashes.add(
            hash(
              JSON.stringify(events.map((event) => payload(event!.payload))),
            ),
          );
      } else {
        if (!owner.source_ref || seenSources.has(owner.source_ref.sha256))
          continue;
        seenSources.add(owner.source_ref.sha256);
        const source = store.read<
          import("./settings-memory.ts").SettingsSource
        >(owner.source_ref);
        // The final ref is the assembled evidence snapshot in settingsSource.
        if (
          source.extraction_messages?.some((m) => {
            const event = eventByID.get(m.id);
            return (
              event?.event_type === "main.message" &&
              event.scope.session_id === cs.session_id
            );
          }) &&
          source.refs.length
        )
          eventSnapshotHashes.add(source.refs.at(-1)!.sha256);
      }
    }
  return commitment.source_refs.every((ref) => {
    if (
      eventSnapshotHashes.has(ref.sha256) ||
      !quoteIn(store.read<unknown>(ref))
    )
      return false;
    const contexts = store
      .all<Context>("Context")
      .filter(
        (ctx) =>
          ctx.session_id === cs.session_id &&
          ctx.purpose === "MAIN" &&
          ctx.raw_context.sha256 === ref.sha256,
      );
    return (
      contexts.length > 0 &&
      contexts.every((ctx) => beforeDelivery(ctx.updated_at))
    );
  });
}

function commitmentID(text: string) {
  const h = hash(text);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function migrateCommitments(cs: Consciousness): MemoryCommitment[] {
  if (cs.commitments) return structuredClone(cs.commitments);
  const entries = new Map<string, MemoryCommitment>();
  for (const item of cs.items)
    for (const text of item.unfulfilled_commitments) {
      const key = commitmentID(cs.id + text);
      const old = entries.get(key);
      entries.set(key, {
        id: key,
        text,
        state: "OPEN",
        source_refs: old?.source_refs ?? item.source_refs,
        task_refs: [...new Set([...(old?.task_refs ?? []), ...item.task_refs])],
        resolution_event_ids: [],
      });
    }
  return [...entries.values()];
}
export function reconcileCommitments(
  store: Store,
  cs: Consciousness,
  items: WorkItem[],
  source: ObjectRef,
  resolutions: { id: string; event_id: string }[] = [],
  sourceEnd = Infinity,
  sourceBatch?: CommitmentSourceBatch,
): MemoryCommitment[] {
  const ledger = migrateCommitments(cs);
  // Only a quote present in the source can introduce a new pending obligation.
  // Existing IDs/text survive paraphrases and omissions in the model's candidate.
  const raw = store.bytes(source).toString();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  // Match decoded message text, never JSON keys, escaped serialization or tool data.
  const original: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      original.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("role" in value) ||
      !("content" in value) ||
      !["user", "assistant"].includes(String(value.role))
    )
      return;
    if (typeof value.content === "string") original.push(value.content);
    else if (Array.isArray(value.content))
      original.push(
        value.content
          .filter(
            (part) =>
              part && part.type === "text" && typeof part.text === "string",
          )
          .map((part) => part.text)
          .join("\n"),
      );
  };
  visit(parsed);
  for (const item of items)
    for (const text of item.unfulfilled_commitments) {
      if (
        !original.some((body) => body.includes(text)) ||
        ledger.some((c) => c.text === text)
      )
        continue;
      ledger.push({
        id: commitmentID(cs.id + text),
        text,
        state: "OPEN",
        source_refs: [source],
        ...(sourceBatch ? { source_batch: structuredClone(sourceBatch) } : {}),
        task_refs: item.task_refs,
        resolution_event_ids: [],
      });
    }
  for (const proposed of resolutions) {
    const c = ledger.find((c) => c.id === proposed.id && c.state === "OPEN");
    const event = store.logs.find(
      (e) => e.event_id === proposed.event_id && e.sequence <= sourceEnd,
    );
    // A delivered task result may close only a narrowly phrased reporting promise.
    // General/compound commitments require the explicit Master UI route.
    if (
      !c ||
      !event ||
      !["notification.result", "notification.presented"].includes(
        event.event_type,
      ) ||
      (event.scope.session_id !== null &&
        event.scope.session_id !== cs.session_id) ||
      !/^(已向 Master 承诺：)?收到执行结果后汇报[；;]不轮询运行中任务[。.]?$/.test(
        c.text,
      )
    )
      continue;
    if (!sourcePrecedesDelivery(store, cs, c, event)) continue;
    const n = presentedNotification(store, event);
    if (!n || n.session_id !== cs.session_id) continue;
    const text = store.bytes(n.message).toString();
    const result = store
      .all<TaskResult>("TaskResult")
      .find(
        (r) =>
          (c.task_refs.includes(r.task_id) ||
            c.task_refs.includes(r.execution_id)) &&
          (text.includes(r.execution_id) || text.includes(r.task_id)) &&
          text.includes(r.outcome),
      );
    if (!result) continue;
    c.state = "COMPLETED";
    c.resolution_event_ids = [event.event_id];
  }
  return ledger;
}
export function boundedItems(items: WorkItem[]) {
  if (items.length > 12) throw Error("MEMORY_ITEM_LIMIT");
  for (const item of items) {
    if (item.summary.length > 1800) throw Error("MEMORY_SUMMARY_LIMIT");
    for (const field of [
      item.goals,
      item.constraints,
      item.decisions,
      item.open_questions,
      item.unfulfilled_commitments,
    ])
      if (field.length > 16 || field.some((s) => s.length > 1200))
        throw Error("MEMORY_FIELD_LIMIT");
  }
}
