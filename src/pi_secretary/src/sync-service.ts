import type { App } from "./app.ts";
import type { Mutation, TaskPlan, TaskProposal } from "./contracts.ts";
import { type Store, type Stored } from "./store.ts";
import { ApiError, limitOf } from "./api/protocol.ts";
import type { SyncChange, SyncPage, SyncTransaction } from "./api/contracts.ts";

type Mapping = { resource: string | null; invalidate: readonly string[] };
const none: Mapping = { resource: null, invalidate: [] };
const mapping = (
  resource: string | null,
  ...invalidate: string[]
): Mapping => ({ resource, invalidate });
// Compile-time coverage follows the generated journal union, including private records.
export const mutationMappings = {
  Session: mapping("session", "timeline"),
  Input: mapping(null, "timeline", "session"),
  AttachmentImport: none,
  Attachment: mapping("attachments"),
  PushTarget: mapping("push-targets", "push-targets"),
  PushDispatch: mapping("push-dispatches", "push-dispatches"),
  WakeTimer: mapping("wakeups", "wakeups"),
  Context: none,
  ModelCall: mapping(null, "timeline", "activities"),
  Consciousness: mapping(
    null,
    "memory",
    "memory/summary",
    "memory/commitments",
  ),
  CompactionJob: mapping(null, "memory", "session", "timeline", "activities"),
  TaskPlan: mapping("tasks", "tasks", "task-requests", "related", "attention"),
  Execution: mapping(
    "executions",
    "tasks",
    "executions",
    "attention",
    "task-requests",
    "related",
    "timeline",
    "activities",
  ),
  Dispatch: mapping(null, "tasks", "executions", "task-requests"),
  WorkerReceipt: mapping(null, "tasks", "executions"),
  Checkpoint: none,
  TaskResult: mapping(null, "tasks", "executions", "artifacts", "related"),
  Feedback: mapping(null, "timeline", "session"),
  DecisionRequest: mapping("decisions", "attention", "tasks"),
  Operation: mapping(
    "operations",
    "attention",
    "tasks",
    "authorization-rules",
    "admin/authorization-rules",
    "timeline",
    "activities",
  ),
  AuthorizationRequest: mapping("authorizations", "attention", "tasks"),
  AuthorizationRule: mapping(
    "authorization-rules",
    "authorization-rules",
    "admin/authorization-rules",
  ),
  SafetyRule: none,
  ProgramRegistration: mapping("admin/programs", "admin/programs"),
  Notification: mapping("notifications", "notifications"),
  ArchiveManifest: mapping(null, "executions", "tasks", "artifacts", "related"),
  WorldCommand: none,
  UserInstructions: mapping(null, "settings"),
  MainPromptSnapshot: none,
  SettingsDraft: mapping(null, "settings"),
  SettingsApplication: mapping(
    null,
    "settings",
    "memory",
    "memory/summary",
    "memory/commitments",
    "session",
    "timeline",
    "activities",
  ),
  ExtractionRecovery: mapping(null, "memory"),
  CoreIdentity: none,
  AssistantProfile: mapping("assistant"),
  ClientRegistration: mapping("clients"),
  ApiCommand: mapping("requests"),
  MemoryExtractionJob: mapping(
    null,
    "memory",
    "memory/summary",
    "memory/commitments",
  ),
  Scope: mapping("scopes", "scopes", "tasks", "task-browser"),
} satisfies Record<Mutation["object_type"], Mapping>;

