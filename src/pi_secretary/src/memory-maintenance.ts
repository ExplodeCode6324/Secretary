import { assertRequestBudget, budgetConfig, requestBudget } from "./budget.ts";
import type {
  CompactionJob,
  Consciousness,
  Context,
  Input,
  MemoryExtractionJob,
} from "./contracts.ts";
import type { HostContext } from "./host-context.ts";
import {
  drainExtractions,
  retryExtractions as retryMemoryExtractions,
} from "./memory-extraction.ts";
import { migrateCommitments } from "./memory.ts";
import { retryNow } from "./model-retry.ts";
import { type AgentMessage } from "./model.ts";
import { id, revise } from "./store.ts";

type MemoryMaintenanceContext = Pick<
  HostContext,
  | "active"
  | "capacityAttemptKey"
  | "compact"
  | "completedSequence"
  | "crop"
  | "extractPending"
  | "extraction"
  | "fullMemoryRefresh"
  | "history"
  | "maintain"
  | "maintenance"
  | "memory"
  | "memoryDue"
  | "model"
  | "pendingSummary"
  | "pressureCache"
  | "pressureKey"
  | "project"
  | "session"
  | "sessionID"
  | "settingsBlocked"
  | "store"
  | "stream"
  | "summaryDue"
  | "tools"
  | "world"
>;

export function memory(this: MemoryMaintenanceContext) {
  return this.store.get<Consciousness>(
    "Consciousness",
    this.session.consciousness_id,
  );
}

export function completedSequence(this: MemoryMaintenanceContext) {
  return (
    this.store
      .events("input.handled")
      .findLast((e) => e.scope.session_id === this.sessionID)?.sequence ?? 0
  );
}

export function memoryDue(this: MemoryMaintenanceContext) {
  if (
    this.settingsBlocked() ||
    this.session.state !== "IDLE" ||
    this.maintenance
  )
    return false;
  const cs = this.memory(),
    start = cs.covered_event_sequence ?? 0;
  const turns = this.store
    .eventsSince("input.handled", start)
    .filter(
      (l) =>
        l.scope.session_id === this.sessionID &&
        l.event_type === "input.handled" &&
        l.sequence > start,
    );
  if (this.pendingSummary()) return this.summaryDue();
  if (!turns.length) return false;
  const jobs = this.store
    .all<CompactionJob>("CompactionJob")
    .filter(
      (j) => j.session_id === this.sessionID && j.mode !== "CONTEXT_COMPACTION",
    );
  if (this.pendingSummary()) return this.summaryDue();
  const critical = this.store
    .eventsSince("feedback.delivered", start)
    .some(
      (l) =>
        l.scope.session_id === this.sessionID &&
        l.sequence > start &&
        l.sequence <= this.completedSequence() &&
        l.event_type === "feedback.delivered",
    );
  const last = jobs.at(-1);
  if (
    !critical &&
    last &&
    Date.now() - Date.parse(last.updated_at) <
      Number(process.env.SECRETARY_MEMORY_MIN_INTERVAL_SECONDS ?? 120) * 1000
  )
    return false;
  const oldest = turns[0].occurred_at;
  return (
    critical ||
    turns.length >= Number(process.env.SECRETARY_MEMORY_UPDATE_TURNS ?? 8) ||
    (!!oldest &&
      Date.now() - Date.parse(oldest) >=
        Number(process.env.SECRETARY_MEMORY_UPDATE_SECONDS ?? 60) * 1000)
  );
}

export function pressureKey(this: MemoryMaintenanceContext) {
  return `${this.session.last_context_id}:${this.memory().revision}:${JSON.stringify(budgetConfig())}`;
}

