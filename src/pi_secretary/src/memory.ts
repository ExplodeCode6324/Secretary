import { hash, type Store } from "./store.ts";
import type {
  Consciousness,
  MemoryCommitment,
  WorkItem,
  ObjectRef,
  Notification,
  TaskResult,
  Context,
} from "./contracts.ts";

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
): MemoryCommitment[] {
  const ledger = migrateCommitments(cs);
  // Only a quote present in the source can introduce a new pending obligation.
  // Existing IDs/text survive paraphrases and omissions in the model's candidate.
  const original = store.bytes(source).toString();
  for (const item of items)
    for (const text of item.unfulfilled_commitments) {
      if (!original.includes(text) || ledger.some((c) => c.text === text))
        continue;
      ledger.push({
        id: commitmentID(cs.id + text),
        text,
        state: "OPEN",
        source_refs: [source],
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
      event.event_type !== "notification.result" ||
      !/^(已向 Master 承诺：)?收到执行结果后汇报[；;]不轮询运行中任务[。.]?$/.test(
        c.text,
      )
    )
      continue;
    const originContexts = store
      .all<Context>("Context")
      .filter((ctx) =>
        c.source_refs.some((ref) => ref.sha256 === ctx.raw_context.sha256),
      );
    // A delivery predating the promise's source cannot resolve a new reporting promise.
    if (
      !originContexts.length ||
      originContexts.some((ctx) => ctx.updated_at >= event.occurred_at)
    )
      continue;
    const n = store.read<Notification>(event.payload);
    if (n.state !== "SENT" || n.session_id !== cs.session_id || !n.receipt)
      continue;
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
