import { contentText } from "@earendil-works/pi-ai";
import type { Host } from "./host.ts";
import type { AgentMessage } from "./model.ts";
import type {
  CompactionJob,
  Consciousness,
  Execution,
  TaskPlan,
  TaskProposal,
  TaskResult,
} from "./contracts.ts";
import type { SummaryPlan, SummaryCandidate } from "./summary.ts";
import { SUMMARY_POLICY } from "./summary.ts";
import { extractNewCommitments } from "./memory-extraction.ts";
import { migrateCommitments, reconcileCommitments } from "./memory.ts";
import { now, revise } from "./store.ts";

function runtimeTasks(host: Host) {
  return host.store
    .all<Execution>("Execution")
    .filter((e) => {
      const plan = host.store.find<TaskPlan>("TaskPlan", e.task_id);
      return (
        !!plan &&
        host.store.read<TaskProposal>(e.proposal_ref ?? plan.proposal_ref)
          .session_id === host.sessionID
      );
    })
    .map((e) => ({
      execution_id: e.id,
      task_id: e.task_id,
      state: e.state,
      updated_at: e.updated_at,
      result: e.result_id
        ? host.store.get<TaskResult>("TaskResult", e.result_id).summary
        : null,
    }));
}

/** Validate frozen owner evidence without rebuilding source or invoking a model. */
export function compactionRecoverySource(host: Host, ownerID: string) {
  const store = host.store;
  const job = store.get<CompactionJob>("CompactionJob", ownerID);
  const cs = store.get<Consciousness>(
    "Consciousness",
    host.session.consciousness_id,
  );
  if (
    job.session_id !== host.sessionID ||
    job.mode !== "WORKING_MEMORY" ||
    job.policy_id !== SUMMARY_POLICY
  )
    throw Error("RECOVERY_OWNER_POLICY_MISMATCH");
  if (job.state === "COMMITTED") return { job, cs, progress: null, delta: [] };
  if (host.settingsBlocked()) throw Error("SETTINGS_APPLICATION_IN_PROGRESS");
  if (
    job.state !== "FAILED" ||
    job.base_revision !== cs.revision ||
    !job.progress_ref ||
    job.source_refs.length !== 2
  )
    throw Error("RECOVERY_OWNER_OR_REVISION_CONFLICT");
  const progress = store.read<{
    plan: SummaryPlan;
    candidate: SummaryCandidate;
  }>(job.progress_ref);
  if (
    progress.candidate.completed !== progress.plan.chunks.length ||
    !Array.isArray(progress.candidate.items)
  )
    throw Error("RECOVERY_SUMMARY_INCOMPLETE");
  const extra = progress.plan.extra as {
    runtime_tasks?: unknown;
    source_end_sequence?: number;
  };
  if (
    extra?.source_end_sequence !== job.source_end_sequence ||
    JSON.stringify(extra.runtime_tasks) !== JSON.stringify(runtimeTasks(host))
  )
    throw Error("RECOVERY_RUNTIME_TASKS_CHANGED");
  const delta = store.logs.filter(
    (e) =>
      e.event_type === "main.message" &&
      e.scope.session_id === host.sessionID &&
      e.sequence > (job.source_start_sequence ?? 0) &&
      e.sequence <= (job.source_end_sequence ?? 0),
  );
  if (
    JSON.stringify(delta.map((e) => e.event_id)) !==
      JSON.stringify(job.source_event_ids) ||
    JSON.stringify(delta.map((e) => store.read(e.payload))) !==
      JSON.stringify(store.read(job.source_refs[1]))
  )
    throw Error("RECOVERY_OWNER_SOURCE_MISMATCH");
  store.bytes(job.source_refs[0]);
  return { job, cs, progress, delta };
}

export async function commitRecoveredCompaction(host: Host, ownerID: string) {
  const { job, cs, progress, delta } = compactionRecoverySource(host, ownerID);
  if (job.state === "COMMITTED") return;
  if (!progress) throw Error("RECOVERY_SUMMARY_INCOMPLETE");
  const quotes = await extractNewCommitments({
    store: host.store,
    model: host.model,
    stream: host.stream,
    sessionID: host.sessionID,
    loopID: job.id,
    consciousnessRevision: cs.revision,
    source: null,
    runtimeConfigHash: host.extractionRuntimeHash,
    recoveryOnly: true,
    existing: migrateCommitments(cs),
    completeMessages: delta.flatMap((e) => {
      const m = host.store.read<AgentMessage>(e.payload);
      return m.role === "user" || m.role === "assistant"
        ? [{ id: e.event_id, role: m.role, text: contentText(m.content) }]
        : [];
    }),
  });
  // Recheck after the async boundary before touching the owner ledger.
  compactionRecoverySource(host, ownerID);
  const items = structuredClone(progress.candidate.items);
  if (items.length) items[0].unfulfilled_commitments = quotes;
  const commitments = reconcileCommitments(
    host.store,
    cs,
    items,
    job.source_refs[1],
    progress.candidate.resolutions ?? [],
    job.source_end_sequence,
    {
      owner_type: "CompactionJob",
      owner_id: job.id,
      source_event_ids: job.source_event_ids,
      source_end_sequence: job.source_end_sequence!,
    },
  );
  items.forEach((item) => {
    item.unfulfilled_commitments = [];
  });
  host.store.commit(
    [
      revise(cs, {
        items,
        commitments,
        covered_event_ids: job.source_event_ids,
        pending_raw_refs: [job.source_refs[0]],
        last_job_id: job.id,
        covered_event_sequence: job.source_end_sequence,
        maintenance_version: 3,
        memory_source_ref: job.source_refs[0],
        memory_updated_at: now(),
      }),
      revise(job, {
        state: "COMMITTED",
        candidate_ref: host.store.put({ items, commitments }),
        covered_event_ids: job.source_event_ids,
      }),
    ],
    [
      host.store.event("consciousness.committed", {
        job_id: job.id,
        source_end_sequence: job.source_end_sequence,
        explicit_extraction_recovery: true,
      }),
    ],
  );
}
