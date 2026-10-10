import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { Store, base, id, now, revise, hash, type Stored } from "./store.ts";
import { ApiError } from "./api/protocol.ts";
import type {
  SyncMetadata,
  Notification,
  NotificationDelivery,
  NotificationRouting,
  DeliveryTarget,
  ClientRegistration,
  OperationLogRecord,
} from "./contracts.ts";
export const SYNC_ID = "35f24396-c7e9-4b60-83d4-bb44a6d2eab3";
export const syncMetadata = (s: Store) =>
  s.find<SyncMetadata>("SyncMetadata", SYNC_ID);
export function initializeSync(s: Store) {
  if (syncMetadata(s)) return;
  s.commit([
    {
      ...base(SYNC_ID),
      record_type: "SyncMetadata",
      schema_version: 1,
      history_id: id(),
      secret: randomBytes(32).toString("hex"),
      projection_version: "1",
      legacy_through: s.sequence,
    },
  ]);
}
export function resetSyncHistory(s: Store) {
  const meta = syncMetadata(s);
  if (!meta) throw new ApiError("SYNC_NOT_INITIALIZED", 503);
  // Keep the signing key so an authenticated old cursor is diagnosed as resync.
  s.commit([revise(meta, { history_id: id() })]);
}
function stableDelivery(notification: string, client: string) {
  const h = hash(notification + ":" + client);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export class NotificationService {
  constructor(readonly store: Store) {}
  target(client: string) {
    return this.store.find<DeliveryTarget>("DeliveryTarget", client);
  }
  configure(client: string, owner: string, enabled: boolean, rotate = false) {
    const c = this.store.get<ClientRegistration>("ClientRegistration", client);
    if (c.owner_id !== owner) throw new ApiError("FORBIDDEN", 403);
    if (!syncMetadata(this.store))
      throw new ApiError("SYNC_NOT_INITIALIZED", 503);
    const old = this.target(client);
    if (
      enabled &&
      !old?.enabled &&
      this.store.select<DeliveryTarget>("DeliveryTarget", (t) => t.enabled, 100)
        .length >= 100
    )
      throw new ApiError("NOTIFICATION_TARGET_LIMIT", 409);
    const target: DeliveryTarget = old
      ? revise(old, {
          enabled,
          binding_nonce: rotate ? id() : old.binding_nonce,
        })
      : {
          ...base(client),
          schema_version: 1,
          record_type: "DeliveryTarget",
          owner_id: owner,
          enabled,
          binding_nonce: id(),
        };
    if (!old || old.enabled !== enabled || rotate) this.store.commit([target]);
    return { client_id: client, enabled };
  }
  binding(client: string, owner: string) {
    const t = this.target(client),
      m = syncMetadata(this.store);
    if (!t || !m || t.owner_id !== owner)
      throw new ApiError("FORBIDDEN_TARGET", 403);
    return (
      client +
      "." +
      createHmac("sha256", m.secret)
        .update(owner + ":" + client + ":" + t.binding_nonce)
        .digest("base64url")
    );
  }
  authenticate(
    token: string | undefined,
    owner: string,
    required = false,
  ): string | null {
    if (!token) {
      if (required) throw new ApiError("CLIENT_BINDING_REQUIRED", 403);
      return null;
    }
    if (token.length > 200) throw new ApiError("FORBIDDEN_TARGET", 403);
    const client = token.split(".")[0];
    const expected = Buffer.from(this.binding(client, owner)),
      got = Buffer.from(token);
    if (got.length !== expected.length || !timingSafeEqual(got, expected))
      throw new ApiError("FORBIDDEN_TARGET", 403);
    return client;
  }
  private delivery(n: Notification, client: string): NotificationDelivery {
    return {
      ...base(stableDelivery(n.id, client)),
      record_type: "NotificationDelivery",
      schema_version: 1,
      notification_id: n.id,
      client_id: client,
      session_id: n.session_id,
      content_version: n.message.sha256,
      created_at: now(),
      received_at: null,
      presented_at: null,
      read_at: null,
    };
  }
  create(session: string, message: string, key: string): Notification {
    const n: Notification = {
      ...base(),
      record_type: "Notification",
      schema_version: 1,
      state: "QUEUED",
      session_id: session,
      channel: "local-ui",
      message: this.store.put(message, "text/plain"),
      delivery_key: key,
      receipt: null,
      requested_at: now(),
    };
    const records: Stored[] = [n];
    if (syncMetadata(this.store)) {
      const clients = this.store.select<DeliveryTarget>(
        "DeliveryTarget",
        (t) => t.enabled,
        100,
      );
      const routing: NotificationRouting = {
        ...base(n.id),
        schema_version: 1,
        record_type: "NotificationRouting",
        notification_id: n.id,
        state: clients.length ? "ROUTED" : "UNROUTED",
      };
      records.push(routing, ...clients.map((c) => this.delivery(n, c.id)));
    }
    this.store.commit(records, [
      this.store.event(
        "notification.queued",
        n,
        { session_id: session, task_id: null, execution_id: null },
        "MAIN",
      ),
    ]);
    return n;
  }
  // Explicit, bounded and repeatable routing command. Reads never claim intent.
  claimUnrouted(client: string) {
    if (!this.target(client)?.enabled)
      throw new ApiError("TARGET_DISABLED", 409);
    const routes = this.store.select<NotificationRouting>(
      "NotificationRouting",
      (r) => r.state === "UNROUTED",
      100,
    );
    if (!routes.length) return { claimed: 0 };
    const records: Stored[] = [];
    for (const r of routes) {
      const n = this.store.get<Notification>("Notification", r.notification_id);
      records.push(revise(r, { state: "ROUTED" }), this.delivery(n, client));
    }
    this.store.commit(records);
    return { claimed: routes.length };
  }
  deliveryFor(delivery: string, client: string) {
    const d = this.store.get<NotificationDelivery>(
      "NotificationDelivery",
      delivery,
    );
    if (d.client_id !== client) throw new ApiError("FORBIDDEN_TARGET", 403);
    return d;
  }
  ack(
    delivery: string,
    client: string,
    kind: "received" | "presented" | "read",
    version: string,
  ) {
    const d = this.deliveryFor(delivery, client);
    if (d.content_version !== version)
      throw new ApiError("CONTENT_VERSION_CONFLICT", 409);
    if (d[(kind + "_at") as "received_at"]) return;
    if (
      (kind === "presented" && !d.received_at) ||
      (kind === "read" && !d.presented_at)
    )
      throw new ApiError("ACK_PRECONDITION", 409);
    const changed = revise(d, { [kind + "_at"]: now() });
    const events =
      kind === "presented"
        ? [
            this.store.event(
              "notification.presented",
              changed,
              { session_id: d.session_id, task_id: null, execution_id: null },
              "MAIN",
            ),
          ]
        : [];
    this.store.commit([changed], events);
  }
}
/** Verifies immutable presentation evidence without depending on the latest delivery revision. */
export function presentedNotification(
  store: Store,
  event: OperationLogRecord,
): Notification | null {
  if (event.event_type === "notification.result") {
    const n = store.read<Notification>(event.payload);
    const saved = store.find<Notification>("Notification", n.id);
    if (
      n.state !== "SENT" ||
      !n.receipt ||
      !saved ||
      hash(JSON.stringify(saved)) !== event.payload.sha256
    )
      return null;
    const receipt = store.read<{ delivery_key?: string; presented?: boolean }>(
      n.receipt,
    );
    return receipt.delivery_key === n.delivery_key && receipt.presented === true
      ? n
      : null;
  }
  if (event.event_type !== "notification.presented") return null;
  const d = store.read<NotificationDelivery>(event.payload),
    saved = store.find<NotificationDelivery>("NotificationDelivery", d.id);
  if (
    d.record_type !== "NotificationDelivery" ||
    !d.presented_at ||
    !d.received_at ||
    !saved ||
    saved.notification_id !== d.notification_id ||
    saved.client_id !== d.client_id ||
    saved.presented_at !== d.presented_at ||
    saved.content_version !== d.content_version
  )
    return null;
  const n = store.find<Notification>("Notification", d.notification_id);
  return n &&
    n.session_id === d.session_id &&
    n.message.sha256 === d.content_version
    ? n
    : null;
}