export function maintainIfNeeded(this: MemoryMaintenanceContext) {
  if (this.active || this.maintenance || this.settingsBlocked()) return;
  const key = this.pressureKey();
  if (this.pressureCache?.key !== key)
    this.pressureCache = {
      key,
      pressured:
        !!this.session.last_context_id &&
        requestBudget(this.model, this.history()).occupancy >=
          budgetConfig().normal,
    };
  const pressure =
    this.pressureCache.pressured && this.capacityAttemptKey !== key;
  const extractionDue = this.store
    .indexed<MemoryExtractionJob>("MemoryExtractionJob", "pending_extraction", [
      true,
    ])
    .some(
      (j) =>
        j.session_id === this.sessionID &&
        !j.merged &&
        (j.state !== "FAILED" ||
          (!!j.next_attempt_at &&
            Date.parse(j.next_attempt_at) <= retryNow(this.store))),
    );
  if (!this.memoryDue() && !pressure && !extractionDue) return;
  if (this.pendingSummary() && !this.summaryDue() && !extractionDue) return;
  void this.compact(false);
}

export function compact(this: MemoryMaintenanceContext, reset = true) {
  if (this.settingsBlocked())
    return Promise.reject(Error("SETTINGS_APPLICATION_IN_PROGRESS"));
  if (this.maintenance) return this.maintenance;
  if (reset) {
    const pending = this.pendingSummary();
    if (pending && pending.state === "FAILED")
      this.store.commit([
        revise(pending, {
          state: "SUMMARIZING",
          retry_round: 0,
          retry_generation: (pending.retry_generation ?? 0) + 1,
          next_attempt_at: null,
        }),
      ]);
  }
  const active = this.active;
  if (this.memory().pending_raw_refs.length > 1 && this.fullMemoryRefresh)
    return (async () => {
      await active;
      await this.fullMemoryRefresh!();
    })();
  this.maintenance = (async () => {
    await active;
    await this.maintain();
    await this.extractPending();
    await this.world?.memorySearch?.catchUp();
    if (this.session.last_context_id) {
      const c = this.store.get<Context>(
        "Context",
        this.session.last_context_id,
      );
      const messages = this.store.read<AgentMessage[]>(c.raw_context);
      const eligible = this.session.active_loop_id
        ? (c.protected_from_index ?? 0)
        : messages.length;
      if (
        requestBudget(this.model, this.project(messages)).occupancy >=
        budgetConfig().normal
      )
        this.crop(messages, eligible);
    }
  })().finally(() => {
    try {
      // Explicit maintenance may remove a capacity block, but never a recovery block.
      // Revalidate complete queued input material, not only the historical projection.
      if (this.session.state === "CAPACITY_BLOCKED") {
        const next = this.history();
        if (!this.session.active_loop_id)
          next.push(
            ...this.store
              .all<Input>("Input")
              .filter(
                (i) =>
                  i.session_id === this.sessionID && i.state === "ACCEPTED",
              )
              .map((i) => ({
                role: "user" as const,
                content: this.store.bytes(i.payload).toString(),
                timestamp: Date.parse(i.received_at),
              })),
          );
        try {
          assertRequestBudget(this.model, next, {
            tools: this.tools(this.session.active_loop_id ?? id()),
          });
          this.store.commit([
            revise(this.session, { state: "IDLE", recovery_error: null }),
          ]);
        } catch {
          /* Keep the explicit block and original evidence. */
        }
      }
      this.capacityAttemptKey = this.pressureKey();
    } finally {
      this.maintenance = undefined;
    }
  });
  return this.maintenance;
}

export function retryExtractions(
  this: MemoryMaintenanceContext,
  requestID: string,
) {
  return retryMemoryExtractions(this.store, this.sessionID, requestID);
}

export function extractPending(this: MemoryMaintenanceContext) {
  if (this.extraction) return this.extraction;
  this.extraction = drainExtractions({
    store: this.store,
    model: this.model,
    stream: this.stream,
    sessionID: this.sessionID,
  }).finally(() => {
    this.extraction = undefined;
  });
  return this.extraction;
}

