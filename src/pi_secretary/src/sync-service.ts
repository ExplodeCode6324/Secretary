import { casTextChunk } from "./cas-text.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { App } from "./app.ts";
import { type Store, type Stored, now } from "./store.ts";
import type {
  Mutation,
  NotificationDelivery,
  Notification,
} from "./contracts.ts";
import { ApiError } from "./api/protocol.ts";
import { syncMetadata, NotificationService } from "./notification-service.ts";
export const SYNC_BYTES = 512 * 1024;
export const SYNC_LIMIT = 100;
export type Change = {
  resource_type: string;
  resource_id: string;
  revision: string;
  query: string;
  state?: string;
  client_id?: string;
  request_id?: string;
};
export type SyncBatch = {
  transaction_id: string;
  sequence: string;
  index: number;
  final: boolean;
  changes: Change[];
  cursor: string | null;
};
export type SyncPage = {
  batches: SyncBatch[];
  next_cursor: string;
  next_page: string | null;
  has_more: boolean;
};
const resources: Record<string, [string, string]> = {
  Session: ["session", "session"],
  Input: ["input", "timeline"],
  ModelCall: ["activity", "timeline"],
  Feedback: ["feedback", "timeline"],
  Dispatch: ["task_progress", "tasks"],
  WorkerReceipt: ["task_progress", "tasks"],
  TaskPlan: ["task", "tasks"],
  Execution: ["execution", "executions"],
  TaskResult: ["result", "artifacts"],
  DecisionRequest: ["decision", "decisions"],
  AuthorizationRequest: ["authorization", "authorizations"],
  Operation: ["operation", "operations"],
  AssistantProfile: ["assistant", "assistant"],
  Consciousness: ["memory", "memory/summary"],
  CompactionJob: ["memory_update", "memory"],
  ExtractionRecovery: ["memory_recovery", "memory"],
  SettingsDraft: ["settings_draft", "settings"],
  SettingsApplication: ["settings_application", "settings"],
  UserInstructions: ["instructions", "settings"],
  Notification: ["notification", "notifications"],
  NotificationDelivery: ["delivery", "deliveries"],
  ApiCommand: ["request", "requests"],
  AuthorizationRule: ["capabilities", "core"],
  ProgramRegistration: ["capabilities", "core"],
  ArchiveManifest: ["artifacts", "artifacts"],
  WorldCommand: ["world_command", "world/facts"],
};
const singular = new Set([
  "tasks",
  "executions",
  "decisions",
  "authorizations",
  "operations",
  "notifications",
  "deliveries",
  "requests",
]);
type Version = { sequence: number; mutation: Mutation };
type Token = {
  v: string;
  history: string;
  scope: string;
  sequence: string;
  digest: string;
  offset?: number;
  expires?: number;
  part?: number;
  count?: number;
};
export class SyncService {
  private indexed = 0;
  private versions = new Map<string, Version[]>();
  private keys: string[] = [];
  readonly notifications: NotificationService;
  constructor(
    readonly app: App,
    readonly owner: string,
    readonly instance: string,
  ) {
    this.notifications = new NotificationService(app.store);
  }
  get store(): Store {
    return this.app.store;
  }
  private metadata() {
    const m = syncMetadata(this.store);
    if (!m) throw new ApiError("SYNC_NOT_INITIALIZED", 503);
    return m;
  }
  private scope(client: string | null) {
    return (
      this.owner + ":" + this.app.host.sessionID + ":" + (client ?? "owner")
    );
  }
  private digest(sequence: number) {
    return sequence === 0
      ? "0".repeat(64)
      : this.store.projectionFrames[sequence - 1]?.digest;
  }
  private encode(value: Token) {
    const data = Buffer.from(JSON.stringify(value)).toString("base64url");
    return (
      data +
      "." +
      createHmac("sha256", this.metadata().secret)
        .update(data)
        .digest("base64url")
    );
  }
  private decode(
    token: string,
    client: string | null,
    kind = "sync-v1",
  ): Token {
    try {
      if (token.length > 8192) throw Error();
      const [data, sig, ...extra] = token.split(".");
      if (
        !/^[A-Za-z0-9_-]+$/.test(data) ||
        !/^[A-Za-z0-9_-]+$/.test(sig) ||
        extra.length
      )
        throw Error();
      const expected = createHmac("sha256", this.metadata().secret)
          .update(data)
          .digest(),
        got = Buffer.from(sig, "base64url");
      if (got.length !== expected.length || !timingSafeEqual(got, expected))
        throw Error();
      const v = JSON.parse(Buffer.from(data, "base64url").toString()) as Token;
      if (
        v.v !== kind ||
        v.scope !== this.scope(client) ||
        v.history !== this.metadata().history_id
      )
        throw new ApiError("RESYNC_REQUIRED", 409, {
          reason:
            v.v !== kind
              ? "PROJECTION_MISMATCH"
              : v.scope !== this.scope(client)
                ? "SCOPE_MISMATCH"
                : "HISTORY_MISMATCH",
          recovery: "sync/bootstrap",
        });
      if (
        !/^(0|[1-9][0-9]*)$/.test(v.sequence) ||
        !Number.isSafeInteger(Number(v.sequence))
      )
        throw Error();
      if (
        Number(v.sequence) > this.store.sequence ||
        this.digest(Number(v.sequence)) !== v.digest
      )
        throw new ApiError("RESYNC_REQUIRED", 409, {
          reason: "POSITION_UNAVAILABLE",
          recovery: "sync/bootstrap",
        });
      if (
        v.expires !== undefined &&
        (!Number.isFinite(v.expires) || v.expires < Date.now())
      )
        throw new ApiError("SNAPSHOT_EXPIRED", 409);
      return v;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("INVALID_SYNC_CURSOR", 400);
    }
  }
  cursor(sequence: number, client: string | null) {
    return this.encode({
      v: "sync-v1",
      history: this.metadata().history_id,
      scope: this.scope(client),
      sequence: String(sequence),
      digest: this.digest(sequence)!,
    });
  }
  private index() {
    for (; this.indexed < this.store.projectionFrames.length; this.indexed++) {
      const f = this.store.projectionFrames[this.indexed];
      for (const m of f.mutations)
        if (resources[m.object_type]) {
          const key = m.object_type + ":" + m.object_id;
          let history = this.versions.get(key);
          if (!history) {
            history = [];
            this.versions.set(key, history);
            this.keys.push(key);
          }
          history.push({ sequence: f.sequence, mutation: m });
        }
    }
  }
  private change(m: Mutation, client: string | null): Change | null {
    const mapping = resources[m.object_type];
    if (!mapping) return null;
    const compact = !["Consciousness", "TaskResult"].includes(m.object_type);
    const r = compact
      ? this.store.read<Stored>(m.snapshot)
      : {
          record_type: m.object_type as "Consciousness" | "TaskResult",
          id: m.object_id,
          revision: m.new_revision,
        };
    if (
      "session_id" in r &&
      r.session_id &&
      r.session_id !== this.app.host.sessionID
    )
      return null;
    if (r.record_type === "NotificationDelivery" && r.client_id !== client)
      return null;
    const [resource_type, route] = mapping;
    const result: Change = {
      resource_type,
      resource_id: r.id,
      revision: String(r.revision),
      query: singular.has(route) ? route + "/" + r.id : route,
    };
    if ("state" in r && typeof r.state === "string") result.state = r.state;
    if (r.record_type === "NotificationDelivery")
      result.client_id = r.client_id;
    if (r.record_type === "ApiCommand") result.request_id = r.id;
    return result;
  }
  private at(history: Version[], seq: number) {
    let lo = 0,
      hi = history.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (history[mid].sequence <= seq) lo = mid + 1;
      else hi = mid;
    }
    return history[lo - 1];
  }
  snapshotPage(client: string | null, cursor?: string) {
    this.index();
    const v = cursor
      ? this.decode(cursor, client, "snapshot-v1")
      : {
          v: "snapshot-v1",
          history: this.metadata().history_id,
          scope: this.scope(client),
          sequence: String(this.store.sequence),
          digest: this.store.digest,
          offset: 0,
          count: this.keys.length,
          expires: Date.now() + 300000,
        };
    let offset = v.offset ?? 0;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > this.keys.length
    )
      throw new ApiError("INVALID_SYNC_CURSOR");
    const items: Change[] = [];
    // Budget scans as well as visible items; a filtered page can be empty but advances.
    const count = v.count!;
    if (!Number.isSafeInteger(count) || count < 0 || count > this.keys.length)
      throw new ApiError("INVALID_SYNC_CURSOR");
    const end = Math.min(count, offset + 100);
    for (; offset < end; offset++) {
      const item = this.at(
        this.versions.get(this.keys[offset])!,
        Number(v.sequence),
      );
      if (item) {
        const c = this.change(item.mutation, client);
        if (c) items.push(c);
      }
    }
    return {
      items,
      version: v.sequence,
      cursor: this.cursor(Number(v.sequence), client),
      next_cursor: offset < count ? this.encode({ ...v, offset }) : null,
    };
  }
  async bootstrap(client: string | null) {
    // Everything in this block is synchronous. World is explicitly a later, independent read.
    const metadata = this.metadata();
    const page = this.snapshotPage(client);
    const asOf = now();
    const session = this.app.host.session;
    const profile = this.store.select("AssistantProfile", () => true, 1)[0];
    const journal = {
      session: {
        id: session.id,
        state: session.state,
        revision: String(session.revision),
      },
      assistant: {
        actor_id: "assistant",
        display_name:
          profile && "name" in profile && profile.name
            ? profile.name
            : "secretary",
      },
      resources: page,
      queries: [
        "timeline",
        "tasks",
        "attention",
        "memory/summary",
        "memory/commitments",
        "settings",
        "artifacts",
        "related",
        "notifications",
      ],
      as_of: asOf,
    };
    const world = this.app.world
      ? await this.app.world.syncStatus()
      : {
          availability: "not_configured",
          world_version: null,
          world_history_id: null,
        };
    return {
      history_id: metadata.history_id,
      projection_version: "1",
      instance_id: this.instance,
      cursor: page.cursor,
      journal,
      world,
    };
  }
  private *changesAt(
    sequence: number,
    client: string | null,
  ): Generator<Change> {
    const f = this.store.projectionFrames[sequence - 1];
    for (const m of f.mutations) {
      const c = this.change(m, client);
      if (c) yield c;
      if (m.object_type === "ApiCommand") {
        const r = this.store.read<import("./contracts.ts").ApiCommand>(
          m.snapshot,
        );
        if (r.command.startsWith("admin/world/"))
          yield {
            resource_type: "world",
            resource_id: r.id,
            revision: String(sequence),
            query: "world/facts",
          };
      }
      // Related/attention/artifact/public memory are invalidated by dependencies, even records-only commits.
      const routes =
        m.object_type === "TaskResult"
          ? ["artifacts", "related", "tasks"]
          : ["AuthorizationRequest", "DecisionRequest", "Execution"].includes(
                m.object_type,
              )
            ? ["attention", "related", "tasks"]
            : ["Consciousness", "CompactionJob", "ExtractionRecovery"].includes(
                  m.object_type,
                )
              ? ["memory/summary", "memory/commitments"]
              : [];
      for (const route of routes)
        yield {
          resource_type: "invalidation",
          resource_id: route,
          revision: String(sequence),
          query: route,
        };
    }
    for (const e of f.log_records) {
      if (e.scope.session_id && e.scope.session_id !== this.app.host.sessionID)
        continue;
      if (
        ["main.message", "input.accepted", "notification.queued"].includes(
          e.event_type,
        )
      )
        yield {
          resource_type: "message",
          resource_id: e.event_id,
          revision: String(sequence),
          query: "timeline/around?event_id=" + e.event_id,
        };
      else if (e.event_type.startsWith("world.change_"))
        yield {
          resource_type: "world",
          resource_id: e.event_id,
          revision: String(sequence),
          query: "world/facts",
        };
    }
  }
  private *parts(sequence: number, client: string | null): Generator<Change[]> {
    let items: Change[] = [],
      bytes = 0;
    for (const c of this.changesAt(sequence, client)) {
      const size = Buffer.byteLength(JSON.stringify(c)) + 1;
      if (items.length && (bytes + size > 48 * 1024 || items.length >= 100)) {
        yield items;
        items = [];
        bytes = 0;
      }
      items.push(c);
      bytes += size;
    }
    yield items;
  }
  changes(after: string, client: string | null, pageToken?: string): SyncPage {
    const start = this.decode(after, client);
    const continuation = pageToken
      ? this.decode(pageToken, client, "parts-v1")
      : null;
    if (continuation && continuation.sequence !== start.sequence)
      throw new ApiError("INVALID_SYNC_CURSOR");
    let sequence = Number(start.sequence) + 1,
      skip = continuation?.part ?? 0;
    if (!Number.isSafeInteger(skip) || skip < 0)
      throw new ApiError("INVALID_SYNC_CURSOR");
    const batches: SyncBatch[] = [];
    let next = after,
      used = 2048,
      scanned = 0;
    for (
      ;
      sequence <= this.store.sequence && scanned < 100;
      sequence++, scanned++
    ) {
      const parts = this.parts(sequence, client);
      let current = parts.next(),
        index = 0;
      while (!current.done) {
        const following = parts.next(),
          final = !!following.done;
        if (index >= skip) {
          const batch: SyncBatch = {
            transaction_id: this.metadata().history_id + ":" + String(sequence),
            sequence: String(sequence),
            index,
            final,
            changes: current.value,
            cursor: final ? this.cursor(sequence, client) : null,
          };
          const size = Buffer.byteLength(JSON.stringify(batch)) + 1;
          if (
            batches.length &&
            (used + size > SYNC_BYTES - 4096 || batches.length >= 100)
          ) {
            const position = this.decode(next, client);
            return {
              batches,
              next_cursor: next,
              next_page: index
                ? this.encode({ ...position, v: "parts-v1", part: index })
                : null,
              has_more: true,
            };
          }
          batches.push(batch);
          used += size;
          if (final) next = batch.cursor!;
        }
        index++;
        current = following;
      }
      skip = 0;
    }
    return {
      batches,
      next_cursor: next,
      next_page: null,
      has_more: sequence <= this.store.sequence,
    };
  }
  listNotifications(
    client: string | null,
    q: URLSearchParams,
    deliveries: boolean,
  ) {
    if (deliveries && !client)
      throw new ApiError("CLIENT_BINDING_REQUIRED", 403);
    const scope = deliveries ? "deliveries" : "notifications";
    const token = q.get("cursor");
    this.index();
    const saved = token
      ? this.decode(token, client, scope + "-v1")
      : {
          v: scope + "-v1",
          history: this.metadata().history_id,
          scope: this.scope(client),
          sequence: String(this.store.sequence),
          digest: this.store.digest,
          offset: 0,
          count: this.keys.length,
          expires: Date.now() + 300000,
        };
    const limit = Number(q.get("limit") ?? 30);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApiError("INVALID_LIMIT");
    let offset = saved.offset ?? 0;
    const items: unknown[] = [];
    let bytes = 0,
      scanned = 0;
    for (
      ;
      offset < saved.count! && items.length < limit && scanned < 1000;
      offset++, scanned++
    ) {
      const key = this.keys[offset];
      if (
        !key.startsWith(deliveries ? "NotificationDelivery:" : "Notification:")
      )
        continue;
      const ver = this.at(this.versions.get(key)!, Number(saved.sequence));
      if (!ver) continue;
      const r = this.store.read<Notification | NotificationDelivery>(
        ver.mutation.snapshot,
      );
      if (r.record_type === "NotificationDelivery" && r.client_id !== client)
        continue;
      const item = this.notificationView(r);
      const size = Buffer.byteLength(JSON.stringify(item));
      if (items.length && bytes + size > 256 * 1024) break;
      items.push(item);
      bytes += size;
    }
    return {
      items,
      version: saved.sequence,
      next_cursor:
        offset < saved.count! ? this.encode({ ...saved, offset }) : null,
    };
  }
  notificationView(r: Notification | NotificationDelivery) {
    if (r.record_type === "NotificationDelivery")
      return {
        id: r.id,
        notification_id: r.notification_id,
        client_id: r.client_id,
        revision: String(r.revision),
        content_version: r.content_version,
        created_at: r.created_at,
        received_at: r.received_at,
        presented_at: r.presented_at,
        read_at: r.read_at,
      };
    return {
      id: r.id,
      revision: String(r.revision),
      content_version: r.message.sha256,
      bytes: String(r.message.bytes),
      requested_at: r.requested_at,
      legacy: !this.store.find("NotificationRouting", r.id),
      legacy_state: this.store.find("NotificationRouting", r.id)
        ? null
        : r.state,
      content_query: "notifications/" + r.id + "/content",
    };
  }
  notificationContent(id: string, q: URLSearchParams, client: string | null) {
    const n = this.store.get<Notification>("Notification", id);
    const token = q.get("cursor");
    const saved = token
      ? this.decode(token, client, "notification-content:" + id)
      : {
          v: "notification-content:" + id,
          history: this.metadata().history_id,
          scope: this.scope(client),
          sequence: String(this.store.sequence),
          digest: this.store.digest,
          offset: 0,
        };
    const chunk = casTextChunk(this.store, n.message, saved.offset ?? 0);
    return {
      id,
      content_version: n.message.sha256,
      text: chunk.text,
      next_cursor:
        chunk.next !== null
          ? this.encode({ ...saved, offset: chunk.next })
          : null,
    };
  }
}
