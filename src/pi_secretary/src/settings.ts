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
          process.env.SECRETARY_COMPACTION_BYTES ?? "32768",
          process.env.SECRETARY_COMPACTION_OUTPUT_TOKENS ?? "8192",
          process.env.SECRETARY_MAX_OUTPUT_TOKENS ?? "4096",
          process.env.SECRETARY_MAX_WORKERS ?? "2",
        ],
        world: world?.configurationHash ?? null,
      }),
    );
    const incomplete = this.applications().find(
      (a) => !["APPLIED", "FAILED"].includes(a.state),
    );
    if (incomplete && incomplete.runtime_settings_hash !== this.runtimeHash)
      throw Error(
        "SETTINGS_RECOVERY_REQUIRES_ORIGINAL_RUNTIME: restore the previous model/database configuration before recovery",
      );
    host.settingsBlocked = () => this.blocked;
    host.scheduler.settingsBlocked = () => this.blocked;
    host.fullMemoryRefresh = () => {
      if (!this.blocked) this.store.commit([this.record(emptySettings())]);
      return this.tick();
    };
    if (world) world.coordinate = (c) => this.enqueueCommand(c);
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
      this.applications().some((a) => !["APPLIED", "FAILED"].includes(a.state))
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
    if (payload.command_ids.length)
      throw Error("MASTER_DRAFT_CANNOT_SET_COMMAND_IDS");
    if (payload.edits.length && !this.world) throw Error("WORLD_UNAVAILABLE");
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
  private enqueueCommand(command: WorldCommand) {
    if (
      this.applications().some((a) =>
        this.store
          .read<SettingsPayload>(a.payload_ref)
          .command_ids.includes(command.id),
      )
    )
      return;
    const application = this.record({
      ...emptySettings(),
      command_ids: [command.id],
    });
    this.store.commit(
      [application],
      [
        this.store.event("settings.world_queued", {
          application_id: application.id,
          command_id: command.id,
        }),
      ],
    );
  }
  retry(applicationID: string) {
    const a = this.store.get<SettingsApplication>(
      "SettingsApplication",
      applicationID,
    );
    if (!["FAILED", "BLOCKED"].includes(a.state)) return a;
    const next = revise(a, {
      state:
        a.state === "BLOCKED" ? ("COMMITTING" as const) : ("QUEUED" as const),
      error: null,
      ...(a.state === "FAILED"
        ? { source_ref: null, candidate_ref: null, context_id: null }
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
    const next = this.applications().find(
      (a) => !["APPLIED", "FAILED"].includes(a.state),
    );
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
    const world: Changes["world"] = [];
    for (const key of payload.command_ids) {
      const c = this.store.get<WorldCommand>("WorldCommand", key),
        op = this.store.get<Operation>("Operation", c.operation_id);
      if (
        !["AUTHORIZED", "DISPATCHED", "RESULT_UNKNOWN", "SUCCEEDED"].includes(
          op.state,
        )
      )
        throw Error("WORLD_AUTHORIZATION_REQUIRED");
      world.push(c.change);
    }
    if (payload.edits.length) {
      if (!this.world) throw Error("WORLD_UNAVAILABLE");
      const event = this.store.logs.find(
        (e) =>
          e.event_type === "settings.requested" &&
          this.store.read<{ application_id: string }>(e.payload)
            .application_id === application.id,
      );
      if (!event || event.actor !== "MASTER_UI")
        throw Error("MASTER_EVIDENCE_REQUIRED");
      const evidence = [
        { log_event_id: event.event_id, content: event.payload },
      ];
      const catalog = await this.world.catalogList();
      const sourceKey = "master-settings:" + this.host.sessionID;
      let sourceID = catalog.sources.find(
        (s) => s.source_key === sourceKey,
      )?.source_id;
      const common = () => ({
        schema_version: 1 as const,
        request_id: id(),
        change_id: id(),
        request_hash: "0".repeat(64),
      });
      if (!sourceID) {
        sourceID = id();
        world.push({
          ...common(),
          record_type: "WorldCatalogChange",
          kind: "REGISTER_SOURCE",
          entity_id: null,
          entity_kind: null,
          display_name: null,
          external_key: null,
          source_id: sourceID,
          source_kind: "MASTER",
          source_key: sourceKey,
          description: "Master WebUI settings",
          expected_revision: 0,
          evidence,
        });
      }
      for (const edit of payload.edits) {
        if (edit.kind === "ENTITY") {
          world.push({
            ...common(),
            record_type: "WorldCatalogChange",
            kind: edit.retire ? "RETIRE_ENTITY" : "UPSERT_ENTITY",
            entity_id: edit.entity_id!,
            entity_kind: edit.entity_kind!,
            display_name: edit.display_name!,
            external_key: edit.external_key ?? null,
            source_id: null,
            source_kind: null,
            source_key: null,
            description: null,
            expected_revision: edit.expected_revision,
            evidence,
          });
        } else {
          if (edit.mode !== "ASSERT" && !edit.assertion_id)
            throw Error("ASSERTION_ID_REQUIRED");
          world.push({
            ...common(),
            record_type: "WorldChange",
            mode: edit.mode!,
            assertion_id: edit.mode === "RETRACT" ? edit.assertion_id! : id(),
            subject_id: edit.subject_id!,
            predicate_key: edit.predicate_key!,
            scope_key: edit.scope_key!,
            source_id: sourceID,
            expected_revision: edit.expected_revision,
            value:
              edit.mode === "RETRACT"
                ? null
                : ((edit.value ?? null) as WorldChange["value"]),
            object_entity_id:
              edit.mode === "RETRACT" ? null : (edit.object_entity_id ?? null),
            replaces_assertion_id:
              edit.mode === "ASSERT" ? null : edit.assertion_id!,
            valid_from: edit.valid_from ?? now(),
            valid_to: edit.valid_to ?? null,
            fresh_until: edit.fresh_until ?? null,
            resolve_conflict_id: edit.resolve_conflict_id ?? null,
            resolution_note: edit.resolution_note ?? null,
            provenance: {
              source_kind: "MASTER",
              source_id: sourceID,
              observed_at: null,
              received_at: now(),
              scope: "Master explicitly applied World Model changes",
              epistemic: "REPORTED",
              evidence,
            },
          });
        }
      }
    }
    for (const change of world) {
      change.request_hash = hash(
        JSON.stringify({ ...change, request_hash: undefined }),
      );
      shape(change);
    }
    return { world, instructions: payload.instructions };
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
      if (
        this.host.session.active_loop_id ||
        this.store
          .all("Input")
          .some(
            (i) =>
              "state" in i &&
              i.record_type === "Input" &&
              i.state === "CLAIMED",
          )
      )
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
      if (!a.context_id) {
        const context = this.host.prepareSettingsContext(
          key,
          changes.instructions?.content ?? settings.content,
          changes.instructions ? settings.revision + 1 : settings.revision,
          rebuiltMessages(source, candidate, key, current.revision + 1),
          current.revision + 1,
        );
        a = this.update(key, { context_id: context.id });
      }
      if (changes.world.length) {
        if (!this.world) throw Error("WORLD_UNAVAILABLE");
        activity.step(activityID, "正在提交设置");
        a = this.update(key, { state: "COMMITTING" });
        stage = a.state;
        // A durable receipt wins over later auth changes after an already completed commit.
        const receipt = await this.world.batchReceipt(key);
        if (!receipt) {
          for (const commandID of payload.command_ids) {
            const command = this.store.get<WorldCommand>(
              "WorldCommand",
              commandID,
            );
            const op = this.store.get<Operation>(
              "Operation",
              command.operation_id,
            );
            if (op.state === "AUTHORIZED")
              this.world.auth.dispatch(op.id, [
                revise(command, { state: "APPLYING" }),
              ]);
            else this.world.auth.resumeWorldDispatch(op.id);
          }
        }
        await this.world.applyBatch(key, a.request_hash, changes.world);
        await this.world.export();
      }
      activity.step(activityID, "正在重建上下文");
      a = this.update(key, { state: "REBUILDING" });
      stage = a.state;
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
                .map((m) => hash(JSON.stringify(m))),
            ]),
          ],
          last_job_id: null,
          settings_application_id: key,
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
    } catch (error) {
      let state: "FAILED" | "BLOCKED" = ["COMMITTING", "REBUILDING"].includes(
        stage,
      )
        ? "BLOCKED"
        : "FAILED";
      if (stage === "COMMITTING" && this.world) {
        try {
          if (!(await this.world.batchReceipt(key))) state = "FAILED";
        } catch {
          /* Unknown database outcome keeps the gate closed. */
        }
      }
      if (state === "FAILED" && stage === "COMMITTING") {
        const a = this.store.get<SettingsApplication>(
          "SettingsApplication",
          key,
        );
        const payload = this.store.read<SettingsPayload>(a.payload_ref);
        for (const commandID of payload.command_ids) {
          const command = this.store.get<WorldCommand>(
            "WorldCommand",
            commandID,
          );
          const op = this.store.get<Operation>(
            "Operation",
            command.operation_id,
          );
          const receipt = this.store.put({
            outcome: "NOT_APPLIED",
            error: String(error),
            application_id: key,
          });
          const transient = /^(08|40|53|57|58)/.test(
            String((error as { code?: string }).code ?? ""),
          );
          if (transient) {
            this.store.commit([
              revise(command, {
                state: "RETRYABLE_ERROR",
                error: String(error),
                receipt_ref: receipt,
              }),
            ]);
            continue;
          }
          this.store.commit([
            revise(command, {
              state: String(error).includes("REVISION_CONFLICT")
                ? "CONFLICT"
                : "REJECTED",
              error: String(error),
              receipt_ref: receipt,
            }),
            revise(op, {
              state: "FAILED",
              effect: "NOT_APPLIED",
              receipt,
              error: String(error),
            }),
          ]);
        }
      }
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