export function memoryStatus(this: MemoryMaintenanceContext) {
  const cs = this.store.get<Consciousness>(
    "Consciousness",
    this.session.consciousness_id,
  );
  const jobs = this.store
    .all<CompactionJob>("CompactionJob")
    .filter((j) => j.session_id === this.sessionID);
  const latest = jobs.at(-1);
  const successful = jobs.filter((j) => j.state === "COMMITTED").at(-1);
  const activation = cs.settings_application_id
    ? this.store.find("SettingsApplication", cs.settings_application_id)
    : undefined;
  const activationNewer =
    activation && (!latest || activation.updated_at > latest.updated_at);
  return {
    revision: cs.revision,
    extraction_pending_count: this.store
      .all<MemoryExtractionJob>("MemoryExtractionJob")
      .filter(
        (j) =>
          j.session_id === this.sessionID &&
          !j.merged &&
          (j.state !== "FAILED" || j.next_attempt_at !== null),
      ).length,
    extraction_failed_count: this.store
      .all<MemoryExtractionJob>("MemoryExtractionJob")
      .filter(
        (j) =>
          j.session_id === this.sessionID &&
          j.state === "FAILED" &&
          !j.next_attempt_at,
      ).length,
    extraction: this.store
      .all<MemoryExtractionJob>("MemoryExtractionJob")
      .filter((j) => j.session_id === this.sessionID && !j.merged)
      .map((j) => ({
        id: j.id,
        state: j.state,
        round: j.round,
        next_attempt_at: j.next_attempt_at,
        error: j.error,
      })),
    next_attempt_at: latest?.next_attempt_at ?? null,
    retry_round: latest?.retry_round ?? 0,
    maintenance_mode: latest?.mode ?? "WORKING_MEMORY",
    compaction_target_reached:
      jobs.filter((j) => j.mode === "CONTEXT_COMPACTION").at(-1)
        ?.target_reached ?? null,
    state: activationNewer
      ? "SETTINGS_APPLIED"
      : (latest?.state ?? "NOT_NEEDED"),
    last_success_at:
      activation &&
      (!successful || activation.updated_at > successful.updated_at)
        ? activation.updated_at
        : (successful?.updated_at ?? null),
    pending_source_bytes: cs.pending_raw_refs.reduce(
      (n, r) => n + this.store.contentBytes(r),
      0,
    ),
    attempt: latest?.attempt ?? 0,
    errors: latest?.validation_errors ?? [],
    commitments: migrateCommitments(cs),
    covered_event_sequence: cs.covered_event_sequence ?? null,
    input_projection_ref: cs.input_projection_ref ?? null,
    input_exit:
      this.world?.memorySearch?.state === "ready" &&
      this.world.memorySearch.indexedSequence >= this.store.sequence
        ? "available"
        : "disabled_search_not_ready",
    search: this.world?.memorySearch?.status() ?? {
      status: "not_configured",
    },
  };
}

export function resolveMemoryCommitment(
  this: MemoryMaintenanceContext,
  commitmentID: string,
  state: "COMPLETED" | "CANCELLED",
  note: string,
) {
  if (this.settingsBlocked()) throw Error("SETTINGS_APPLICATION_IN_PROGRESS");
  if (!note.trim()) throw Error("RESOLUTION_NOTE_REQUIRED");
  const cs = this.store.get<Consciousness>(
    "Consciousness",
    this.session.consciousness_id,
  );
  const commitments = migrateCommitments(cs);
  const commitment = commitments.find((c) => c.id === commitmentID);
  if (!commitment || commitment.state !== "OPEN")
    throw Error("OPEN_COMMITMENT_NOT_FOUND");
  const event = this.store.event(
    "consciousness.master_resolved",
    { commitment_id: commitmentID, state, note },
    { session_id: this.sessionID, task_id: null, execution_id: null },
    "MASTER_UI",
  );
  commitment.state = state;
  commitment.resolution_event_ids = [event.event_id];
  this.store.commit([revise(cs, { commitments })], [event]);
}
