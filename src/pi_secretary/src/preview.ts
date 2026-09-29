import type { AssistantMessageEvent } from "@earendil-works/pi-ai";

export type Preview = {
  id: string;
  loop: string;
  session: string;
  at: string;
  version: number;
  status: "running" | "saved" | "incomplete";
  truncated: boolean;
  blocks: { index: number; type: "text" | "thinking"; text: string }[];
};
export type PreviewUpdate =
  | { type: "start"; id: string; loop: string; session: string }
  | { type: "event"; id: string; event: AssistantMessageEvent }
  | { type: "saved" | "failed"; id: string };

// Disposable display state. Never authority, model context, or an execution input.
export class Previews {
  revision = 0;
  private entries = new Map<string, Preview>();
  update(update: PreviewUpdate) {
    if (update.type === "start") {
      this.entries.set(update.id, {
        id: update.id,
        loop: update.loop,
        session: update.session,
        at: new Date().toISOString(),
        version: ++this.revision,
        status: "running",
        truncated: false,
        blocks: [],
      });
      while (this.entries.size > 8)
        this.entries.delete(this.entries.keys().next().value!);
      return;
    }
    const item = this.entries.get(update.id);
    if (!item) return;
    if (update.type === "saved" || update.type === "failed") {
      item.status = update.type === "saved" ? "saved" : "incomplete";
    } else if (update.type === "event") {
      const e = update.event;
      if (
        e.type !== "text_delta" &&
        e.type !== "thinking_delta" &&
        e.type !== "text_end" &&
        e.type !== "thinking_end"
      )
        return;
      const type = e.type.startsWith("text") ? "text" : "thinking";
      // Signed/redacted blocks with no visible text are never projected.
      const source = e.partial.content[e.contentIndex];
      if (
        type === "thinking" &&
        (!source ||
          source.type !== "thinking" ||
          source.redacted ||
          !source.thinking)
      )
        return;
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
      const next = "delta" in e ? block.text + e.delta : e.content;
      const available =
        32768 -
        item.blocks.reduce((n, b) => n + (b === block ? 0 : b.text.length), 0);
      block.text = next.slice(0, available);
      if (next.length > available) item.truncated = true;
    }
    item.version = ++this.revision;
  }
  snapshot(session: string, thinking: boolean) {
    return [...this.entries.values()]
      .filter((p) => p.session === session)
      .map((p) => ({
        ...p,
        blocks: p.blocks
          .toSorted((a, b) => a.index - b.index)
          .filter((b) => thinking || b.type !== "thinking")
          .map((b) => ({ ...b })),
      }));
  }
}
