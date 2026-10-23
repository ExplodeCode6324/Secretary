import { attachmentInputView } from "./attachments.ts";
import { randomUUID } from "node:crypto";
import type { App } from "./app.ts";
import {
  activityHistoryFor,
  type HistoricalActivity,
} from "./activity-history.ts";
import type {
  ObjectRef,
  Input,
  Feedback,
  Notification,
  ModelCall,
} from "./contracts.ts";
import {
  abnormalReply,
  hasDisplayContent,
  messageDisplaysFor,
} from "./message-display.ts";
import { thinkingPreview, visibleThinking } from "./thinking-preview.ts";
import type { ThinkingPreview } from "./api/contracts.ts";

export const PAGE_BYTES = 1024 * 1024;
export const FRAGMENT_BYTES = 64 * 1024;
type Key = { order: number; id: string };
type Meta = Key & {
  session: string;
  revision: number;
  kind: "message" | "activity";
  role?: string;
  at?: string;
  call_id?: string;
  incomplete?: boolean;
  source?: ObjectRef;
  event?: string;
  activity?: HistoricalActivity;
  previewVersion?: number;
  preview_availability?: "active" | "expired";
  source_kind?: string;
  source_event_id?: string;
  outcome?: string;
  request_id?: string;
  input_id?: string;
  task_id?: string;
  execution_id?: string;
  result_id?: string;
  decision_request_id?: string;
  notification_id?: string;
};
type Cursor = Key & {
  generation: string;
  session: string;
  thinking: boolean;
  streaming: boolean;
  v: 1;
};
export type TimelineOptions = {
  thinking?: boolean;
  streaming?: boolean;
  limit?: number;
  cursor?: string;
  direction?: string;
  locate?: string;
  since?: number;
  generation?: string;
  lower?: string;
  upper?: string;
  tail?: boolean;
  fragment?: string;
  textOffset?: number;
  thinkingOffset?: number;
};
const compare = (a: Key, b: Key) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function cut(text: string, offset: number, budget: number) {
  let lo = offset,
    hi = Math.min(text.length, offset + 4999);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(text.slice(offset, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  // Do not split UTF-16 surrogate pairs.
  if (lo < text.length && lo > offset && /[\uD800-\uDBFF]/.test(text[lo - 1]))
    lo--;
  return text.slice(offset, lo);
}
const registries = new WeakMap<App, Timeline>();
export function timelineFor(app: App) {
  let value = registries.get(app);
  if (!value) {
    value = new Timeline(app);
    registries.set(app, value);
  }
  value.sync();
  return value;
}
/** Disposable references and display order; bodies are read only for the requested page. */
export class Timeline {
  readonly generation = randomUUID();
  revision = 0;
  private position = 0;
  private rows = new Map<string, Meta>();
  private ordered = new Map<string, Meta[]>();
  private live = new Map<string, HistoricalActivity>();
  private previews = new Map<
    string,
    ReturnType<App["host"]["previews"]["snapshot"]>[number]
  >();
  private previewRevision = -1;
  private history;
  constructor(private app: App) {
    this.history = activityHistoryFor(app.store);
    this.history.observe((activity) => {
      const session = this.history.sessionFor(activity);
      if (!session) return;
      this.put({
        id: activity.id,
        session,
        kind: "activity",
        order: activity.order,
        activity,
      });
    });
  }
  private put(value: Omit<Meta, "revision">) {
    const old = this.rows.get(value.id);
    if (
      old &&
      JSON.stringify({ ...old, revision: undefined }) === JSON.stringify(value)
    )
      return;
    const row: Meta = {
      ...value,
      order: old?.order ?? value.order,
      revision: ++this.revision,
    };
    this.rows.set(row.id, row);
    const list = this.ordered.get(row.session) ?? [];
    if (!old) list.splice(this.bound(list, row), 0, row);
    else {
      const index = this.bound(list, old);
      list[index] = row;
    }
    this.ordered.set(row.session, list);
  }
  private bound(list: Meta[], key: Key) {
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compare(list[mid], key) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  sync() {
    this.history.sync();
    const displays = messageDisplaysFor(this.app.store);
    for (
      ;
      this.position < this.app.store.projectionFrames.length;
      this.position++
    ) {
      const frame = this.app.store.projectionFrames[this.position];
      for (const [index, e] of frame.log_records.entries()) {
        if (
          ![
            "input.accepted",
            "main.message",
            "feedback.delivered",
            "notification.queued",
          ].includes(e.event_type)
        )
          continue;
        const session = e.scope.session_id;
        if (!session) continue;
        let role = "system",
          call_id: string | undefined,
          incomplete = false;
        const metadata: Partial<Meta> = { source_event_id: e.event_id };
        if (e.event_type === "main.message") {
          const m = this.app.store.read<any>(e.payload);
          if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
          // Abnormal empty results carry status; normal tool-only stays an activity.
          const visible = hasDisplayContent(m.content);
          if (!visible && !abnormalReply(m.stopReason)) continue;
          role = "secretary";
          call_id = displays.forEvent(e.event_id)?.call_id;
          metadata.source_kind = "assistant_response";
          metadata.outcome =
            (
              {
                stop: "completed",
                toolUse: "continued",
                length: "truncated",
                error: "failed",
                aborted: "interrupted",
              } as Record<string, string>
            )[m.stopReason] ?? "unknown";
          if (!visible && m.stopReason === "error" && call_id) {
            const call = this.app.store.find<ModelCall>("ModelCall", call_id);
            if (
              call?.scope.session_id === session &&
              call.state === "INTERRUPTED" &&
              call.failure_kind === "CANCELLED"
            )
              metadata.outcome = "interrupted";
          }
          incomplete = abnormalReply(m.stopReason);
        } else if (e.event_type === "input.accepted") {
          const input = this.app.store.read<Input>(e.payload);
          if (input.attachments?.length) metadata.input_id = input.id;
          role = input.producer === "MASTER" ? "master" : "system";
          metadata.source_kind =
            role === "master" ? "master_input" : "system_input";
          if (
            role === "master" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              input.dedupe_key,
            )
          )
            metadata.request_id = input.dedupe_key;
        } else if (e.event_type === "notification.queued") {
          role = "secretary";
          metadata.source_kind = "notification";
          metadata.notification_id = this.app.store.read<Notification>(
            e.payload,
          ).id;
        } else {
          const feedback = this.app.store.read<Feedback>(e.payload);
          metadata.source_kind = "task_feedback";
          for (const key of [
            "task_id",
            "execution_id",
            "result_id",
            "decision_request_id",
          ] as const)
            if (feedback[key]) metadata[key] = feedback[key]!;
        }
        this.put({
          ...metadata,
          id: call_id ? "message:" + call_id : e.event_id,
          session,
          kind: "message",
          role,
          at: e.occurred_at,
          call_id,
          incomplete,
          order:
            this.history.messageOrder(e.event_id) ??
            frame.sequence * 1000 +
              500 +
              (index / (frame.log_records.length + 1)) * 100,
          source: e.payload,
          event: e.event_type,
        });
      }
    }
    const snapshot = this.app.activitySnapshot();
    const current = new Map(this.history.live(snapshot).map((a) => [a.id, a]));
    for (const [id, a] of current) {
      const old = this.live.get(id);
      if (
        !old ||
        old.version !== a.version ||
        old.phase !== a.phase ||
        old.status !== a.status ||
        this.rows.get(id)?.activity?.source !== "live"
      ) {
        const row = this.rows.get(id);
        this.put({
          id,
          session: a.session_id ?? this.app.host.sessionID,
          kind: "activity",
          order: row?.order ?? a.order,
          activity: a,
        });
      }
    }
    for (const id of this.live.keys())
      if (!current.has(id)) {
        const durable = this.history.selected(this.app.host.sessionID, [id])[0];
        const old = this.rows.get(id);
        if (old && durable)
          this.put({
            id,
            session: old.session,
            kind: "activity",
            order: old.order,
            activity: durable,
          });
        else if (old?.activity)
          this.put({
            id,
            session: old.session,
            kind: "activity",
            order: old.order,
            activity: {
              ...old.activity,
              status: "interrupted",
              phase: "活动已结束，结果未记录",
              ended_at: old.activity.last_progress_at,
            },
          });
      }
    this.live = current;
    if (this.previewRevision !== this.app.host.previews.revision) {
      this.previewRevision = this.app.host.previews.revision;
      const previous = this.previews;
      this.previews = new Map(
        this.app.host.previews
          .snapshot(this.app.host.sessionID, true)
          .map((p) => [p.id, p]),
      );
      for (const id of previous.keys()) {
        const old = this.rows.get("message:" + id);
        if (old && !old.source && !this.previews.has(id)) {
          const { revision: _revision, ...row } = old;
          this.put({ ...row, preview_availability: "expired" });
        }
      }
      for (const p of this.previews.values()) {
        const id = "message:" + p.id,
          old = this.rows.get(id);
        if (
          old?.source ||
          (!old && !p.blocks.some((b) => b.text) && !p.thinking_preview)
        )
          continue;
        this.put({
          id,
          session: p.session,
          kind: "message",
          role: "secretary",
          at: p.at,
          call_id: p.id,
          order:
            old?.order ??
            (this.rows.get("model:" + p.id)?.order ??
              this.app.store.sequence * 1000) + 100,
          previewVersion: p.version,
          preview_availability: "active",
          source_kind: "assistant_response",
        });
      }
    }
  }
  private encode(row: Key, session: string, o: TimelineOptions) {
    return Buffer.from(
      JSON.stringify({
        id: row.id,
        order: row.order,
        session,
        generation: this.generation,
        thinking: !!o.thinking,
        streaming: !!o.streaming,
        v: 1,
      }),
    ).toString("base64url");
  }
  private decode(token: string, session: string, o: TimelineOptions): Cursor {
    try {
      if (token.length > 2048) throw Error();
      const c = JSON.parse(Buffer.from(token, "base64url").toString());
      if (
        c.v !== 1 ||
        c.generation !== this.generation ||
        c.session !== session ||
        c.thinking !== !!o.thinking ||
        c.streaming !== !!o.streaming ||
        !Number.isFinite(c.order) ||
        typeof c.id !== "string" ||
        c.id.length > 256
      )
        throw Error();
      const row = this.rows.get(c.id);
      if (!row || row.session !== session || row.order !== c.order)
        throw Error();
      return c;
    } catch {
      throw Error("TIMELINE_RESET_REQUIRED");
    }
  }
  private body(row: Meta, o: TimelineOptions) {
    let text = "",
      thinking = "";
    let preview: ThinkingPreview | undefined;
    if (row.source) {
      const value = this.app.store.read<any>(row.source);
      if (row.event === "main.message") {
        text = value.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text ?? "")
          .join("\n");
        preview = thinkingPreview(value.content);
        if (o.thinking)
          thinking = [...visibleThinking(value.content)].join("\n");
      } else if (row.event === "input.accepted")
        text = this.app.store.bytes((value as Input).payload).toString();
      else if (row.event === "feedback.delivered")
        text = `任务反馈 · ${(value as Feedback).summary}\n执行 ${(value as Feedback).execution_id}`;
      else
        text = this.app.store.bytes((value as Notification).message).toString();
    } else {
      const p = this.previews.get(row.call_id!);
      preview = p?.thinking_preview;
      if (o.streaming) {
        text =
          p?.blocks
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n") ?? "";
        if (o.thinking)
          thinking =
            p?.blocks
              .filter((b) => b.type === "thinking")
              .map((b) => b.text)
              .filter(Boolean)
              .join("\n") ?? "";
      }
    }
    let textOffset = o.textOffset ?? 0,
      thinkingOffset = o.thinkingOffset ?? 0;
    if (
      ![textOffset, thinkingOffset].every(
        (v) => Number.isSafeInteger(v) && v >= 0,
      ) ||
      textOffset > text.length ||
      thinkingOffset > thinking.length
    )
      throw Error("INVALID_FRAGMENT_OFFSET");
    const boundary = (text: string, offset: number) =>
      offset > 0 &&
      /[\uDC00-\uDFFF]/.test(text[offset] ?? "") &&
      /[\uD800-\uDBFF]/.test(text[offset - 1])
        ? offset - 1
        : offset;
    textOffset = boundary(text, textOffset);
    thinkingOffset = boundary(thinking, thinkingOffset);
    return {
      text: cut(text, textOffset, 28000),
      ...(o.thinking ? { thinking: cut(thinking, thinkingOffset, 28000) } : {}),
      ...(preview ? { thinking_preview: preview } : {}),
      textOffset,
      thinkingOffset,
      textLength: text.length,
      thinkingLength: thinking.length,
    };
  }
  private item(row: Meta, session: string, o: TimelineOptions): any {
    const cursor = this.encode(row, session, o);
    if (row.kind === "activity")
      return {
        id: row.id,
        kind: row.kind,
        order: row.order,
        revision: row.revision,
        cursor,
        activity: row.activity,
      };
    const p = !row.source && this.previews.get(row.call_id!);
    return {
      id: row.id,
      kind: row.kind,
      order: row.order,
      revision: row.revision,
      ...(row.input_id
        ? attachmentInputView(this.app.store, row.input_id)
        : {}),
      cursor,
      role: row.role,
      at: row.at,
      call_id: row.call_id,
      ...Object.fromEntries(
        [
          "source_kind",
          "source_event_id",
          "outcome",
          "request_id",
          "task_id",
          "execution_id",
          "result_id",
          "decision_request_id",
          "notification_id",
        ]
          .filter((k) => (row as any)[k] !== undefined)
          .map((k) => [k, (row as any)[k]]),
      ),
      ...(!row.source
        ? { preview_availability: p ? "active" : "expired" }
        : {}),
      incomplete: row.incomplete || (p && p.status === "incomplete"),
      persistence: row.source ? "durable" : "transient",
      ...(p ? { preview_status: p.status } : {}),
      running: p && p.status === "running",
      truncated: p && p.truncated,
      ...this.body(row, o),
    };
  }
  summary(session: string) {
    const selected = [...this.live.values()].filter(
      (a) => this.history.sessionFor(a) === session,
    );
    const snapshot = this.app.activitySnapshot();
    return {
      total: this.ordered.get(session)?.length ?? 0,
      active: selected.length,
      locators: selected
        .slice(0, 16)
        .map((a) => ({ id: a.id, label: a.phase, actions: a.actions })),
      queue: snapshot.queue,
      observed_at: snapshot.observed_at,
      store_revision: this.app.store.sequence,
    };
  }
  messageRevision(session: string, id: string) {
    const row = this.rows.get(id);
    if (!row || row.session !== session || row.kind !== "message")
      throw Error("TIMELINE_ITEM_NOT_FOUND");
    return row.revision;
  }
  query(session: string, o: TimelineOptions = {}) {
    const limit = o.limit ?? 200;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw Error("INVALID_TIMELINE_LIMIT");
    if (o.direction && !["before", "after"].includes(o.direction))
      throw Error("INVALID_TIMELINE_DIRECTION");
    const list = this.ordered.get(session) ?? [];
    const base = {
      generation: this.generation,
      revision: this.revision,
      summary: this.summary(session),
    };
    if (o.fragment) {
      const row = this.rows.get(o.fragment);
      if (!row || row.session !== session || row.kind !== "message")
        throw Error("TIMELINE_ITEM_NOT_FOUND");
      return { ...base, items: [this.item(row, session, o)] };
    }
    if (o.since != null) {
      if (
        o.generation !== this.generation ||
        !Number.isSafeInteger(o.since) ||
        o.since < 0 ||
        o.since > this.revision
      )
        return { ...base, reset: true, items: [] };
      if (o.since === this.revision)
        return { ...base, items: [], outside: false };
      const lower = o.lower ? this.decode(o.lower, session, o) : null;
      const upper = o.upper ? this.decode(o.upper, session, o) : null;
      const start = lower ? this.bound(list, lower) : o.tail ? 0 : list.length;
      const end = o.tail
        ? list.length
        : upper
          ? this.bound(list, upper) + 1
          : start;
      // Only inspect the loaded interval, never a retained event queue or whole history.
      if (end - start > 2200) return { ...base, reset: true, items: [] };
      const changed = list
        .slice(start, end)
        .filter((row) => row.revision > o.since!)
        .sort((a, b) => a.revision - b.revision);
      const items: any[] = [];
      let bytes = size(base) + 4096,
        revision = o.since;
      for (const row of changed) {
        const item = this.item(row, session, o),
          n = size(item) + 1;
        if (items.length >= limit || bytes + n > PAGE_BYTES) break;
        items.push(item);
        bytes += n;
        revision = row.revision;
      }
      const more = items.length < changed.length;
      return {
        ...base,
        revision: more ? revision : this.revision,
        items,
        outside: !o.tail,
        more,
      };
    }
    let index = list.length - 1,
      step = -1;
    if (o.cursor) {
      const c = this.decode(o.cursor, session, o);
      index = this.bound(list, c);
      if (o.direction === "after") {
        step = 1;
        if (list[index] && compare(list[index], c) === 0) index++;
      } else index--;
    } else if (o.locate) {
      const row = this.rows.get(o.locate);
      if (!row || row.session !== session)
        throw Error("TIMELINE_ITEM_NOT_FOUND");
      step = 1;
      index = Math.max(0, this.bound(list, row) - Math.floor(limit / 2));
    }
    const items: any[] = [];
    let bytes = size(base) + 8192,
      scanned = 0,
      last: Meta | undefined;
    for (
      ;
      index >= 0 &&
      index < list.length &&
      items.length < limit &&
      scanned < 400;
      index += step
    ) {
      const row = list[index];
      scanned++;
      const item = this.item(row, session, o),
        n = size(item) + 1;
      if (bytes + n > PAGE_BYTES) break;
      items.push(item);
      bytes += n;
      last = row;
    }
    if (step === -1) items.reverse();
    const first = items[0],
      end = items.at(-1);
    return {
      ...base,
      items,
      before:
        step === -1 && last && index >= 0
          ? this.encode(last, session, o)
          : first && this.bound(list, first) > 0
            ? first.cursor
            : null,
      after:
        step === 1 && last && index < list.length
          ? this.encode(last, session, o)
          : end && this.bound(list, end) < list.length - 1
            ? end.cursor
            : null,
      continuation:
        last && index >= 0 && index < list.length
          ? this.encode(last, session, o)
          : null,
    };
  }

  diagnostics() {
    return {
      metadata: this.rows.size,
      fragment_bytes: 0,
      fragment_count: 0,
    };
  }
}
