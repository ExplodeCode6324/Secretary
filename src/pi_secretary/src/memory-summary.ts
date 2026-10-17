import { contentText } from "@earendil-works/pi-ai";
import { activitiesFor } from "./activity.ts";
import type {
  CompactionJob,
  Execution,
  Notification,
  TaskPlan,
  TaskProposal,
  TaskResult,
} from "./contracts.ts";
import { stableID } from "./execution-utils.ts";
import type { HostContext } from "./host-context.ts";
import { isTimerMessage } from "./input-origin.ts";
import { enqueueExtractions } from "./memory-extraction.ts";
import { migrateCommitments, reconcileCommitments } from "./memory.ts";
import { maintenanceRetryAt, retryNow } from "./model-retry.ts";
import { type AgentMessage } from "./model.ts";
import { presentedNotification } from "./notification-service.ts";
import { base, now, revise } from "./store.ts";
import {
  SUMMARY_POLICY,
  createSummaryPlan,
  runSummary,
  type SummaryCandidate,
  type SummaryPlan,
} from "./summary.ts";

type MemorySummaryContext = Pick<
  HostContext,
  | "completedSequence"
  | "memory"
  | "model"
  | "notifyFailure"
  | "pendingSummary"
  | "session"
  | "sessionID"
  | "store"
  | "stream"
  | "summaryDue"
>;

