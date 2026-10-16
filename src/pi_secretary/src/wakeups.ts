import type { Input, WakeTimer } from "./contracts.ts";
import { Store, base, hash, revise, shapeDefinition } from "./store.ts";
import { stableID } from "./scheduler.ts";
import { ApiError } from "./api/protocol.ts";

type ToolName = "schedule_wakeup" | "cancel_wakeup";
/** Match declared string fields after the provider's validation/coercion. */
export function wakeupArguments(name: ToolName, args: unknown) {
  const value = args as Record<string, unknown>;
  return name === "schedule_wakeup"
    ? { at: String(value.at), note: String(value.note) }
    : { timer_id: String(value.timer_id) };
}
export type WakeupResult = {
  timer_id: string;
  at: string;
  state: WakeTimer["state"];
};
const view = (timer: WakeTimer): WakeupResult => ({
  timer_id: timer.id,
  at: timer.at,
  state: timer.state,
});

/** A disposable, bounded pending set; the journal is the only durable authority. */
export class Wakeups {
  private readonly pending = new Map<string, WakeTimer>();
  constructor(
    readonly store: Store,
    readonly sessionID: string,
    readonly clock: () => number = Date.now,
  ) {
    for (const timer of store.all<WakeTimer>("WakeTimer"))
      if (timer.session_id === sessionID && timer.state === "PENDING")
        this.pending.set(timer.id, timer);
    if (this.pending.size > 100) throw Error("WAKEUP_LIMIT_EXCEEDED");
  }
  get(timerID: string): WakeTimer {
    const timer = this.store.find<WakeTimer>("WakeTimer", timerID);
    if (!timer || timer.session_id !== this.sessionID)
      throw new ApiError("NOT_FOUND", 404);
    return timer;
  }
  private digest(name: ToolName, args: unknown) {
    return hash(
      JSON.stringify({
        session_id: this.sessionID,
        name,
        args: wakeupArguments(name, args),
      }),
    );
  }
  /** Recovery only reads the original receipt, even if the timer has since fired. */
  recovered(
    name: ToolName,
    call: string,
    args: unknown,
  ): WakeupResult | undefined {
    const saved = this.store.receipt<string>(call, this.digest(name, args));
    if (saved === undefined) return undefined;
    const timer = this.get(saved);
    // CommandReceipt.object_id is a UUID, not a JSON result. at is immutable;
    // scheduling always returned PENDING, cancellation always a terminal state.
    // No domain method is rerun during recovery.
    if (name === "cancel_wakeup" && timer.state === "PENDING")
      throw Error("WAKEUP_RECEIPT_CORRUPT");
    return {
      ...view(timer),
      state: name === "schedule_wakeup" ? "PENDING" : timer.state,
    };
  }
  schedule(
    call: string,
    args: { at: string; note: string },
    sourceEvents: string[],
  ): WakeupResult {
    const previous = this.recovered("schedule_wakeup", call, args);
    if (previous) return previous;
    // Validate before normalization: Date.parse silently rolls over e.g. Feb 30.
    try {
      shapeDefinition("Time", args.at);
    } catch {
      throw new ApiError("INVALID_WAKEUP_TIME");
    }
    const at = Date.parse(args.at);
    if (
      !Number.isFinite(at) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(args.at) ||
      at <= this.clock()
    )
      throw new ApiError("INVALID_WAKEUP_TIME");
    if (!args.note.trim() || Buffer.byteLength(args.note, "utf8") > 4096)
      throw new ApiError("INVALID_WAKEUP_NOTE");
    if (this.pending.size >= 100)
      throw new ApiError("WAKEUP_LIMIT_EXCEEDED", 409);
    const sources = [...new Set(sourceEvents)];
    if (!sources.length) throw new ApiError("WAKEUP_SOURCE_REQUIRED");
    const timer: WakeTimer = {
      ...base(stableID("wakeup:" + call)),
      schema_version: 1,
      record_type: "WakeTimer",
      session_id: this.sessionID,
      at: new Date(at).toISOString(),
      note: args.note,
      source_event_ids: sources,
      state: "PENDING",
      fired_at: null,
      cancelled_at: null,
      input_id: null,
    };
    const result = view(timer);
    this.store.commit([timer], [], {
      request: call,
      hash: this.digest("schedule_wakeup", args),
      value: timer.id,
    });
    this.pending.set(timer.id, timer);
    return result;
  }
  cancel(timerID: string, call?: string): WakeupResult {
    const args = { timer_id: timerID };
    if (call) {
      const previous = this.recovered("cancel_wakeup", call, args);
      if (previous) return previous;
    }
    const old = this.get(timerID);
    const timer =
      old.state === "PENDING"
        ? revise(old, {
            state: "CANCELLED",
            cancelled_at: new Date(this.clock()).toISOString(),
          })
        : old;
    const result = view(timer);
    if (timer !== old || call)
      this.store.commit(
        timer !== old ? [timer] : [],
        [],
        call
          ? {
              request: call,
              hash: this.digest("cancel_wakeup", args),
              value: timer.id,
            }
          : undefined,
      );
    this.pending.delete(timerID);
    return result;
  }
  hasDue() {
    return [...this.pending.values()].some(
      (t) => Date.parse(t.at) <= this.clock(),
    );
  }
  fireDue() {
    const time = this.clock();
    for (const old of [...this.pending.values()].sort(
      (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
    )) {
      if (Date.parse(old.at) > time) continue;
      const firedAt = new Date(time).toISOString();
      const input: Input = {
        ...base(stableID("wakeup-input:" + old.id)),
        schema_version: 1,
        record_type: "Input",
        session_id: this.sessionID,
        dedupe_key: "wakeup:" + old.id,
        producer: "TIMER",
        state: "ACCEPTED",
        loop_id: null,
        feedback_id: null,
        received_at: firedAt,
        payload: this.store.put(
          "Scheduled self-wakeup (TIMER; not a new Master instruction):\n" +
            JSON.stringify({
              timer_id: old.id,
              note: old.note,
              scheduled_at: old.at,
              fired_at: firedAt,
              late_by_ms: Math.max(0, time - Date.parse(old.at)),
            }),
          "text/plain",
        ),
      };
      const timer = revise(old, {
        state: "FIRED",
        fired_at: firedAt,
        input_id: input.id,
      });
      const scope = {
        session_id: this.sessionID,
        task_id: null,
        execution_id: null,
      };
      this.store.commit(
        [timer, input],
        [
          this.store.event("input.accepted", input, scope, "HOST"),
          this.store.event(
            "wakeup.fired",
            { timer_id: timer.id, input_id: input.id },
            scope,
            "HOST",
          ),
        ],
      );
      this.pending.delete(timer.id);
    }
  }
}
