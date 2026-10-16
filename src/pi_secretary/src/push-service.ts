import type { Notification, PushTarget, PushDispatch } from "./contracts.ts";
import type { PushTargetConfig } from "./api/contracts.ts";
import { Store, base, id, revise } from "./store.ts";
import { stableID } from "./scheduler.ts";
import { ApiError, validate } from "./api/protocol.ts";
import { Notifications } from "./notification-service.ts";
import { PushFailure, sendPush } from "./push-transport.ts";
export type PushDelivery = typeof sendPush;
const delays = [30000, 120000, 600000];
const live = (d: PushDispatch) =>
  d.state === "PENDING" || d.state === "SENDING";
export function quietNow(target: PushTarget, time: number) {
  const q = target.quiet_hours;
  if (!q) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: q.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(time);
  const at =
    parts.find((p) => p.type === "hour")!.value +
    ":" +
    parts.find((p) => p.type === "minute")!.value;
  return q.start < q.end
    ? at >= q.start && at < q.end
    : at >= q.start || at < q.end;
}
export function validatePushConfig(config: PushTargetConfig) {
  validate("PushTargetConfig", config);
  if (!config.name.trim()) throw new ApiError("INVALID_PUSH_CONFIG");
  if (config.kind === "MACOS_NOTIFICATION") {
    if (config.endpoint !== null) throw new ApiError("INVALID_PUSH_ENDPOINT");
  } else {
    try {
      const u = new URL(config.endpoint!);
      if (
        !["http:", "https:"].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        u.pathname !== "/" ||
        config.endpoint !== u.origin
      )
        throw Error();
    } catch {
      throw new ApiError("INVALID_PUSH_ENDPOINT");
    }
  }
  if (config.quiet_hours) {
    try {
      new Intl.DateTimeFormat("en", {
        timeZone: config.quiet_hours.timezone,
      });
      if (config.quiet_hours.start === config.quiet_hours.end) throw Error();
    } catch {
      throw new ApiError("INVALID_QUIET_HOURS");
    }
  }
}

