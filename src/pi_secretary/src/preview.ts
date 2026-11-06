import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ThinkingPreview } from "./api/contracts.ts";
import { thinkingPreview } from "./thinking-preview.ts";

export type Preview = {
  id: string;
  source?: "MAIN" | "TASK";
  epoch?: string;
  task_id?: string;
  execution_id?: string;
  transport_attempt?: number;
  attempt_id?: string;
  loop: string;
  session: string;
  at: string;
  version: number;
  status: "running" | "saved" | "incomplete";
  truncated: boolean;
  thinking_preview?: ThinkingPreview;
  blocks: { index: number; type: "text" | "thinking"; text: string }[];
};
export type PreviewUpdate =
  | {
      type: "start";
      id: string;
      loop: string;
      session: string;
      task_id?: string;
      execution_id?: string;
      transport_attempt?: number;
      attempt_id?: string;
    }
  | { type: "event"; id: string; event: AssistantMessageEvent }
  | { type: "saved" | "failed"; id: string };

// Disposable display state. Never authority, model context, or an execution input.
export class Previews {
  revision = 0;
  readonly epoch = randomUUID();
  private entries = new Map<string, Preview>();
  update(update: PreviewUpdate) {
    if (update.type === "start") {
      if (this.entries.has(update.id)) return;
      this.entries.set(update.id, {
        id: update.id,
        source: update.execution_id ? "TASK" : "MAIN",
        epoch: this.epoch,
        ...(update.execution_id
          ? {
              task_id: update.task_id,
              execution_id: update.execution_id,
              transport_attempt: update.transport_attempt,
              attempt_id: update.attempt_id,
            }
          : {}),
        loop: update.loop,
        session: update.session,
        at: new Date().toISOString(),
        version: ++this.revision,
        status: "running",
        truncated: false,
        blocks: [],
      });
      this.prune();
      return;
    }
    const item = this.entries.get(update.id);
    if (!item || (item.status !== "running" && update.type === "event")) return;
    if (update.type === "saved" || update.type === "failed") {
      item.status = update.type === "saved" ? "saved" : "incomplete";
    } else if (update.type === "event") {
      const e = update.event;
      const content =
        "partial" in e
          ? e.partial.content
          : e.type === "done"
            ? e.message.content
            : e.type === "error"
              ? e.error.content
              : undefined;
      if (content) {
        item.thinking_preview = thinkingPreview(content);
        // A redacted/replaced block revokes previously retained visible reasoning.
        item.blocks = item.blocks.filter((b) => {
          const source = content[b.index];
          return (
            b.type !== "thinking" ||
            (source?.type === "thinking" &&
              !source.redacted &&
              !!source.thinking)
          );
        });
      }
      if (
        e.type !== "text_delta" &&
        e.type !== "thinking_delta" &&
        e.type !== "text_end" &&
        e.type !== "thinking_end"
      ) {
        if (content) item.version = ++this.revision;
        return;
      }
      const type = e.type.startsWith("text") ? "text" : "thinking";
      // Signed/redacted blocks with no visible text are never projected.
      const source = e.partial.content[e.contentIndex];
      if (
        type === "thinking" &&
        (!source ||
          source.type !== "thinking" ||
          source.redacted ||
          !source.thinking)
      ) {
        item.version = ++this.revision;
        return;
      }
      let block = item.blocks.find((b) => b.index === e.contentIndex);
      if (!block) {
        if (item.blocks.length >= 128) {
          item.truncated = true;
          item.version = ++this.revision;
          return;
        }
        block = { index: e.contentIndex, type, text: "" };
        item.blocks.push(block);
      }
      if (block.type !== type) {
        block.type = type;
        block.text = "";
      }
      const next =
        type === "thinking" && source?.type === "thinking"
          ? source.thinking
          : "delta" in e
            ? block.text + e.delta
            : e.content;
      if (item.source !== "TASK") {
        const available =
          32768 -
          item.blocks.reduce(
            (n, b) => n + (b === block ? 0 : b.text.length),
            0,
          );
        const end = next.charCodeAt(available - 1);
        block.text = next.slice(
          0,
          next.length > available && end >= 0xd800 && end <= 0xdbff
            ? available - 1
            : available,
        );
        if (next.length > available) item.truncated = true;
      } else {
        block.text = next;
        let overflow =
          item.blocks.reduce((n, b) => n + b.text.length, 0) - 32768;
        for (const b of item.blocks) {
          if (overflow <= 0) break;
          let trim = Math.min(overflow, b.text.length);
          if (
            trim < b.text.length &&
            b.text.charCodeAt(trim) >= 0xdc00 &&
            b.text.charCodeAt(trim) <= 0xdfff
          )
            trim++;
          b.text = b.text.slice(trim);
          overflow -= trim;
          item.truncated = true;
        }
      }
    }
    item.version = ++this.revision;
    this.prune();
  }
  private prune() {
    for (const source of ["MAIN", "TASK"] as const) {
      const items = [...this.entries.values()].filter(
        (p) => p.source === source,
      );
      let bytes = items.reduce((n, p) => n + this.bytes(p), 0);
      const limit = source === "MAIN" ? 8 : 32;
      while (
        items.length > limit ||
        (source === "TASK" && bytes > 1024 * 1024)
      ) {
        const i = Math.max(
          0,
          items.findIndex((p) => p.status !== "running"),
        );
        const [victim] = items.splice(i, 1);
        bytes -= this.bytes(victim);
        this.entries.delete(victim.id);
      }
    }
  }
  private bytes(p: Preview) {
    return (
      p.blocks.reduce((n, b) => n + Buffer.byteLength(b.text), 0) +
      Buffer.byteLength(p.thinking_preview?.text ?? "")
    );
  }
  get(id: string, thinking: boolean) {
    const p = this.entries.get(id);
    return p
      ? {
          ...p,
          blocks: p.blocks
            .filter((b) => thinking || b.type !== "thinking")
            .map((b) => ({ ...b })),
        }
      : undefined;
  }
  taskSnapshot(session: string) {
    return {
      epoch: this.epoch,
      version: Math.max(
        0,
        ...[...this.entries.values()]
          .filter((p) => p.source === "TASK" && p.session === session)
          .map((p) => p.version),
      ),
      previews: [...this.entries.values()]
        .filter((p) => p.source === "TASK" && p.session === session)
        .map((p) => ({
          id: p.id,
          task_id: p.task_id!,
          execution_id: p.execution_id!,
          transport_attempt: p.transport_attempt ?? 1,
          attempt_id: p.attempt_id ?? "",
          version: p.version,
          status: p.status,
          truncated: p.truncated,
        })),
    };
  }
  snapshot(session: string, thinking: boolean) {
    return [...this.entries.values()]
      .filter((p) => p.session === session && p.source !== "TASK")
      .map((p) => ({
        ...p,
        ...(p.thinking_preview
          ? { thinking_preview: { ...p.thinking_preview } }
          : {}),
        blocks: p.blocks
          .toSorted((a, b) => a.index - b.index)
          .filter((b) => thinking || b.type !== "thinking")
          .map((b) => ({ ...b })),
      }));
  }
}

const registries = new WeakMap<Store, Previews>();
export function previewsFor(store: Store) {
  let value = registries.get(store);
  if (!value) registries.set(store, (value = new Previews()));
  return value;
}
