import type { BridgePort, Snapshot } from "../bridge";
import type { Message, Timeline } from "../contracts";
export function fixtureBridge(conversation = false) {
  let sequence = 0;
  let snapshotDelay = 0;
  let snapshotPending = false;
  const calls: string[] = [];
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
  const cursor = (offset: number, thinking = false, streaming = false) =>
    `${offset}:${thinking}:${streaming}`;
  const timeline: Timeline = {
    items: conversation
      ? messages.slice(-50).map((m) => ({ ...m, thinking: undefined }))
      : messages,
    version: "1",
    generation: "fixture",
    before: conversation ? cursor(950) : null,
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
  let contentDelay = 0,
    failContent = false;
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
    snapshot: async () => {
      const delay = snapshotDelay;
      snapshotDelay = 0;
      snapshotPending = true;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      snapshotPending = false;
      return structuredClone(state);
    },
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
      calls.push(query.operation);
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
        else if (p.cursor) {
          const [offset, thought, stream] = String(p.cursor).split(":");
          if (
            thought !== String(!!p.thinking) ||
            stream !== String(!!p.streaming)
          )
            throw Error("CURSOR_EXPIRED");
          start = Math.max(
            0,
            Number(offset) + (p.direction === "before" ? -50 : 0),
          );
        }
        const items = messages.slice(start, start + 50).map((m) => ({
          ...m,
          thinking: p.thinking ? m.thinking : undefined,
        }));
        return structuredClone({
          ...timeline,
          items,
          before: start ? cursor(start, !!p.thinking, !!p.streaming) : null,
          after:
            start + 50 < messages.length
              ? cursor(start + 50, !!p.thinking, !!p.streaming)
              : null,
        }) as T;
      }
      if (
        query.operation === "messages/{id}/content" &&
        query.id === "message:synthetic-stream" &&
        running
      )
        return {
          id: query.id,
          kind: "message",
          role: "secretary",
          revision: String(sequence),
          text: "must not replace SSE",
          thinking: "人工流式思考",
          persistence: "transient",
          preview_status: "running",
        } as T;
      if (
        query.operation === "messages/{id}/content" &&
        query.id === "message:synthetic-stream"
      ) {
        const m = messages.find((m) => m.id === query.id)!;
        const offset = Number(query.parameters?.cursor ?? 0);
        if (contentDelay) await new Promise((r) => setTimeout(r, contentDelay));
        if (failContent) throw Error("FIXTURE_CONTENT_OFFLINE");
        return structuredClone({
          ...m,
          text: m.text.slice(offset, offset + 4999),
          thinking: query.parameters?.thinking ? "人工思考验证片段" : undefined,
          next_cursor:
            offset + 4999 < m.text.length ? String(offset + 4999) : null,
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
    delaySnapshot(ms: number) {
      snapshotDelay = ms;
    },
    pendingSnapshot: () => snapshotPending,
    commands: () => [...calls],
    appendRows(n: number) {
      for (let i = 0; i < n; i++)
        messages.push({
          ...messages[0],
          id: `message:append-${++sequence}`,
          text: `新记录 ${sequence}`,
        });
      timeline.items = messages
        .slice(-50)
        .map((m) => ({ ...m, thinking: undefined }));
      timeline.version = String(sequence + 1);
      timeline.before = cursor(messages.length - 50);
    },
    publishPreview() {
      timeline.items = [
        ...timeline.items.filter((m) => m.id !== "message:synthetic-stream"),
        {
          id: "message:synthetic-stream",
          kind: "message",
          revision: String(++sequence),
          role: "secretary",
          text: "",
          call_id: "synthetic-stream",
          persistence: "transient",
          incomplete: true,
          next_cursor: null,
          preview_status: "running",
        },
      ];
      timeline.version = String(sequence);
    },
    contentMode(delay: number, fail = false) {
      contentDelay = delay;
      failContent = fail;
    },
    completePreview() {
      const row: Message = {
        id: "message:synthetic-stream",
        kind: "message",
        revision: String(++sequence),
        role: "secretary",
        text: preview,
        call_id: "synthetic-stream",
        persistence: "durable",
        incomplete: false,
        next_cursor: null,
        outcome: "completed",
      };
      messages.push(row);
      timeline.items = [
        ...timeline.items.filter((m) => m.id !== row.id),
        {
          ...row,
          text: row.text.slice(0, 4999),
          next_cursor: row.text.length > 4999 ? "4999" : null,
        },
      ];
      timeline.version = String(sequence);
      running = false;
      preview = "";
    },
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
