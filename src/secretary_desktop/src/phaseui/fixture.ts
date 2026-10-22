import type { BridgePort, Snapshot } from "../bridge";
import type { Message, Timeline } from "../contracts";
export function fixtureBridge(conversation = false) {
  let sequence = 0;
  const messages: Message[] = Array.from(
    { length: conversation ? 1000 : 40 },
    (_, i) => ({
      id: `message:fixture-${i}`,
      kind: "message",
      revision: "1",
      role: i % 2 ? "secretary" : "master",
      at: "2026-10-21T00:00:00Z",
      thinking: conversation ? "人工思考内容，折叠验证。" : undefined,
      text:
        conversation && i % 100 === 80
          ? "中文👩‍💻\n".repeat(12000)
          : i % 2
            ? '这是一段人工验证数据。\n\n**当前状态**：保留阅读位置，支持文本选择。\n\n```ts\nconst phase = "three frames";\n```'
            : "核对布局、状态与响应。",
      call_id: null,
      incomplete: false,
      next_cursor: null,
      persistence: "durable",
    }),
  );
  const timeline: Timeline = {
    items: conversation ? messages.slice(-50) : messages,
    version: "1",
    generation: "fixture",
    before: conversation ? "950" : null,
    after: null,
  };
  const state: Snapshot = {
    profiles: [{ id: "fixture", mode: "synthetic" }],
    profile: "fixture",
    domain: "phaseui-fixture",
    sync: "SYNCED",
    draft: { text: "", version: 0 },
    anchor: "latest",
    core: {
      api_version: "1",
      data_domain_id: "phaseui-fixture",
      owner_id: "fixture-master",
      instance_id: "fixture-instance",
      session_id: "fixture-session",
      state: "RUNNING",
      mode: "synthetic",
      capabilities: {
        messages: { state: "supported", allowed: true, reason: null },
      },
    },
    cache: {
      [JSON.stringify({ operation: "timeline" })]: timeline,
      [JSON.stringify({ operation: "assistant" })]: {
        name: "Secretary",
        actor_id: "assistant",
        revision: "1",
      },
    },
    outbox: [],
    approvals: [],
  };
  let preview = "";
  let running = false;
  const port: BridgePort = {
    copyText: async () => {},
    openUrl: async () => "REQUESTED",
    messageOutbox: async () => ({ items: [], next: null }),
    messageBody: async () => {
      throw Error("FIXTURE_NO_OUTBOX");
    },
    discardMessage: async () => {
      throw Error("FIXTURE_NO_OUTBOX");
    },
    snapshot: async () => structuredClone(state),
    connect: async () => structuredClone(state),
    transient: async () => ({
      domain: state.domain!,
      instance: state.core!.instance_id,
      epoch: "fixture",
      version: String(sequence),
      connected: true,
      data: {
        previews: preview
          ? [
              {
                id: "synthetic-stream",
                at: "2026-10-21T00:00:01Z",
                status: running ? "running" : "saved",
                truncated: false,
                blocks: [{ type: "text", text: preview }],
              },
            ]
          : [],
      },
    }),
    draft: async (_domain, version, text) => {
      if (version !== state.draft!.version) throw Error("DRAFT_CONFLICT");
      return (state.draft = { version: version + 1, text });
    },
    submit: async (_domain, query, body) => {
      if (query.operation !== "messages") throw Error("FIXTURE_UNSUPPORTED");
      messages.push({
        id: `message:sent-${++sequence}`,
        kind: "message",
        revision: "1",
        role: "master",
        text: String((body as { text: string }).text),
        call_id: null,
        incomplete: false,
        next_cursor: null,
        persistence: "durable",
      });
      state.draft = { text: "", version: state.draft!.version + 1 };
      return `fixture-request-${sequence}`;
    },
    query: async <T>(_domain: string, query: import("../bridge").Query) => {
      if (query.operation.startsWith("timeline")) {
        if (!conversation) return structuredClone(timeline) as T;
        const p = query.parameters ?? {};
        let start = Math.max(0, messages.length - 50);
        if (p.message_id)
          start = Math.max(
            0,
            messages.findIndex((m) => m.id === p.message_id) - 25,
          );
        else if (p.cursor)
          start = Math.max(
            0,
            Number(p.cursor) + (p.direction === "before" ? -50 : 0),
          );
        const items = messages
          .slice(start, start + 50)
          .map((m) => ({
            ...m,
            thinking: p.thinking ? m.thinking : undefined,
          }));
        return structuredClone({
          ...timeline,
          items,
          before: start ? String(start) : null,
          after: start + 50 < messages.length ? String(start + 50) : null,
        }) as T;
      }
      if (query.operation === "messages/{id}/content")
        return structuredClone({
          ...messages.find((m) => m.id === query.id),
          thinking: "人工思考验证片段",
        }) as T;
      return {
        items: [],
        before: null,
        after: null,
        next_cursor: null,
        version: "1",
      } as T;
    },
    subscribe: async () => {},
    anchor: async (_domain, value) => {
      state.anchor = value;
    },
    stop: async () => {
      throw Error("FIXTURE_NO_CORE");
    },
    download: async () => {
      throw Error("FIXTURE_NO_FILES");
    },
  };
  return {
    port,
    advance() {
      running = true;
      preview += "人工流式片段 " + ++sequence + "。";
    },
    drain() {
      running = false;
      preview = ""; // End the bounded synthetic workload; recovery returns to the initial row set.
    },
    status: () => ({ pending: running ? 1 : 0, previewLength: preview.length }),
    state,
  };
}