export async function maintain(this: MemorySummaryContext, inLoop = false) {
  const session = this.session;
  if (
    (!inLoop && !["IDLE", "CAPACITY_BLOCKED"].includes(session.state)) ||
    !session.last_context_id
  )
    return;
  const cs = this.memory(),
    pending = this.pendingSummary();
  if (pending && !this.summaryDue(pending)) return;
  const sourceRef = pending?.source_refs[0] ?? cs.pending_raw_refs[0];
  const sourceEnd = pending?.source_end_sequence ?? this.completedSequence();
  if (!sourceRef || sourceEnd <= (cs.covered_event_sequence ?? 0)) return;
  const delta = this.store.logs.filter(
    (l) =>
      l.scope.session_id === this.sessionID &&
      l.event_type === "main.message" &&
      l.sequence > (cs.covered_event_sequence ?? 0) &&
      l.sequence <= sourceEnd,
  );
  const sources = delta.map((l) => l.event_id);
  const evidence = this.store.put(
    delta.map((l) => this.store.read<AgentMessage>(l.payload)),
  );
  let job: CompactionJob = pending
    ? revise(pending, {
        state: "SUMMARIZING",
        base_revision: cs.revision,
        retry_round:
          pending.state === "FAILED"
            ? (pending.retry_round ?? 0) + 1
            : (pending.retry_round ?? 0),
        next_attempt_at: null,
      })
    : {
        retry_round: 0,
        retry_generation: 0,
        schema_version: 1,
        record_type: "CompactionJob",
        ...base(),
        state: "SUMMARIZING",
        session_id: this.sessionID,
        base_revision: cs.revision,
        source_event_ids: sources,
        source_refs: [sourceRef, evidence],
        candidate_ref: null,
        covered_event_ids: [],
        validation_errors: [],
        memory_version: 2,
        attempt: 1,
        source_start_sequence: cs.covered_event_sequence ?? 0,
        source_end_sequence: sourceEnd,
        mode: "WORKING_MEMORY",
        policy_id: SUMMARY_POLICY,
      };
  this.store.commit(
    [job],
    [
      this.store.event("consciousness.started", {
        job_id: job.id,
        base_revision: cs.revision,
        source_end_sequence: sourceEnd,
      }),
    ],
  );
  const activity = activitiesFor(this.store),
    activityID = "compaction:" + job.id;
  activity.start(
    activityID,
    { session_id: this.sessionID, task_id: null, execution_id: null },
    "compaction",
    "正在更新工作记忆",
  );
  const runtimeTasks = () =>
    this.store
      .all<Execution>("Execution")
      .filter((e) => {
        const plan = this.store.find<TaskPlan>("TaskPlan", e.task_id);
        return (
          !!plan &&
          this.store.read<TaskProposal>(e.proposal_ref ?? plan.proposal_ref)
            .session_id === this.sessionID
        );
      })
      .map((e) => ({
        execution_id: e.id,
        task_id: e.task_id,
        state: e.state,
        updated_at: e.updated_at,
        result: e.result_id
          ? this.store.get<TaskResult>("TaskResult", e.result_id).summary
          : null,
      }));
  const tasks = runtimeTasks();
  try {
    const saved = job.progress_ref
      ? this.store.read<{
          plan: SummaryPlan;
          candidate: SummaryCandidate;
          commitments?: ReturnType<typeof migrateCommitments>;
        }>(job.progress_ref)
      : null;
    const plan =
      saved?.plan ??
      createSummaryPlan({
        model: this.model,
        items: cs.items,
        commitments: migrateCommitments(cs),
        sources: delta.map((l) => ({
          id: l.event_id,
          text: JSON.stringify({
            event_id: l.event_id,
            sequence: l.sequence,
            source_ref: l.payload,
            message: this.store.read(l.payload),
          }),
        })),
        extra: {
          runtime_tasks: tasks,
          source_end_sequence: sourceEnd,
          delivered_notifications: this.store.logs
            .filter(
              (l) =>
                l.event_type === "notification.presented" &&
                l.sequence <= sourceEnd,
            )
            .map((l) => {
              const n = presentedNotification(this.store, l);
              return n?.session_id === this.sessionID
                ? {
                    event_id: l.event_id,
                    state: n.state,
                    message: this.store.bytes(n.message).toString(),
                  }
                : null;
            })
            .filter(Boolean)
            .slice(-12),
        },
      });
    const commitmentsBefore = saved?.commitments ?? migrateCommitments(cs);
    const candidate = await runSummary({
      store: this.store,
      model: this.model,
      stream: this.stream,
      sessionID: this.sessionID,
      loopID: job.id,
      consciousnessRevision: cs.revision,
      refs: [sourceRef, evidence],
      plan,
      commitments: commitmentsBefore,
      round: job.retry_round ?? 0,
      generation: job.retry_generation ?? 0,
      candidate: saved?.candidate ?? { items: cs.items, completed: 0 },
      checkpoint: (candidate) => {
        job = revise(this.store.get<CompactionJob>("CompactionJob", job.id), {
          progress_ref: this.store.put({
            plan,
            candidate,
            commitments: commitmentsBefore,
          }),
        });
        this.store.commit([job]);
      },
      progress: (index, attempt, error) => {
        job = revise(this.store.get<CompactionJob>("CompactionJob", job.id), {
          attempt,
          validation_errors: error
            ? [...job.validation_errors, error]
            : job.validation_errors,
        });
        this.store.commit(
          [job],
          [
            this.store.event(
              attempt > 1 ? "consciousness.retry" : "consciousness.segment",
              {
                job_id: job.id,
                segment: index,
                attempt,
                previous_error: error,
              },
            ),
          ],
        );
        activity.step(activityID, "正在更新工作记忆", {
          attempt,
          max_attempts: 4,
        });
      },
    });
    const items = candidate.items;
    enqueueExtractions({
      store: this.store,
      sessionID: this.sessionID,
      loopID: job.id,
      taskRefs: items[0]?.task_refs ?? [],
      source: null,
      completeMessages: delta.flatMap((l) => {
        const m = this.store.read<AgentMessage>(l.payload);
        return (m.role === "user" || m.role === "assistant") &&
          !isTimerMessage(this.store, m)
          ? [{ id: l.event_id, role: m.role, text: contentText(m.content) }]
          : [];
      }),
    });
    const current = this.memory(),
      latest = this.store.get<CompactionJob>("CompactionJob", job.id);
    if (
      current.revision !== cs.revision ||
      JSON.stringify(runtimeTasks()) !== JSON.stringify(tasks)
    ) {
      this.store.commit(
        [revise(latest, { state: "STALE" })],
        [this.store.event("consciousness.stale", { job_id: job.id })],
      );
      return;
    }
    const commitments = reconcileCommitments(
      this.store,
      cs,
      items,
      evidence,
      candidate.resolutions ?? [],
      sourceEnd,
      {
        owner_type: "CompactionJob",
        owner_id: job.id,
        source_event_ids: sources,
        source_end_sequence: sourceEnd,
      },
    );
    items.forEach((item) => {
      item.unfulfilled_commitments = [];
    });
    this.store.commit(
      [
        revise(current, {
          items,
          commitments,
          covered_event_ids: sources,
          pending_raw_refs: [sourceRef],
          last_job_id: job.id,
          covered_event_sequence: sourceEnd,
          maintenance_version: 3,
          memory_source_ref: sourceRef,
          memory_updated_at: now(),
        }),
        revise(latest, {
          state: "COMMITTED",
          candidate_ref: this.store.put({ items, commitments }),
          covered_event_ids: sources,
        }),
      ],
      [
        this.store.event("consciousness.committed", {
          job_id: job.id,
          source_end_sequence: sourceEnd,
        }),
      ],
    );
  } catch (error) {
    const latest = this.store.get<CompactionJob>("CompactionJob", job.id);
    this.store.commit(
      [
        revise(latest, {
          state: "FAILED",
          validation_errors: [...latest.validation_errors, String(error)],
          next_attempt_at: maintenanceRetryAt(
            this.store,
            latest.retry_round ?? 0,
            error,
          ),
        }),
      ],
      [
        this.store.event("consciousness.failed", {
          job_id: job.id,
          error: String(error),
        }),
      ],
    );
    const failed = this.store.get<CompactionJob>("CompactionJob", job.id);
    if (!failed.next_attempt_at)
      this.notifyFailure(
        `summary:${job.id}:${job.retry_generation ?? 0}`,
        String(error),
      );
  } finally {
    activity.end(
      activityID,
      this.store.get<CompactionJob>("CompactionJob", job.id).state ===
        "COMMITTED"
        ? "succeeded"
        : "failed",
    );
  }
}

