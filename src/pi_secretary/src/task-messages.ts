import { createHash } from "node:crypto";
import type { Store } from "./store.ts";
import type {
  Context,
  Guidance,
  ModelCall,
  OperationLogRecord,
} from "./contracts.ts";
import type { Message } from "./api/contracts.ts";
import { ApiError } from "./api/protocol.ts";
import { previewsFor } from "./preview.ts";
import {
  thinkingPreview,
  visibleThinking,
  type DisplayBlock,
} from "./thinking-preview.ts";

type RawMessage = {
  role: string;
  content:
    | string
    | (DisplayBlock & { name?: string; id?: string; arguments?: unknown })[];
  stopReason?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};
type Row = { id: string; event?: OperationLogRecord; call?: ModelCall };
type Bucket = {
  rows: Row[];
  positions: Map<string, number>;
  aliases: Map<string, string>;
};
const indexes = new WeakMap<Store, TaskMessages>();
export function taskMessagesFor(store: Store) {
  let index = indexes.get(store);
  if (!index) indexes.set(store, (index = new TaskMessages(store)));
  return index;
}
/** Incremental metadata only. Token reads never traverse historical messages or calls. */
export class TaskMessages {
  private frame = 0;
  private executions = new Map<string, Bucket>();
  private eligible = new Set<string>();
  framesVisited = 0;
  rowsRead = 0;
  constructor(readonly store: Store) {}
  private bucket(eid: string) {
    let b = this.executions.get(eid);
    if (!b)
      this.executions.set(
        eid,
        (b = { rows: [], positions: new Map(), aliases: new Map() }),
      );
    return b;
  }
  private put(eid: string, id: string, patch: Partial<Row>) {
    const b = this.bucket(eid);
    const pos = b.positions.get(id);
    if (pos === undefined) {
      b.positions.set(id, b.rows.length);
      b.rows.push({ id, ...patch });
    } else Object.assign(b.rows[pos], patch);
  }
  sync() {
    for (; this.frame < this.store.projectionFrames.length; this.frame++) {
      this.framesVisited++;
      const f = this.store.projectionFrames[this.frame];
      // Older completed calls have no display marker: preserve their original
      // agent event rows instead of manufacturing duplicate saved-response rows.
      for (const e of f.log_records)
        if (e.event_type === "model.task_preview" && e.causation_id)
          this.eligible.add(e.causation_id);
      for (const m of f.mutations)
        if (m.object_type === "ModelCall") {
          const call = this.store.get<ModelCall>("ModelCall", m.object_id);
          if (
            this.eligible.has(call.id) &&
            call.scope.execution_id &&
            this.store.get<Context>("Context", call.context_id).purpose ===
              "TASK"
          )
            this.put(call.scope.execution_id, "call:" + call.id, { call });
        }
      for (const e of f.log_records) {
        const eid = e.scope.execution_id;
        if (!eid || !["agent.message", "guidance.sent"].includes(e.event_type))
          continue;
        const call = e.causation_id
          ? this.store.find<ModelCall>("ModelCall", e.causation_id)
          : undefined;
        const linked =
          e.event_type === "agent.message" &&
          call?.state === "RESPONSE_SAVED" &&
          call.scope.execution_id === eid &&
          call.scope.task_id === e.scope.task_id &&
          this.store.get<Context>("Context", call.context_id).purpose ===
            "TASK";
        const id = linked ? "call:" + call.id : e.event_id;
        this.put(eid, id, { event: e, ...(linked ? { call } : {}) });
        this.bucket(eid).aliases.set(e.event_id, id);
      }
    }
  }
  rows(eid: string) {
    this.sync();
    return this.bucket(eid).rows;
  }
  position(eid: string, id: string) {
    const b = this.bucket(eid);
    return b.positions.get(b.aliases.get(id) ?? id) ?? -1;
  }
  canonical(eid: string, id: string) {
    return this.bucket(eid).aliases.get(id) ?? id;
  }
  message(task: string, eid: string, id: string, thinking: boolean): Message {
    this.sync();
    this.rowsRead++;
    const b = this.bucket(eid),
      row = b.rows[this.position(eid, id)];
    if (!row) throw new ApiError("MESSAGE_NOT_FOUND", 404);
    const event = row.event,
      call = row.call;
    let raw: RawMessage;
    const live = call
      ? previewsFor(this.store).get(call.id, thinking)
      : undefined;
    const saved = call?.state === "RESPONSE_SAVED" && !!call.response;
    try {
      if (event) {
        if (event.event_type === "guidance.sent") {
          const sent = this.store.read<{ guidance_id: string }>(event.payload);
          const g = this.store.get<Guidance>("Guidance", sent.guidance_id);
          raw = {
            role: "user",
            content: `Guidance SENT · ${g.source} · ${g.id}\n${this.store.bytes(g.text).toString()}`,
          };
        } else raw = this.store.read<RawMessage>(event.payload);
      } else if (saved || call?.response)
        raw = this.store.read<RawMessage>(call!.response!);
      else if (live)
        raw = {
          role: "assistant",
          content: live.blocks
            .toSorted((a, b) => a.index - b.index)
            .map((b) =>
              b.type === "thinking"
                ? { type: "thinking", thinking: b.text }
                : { type: "text", text: b.text },
            ),
        };
      else
        raw = {
          role: "assistant",
          content:
            call?.state === "IN_FLIGHT"
              ? "预览已释放或连接中断；等待持久响应"
              : call?.state === "PREPARED"
                ? "模型请求已准备"
                : "调用已中断；未保存部分正文",
        };
    } catch {
      throw new ApiError("AGENT_MESSAGE_UNAVAILABLE", 410);
    }
    const blocks = Array.isArray(raw.content) ? raw.content : [];
    const text =
      typeof raw.content === "string"
        ? raw.content
        : blocks
            .map((b) =>
              b.type === "text"
                ? (b.text ?? "")
                : b.type === "thinking"
                  ? ""
                  : b.type === "toolCall"
                    ? `Tool ${b.name} (${b.id})\n${JSON.stringify(b.arguments)}`
                    : `[${b.type}: non-text content]`,
            )
            .filter(Boolean)
            .join("\n");
    const durable = !!event || saved || !!call?.response;
    const outcome: Message["outcome"] =
      raw.isError ||
      raw.stopReason === "error" ||
      (!event && call?.state === "FAILED")
        ? "failed"
        : raw.stopReason === "aborted" ||
            (!event && call?.state === "INTERRUPTED")
          ? "interrupted"
          : raw.stopReason === "length"
            ? "truncated"
            : raw.stopReason === "stop"
              ? "completed"
              : raw.stopReason === "toolUse"
                ? "continued"
                : undefined;
    return {
      id: row.id,
      kind: "message",
      role: raw.role,
      text,
      revision: event
        ? String(event.sequence)
        : saved || call?.response
          ? String(call.revision)
          : BigInt(
              "0x" +
                createHash("sha256")
                  .update(
                    `${previewsFor(this.store).epoch}:${call?.revision ?? 0}:${live?.version ?? 0}`,
                  )
                  .digest("hex")
                  .slice(0, 13),
            ).toString(),
      at: event?.occurred_at ?? call?.started_at ?? call?.updated_at,
      call_id: raw.toolCallId ?? null,
      ...(raw.toolName ? { tool_name: raw.toolName } : {}),
      ...(thinking
        ? { thinking: [...visibleThinking(blocks)].join("\n") }
        : {}),
      thinking_preview:
        live && !durable ? live.thinking_preview : thinkingPreview(blocks),
      ...(outcome ? { outcome } : {}),
      incomplete: !durable,
      next_cursor: null,
      persistence: durable ? "durable" : "transient",
      ...(event ? { source_event_id: event.event_id } : {}),
      ...(call
        ? {
            model_call_id: call.id,
            transport_attempt: call.transport_attempt,
            preview_status: durable
              ? ("saved" as const)
              : (live?.status ?? ("incomplete" as const)),
            preview_epoch: previewsFor(this.store).epoch,
            preview_availability: live
              ? ("active" as const)
              : ("expired" as const),
            truncated: !durable && !!live?.truncated,
          }
        : {}),
      task_id: task,
      execution_id: eid,
    };
  }
}
