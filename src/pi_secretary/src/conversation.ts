import type { App } from "./app.ts";
import { activityHistoryFor } from "./activity-history.ts";
import type { Input, Feedback, Notification } from "./contracts.ts";
type MessageRole = "system" | "master" | "secretary";
export type UIMessage = {
  id: string;
  role: MessageRole;
  text: string;
  at: string;
  thinking?: string;
  call_id?: string;
  incomplete?: boolean;
  order?: number;
};
const conversations = new WeakMap<
  App["store"],
  Map<string, { position: number; output: UIMessage[] }>
>();
export function conversation(app: App, showThinking = false): UIMessage[] {
  let caches = conversations.get(app.store);
  if (!caches) {
    caches = new Map();
    conversations.set(app.store, caches);
  }
  const key = `${app.host.sessionID}:${showThinking}`;
  let cache = caches.get(key);
  if (!cache) {
    cache = { position: 0, output: [] };
    caches.set(key, cache);
  }
  const output = cache.output;
  const history = activityHistoryFor(app.store);
  for (const e of app.store.logs.slice(cache.position)) {
    let role: MessageRole = "system",
      text = "";
    let thinking: string | undefined,
      call_id: string | undefined,
      incomplete = false;
    if (e.event_type === "input.accepted") {
      const input = app.store.read<Input>(e.payload);
      role = input.producer === "MASTER" ? "master" : "system";
      text = app.store.bytes(input.payload).toString();
    } else if (e.event_type === "main.message") {
      if (e.scope.session_id !== app.host.sessionID) continue;
      const m = app.store.read<{
        role: string;
        content: {
          type: string;
          text?: string;
          thinking?: string;
          redacted?: boolean;
        }[];
        display_call_id?: string;
        stopReason?: string;
      }>(e.payload);
      if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
      role = "secretary";
      call_id = m.display_call_id;
      incomplete = m.stopReason === "error" || m.stopReason === "aborted";
      if (showThinking)
        thinking = m.content
          .filter((c) => c.type === "thinking" && !c.redacted)
          .map((c) => c.thinking ?? "")
          .join("\n");
      text = m.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
    } else if (e.event_type === "feedback.delivered") {
      const f = app.store.read<Feedback>(e.payload);
      text = `任务反馈 · ${f.summary}\n执行 ${f.execution_id}`;
    } else if (e.event_type === "notification.queued") {
      const n = app.store.read<Notification>(e.payload);
      role = "secretary";
      text = app.store.bytes(n.message).toString();
    }
    if (text || thinking || call_id)
      output.push({
        id: e.event_id,
        role,
        text,
        at: e.occurred_at,
        order: history.messageOrder(e.event_id),
        ...(showThinking && role === "secretary"
          ? { thinking: thinking ?? "" }
          : {}),
        ...(call_id ? { call_id } : {}),
        ...(incomplete ? { incomplete } : {}),
      });
  }
  cache.position = app.store.logs.length;
  return output.map((message) => ({ ...message }));
}