export function notifyFailure(
  this: MemorySummaryContext,
  key: string,
  message: string,
) {
  const recordID = stableID("model-maintenance-failure:" + key);
  if (this.store.find("Notification", recordID)) return;
  const n: Notification = {
    schema_version: 1,
    record_type: "Notification",
    ...base(recordID),
    state: "QUEUED",
    session_id: this.sessionID,
    channel: "local-ui",
    message: this.store.put(message, "text/plain"),
    delivery_key: recordID,
    receipt: null,
    requested_at: now(),
  };
  this.store.commit(
    [n],
    [
      this.store.event("notification.queued", n, {
        session_id: this.sessionID,
        task_id: null,
        execution_id: null,
      }),
    ],
  );
}

export function pendingSummary(this: MemorySummaryContext) {
  const start = this.memory().covered_event_sequence ?? 0;
  return this.store
    .indexed<CompactionJob>("CompactionJob", "state", ["FAILED", "SUMMARIZING"])
    .findLast(
      (j) =>
        j.session_id === this.sessionID &&
        j.mode === "WORKING_MEMORY" &&
        (j.source_start_sequence ?? 0) === start &&
        ["FAILED", "SUMMARIZING"].includes(j.state),
    );
}

export function summaryDue(
  this: MemorySummaryContext,
  job = this.pendingSummary(),
) {
  return (
    !!job &&
    (job.state === "SUMMARIZING" ||
      (!!job.next_attempt_at &&
        Date.parse(job.next_attempt_at) <= retryNow(this.store)))
  );
}