/** Durable outbox with disposable pending/rate indexes; no provider data enters the journal. */
export class Pushes {
  private offset = 0;
  private pending = new Map<string, PushDispatch>();
  private attempts = new Map<string, Map<string, number>>();
  private work?: Promise<void>;
  private closed = false;
  private abort = new AbortController();
  constructor(
    readonly store: Store,
    readonly clock: () => number = Date.now,
    readonly deliver: PushDelivery = sendPush,
  ) {}
  target(targetID: string) {
    const t = this.store.find<PushTarget>("PushTarget", targetID);
    if (!t) throw new ApiError("NOT_FOUND", 404);
    return t;
  }
  configure(config: PushTargetConfig, targetID?: string, expected?: number) {
    validatePushConfig(config);
    const old = targetID ? this.target(targetID) : undefined;
    if (old && old.revision !== expected)
      throw new ApiError("REVISION_CONFLICT", 409);
    if (!old && this.store.all("PushTarget").length >= 20)
      throw new ApiError("PUSH_TARGET_LIMIT");
    const reset =
      !old ||
      (!old.enabled && config.enabled) ||
      old.kind !== config.kind ||
      old.endpoint !== config.endpoint;
    const props = {
      ...config,
      generation: reset ? id() : old!.generation,
      after_sequence: reset ? this.store.sequence + 1 : old!.after_sequence,
    };
    const target: PushTarget = old
      ? revise(old, props)
      : { ...base(), schema_version: 1, record_type: "PushTarget", ...props };
    const cancelled = this.store
      .all<PushDispatch>("PushDispatch")
      .filter(
        (d) =>
          d.target_id === target.id &&
          d.state === "PENDING" &&
          (reset || !target.enabled),
      )
      .map((d) => revise(d, { state: "CANCELLED" }));
    this.store.commit([target, ...cancelled]);
    return target;
  }
  /** Scans only new frames after startup. Deterministic IDs close notification/dispatch crash gaps. */
  reconcile() {
    const targets = this.store.all<PushTarget>("PushTarget");
    while (this.offset < this.store.projectionFrames.length) {
      const frame = this.store.projectionFrames[this.offset];
      const created: PushDispatch[] = [];
      for (const m of frame.mutations) {
        if (m.object_type === "PushDispatch") {
          const d = this.store.get<PushDispatch>("PushDispatch", m.object_id);
          if (live(d)) this.pending.set(d.id, d);
          else this.pending.delete(d.id);
          let rate = this.attempts.get(d.target_id);
          if (!rate) this.attempts.set(d.target_id, (rate = new Map()));
          for (const a of d.attempt_history)
            if (Date.parse(a.at) > this.clock() - 60000)
              rate.set(a.id, Date.parse(a.at));
        }
        if (m.object_type !== "Notification" || m.expected_revision !== 0)
          continue;
        for (const t of targets) {
          if (!t.enabled || frame.sequence <= t.after_sequence) continue;
          const dispatchID = stableID(
            `push:${t.id}:${t.generation}:${m.object_id}`,
          );
          if (this.store.find("PushDispatch", dispatchID)) continue;
          created.push({
            ...base(dispatchID),
            schema_version: 1,
            record_type: "PushDispatch",
            target_id: t.id,
            generation: t.generation,
            notification_id: m.object_id,
            state: "PENDING",
            batch_id: null,
            attempts: 0,
            attempt_history: [],
            next_attempt_at: new Date(this.clock()).toISOString(),
            dispatched_at: null,
            error_code: null,
          });
        }
      }
      if (created.length) this.store.commit(created);
      this.offset++;
    }
  }
  tick(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return (this.work ??= this.run().finally(() => {
      this.work = undefined;
    }));
  }
  private async run() {
    this.reconcile();
    // SENDING left by an earlier process is uncertain, and consumes its saved attempt.
    const interrupted = [...this.pending.values()].filter(
      (d) => d.state === "SENDING",
    );
    if (interrupted.length) {
      this.store.commit(
        interrupted.map((d) => {
          const t = this.target(d.target_id);
          return revise(d, {
            state:
              !t.enabled || t.generation !== d.generation
                ? "CANCELLED"
                : d.attempts >= 4
                  ? "FAILED"
                  : "PENDING",
            error_code: "INTERRUPTED",
          });
        }),
      );
      this.reconcile();
    }
    const results = await Promise.allSettled(
      this.store
        .all<PushTarget>("PushTarget")
        .filter((t) => t.enabled)
        .map((t) => this.send(t)),
    );
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  private preview(d: PushDispatch) {
    const n = this.store.get<Notification>("Notification", d.notification_id);
    const content = new Notifications(this.store, "").view(n, 8192).content;
    if (n.message.media_type === "text/plain") return content.text;
    if (content.truncated) return "新通知";
    try {
      const obj = JSON.parse(content.text);
      return typeof obj.text === "string" ? obj.text : "新通知";
    } catch {
      return "新通知";
    }
  }
  private async send(target: PushTarget) {
    const time = this.clock();
    if (quietNow(target, time)) return;
    const rate = this.attempts.get(target.id) ?? new Map<string, number>();
    for (const [key, at] of rate) if (at <= time - 60000) rate.delete(key);
    if (rate.size >= 3) return;
    const due = [...this.pending.values()].filter(
      (d) =>
        d.target_id === target.id &&
        d.generation === target.generation &&
        d.state === "PENDING" &&
        Date.parse(d.next_attempt_at) <= time,
    );
    if (!due.length) return;
    const batchID = due[0].batch_id ?? id();
    const batch = due
      .filter((d) => d.batch_id === due[0].batch_id)
      .slice(0, 100);
    let message: string;
    try {
      message =
        [
          ...((batch.length > 1 ? `${batch.length} 条通知：` : "") +
            batch.map((d) => this.preview(d)).join("\n")),
        ]
          .slice(0, 200)
          .join("") + "\n在客户端查看";
    } catch {
      this.store.commit(
        batch.map((d) =>
          revise(d, { state: "FAILED", error_code: "CONTENT_UNAVAILABLE" }),
        ),
      );
      this.reconcile();
      return;
    }
    const attempt = { id: id(), at: new Date(time).toISOString() };
    const sending = batch.map((d) =>
      revise(d, {
        state: "SENDING",
        batch_id: batchID,
        attempts: d.attempts + 1,
        attempt_history: [...d.attempt_history, attempt],
        next_attempt_at: new Date(
          time + (delays[d.attempts] ?? 0),
        ).toISOString(),
        error_code: null,
      }),
    );
    this.store.commit(sending);
    this.reconcile();
    let error: PushDispatch["error_code"] = null;
    try {
      await this.deliver(
        this.store.dir,
        target,
        message,
        AbortSignal.any([this.abort.signal, AbortSignal.timeout(10000)]),
      );
    } catch (e) {
      error =
        e instanceof PushFailure &&
        [
          "SECRET_UNAVAILABLE",
          "PROVIDER_REJECTED",
          "UNSUPPORTED_PLATFORM",
        ].includes(e.message)
          ? (e.message as PushDispatch["error_code"])
          : "TRANSPORT_FAILED";
    }
    const currentTarget = this.target(target.id);
    this.store.commit(
      sending.map((d) => {
        const current = this.store.get<PushDispatch>("PushDispatch", d.id);
        const state = !error
          ? "DISPATCHED"
          : !currentTarget.enabled || currentTarget.generation !== d.generation
            ? "CANCELLED"
            : d.attempts >= 4
              ? "FAILED"
              : "PENDING";
        return revise(current, {
          state,
          error_code: error,
          dispatched_at: !error ? new Date(this.clock()).toISOString() : null,
        });
      }),
    );
    this.reconcile();
  }
  async close() {
    this.closed = true;
    this.abort.abort();
    await this.work;
  }
}
