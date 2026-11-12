import {
  authenticatedIdentityHash,
  assertActiveSourceEvents,
  attachmentTag,
} from "./attachment-form.ts";
import { activitiesFor } from "./activity.ts";
import { Store, base, hash, id, now, revise, shape } from "./store.ts";
import type { Stored } from "./store.ts";
import type { Host } from "./host.ts";
import type { World } from "./world.ts";
import type {
  SettingsApplication,
  SettingsDraft,
  WorldChange,
  WorldCatalogChange,
  WorldCommand,
  Operation,
  Consciousness,
} from "./contracts.ts";
import {
  emptySettings,
  validatePayload,
  type SettingsPayload,
} from "./settings-payload.ts";
import { EXECUTOR_SYSTEM } from "./task-prompt.ts";
import { getInstructions, BASE_SYSTEM } from "./instructions.ts";
import {
  settingsSource,
  summarizeSettings,
  rebuiltMessages,
  type SettingsSource,
  type SettingsCandidate,
} from "./settings-memory.ts";
import {
  inputWindowConfig,
  type InputProjectionReceipt,
} from "./input-projection.ts";
import { budgetConfig } from "./budget.ts";
import { SUMMARY_POLICY } from "./summary.ts";
const DRAFT_ID = "21b45476-750e-44ae-82f9-5b6f49a7377c";
type Changes = {
  world: (WorldChange | WorldCatalogChange)[];
  instructions: SettingsPayload["instructions"];
};
export class Settings {
  private active?: Promise<void>;
  private closing = false;
  readonly runtimeHash: string;
  constructor(
    readonly store: Store,
    readonly host: Host,
    readonly world?: World,
  ) {
    this.runtimeHash = hash(
      JSON.stringify({
        policy_version: "settings-memory-v3",
        summary_policy: SUMMARY_POLICY,
        input_window: inputWindowConfig(),
        main_budget: budgetConfig("main"),
        task_budget: budgetConfig("task"),
        model: [
          host.model.id,
          host.model.provider,
          host.model.api,
          host.model.baseUrl,
          host.model.contextWindow,
          host.model.maxTokens,
        ],
        task_model: [
          host.scheduler.model.id,
          host.scheduler.model.provider,
          host.scheduler.model.api,
          host.scheduler.model.baseUrl,
          host.scheduler.model.contextWindow,
          host.scheduler.model.maxTokens,
        ],
        base_prompt: hash(BASE_SYSTEM),
        task_prompt: hash(EXECUTOR_SYSTEM),
        runtime_options: [
          process.env.SECRETARY_MEMORY_UPDATE_TURNS ?? "8",
          process.env.SECRETARY_MEMORY_UPDATE_SECONDS ?? "60",
          process.env.SECRETARY_MEMORY_MIN_INTERVAL_SECONDS ?? "120",
          process.env.SECRETARY_MAX_OUTPUT_TOKENS ?? "4096",
          process.env.SECRETARY_MAX_WORKERS ?? "2",
        ],
        world_policy: "world-store-v1",
      }),
    );
    const incomplete = this.applications().find(
      (a) => !["APPLIED", "FAILED"].includes(a.state),
    );
    if (incomplete && incomplete.runtime_settings_hash !== this.runtimeHash)
      throw Error(
        "SETTINGS_RECOVERY_REQUIRES_ORIGINAL_RUNTIME: unfinished application belongs to an older policy or configuration; use the exact previous code version AND its model/database configuration against its backed-up store to finish/reconcile the application before upgrade. Changing environment variables alone cannot restore an older policy hash; never discard an application with an external receipt",
      );
    if (
      host.session.runtime_settings_hash !== this.runtimeHash &&
      this.mainRecoveryRequired()
    )
      throw Error(
        "SETTINGS_UPGRADE_REQUIRES_IDLE_MAIN: unfinished Main work must be finished/resumed/reconciled using the exact original runtime and configuration against a backed-up store before upgrading. No runtime-change application was queued; do not discard claimed inputs or active loops.",
      );
    host.settingsBlocked = () => this.blocked;
    host.scheduler.settingsBlocked = () => this.blocked;
    host.fullMemoryRefresh = () => {
      if (!this.blocked) this.store.commit([this.record(emptySettings())]);
      return this.tick();
    };
    if (!host.session.last_context_id && !host.session.runtime_settings_hash)
      this.store.commit([
        revise(host.session, { runtime_settings_hash: this.runtimeHash }),
      ]);
    else if (
      host.session.runtime_settings_hash !== this.runtimeHash &&
      !incomplete
    ) {
      const activation = this.record(emptySettings());
      this.store.commit(
        [activation],
        [
          this.store.event("settings.runtime_change_queued", {
            application_id: activation.id,
            previous_hash: host.session.runtime_settings_hash ?? null,
            current_hash: this.runtimeHash,
          }),
        ],
      );
    }
  }
  get blocked() {
    return (
      this.host.session.runtime_settings_hash !== this.runtimeHash ||
      this.pendingApplications().length > 0
    );
  }
  private mainRecoveryRequired() {
    // Match the apply-time precondition, including legacy claimed inputs from
    // other sessions. A narrower startup guard could still deadlock the rebuild.
    return (
      !!this.host.session.active_loop_id ||
      this.store
        .all<import("./contracts.ts").Input>("Input")
        .some((input) => input.state === "CLAIMED")
    );
  }
  private pendingApplications() {
    return this.store.indexed<SettingsApplication>(
      "SettingsApplication",
      "state",
      ["APPLIED", "FAILED"],
      true,
    );
  }
  applications() {
    return this.store.all<SettingsApplication>("SettingsApplication");
  }
  draft() {
    let draft = this.store.find<SettingsDraft>("SettingsDraft", DRAFT_ID);
    if (!draft) {
      draft = {
        schema_version: 1,
        record_type: "SettingsDraft",
        ...base(DRAFT_ID),
        payload_ref: this.store.put(emptySettings()),
      };
      this.store.commit([draft]);
    }
    return draft;
  }
  status() {
    const draft = this.draft();
    return {
      draft: {
        ...draft,
        payload: this.store.read<SettingsPayload>(draft.payload_ref),
      },
      applications: this.applications().slice(-30),
      blocked: this.blocked,
      world_available: !!this.world,
      effective_instructions: getInstructions(this.store),
    };
  }
  save(payload: unknown, expectedRevision: unknown) {
    validatePayload(payload);
    if (payload.edits.length || payload.command_ids.length)
      throw Error("WORLD_USE_WORLD_CHANGES_API");
    const draft = this.draft();
    if (expectedRevision !== draft.revision)
      throw Error("SETTINGS_CONFLICT: 其他页面已修改草稿，请重新载入");
    if (
      payload.instructions &&
      payload.instructions.expected_revision !==
        getInstructions(this.store).revision
    )
      throw Error("INSTRUCTIONS_CONFLICT");
    if (payload.instructions?.content === getInstructions(this.store).content)
      payload = { ...payload, instructions: null };
    const ref = this.store.put(payload);
    if (ref.sha256 === draft.payload_ref.sha256) return draft;
    const next = revise(draft, { payload_ref: ref });
    this.store.commit(
      [next],
      [this.store.event("settings.draft_saved", next, undefined, "MASTER_UI")],
    );
    return next;
  }
  request(expectedRevision: unknown, requestID: unknown) {
    if (typeof requestID !== "string") throw Error("REQUEST_ID_REQUIRED");
    // Receipt uses the draft revision, not the now-cleared draft contents.
    const digest = hash(JSON.stringify({ draft_revision: expectedRevision }));
    const prior = this.store.receipt<string>(requestID, digest);
    if (prior)
      return this.store.get<SettingsApplication>("SettingsApplication", prior);
    const draft = this.draft();
    if (expectedRevision !== draft.revision) throw Error("SETTINGS_CONFLICT");
    const payload = this.store.read<SettingsPayload>(draft.payload_ref);
    if (payload.edits.length || payload.command_ids?.length)
      throw Error("WORLD_SETTINGS_RETIRED");
    if (!payload.instructions && !payload.edits.length)
      return { state: "NO_CHANGES" };
    const application = this.record(payload, requestID, digest);
    this.store.commit(
      [
        application,
        revise(draft, { payload_ref: this.store.put(emptySettings()) }),
      ],
      [
        this.store.event(
          "settings.requested",
          { application_id: application.id, payload },
          undefined,
          "MASTER_UI",
        ),
      ],
      { request: requestID, hash: digest, value: application.id },
    );
    void this.tick();
    return application;
  }
  private record(
    payload: SettingsPayload,
    requestID = id(),
    digest = hash(JSON.stringify(payload)),
  ): SettingsApplication {
    return {
      schema_version: 1,
      record_type: "SettingsApplication",
      ...base(),
      session_id: this.host.sessionID,
      state: "QUEUED",
      payload_ref: this.store.put(payload),
      source_ref: null,
      candidate_ref: null,
      error: null,
      request_id: requestID,
      request_hash: digest,
      context_id: null,
      runtime_settings_hash: this.runtimeHash,
    };
  }
  retry(applicationID: string) {
    const a = this.store.get<SettingsApplication>(
      "SettingsApplication",
      applicationID,
    );
    if (!["FAILED", "BLOCKED"].includes(a.state)) return a;
    const next = revise(a, {
      summary_generation: (a.summary_generation ?? 0) + 1,
      state:
        a.state === "BLOCKED" ? ("COMMITTING" as const) : ("QUEUED" as const),
      error: null,
      // Revalidate candidate exits against current retrieval availability. A
      // BLOCKED retry retains its summary and World receipt, not its request view.
      context_id: null,
      input_projection_ref: undefined,
      ...(a.state === "FAILED"
        ? { source_ref: null, candidate_ref: null }
        : {}),
    });
    this.store.commit([next]);
    void this.tick();
    return next;
  }
  restoreDraft(applicationID: string, expectedRevision: unknown) {
    const a = this.store.get<SettingsApplication>(
      "SettingsApplication",
      applicationID,
    );
    if (a.state !== "FAILED")
      throw Error("ONLY_FAILED_APPLICATION_CAN_BE_EDITED");
    const payload = this.store.read<SettingsPayload>(a.payload_ref);
    if (payload.command_ids.length)
      throw Error("MODEL_COMMAND_REQUIRES_NEW_PROPOSAL");
    const draft = this.draft(),
      existing = this.store.read<SettingsPayload>(draft.payload_ref);
    if (existing.instructions || existing.edits.length)
      throw Error("DRAFT_NOT_EMPTY");
    if (payload.instructions)
      payload.instructions.expected_revision = getInstructions(
        this.store,
      ).revision;
    return this.save(payload, expectedRevision);
  }
  tick(): Promise<void> {
    if (this.active) return this.active;
    if (this.closing) return Promise.resolve();
    const next = this.pendingApplications()[0];
    if (!next || next.state === "BLOCKED") return Promise.resolve();
    this.active = this.execute(next.id).finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
  private update(key: string, patch: Partial<SettingsApplication>) {
    const next = revise(
      this.store.get<SettingsApplication>("SettingsApplication", key),
      patch,
    );
    this.store.commit(
      [next],
      [
        this.store.event("settings.progress", {
          application_id: key,
          state: next.state,
          error: next.error,
        }),
      ],
    );
    return next;
  }
  private async changes(
    application: SettingsApplication,
    payload: SettingsPayload,
  ): Promise<Changes> {
    if (
      payload.instructions &&
      payload.instructions.expected_revision !==
        getInstructions(this.store).revision
    )
      throw Error("INSTRUCTIONS_CONFLICT");
    if (payload.edits.length || payload.command_ids.length)
      throw Error("WORLD_USE_WORLD_CHANGES_API");
    return { world: [], instructions: payload.instructions };
  }

  private async execute(key: string) {
    const activity = activitiesFor(this.store),
      activityID = "settings:" + key;
    activity.start(
      activityID,
      { session_id: this.host.sessionID, task_id: null, execution_id: null },
      "settings",
      "等待主会话安全边界",
    );
    activity.step(activityID, "等待主会话安全边界", undefined, "waiting");
    let stage = this.store.get<SettingsApplication>(
      "SettingsApplication",
      key,
    ).state;
    try {
      await this.host.settingsIdle();
      activity.step(
        activityID,
        this.host.session.runtime_settings_hash !== this.runtimeHash
          ? "正在初始化配置"
          : "正在应用新设置",
      );
      let a = this.store.get<SettingsApplication>("SettingsApplication", key);
      const payload = this.store.read<SettingsPayload>(a.payload_ref);
      if (this.mainRecoveryRequired())
        throw Error("MAIN_RECOVERY_REQUIRED: 先恢复当前轮次，再重试应用");
      let source: SettingsSource;
      if (a.source_ref) source = this.store.read<SettingsSource>(a.source_ref);
      else {
        const changes = await this.changes(a, payload);
        source = settingsSource(this.host, {
          ...changes,
          ...(this.host.session.runtime_settings_hash !== this.runtimeHash
            ? {
                runtime_change:
                  "Model, base prompt or database configuration changed. Re-query current World facts; historical database results are not current authority.",
              }
            : {}),
        });
        a = this.update(key, {
          state: "SUMMARIZING",
          source_ref: this.store.put(source),
        });
        stage = a.state;
      }
      let candidate = a.candidate_ref
        ? this.store.read<SettingsCandidate>(a.candidate_ref)
        : null;
      if (!["COMMITTING", "REBUILDING"].includes(a.state)) {
        stage = "SUMMARIZING";
        candidate = await summarizeSettings(
          this.host,
          key,
          source,
          candidate,
          (c) => this.update(key, { candidate_ref: this.store.put(c) }),
        );
        a = this.update(key, { candidate_ref: this.store.put(candidate) });
      }
      activity.step(activityID, "正在校验设置与上下文");
      if (!candidate || candidate.completed !== source.chunks.length)
        throw Error("INCOMPLETE_SUMMARY_COVERAGE");
      assertActiveSourceEvents(
        this.store,
        source.extraction_messages.map((m) => m.id),
      );
      const changes = source.changes as Changes;
      const current = this.store.get<Consciousness>(
        "Consciousness",
        source.consciousness.id,
      );
      if (
        current.revision !== source.consciousness.revision ||
        this.host.session.last_context_id !== source.context_id
      )
        throw Error("SETTINGS_BASE_CONFLICT");
      const settings = getInstructions(this.store);
      if (
        changes.instructions &&
        settings.revision !== changes.instructions.expected_revision
      )
        throw Error("INSTRUCTIONS_CONFLICT");
      // Build and capacity-check before database writes. Orphan snapshots are immutable audit only.
      const summary = candidate;
      const prepareContext = async () => {
        if (
          a.context_id &&
          a.input_projection_ref &&
          a.input_projection_ref.sha256 !==
            current.input_projection_ref?.sha256 &&
          !(
            this.world?.memorySearch.state === "ready" &&
            this.world.memorySearch.indexedSequence >=
              this.store.read<InputProjectionReceipt>(a.input_projection_ref)
                .considered_journal_sequence
          )
        )
          a = this.update(key, {
            context_id: null,
            input_projection_ref: undefined,
          });
        if (!a.context_id) {
          await this.world?.memorySearch.catchUp();
          const projection = this.host.prepareSettingsInputs(
            key,
            source,
            rebuiltMessages(source, summary, key, current.revision + 1),
            changes.instructions?.content ?? settings.content,
          );
          const context = this.host.prepareSettingsContext(
            key,
            changes.instructions?.content ?? settings.content,
            changes.instructions ? settings.revision + 1 : settings.revision,
            projection.messages,
            current.revision + 1,
          );
          a = this.update(key, {
            context_id: context.id,
            input_projection_ref: projection.receiptRef,
          });
        }
      };
      await prepareContext();
      activity.step(activityID, "正在重建上下文");
      a = this.update(key, { state: "REBUILDING" });
      stage = a.state;
      // Retrieval may have failed while World committed/exported or during a
      // restart. Only an already active receipt is safe to adopt without it.
      await prepareContext();
      assertActiveSourceEvents(
        this.store,
        source.extraction_messages.map((m) => m.id),
      );
      const mutations: Stored[] = [
        revise(current, {
          items: candidate.items,
          commitments: candidate.commitments,
          pending_raw_refs: [],
          covered_event_ids: [],
          covered_event_sequence: source.end_sequence,
          covered_message_hashes: [
            ...new Set([
              ...source.message_hashes,
              ...this.store
                .read<import("./model.ts").AgentMessage[]>(
                  this.store.get<import("./contracts.ts").Context>(
                    "Context",
                    a.context_id!,
                  ).raw_context,
                )
                .map((m) =>
                  attachmentTag(m)
                    ? authenticatedIdentityHash(this.store, m)
                    : hash(JSON.stringify(m)),
                ),
            ]),
          ],
          last_job_id: null,
          settings_application_id: key,
          maintenance_version: 3,
          context_compaction: null,
          ...(a.input_projection_ref
            ? { input_projection_ref: a.input_projection_ref }
            : {}),
          memory_source_ref: this.store.get<import("./contracts.ts").Context>(
            "Context",
            a.context_id!,
          ).raw_context,
          memory_updated_at: now(),
        }),
        revise(this.host.session, {
          last_context_id: a.context_id,
          state: "IDLE",
          recovery_error: null,
          runtime_settings_hash: this.runtimeHash,
        }),
        revise(a, { state: "APPLIED", error: null }),
      ];
      if (changes.instructions)
        mutations.push(
          revise(settings, {
            content: changes.instructions.content,
            updated_by: "MASTER_UI",
          }),
        );
      this.store.commit(mutations, [
        this.store.event("settings.applied", {
          application_id: key,
          context_id: a.context_id,
          source_end_sequence: source.end_sequence,
        }),
      ]);
      activity.step(activityID, "正在补提承诺");
      await this.host.extractPending();
    } catch (error) {
      // Local merge failure after the atomic Settings commit cannot undo APPLIED.
      if (
        this.store.get<SettingsApplication>("SettingsApplication", key)
          .state === "APPLIED"
      ) {
        this.store.commit(
          [],
          [
            this.store.event(
              "memory.extraction.merge_failed",
              {
                application_id: key,
                error: String(error),
              },
              {
                session_id: this.host.sessionID,
                task_id: null,
                execution_id: null,
              },
            ),
          ],
        );
        return;
      }
      let state: "FAILED" | "BLOCKED" = ["COMMITTING", "REBUILDING"].includes(
        stage,
      )
        ? "BLOCKED"
        : "FAILED";
      this.update(key, { state, error: String(error) });
    } finally {
      const state = this.store.get<SettingsApplication>(
        "SettingsApplication",
        key,
      ).state;
      activity.end(activityID, state === "APPLIED" ? "succeeded" : "failed");
    }
  }
  async close() {
    this.closing = true;
    await this.active;
  }
}