export const SYNC_PAGE_BYTES = 256 * 1024;
export class SyncService {
  constructor(
    readonly app: App,
    readonly owner: string,
    readonly instance: string,
  ) {}
  get store(): Store {
    return this.app.store;
  }
  cursor(sequence = this.store.sequence) {
    const digest =
      sequence === 0
        ? "0".repeat(64)
        : this.store.projectionFrames[sequence - 1].digest;
    return Buffer.from(
      JSON.stringify({ owner_id: this.owner, sequence, digest }),
    ).toString("base64url");
  }
  position(cursor: string) {
    try {
      if (!cursor || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor))
        throw Error();
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (
        value.owner_id !== this.owner ||
        Object.keys(value).length !== 3 ||
        !Number.isSafeInteger(value.sequence) ||
        value.sequence < 0 ||
        value.sequence > this.store.sequence ||
        value.digest !==
          (value.sequence === 0
            ? "0".repeat(64)
            : this.store.projectionFrames[value.sequence - 1].digest)
      )
        throw Error();
      return value.sequence as number;
    } catch {
      throw new ApiError("RESYNC_REQUIRED", 409);
    }
  }
  current() {
    return {
      cursor: this.cursor(),
      sequence: String(this.store.sequence),
      instance_id: this.instance,
    };
  }
  private visible(r: Stored) {
    const sid = this.app.host.sessionID;
    if (r.record_type === "TaskPlan")
      return this.store.read<TaskProposal>(r.proposal_ref).session_id === sid;
    if ("session_id" in r && r.session_id && r.session_id !== sid) return false;
    if (
      (r.record_type === "Operation" ||
        r.record_type === "ModelCall" ||
        r.record_type === "AuthorizationRequest") &&
      r.scope.session_id &&
      r.scope.session_id !== sid
    )
      return false;
    if ("task_id" in r && typeof r.task_id === "string") {
      const task = this.store.find<TaskPlan>("TaskPlan", r.task_id);
      if (task && !this.visible(task)) return false;
    }
    return true;
  }
  transaction(sequence: number): SyncTransaction {
    const frame = this.store.projectionFrames[sequence - 1];
    const changes = new Map<string, SyncChange>(),
      affected = new Set<string>();
    let bytes = 0,
      coarse = false;
    const invalidate = (query: string, resource = query) => {
      affected.add(resource);
      const item: SyncChange = {
        kind: "invalidate",
        resource_type: resource,
        query,
      };
      const key = "invalidate:" + query;
      if (!coarse && !changes.has(key)) {
        changes.set(key, item);
        bytes += Buffer.byteLength(JSON.stringify(item)) + 1;
      }
    };
    for (const mutation of frame.mutations) {
      const m = mutationMappings[mutation.object_type];
      if (!m.resource && !m.invalidate.length) continue;
      const r = this.store.read<Stored>(mutation.snapshot);
      if (!this.visible(r)) continue;
      for (const query of m.invalidate) invalidate(query);
      // Exact aggregate queries supplement collection invalidations; coarse fallback
      // keeps only bounded resource classes, never an unbounded set of IDs.
      let taskID =
        "task_id" in r && typeof r.task_id === "string" ? r.task_id : null;
      const executionID =
        r.record_type === "Execution"
          ? r.id
          : "execution_id" in r && typeof r.execution_id === "string"
            ? r.execution_id
            : r.record_type === "Operation" ||
                r.record_type === "AuthorizationRequest"
              ? r.scope.execution_id
              : null;
      if (!taskID && executionID)
        taskID =
          this.store.find<import("./contracts.ts").Execution>(
            "Execution",
            executionID,
          )?.task_id ?? null;
      if (taskID) {
        invalidate("tasks/" + taskID, "tasks");
        invalidate("tasks/" + taskID + "/executions", "executions");
      }
      if (executionID && r.record_type !== "Execution")
        invalidate("executions/" + executionID, "executions");

      if (m.resource) {
        affected.add(m.resource);
        if (!coarse) {
          const item: SyncChange = {
            kind: "record",
            resource_type: m.resource,
            resource_id: mutation.object_id,
            revision: String(mutation.new_revision),
          };
          changes.set(m.resource + ":" + mutation.object_id, item);
          bytes += Buffer.byteLength(JSON.stringify(item)) + 1;
        }
      }
      if (bytes > SYNC_PAGE_BYTES / 2) {
        coarse = true;
        changes.clear();
      }
    }
    if (
      frame.mutations.some((m) =>
        [
          "TaskPlan",
          "Execution",
          "TaskResult",
          "AuthorizationRequest",
          "DecisionRequest",
          "Operation",
          "Scope",
        ].includes(m.object_type),
      )
    )
      invalidate("task-browser");
    for (const event of frame.log_records) {
      if (event.event_type === "agent.message") invalidate("task-browser");
      if (event.event_type.startsWith("world.change_")) invalidate("world");
      if (
        event.scope.session_id &&
        event.scope.session_id !== this.app.host.sessionID
      )
        continue;
      if (
        [
          "main.message",
          "input.accepted",
          "notification.queued",
          "feedback.delivered",
          "agent.message",
          "main.tool.result",
        ].includes(event.event_type)
      )
        invalidate("timeline");
      if (
        event.event_type === "notification.presented" ||
        event.event_type === "notification.result"
      )
        invalidate("notifications");
      if (event.event_type === "operation.dispatched") {
        invalidate("authorization-rules");
        invalidate("admin/authorization-rules");
      }
    }
    return {
      cursor: this.cursor(sequence),
      changes: coarse
        ? [...affected].map((query) => ({
            kind: "invalidate",
            resource_type: query,
            query,
          }))
        : [...changes.values()],
    };
  }
  changes(after: string, limit = 100): SyncPage {
    let position = this.position(after);
    const transactions: SyncTransaction[] = [];
    let next_cursor = after;
    let transactionBytes = 0;
    for (
      let count = 0;
      position < this.store.sequence && count < limit;
      count++
    ) {
      const transaction = this.transaction(position + 1);
      const has_more = position + 1 < this.store.sequence;
      const candidateBytes =
        transactionBytes +
        (transactions.length ? 1 : 0) +
        Buffer.byteLength(JSON.stringify(transaction));
      // Serialize each transaction once; count the actual cursor/boolean wrapper and commas.
      const envelope = {
        api_version: "1",
        data: {
          transactions: [],
          next_cursor: transaction.cursor,
          has_more,
        },
      };
      if (
        candidateBytes + Buffer.byteLength(JSON.stringify(envelope)) >
        SYNC_PAGE_BYTES
      )
        break;
      transactionBytes = candidateBytes;
      transactions.push(transaction);
      next_cursor = transaction.cursor;
      position++;
    }
    return {
      transactions,
      next_cursor,
      has_more: position < this.store.sequence,
    };
  }
  query(route: string, q: URLSearchParams) {
    const allowed = route === "sync/cursor" ? [] : ["after", "limit"];
    for (const key of q.keys())
      if (!allowed.includes(key) || q.getAll(key).length !== 1)
        throw new ApiError("INVALID_QUERY");
    if (route === "sync/cursor") return this.current();
    if (route !== "sync/changes") throw new ApiError("NOT_FOUND", 404);
    if (!q.has("after")) throw new ApiError("INVALID_QUERY");
    const limits = new URLSearchParams(q);
    if (!limits.has("limit")) limits.set("limit", "100");
    return this.changes(q.get("after")!, limitOf(limits));
  }
}
