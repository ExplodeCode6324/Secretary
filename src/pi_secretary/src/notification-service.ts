import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { hash, now, revise, type Store } from "./store.ts";
import type {
  Notification,
  ClientRegistration,
  CoreIdentity,
  OperationLogRecord,
} from "./contracts.ts";
import { ApiError } from "./api/protocol.ts";

type Presentation = {
  notification_id: string;
  client_id: string;
  presented_at: string;
};
export function presentationID(notification: string, client: string) {
  const h = hash("notification.presented:" + notification + ":" + client);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Shared validation for queries and commitment evidence. Legacy SENT is not evidence. */
export function presentedNotification(
  store: Store,
  event: OperationLogRecord,
): Notification | null {
  if (
    event.event_type !== "notification.presented" ||
    event.actor !== "MASTER_UI"
  )
    return null;
  store.transactionForEvent(event.event_id);
  const p = store.read<Partial<Presentation>>(event.payload);
  if (
    !p ||
    typeof p.notification_id !== "string" ||
    typeof p.client_id !== "string" ||
    typeof p.presented_at !== "string" ||
    !Number.isFinite(Date.parse(p.presented_at)) ||
    p.presented_at !== event.occurred_at ||
    Object.keys(p).length !== 3 ||
    event.event_id !== presentationID(p.notification_id, p.client_id)
  )
    return null;
  const n = store.find<Notification>("Notification", p.notification_id);
  const c = store.find<ClientRegistration>("ClientRegistration", p.client_id);
  const owner = store.all<CoreIdentity>("CoreIdentity")[0];
  return n &&
    c &&
    owner &&
    c.owner_id === owner.owner_id &&
    event.scope.session_id === n.session_id &&
    event.scope.task_id === null &&
    event.scope.execution_id === null
    ? n
    : null;
}
const indexes = new WeakMap<
  Store,
  { offset: number; values: Map<string, Map<string, Presentation>> }
>();
export class Notifications {
  constructor(
    readonly store: Store,
    readonly owner: string,
  ) {}
  private index() {
    let index = indexes.get(this.store);
    if (!index)
      indexes.set(this.store, (index = { offset: 0, values: new Map() }));
    for (; index.offset < this.store.logs.length; index.offset++) {
      const e = this.store.logs[index.offset];
      if (!presentedNotification(this.store, e)) continue;
      const p = this.store.read<Presentation>(e.payload);
      let clients = index.values.get(p.notification_id);
      if (!clients) index.values.set(p.notification_id, (clients = new Map()));
      if (!clients.has(p.client_id)) clients.set(p.client_id, p);
    }
    return index.values;
  }
  presented(notificationID: string, clientID: string) {
    const n = this.store.get<Notification>("Notification", notificationID);
    const client = this.store.find<ClientRegistration>(
      "ClientRegistration",
      clientID,
    );
    if (!client || client.owner_id !== this.owner)
      throw new ApiError("FORBIDDEN", 403);
    if (this.index().get(n.id)?.has(clientID)) return { status: "NO_CHANGES" };
    const presented_at = now();
    const e = this.store.event(
      "notification.presented",
      { notification_id: n.id, client_id: clientID, presented_at },
      { session_id: n.session_id, task_id: null, execution_id: null },
      "MASTER_UI",
    );
    e.event_id = presentationID(n.id, clientID);
    e.occurred_at = presented_at;
    this.store.commit([], [e]);
  }
  read(notificationID: string) {
    const n = this.store.get<Notification>("Notification", notificationID);
    if (n.read_at) return { status: "NO_CHANGES" };
    this.store.commit([revise(n, { read_at: now() })]);
  }
  view(n: Notification, limit: number) {
    const ref = n.message;
    if (
      ref.path !== "objects/" + ref.sha256 ||
      fs.lstatSync(path.join(this.store.dir, "objects")).isSymbolicLink()
    )
      throw Error("CORRUPT_OBJECT");
    const fd = fs.openSync(
      path.join(this.store.dir, ref.path),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    let prefix: Buffer;
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size !== ref.bytes)
        throw Error("CORRUPT_OBJECT");
      // Hash with fixed memory; never allocate the original arbitrarily large content.
      const buffer = Buffer.alloc(65536),
        digest = createHash("sha256");
      prefix = Buffer.alloc(Math.min(limit, ref.bytes));
      let offset = 0,
        length: number;
      while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        digest.update(buffer.subarray(0, length));
        if (offset < prefix.length)
          buffer.copy(
            prefix,
            offset,
            0,
            Math.min(length, prefix.length - offset),
          );
        offset += length;
      }
      if (digest.digest("hex") !== ref.sha256) throw Error("CORRUPT_OBJECT");
    } finally {
      fs.closeSync(fd);
    }
    // A streaming decoder omits an incomplete trailing scalar instead of inserting U+FFFD.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(prefix, {
      stream: prefix.length < ref.bytes,
    });
    return {
      id: n.id,
      revision: String(n.revision),
      state: n.state,
      session_id: n.session_id,
      channel: n.channel,
      requested_at: n.requested_at,
      updated_at: n.updated_at,
      created_sequence: String(this.store.firstSequence("Notification", n.id)),
      read_at: n.read_at ?? null,
      presented: [...(this.index().get(n.id)?.values() ?? [])].map(
        ({ client_id, presented_at }) => ({ client_id, presented_at }),
      ),
      content: {
        text,
        media_type: ref.media_type,
        content_version: ref.sha256,
        bytes: String(ref.bytes),
        truncated: prefix.length < ref.bytes,
      },
    };
  }
}
