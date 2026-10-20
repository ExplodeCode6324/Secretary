import type {
  Authorization,
  Core,
  Message,
  Timeline,
  TimelineItem,
} from "./contracts";
export type Preview = {
  id: string;
  at: string;
  status: "running" | "saved" | "incomplete";
  truncated: boolean;
  blocks: { type: string; text: string }[];
};
export type Transient = {
  domain: string;
  instance: string;
  epoch: string;
  version: string;
  connected: boolean;
  data: { previews?: unknown } | null;
};
export function previews(value: unknown): Preview[] {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { previews?: unknown }).previews)
  )
    return [];
  return (value as { previews: unknown[] }).previews
    .slice(0, 8)
    .filter((p): p is Preview => {
      if (!p || typeof p !== "object") return false;
      const q = p as Preview;
      return (
        typeof q.id === "string" &&
        typeof q.at === "string" &&
        ["running", "saved", "incomplete"].includes(q.status) &&
        Array.isArray(q.blocks) &&
        q.blocks.length <= 128 &&
        q.blocks.every(
          (b) => typeof b.text === "string" && typeof b.type === "string",
        ) &&
        q.blocks.reduce((n, b) => n + b.text.length, 0) <= 32768
      );
    });
}
export function conversation(
  timeline: Timeline | undefined,
  live: unknown,
  finalized: Set<string>,
): TimelineItem[] {
  const rows = new Map<string, TimelineItem>();
  for (const row of timeline?.items ?? []) {
    rows.set(row.id, row);
    if (row.kind === "message" && row.persistence === "durable" && row.call_id)
      finalized.add(row.call_id);
  }
  for (const p of previews(live)) {
    if (finalized.has(p.id)) continue;
    const id = "message:" + p.id,
      old = rows.get(id);
    if (old?.kind === "message" && old.persistence === "durable") continue;
    rows.set(id, {
      id,
      kind: "message",
      role: "secretary",
      revision: String(old?.revision ?? "0"),
      at: p.at,
      text: p.blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join(""),
      call_id: p.id,
      persistence: "transient",
      preview_status: p.status,
      truncated: p.truncated,
      incomplete: p.status === "incomplete",
      next_cursor: null,
    });
  }
  // Finalized IDs survive pagination in this connection; bounded with the session.
  while (finalized.size > 10000)
    finalized.delete(finalized.values().next().value!);
  return [...rows.values()];
}
export function projection<T>(
  cache: Record<string, unknown> | undefined,
  operation: string,
): T | undefined {
  for (const [key, value] of Object.entries(cache ?? {})) {
    try {
      if (JSON.parse(key).operation === operation) return value as T;
    } catch {
      /* unrecognized cache key */
    }
  }
}
export function capability(core: Core | undefined, name: string) {
  return (
    core?.capabilities[name]?.state === "supported" &&
    core.capabilities[name].allowed
  );
}
export function approvalProblem(
  a: Authorization | null,
  now: number,
  pending: boolean,
): string {
  if (!a) return "请选择并读取操作详情";
  if (pending) return "该授权已有待确认的提交，请等待回执";
  if (a.state !== "PENDING") return `当前状态：${a.state}，不能批准`;
  if (
    a.expires_at &&
    (!Number.isFinite(Date.parse(a.expires_at)) ||
      Date.parse(a.expires_at) <= now)
  )
    return "授权已到期";
  const d = a.display;
  if (
    !d ||
    typeof d !== "object" ||
    Array.isArray(d) ||
    !("parameters" in d) ||
    !("action" in d)
  )
    return "缺少完整操作参数，无法批准";
  if (!a.display_hash || !a.revision) return "缺少授权版本";
  return "";
}
export function messageLabel(m: Message) {
  return m.persistence === "durable"
    ? m.incomplete
      ? "已记录 · 未完整"
      : "已记录"
    : m.persistence === "transient"
      ? m.preview_status === "running"
        ? "正在生成"
        : m.preview_status === "incomplete"
          ? "生成中断"
          : "等待最终记录"
      : "最终状态未知";
}
// Show invisible directional/format controls literally in consent parameters.
export function approvalDisplay(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

export function retainPreview(
  current: unknown,
  snapshot: Pick<Transient, "connected" | "data"> | null,
): unknown {
  return snapshot?.connected ? snapshot.data : current;
}
