import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { App } from "./app.ts";
import { base, id, now, revise, type Stored } from "./store.ts";
import type {
  ApiCommand,
  CoreIdentity,
  AssistantProfile,
  ClientRegistration,
  Consciousness,
  TaskPlan,
  TaskProposal,
  Execution,
  TaskResult,
  AuthorizationRequest,
  DecisionRequest,
  AuthorizationRule,
  Artifact,
  Input,
  ObjectRef,
} from "./contracts.ts";
import {
  ApiError,
  Cursors,
  fingerprint,
  project,
  revision,
  validate,
  errorOf,
} from "./api/protocol.ts";
import { commandRoute } from "./api/routes.ts";
import type { Receipt } from "./api/contracts.ts";
import { timelineFor } from "./timeline.ts";
import { activityHistoryFor } from "./activity-history.ts";
export type OwnerPrincipal = Readonly<{
  kind: "local-owner";
  owner_id: string;
}>;
const IDENTITY = "995e1b45-b9e8-43e7-b0df-460814f2c7f1";
const PROFILE = "1c5e07dd-0519-4266-8208-b00e9cbd997a";
const longRoutes = new Set([
  "task-requests/:id/cancel",
  "executions/:id/cancel",
  "session/compact",
  "session/resume",
  "memory/recovery",
  "operations/:id/verify-write",
  "admin/world/migrate",
]);
/** Admission and public projections only. Domain owners retain business state machines. */
export class ApplicationService {
  readonly instanceID = id();
  readonly identity: CoreIdentity;
  readonly principal: OwnerPrincipal;
  readonly cursors = new Cursors(randomUUID());
  private running = new Set<Promise<void>>();
  private closed = false;
  private frame = 0;
  private artifacts = new Map<
    string,
    { artifact: Artifact; task: string; execution: string }
  >();
  private taskIDs = new Set<string>();
  private executionIDs = new Map<string, string[]>();
  private messageEvents = new Map<string, string>();
  private eventMessages = new Map<string, string>();
  private events = new Map<
    string,
    {
      session_id: string | null;
      task_id: string | null;
      execution_id: string | null;
    }
  >();
  constructor(
    readonly app: App,
    readonly stop?: () => void,
  ) {
    const store = app.store;
    let identity = store.find<CoreIdentity>("CoreIdentity", IDENTITY);
    if (!identity) {
      identity = {
        ...base(IDENTITY),
        schema_version: 1,
        record_type: "CoreIdentity",
        owner_id: id(),
      };
      store.commit([identity]);
    }
    this.identity = identity;
    this.principal = Object.freeze({
      kind: "local-owner",
      owner_id: identity.owner_id,
    });
    if (!store.find("AssistantProfile", PROFILE))
      store.commit([
        {
          ...base(PROFILE),
          schema_version: 1,
          record_type: "AssistantProfile",
          name: "",
        },
      ]);
    // An interrupted dispatch is reconciled through domain resources, never replayed.
    for (const request of store.all<ApiCommand>("ApiCommand")) {
      if (request.state === "RUNNING") {
        const recovery =
          request.command === "memory/recovery"
            ? store.select<import("./contracts.ts").ExtractionRecovery>(
                "ExtractionRecovery",
                (r) => r.request_id === request.id,
                1,
              )
            : [];
        store.commit([
          revise(request, {
            state: "UNKNOWN",
            error_code: "INTERRUPTED_DISPATCH",
            resource_ids: [
              ...request.resource_ids,
              ...recovery.map((r) => ({ type: r.record_type, id: r.id })),
            ],
          }),
        ]);
      } else if (request.state === "QUEUED") this.schedule(request.id);
    }
    this.sync();
  }
  private authorize(principal: OwnerPrincipal) {
    if (
      principal.kind !== "local-owner" ||
      principal.owner_id !== this.identity.owner_id
    )
      throw new ApiError("FORBIDDEN", 403);
  }
  private sync() {
    for (; this.frame < this.app.store.projectionFrames.length; this.frame++) {
      const frame = this.app.store.projectionFrames[this.frame];
      for (const event of frame.log_records) {
        this.events.set(event.event_id, event.scope);
        if (event.event_type === "main.message") {
          const m = this.app.store.read<{ display_call_id?: string }>(
            event.payload,
          );
          const message = m.display_call_id
            ? "message:" + m.display_call_id
            : event.event_id;
          this.messageEvents.set(message, event.event_id);
          this.eventMessages.set(event.event_id, message);
        } else if (event.event_type === "input.accepted") {
          this.messageEvents.set(event.event_id, event.event_id);
          this.eventMessages.set(event.event_id, event.event_id);
        }
      }
      for (const mutation of frame.mutations) {
        if (mutation.object_type === "TaskPlan")
          this.taskIDs.add(mutation.object_id);
        if (
          mutation.object_type === "Execution" &&
          mutation.expected_revision === 0
        ) {
          const e = this.app.store.read<Execution>(mutation.snapshot);
          const ids = this.executionIDs.get(e.task_id) ?? [];
          ids.push(e.id);
          this.executionIDs.set(e.task_id, ids);
        }
      }
      for (const mutation of frame.mutations)
        if (mutation.object_type === "TaskResult") {
          const result = this.app.store.read<TaskResult>(mutation.snapshot);
          for (const artifact of result.artifacts)
            this.artifacts.set(artifact.artifact_id, {
              artifact,
              task: result.task_id,
              execution: result.execution_id,
            });
        }
    }
  }
  receipt(requestID: string): Receipt {
    const r = this.app.store.get<ApiCommand>("ApiCommand", requestID);
    return {
      request_id: r.id,
      command: r.command,
      acceptance: "ACCEPTED",
      state: r.state,
      revision: String(r.revision),
      resource_ids: r.resource_ids,
      error_code: r.error_code,
    };
  }
  command(principal: OwnerPrincipal, path: string, body: unknown): Receipt {
    this.authorize(principal);
    if (this.closed) throw new ApiError("CORE_STOPPING", 503);
    const route = commandRoute(path);
    if (!route) throw new ApiError("NOT_FOUND", 404);
    validate(route.schema, body);
    const requestID = body.request_id as string;
    const digest = fingerprint({ owner: principal.owner_id, path, body });
    const store = this.app.store,
      old = store.find<ApiCommand>("ApiCommand", requestID);
    if (old) {
      if (old.request_hash !== digest || old.owner_id !== principal.owner_id)
        throw new ApiError("REQUEST_CONFLICT", 409);
      return this.receipt(requestID);
    }
    // A client cannot capture a legacy/internal request ID from the same store.
    if (store.hasRequestIdentity(requestID))
      throw new ApiError("REQUEST_CONFLICT", 409);
    const request: ApiCommand = {
      ...base(requestID),
      schema_version: 1,
      record_type: "ApiCommand",
      owner_id: principal.owner_id,
      command: path,
      request_hash: digest,
      state: longRoutes.has(route.route) ? "QUEUED" : "ACCEPTED",
      arguments_ref: store.put(body),
      resource_ids: [],
      error_code: null,
      result_ref: null,
    };
    if (request.state === "QUEUED") {
      request.resource_ids = [{ type: "Session", id: this.app.host.sessionID }];
      if (route.route === "executions/:id/cancel") {
        this.execution(route.target!);
        request.resource_ids.push({ type: "Execution", id: route.target! });
      }
      if (route.route === "operations/:id/verify-write") {
        store.get("Operation", route.target!);
        request.resource_ids.push({ type: "Operation", id: route.target! });
      }
      if (route.route === "task-requests/:id/cancel") {
        const target = this.app.scheduler.requestStatus(route.target!);
        if (!target) throw new ApiError("NOT_FOUND", 404);
        this.task(target.task_id);
        request.resource_ids.push({ type: "TaskPlan", id: target.task_id });
      }
      store.commit([request]);
      this.schedule(requestID);
      return this.receipt(requestID);
    }
    // Attach acceptance to the FIRST domain mutation, in the very same journal frame.
    // Later domain progress is independently recoverable (e.g. task initialization).
    let accepted = false;
    let result: unknown;
    try {
      store.withAdmission(
        (records) => {
          request.resource_ids = records
            .filter((r) => !["SafetyRule", "Session"].includes(r.record_type))
            .map((r) => ({ type: r.record_type, id: r.id }));
          accepted = true;
          return request;
        },
        () => {
          result = this.dispatch(path, body);
        },
      );
    } catch (error) {
      if (!store.find("ApiCommand", requestID)) throw error;
      // Acceptance already committed; callers must reconcile the authoritative objects.
    }
    if (!accepted) {
      request.result_ref = result === undefined ? null : store.put(result);
      store.commit([request]);
    } // Durable NO_CHANGES, too.
    if (path === "core/stop") setImmediate(() => this.stop?.());
    return this.receipt(requestID);
  }
  private schedule(requestID: string) {
    const job = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        if (this.closed) return;
        const s = this.app.store,
          r = s.get<ApiCommand>("ApiCommand", requestID);
        if (r.state !== "QUEUED") return;
        s.commit([revise(r, { state: "RUNNING" })]);
        try {
          const result = await this.dispatch(
            r.command,
            s.read<Record<string, unknown>>(r.arguments_ref),
          );
          const resources =
            r.command === "memory/recovery"
              ? s
                  .select<import("./contracts.ts").ExtractionRecovery>(
                    "ExtractionRecovery",
                    (e) => e.request_id === requestID,
                    1,
                  )
                  .map((e) => ({ type: e.record_type, id: e.id }))
              : r.resource_ids;
          s.commit([
            revise(s.get<ApiCommand>("ApiCommand", requestID), {
              state: "COMPLETED",
              resource_ids: resources,
              result_ref: result === undefined ? null : s.put(result),
            }),
          ]);
        } catch (error) {
          // Failure may follow a durable partial effect. Never promise safe replay.
          s.commit([
            revise(s.get<ApiCommand>("ApiCommand", requestID), {
              state: "UNKNOWN",
              error_code: errorOf(error).code,
            }),
          ]);
        }
      })
      .finally(() => this.running.delete(job));
    this.running.add(job);
  }
  private dispatch(path: string, b: Record<string, unknown>): unknown {
    const { route, target } = commandRoute(path)!;
    const { host, scheduler, settings, authorization, store } = this.app;
    const requestID = b.request_id as string;
    switch (route) {
      case "assistant/profile": {
        const p = store.get<AssistantProfile>("AssistantProfile", PROFILE);
        if (p.revision !== revision(b.expected_revision))
          throw new ApiError("REVISION_CONFLICT", 409);
        store.commit([revise(p, { name: (b.name as string).trim() })]);
        return;
      }
      case "clients":
        if (b.client_id) {
          const c = store.get<ClientRegistration>(
            "ClientRegistration",
            b.client_id as string,
          );
          if (c.owner_id !== this.identity.owner_id)
            throw new ApiError("FORBIDDEN", 403);
          return { client_id: c.id, instance_id: b.instance_id ?? null };
        }
        store.commit([
          {
            ...base(),
            schema_version: 1,
            record_type: "ClientRegistration",
            name: b.name as string,
            owner_id: this.identity.owner_id,
          },
        ]);
        return;
      case "messages":
        return host.accept(b.text as string, requestID, "MASTER");
      case "task-requests":
        return scheduler.propose(b.goal as string, requestID, host.sessionID, {
          reuse: b.reuse_task_id as string | undefined,
          parent: b.parent_execution_id as string | undefined,
          programID: b.program_id as string | undefined,
          at: b.at as string | undefined,
          interval: b.interval_seconds as number | undefined,
          deadline: b.deadline as string | undefined,
          materials: b.materials as string[] | undefined,
          constraints: b.constraints as string[] | undefined,
          acceptance: b.acceptance as string[] | undefined,
          preconditions: b.preconditions as NonNullable<
            Parameters<typeof scheduler.propose>[3]
          >["preconditions"],
        });
      case "task-requests/:id/cancel":
        return scheduler.cancelRequest(target!, host.sessionID);
      case "executions/:id/cancel":
        this.execution(target!);
        return scheduler.cancel(target!);
      case "executions/:id/viewed":
        this.execution(target!);
        return scheduler.viewed(target!);
      case "decisions/:id/answer":
        this.decision(target!);
        return scheduler.answer(target!, b.answer, requestID, "MASTER");
      case "authorizations/:id/decision":
        this.authorization(target!);
        return authorization.decide({
          schema_version: 1,
          record_type: "ApprovalCommand",
          request_id: requestID,
          authorization_id: target!,
          expected_revision: revision(b.expected_revision),
          display_hash: b.display_hash as string,
          decision: b.decision as "APPROVE" | "REJECT" | "REVOKE",
        });
      case "settings/draft": {
        const payload = structuredClone(b.payload) as any;
        if (payload.instructions)
          payload.instructions.expected_revision = revision(
            payload.instructions.expected_revision,
          );
        for (const edit of payload.edits)
          if (typeof edit.expected_revision === "string")
            edit.expected_revision = revision(edit.expected_revision, true);
        return settings.save(payload, revision(b.expected_revision));
      }
      case "settings/apply":
        return settings.request(revision(b.expected_revision), requestID);
      case "settings/applications/:id/retry":
        return settings.retry(target!);
      case "settings/applications/:id/restore-draft":
        return settings.restoreDraft(target!, revision(b.expected_revision));
      case "session/compact":
        return host.compact();
      case "session/resume":
        return host.resume();
      case "memory/commitments/:id/resolve":
        return host.resolveMemoryCommitment(
          target!,
          b.state as "COMPLETED" | "CANCELLED",
          b.note as string,
        );
      case "memory/recovery":
        return host.recoverMemory({
          ...b,
          expected_revision: revision(b.expected_revision),
        } as Parameters<typeof host.recoverMemory>[0]);
      case "operations/:id/verify-write": {
        const op = store.get<import("./contracts.ts").Operation>(
          "Operation",
          target!,
        );
        if (op.scope.execution_id) this.execution(op.scope.execution_id);
        return scheduler.verifyWrite(target!);
      }
      case "admin/world/migrate":
        if (!this.app.world) throw new ApiError("WORLD_UNAVAILABLE", 503);
        return this.app.world.migrate();
      case "admin/programs":
        return scheduler.registerProgram(
          b.entrypoint as string,
          b.name as string,
        );
      case "admin/authorization-rules":
        return authorization.rule(
          b.action as string,
          b.resource as string,
          b.parameters,
        );
      case "admin/authorization-rules/:id/disable": {
        const r = store.get<AuthorizationRule>("AuthorizationRule", target!);
        if (r.revision !== revision(b.expected_revision))
          throw new ApiError("REVISION_CONFLICT", 409);
        store.commit([revise(r, { state: "DISABLED" })]);
        return;
      }
      case "core/stop":
        return;
    }
  }
  private task(taskID: string) {
    const p = this.app.store.get<TaskPlan>("TaskPlan", taskID);
    if (
      this.app.store.read<TaskProposal>(p.proposal_ref).session_id !==
      this.app.host.sessionID
    )
      throw new ApiError("NOT_FOUND", 404);
    return p;
  }
  private execution(executionID: string) {
    const e = this.app.store.get<Execution>("Execution", executionID);
    this.task(e.task_id);
    return e;
  }
  private decision(decisionID: string) {
    const d = this.app.store.get<DecisionRequest>(
      "DecisionRequest",
      decisionID,
    );
    this.execution(d.execution_id);
    return d;
  }
  private authorization(authorizationID: string) {
    const a = this.app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      authorizationID,
    );
    if (a.scope.execution_id) this.execution(a.scope.execution_id);
    else if (
      a.scope.session_id &&
      a.scope.session_id !== this.app.host.sessionID
    )
      throw new ApiError("NOT_FOUND", 404);
    return a;
  }
  artifact(artifactID: string) {
    this.sync();
    const value = this.artifacts.get(artifactID);
    if (!value) throw new ApiError("NOT_FOUND", 404);
    this.task(value.task);
    const e = this.execution(value.execution);
    let available = false;
    try {
      const ref = value.artifact.content;
      const directory = fs.lstatSync(path.join(this.app.store.dir, "objects"));
      const file = fs.lstatSync(path.join(this.app.store.dir, ref.path));
      available =
        /^objects\/[a-f0-9]{64}$/.test(ref.path) &&
        directory.isDirectory() &&
        !directory.isSymbolicLink() &&
        file.isFile() &&
        !file.isSymbolicLink() &&
        file.size === ref.bytes;
    } catch {
      /* Metadata reports an unavailable immutable artifact. */
    }
    return {
      ...value,
      state:
        e.retention_state === "RETIRED"
          ? "archived"
          : available
            ? "available"
            : "unavailable",
    };
  }
  private artifactView(artifactID: string) {
    const a = this.artifact(artifactID);
    return {
      id: artifactID,
      name: a.artifact.name,
      task_id: a.task,
      execution_id: a.execution,
      content_version: a.artifact.content.sha256,
      bytes: String(a.artifact.content.bytes),
      media_type: a.artifact.content.media_type,
      state: a.state,
    };
  }
  private page(
    scope: string,
    values: unknown[],
    q: URLSearchParams,
    version = String(this.app.store.sequence),
  ) {
    return this.cursors.page(scope, values, q, version);
  }
  async query(
    principal: OwnerPrincipal,
    path: string,
    q = new URLSearchParams(),
  ): Promise<unknown> {
    this.authorize(principal);
    this.sync();
    const { store, host, settings, scheduler } = this.app,
      sid = host.sessionID;
    const allowed = new Set([
      "cursor",
      "limit",
      ...(path === "timeline" ? ["direction", "thinking", "streaming"] : []),
      ...(path === "timeline/around"
        ? ["message_id", "event_id", "thinking", "streaming"]
        : []),
      ...(path.startsWith("messages/") ? ["thinking", "streaming"] : []),
      ...(path === "related" ? ["scope_type", "scope_id"] : []),
      ...(path === "artifacts" ? ["task_id"] : []),
      ...(path === "memory/recovery" ? ["group_key"] : []),
      ...(path.startsWith("world/")
        ? ["subject", "predicate", "scope", "kind", "history"]
        : []),
    ]);
    for (const key of q.keys())
      if (!allowed.has(key) || q.getAll(key).length !== 1)
        throw new ApiError("INVALID_QUERY");
    for (const key of ["thinking", "streaming", "history"])
      if (q.has(key) && !["true", "false"].includes(q.get(key)!))
        throw new ApiError("INVALID_QUERY");
    if (
      q.has("limit") &&
      (!/^[1-9][0-9]*$/.test(q.get("limit")!) ||
        Number(q.get("limit")) > (path.startsWith("timeline") ? 200 : 100))
    )
      throw new ApiError("INVALID_LIMIT");
    const parts = path.split("/"),
      target = parts[1];
    if (path === "core")
      return {
        api_version: "1",
        data_domain_id: this.identity.owner_id,
        owner_id: this.identity.owner_id,
        instance_id: this.instanceID,
        session_id: sid,
        state: host.session.state,
        mode: process.env.SECRETARY_MODE ?? "fixture",
        capabilities: {
          ...Object.fromEntries(
            [
              "messages",
              "tasks",
              "memory",
              "settings",
              "artifacts",
              "attention",
              "authorizations",
              "decisions",
              "assistant_profile",
              "timeline",
              "related",
              "administration",
            ].map((name) => [
              name,
              { state: "supported", allowed: true, reason: null },
            ]),
          ),
          core: { state: "supported", allowed: true, reason: null },
          world: {
            state: this.app.world ? "supported" : "not_configured",
            allowed: !!this.app.world,
            reason: this.app.world ? null : "WORLD_NOT_CONFIGURED",
          },
          devices: {
            state: "not_supported",
            allowed: false,
            reason: "DEVICE_API_NOT_IMPLEMENTED",
          },
          attachments: {
            state: "not_supported",
            allowed: false,
            reason: "UPLOAD_NOT_IMPLEMENTED",
          },
          reliable_sync: {
            state: "not_supported",
            allowed: false,
            reason: "CHANGEFEED_NOT_IMPLEMENTED",
          },
        },
      };
    if (path === "assistant") {
      const p = store.get<AssistantProfile>("AssistantProfile", PROFILE);
      return {
        actor_id: "assistant",
        name: p.name.trim() || "secretary",
        revision: String(p.revision),
      };
    }
    if (parts[0] === "clients" && parts.length === 2) {
      const c = store.get<ClientRegistration>("ClientRegistration", target);
      if (c.owner_id !== this.identity.owner_id)
        throw new ApiError("NOT_FOUND", 404);
      return project(c);
    }
    if (path === "session")
      return {
        id: sid,
        state: host.session.state,
        revision: String(host.session.revision),
        recovery_error: host.session.recovery_error,
      };
    if (parts[0] === "requests" && parts.length === 2)
      return {
        receipt: this.receipt(target),
        result: store.get<ApiCommand>("ApiCommand", target).result_ref
          ? project(
              store.read(
                store.get<ApiCommand>("ApiCommand", target).result_ref!,
              ),
            )
          : null,
        resources: store
          .get<ApiCommand>("ApiCommand", target)
          .resource_ids.map((r) => {
            const v = store.find(r.type as Stored["record_type"], r.id);
            return {
              type: r.type,
              id: r.id,
              state: v && "state" in v ? v.state : null,
              revision: v ? String(v.revision) : null,
            };
          }),
      };
    if (path === "settings") return project(settings.status());
    if (path === "memory") {
      const { commitments, ...status } = host.memoryStatus();
      return project(status);
    }
    if (path === "memory/summary") {
      const cs = store.get<Consciousness>(
        "Consciousness",
        host.session.consciousness_id,
      );
      return this.page(
        path,
        cs.items.map((item) =>
          project({
            item_id: item.item_id,
            tier: item.tier,
            summary: item.summary,
            goals: item.goals,
            constraints: item.constraints,
            decisions: item.decisions,
            open_questions: item.open_questions,
            task_ids: item.task_refs,
            sources: item.source_refs.map((ref) => this.sourceView(ref)),
            updated_at: item.last_activity_at,
          }),
        ),
        q,
        String(cs.revision),
      );
    }
    if (path === "memory/commitments") {
      const status = host.memoryStatus();
      const page = this.page(
        path,
        status.commitments,
        q,
        String(status.revision),
      );
      return {
        ...page,
        items: page.items.map((c: any) =>
          project({
            id: c.id,
            text: c.text,
            state: c.state,
            task_ids: c.task_refs,
            resolution_event_ids: c.resolution_event_ids,
            sources: c.source_refs.map((ref: ObjectRef) =>
              this.sourceView(ref),
            ),
            source_event_ids: c.source_batch?.source_event_ids ?? [],
          }),
        ),
      };
    }
    if (path === "memory/recovery")
      return this.page(
        path,
        project(host.memoryRecoveryPreflight(q.get("group_key") ?? undefined)),
        q,
      );
    if (path === "tasks") {
      const page = this.page(path, [...this.taskIDs], q);
      return {
        ...page,
        items: page.items.map((id) => {
          const p = this.task(id as string);
          return {
            id: p.id,
            revision: String(p.revision),
            state: p.state,
            goal: store.read<TaskProposal>(p.proposal_ref).goal,
            active_execution_ids: p.active_execution_ids,
          };
        }),
      };
    }
    if (parts[0] === "tasks" && parts.length === 2) {
      const p = this.task(target),
        ids = this.executionIDs.get(target) ?? [],
        latest = ids.at(-1),
        e = latest ? this.execution(latest) : null;
      const baseline = store.read<TaskProposal>(p.proposal_ref),
        effective = e ? scheduler.proposalFor(e) : null;
      return project({
        id: p.id,
        revision: p.revision,
        state: p.state,
        goal: baseline.goal,
        baseline: {
          goal: baseline.goal,
          constraints: baseline.constraints,
          acceptance_criteria: baseline.acceptance_criteria,
        },
        effective_proposal: effective
          ? {
              goal: effective.goal,
              constraints: effective.constraints,
              acceptance_criteria: effective.acceptance_criteria,
            }
          : null,
        latest_execution_id: latest ?? null,
        latest_state: e?.state ?? null,
        continuation: scheduler.continuationStatus(p.id, latest, sid),
        pending_requests: (p.pending_requests ?? [])
          .slice(0, 100)
          .map((r) => ({ request_id: r.request_id, due_at: r.due_at })),
        pending_request_count: p.pending_requests?.length ?? 0,
        result: e?.result_id ? this.result(e.result_id) : null,
      });
    }
    if (parts[0] === "tasks" && parts[2] === "requests" && parts.length === 3) {
      const p = this.task(target),
        page = this.page(path, p.pending_requests ?? [], q);
      return {
        ...page,
        items: page.items.map((r: any) => {
          const p = store.read<TaskProposal>(r.proposal_ref);
          return {
            request_id: r.request_id,
            due_at: r.due_at,
            goal: p.goal,
            constraints: p.constraints,
            acceptance_criteria: p.acceptance_criteria,
          };
        }),
      };
    }
    if (
      parts[0] === "tasks" &&
      parts[2] === "executions" &&
      parts.length === 3
    ) {
      this.task(target);
      const page = this.page(path, this.executionIDs.get(target) ?? [], q);
      return {
        ...page,
        items: page.items.map((id) => this.executionView(id as string)),
      };
    }
    if (parts[0] === "task-requests" && parts.length === 2) {
      const r = scheduler.requestStatus(target);
      if (!r) throw new ApiError("NOT_FOUND", 404);
      this.task(r.task_id);
      const proposal = store.read<TaskProposal>(r.proposal_ref);
      return project({
        ...r,
        goal: proposal.goal,
        constraints: proposal.constraints,
        acceptance_criteria: proposal.acceptance_criteria,
      });
    }
    if (parts[0] === "executions" && parts.length === 2)
      return this.executionView(target);
    if (path === "decisions")
      return this.page(
        path,
        store
          .all<DecisionRequest>("DecisionRequest")
          .filter((d) => {
            try {
              this.decision(d.id);
              return true;
            } catch {
              return false;
            }
          })
          .map((d) => project(d)),
        q,
      );
    if (parts[0] === "decisions" && parts.length === 2)
      return project(this.decision(target));
    if (path === "authorizations")
      return this.page(
        path,
        store
          .all<AuthorizationRequest>("AuthorizationRequest")
          .filter((a) => {
            try {
              this.authorization(a.id);
              return true;
            } catch {
              return false;
            }
          })
          .map((a) => project(a)),
        q,
      );
    if (parts[0] === "authorizations" && parts.length === 2) {
      const a = this.authorization(target);
      return project({ ...a, display: store.read(a.display_ref) });
    }
    if (path === "attention") {
      const asOf = now();
      const approvals = store
        .all<AuthorizationRequest>("AuthorizationRequest")
        .filter(
          (a) =>
            ["PENDING", "APPROVED"].includes(a.state) &&
            (!a.expires_at || a.expires_at > asOf),
        );
      const decisions = store
        .all<DecisionRequest>("DecisionRequest")
        .filter(
          (d) =>
            d.state === "OPEN" &&
            (!d.deadline || d.deadline > asOf) &&
            this.execution(d.execution_id).state === "WAIT_DECISION",
        );
      const deadlines = [
        ...approvals.map((a) => a.expires_at),
        ...decisions.map((d) => d.deadline),
      ]
        .filter((d): d is string => !!d)
        .sort();
      const items = [
        ...approvals.map((a) => ({
          type: "authorization",
          id: a.id,
          revision: String(a.revision),
          expires_at: a.expires_at,
        })),
        ...decisions.map((d) => ({
          type: "decision",
          id: d.id,
          revision: String(d.revision),
          expires_at: d.deadline,
        })),
      ];
      return {
        ...this.page(path, items, q, fingerprint(items)),
        counts: {
          authorizations: approvals.length,
          decisions: decisions.length,
        },
        as_of: asOf,
        valid_until: deadlines[0] ?? null,
        session_id: sid,
      };
    }
    if (path === "artifacts") {
      const task = q.get("task_id");
      if (task) this.task(task);
      return this.page(
        path + ":" + (task ?? ""),
        [...this.artifacts.keys()]
          .filter((id) => !task || this.artifacts.get(id)!.task === task)
          .map((id) => this.artifactView(id)),
        q,
      );
    }
    if (parts[0] === "artifacts" && parts.length === 2)
      return this.artifactView(target);
    if (path === "related") {
      const scope = q.get("scope_type") ?? "session",
        value = q.get("scope_id") ?? sid;
      let tasks: string[] = [];
      if (scope === "session" && value === sid)
        tasks = [...this.taskIDs].filter((id) => {
          try {
            this.task(id);
            return true;
          } catch {
            return false;
          }
        });
      else if (scope === "task") {
        this.task(value);
        tasks = [value];
      } else if (scope === "event" || scope === "message") {
        const event = this.events.get(this.messageEvents.get(value) ?? value);
        if (!event) throw new ApiError("NOT_FOUND", 404);
        if (event.session_id !== sid && !event.task_id)
          throw new ApiError("NOT_FOUND", 404);
        if (event.task_id) {
          this.task(event.task_id);
          tasks = [event.task_id];
        }
      } else throw new ApiError("INVALID_SCOPE");
      return this.page(
        path + ":" + scope + ":" + value,
        [
          ...tasks.map((id) => ({ type: "task", id, basis: "recorded_scope" })),
          ...[...this.artifacts]
            .filter(([, a]) => tasks.includes(a.task))
            .map(([id]) => ({ type: "artifact", id, basis: "task_result" })),
        ],
        q,
      );
    }
    if (path === "timeline" || path === "timeline/around")
      return this.timeline(path, q);
    if (parts[0] === "messages" && parts[2] === "content" && parts.length === 3)
      return this.fragment(target, q);
    if (parts[0] === "activities" && parts.length === 2) {
      const history = activityHistoryFor(store);
      const a =
        history
          .live(this.app.activitySnapshot())
          .find((a) => a.id === target && history.sessionFor(a) === sid) ??
        history.selected(sid, [target])[0];
      if (!a) throw new ApiError("NOT_FOUND", 404);
      return project(a);
    }
    if (parts[0] === "world") {
      const world = this.app.world;
      if (!world) throw new ApiError("WORLD_UNAVAILABLE", 503);
      if (path === "world/slot")
        return world.slot(
          q.get("subject") ?? "",
          q.get("predicate") ?? "",
          q.get("scope") ?? "",
        );
      if (path === "world/catalog") {
        const kind = q.get("kind") ?? "entities",
          scope = path + ":" + kind;
        const page = await world.catalogPage(
          kind,
          q.get("cursor")
            ? this.cursors.decode<string>(scope, q.get("cursor")!)
            : undefined,
          Number(q.get("limit") ?? 30),
        );
        return {
          ...project(page),
          next_cursor: page.next_cursor
            ? this.cursors.encode(scope, page.next_cursor)
            : null,
        };
      }
      if (path === "world/facts") {
        const scope =
          path +
          ":" +
          fingerprint([q.get("subject"), q.get("predicate"), q.get("history")]);
        const page = await world.browse({
          subject: q.get("subject") ?? undefined,
          predicate: q.get("predicate") ?? undefined,
          history: q.get("history") === "true",
          cursor: q.get("cursor")
            ? this.cursors.decode<string>(scope, q.get("cursor")!)
            : undefined,
          limit: Number(q.get("limit") ?? 30),
        });
        return {
          items: project(page.rows),
          world_version: page.version,
          next_cursor: page.next_cursor
            ? this.cursors.encode(scope, page.next_cursor)
            : null,
        };
      }
    }
    if (path === "operations")
      return this.page(path, project(store.all("Operation")), q);
    if (parts[0] === "operations" && parts.length === 2)
      return project(store.get("Operation", target));
    if (path === "admin/programs")
      return this.page(path, project(store.all("ProgramRegistration")), q);
    if (path === "admin/authorization-rules")
      return this.page(path, project(store.all("AuthorizationRule")), q);
    throw new ApiError("NOT_FOUND", 404);
  }
  private sourceView(ref: ObjectRef) {
    return { ...project(ref), event_ids: [], locator_state: "unavailable" };
  }
  private result(resultID: string) {
    const r = this.app.store.get<TaskResult>("TaskResult", resultID);
    return {
      id: r.id,
      revision: String(r.revision),
      outcome: r.outcome,
      summary: r.summary,
      limitations: r.limitations,
      artifact_ids: r.artifacts.map((a) => a.artifact_id),
      needs_action: r.needs_action,
      verified_by: r.verified_by,
      observed_at: r.observed_at,
    };
  }
  private executionView(executionID: string) {
    const e = this.execution(executionID);
    return project({
      id: e.id,
      revision: e.revision,
      task_id: e.task_id,
      state: e.state,
      retention_state: e.retention_state,
      last_activity_at: e.last_activity_at,
      waiting_request_ids: e.waiting_request_ids,
      unknown_operation_ids: e.unknown_operation_ids,
      cancel_requested: e.cancel_requested,
      result: e.result_id ? this.result(e.result_id) : null,
    });
  }
  private timeline(path: string, q: URLSearchParams) {
    const t = timelineFor(this.app),
      thinking = q.get("thinking") === "true",
      streaming = q.get("streaming") === "true",
      scope =
        "timeline:" +
        this.app.host.sessionID +
        ":" +
        thinking +
        ":" +
        streaming;
    let locate: string | undefined;
    if (path.endsWith("/around")) {
      const message = q.get("message_id"),
        event = q.get("event_id");
      if (!!message === !!event) throw new ApiError("INVALID_LOCATOR");
      locate = message ?? this.eventMessages.get(event!) ?? event!;
    }
    const result = t.query(this.app.host.sessionID, {
      thinking,
      streaming,
      limit: Number(q.get("limit") ?? 30),
      cursor: q.get("cursor")
        ? this.cursors.decode<string>(scope, q.get("cursor")!)
        : undefined,
      direction: q.get("direction") ?? undefined,
      locate,
    });
    return {
      items: result.items.map((v: any) =>
        this.messageView(v, thinking, streaming),
      ),
      version: String(result.revision),
      generation: result.generation,
      before:
        "before" in result && result.before
          ? this.cursors.encode(scope, result.before)
          : null,
      after:
        "after" in result && result.after
          ? this.cursors.encode(scope, result.after)
          : null,
    };
  }
  private messageView(item: any, thinking = false, streaming = false) {
    if (item.kind !== "message")
      return project({
        id: item.id,
        kind: item.kind,
        revision: item.revision,
        activity: item.activity,
      });
    const offset = item.textOffset + item.text.length,
      thinkingOffset = item.thinkingOffset + (item.thinking?.length ?? 0);
    return {
      id: item.id,
      kind: "message",
      revision: String(item.revision),
      role: item.role === "secretary" ? "assistant" : item.role,
      at: item.at,
      text: item.text,
      ...(thinking ? { thinking: item.thinking } : {}),
      call_id: item.call_id ?? null,
      incomplete: !!item.incomplete,
      next_cursor:
        offset < item.textLength || thinkingOffset < item.thinkingLength
          ? this.cursors.encode(
              "body:" + item.id + ":" + thinking + ":" + streaming,
              { offset, thinkingOffset, version: item.revision },
            )
          : null,
    };
  }
  private fragment(messageID: string, q: URLSearchParams) {
    const thinking = q.get("thinking") === "true",
      streaming = q.get("streaming") === "true";
    const cursor = q.get("cursor"),
      saved = cursor
        ? this.cursors.decode<{
            offset: number;
            thinkingOffset: number;
            version: number;
          }>("body:" + messageID + ":" + thinking + ":" + streaming, cursor)
        : null;
    const result = timelineFor(this.app).query(this.app.host.sessionID, {
      thinking,
      streaming,
      fragment: messageID,
      textOffset: saved?.offset ?? 0,
      thinkingOffset: saved?.thinkingOffset ?? 0,
    });
    const item = result.items[0];
    if (saved && saved.version !== item.revision)
      throw new ApiError("CURSOR_EXPIRED", 409);
    return this.messageView(item, thinking, streaming);
  }
  async close() {
    this.closed = true;
    await Promise.all(this.running);
  }
}
