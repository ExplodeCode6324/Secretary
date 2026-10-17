import fs from "node:fs";
import path from "node:path";
import { Store, id } from "../../src/pi_secretary/src/store.ts";
import { saveContext } from "../../src/pi_secretary/src/context.ts";
import { durableStream } from "../../src/pi_secretary/src/transport.ts";
import {
  fixtureModel,
  replyStream,
  type AgentMessage,
  type StreamFn,
} from "../../src/pi_secretary/src/model.ts";
const dir = process.argv[2];
const analyze = process.argv[3] === "analyze";
if (!dir?.includes("issue24") || (!analyze && fs.existsSync(dir)))
  throw Error("Fresh issue24 directory required");
const store = await Store.open(dir);
// Test-only legacy encoder for a paired physical-byte comparison.
if (process.argv[3] === "legacy")
  store.putMessages = (messages) => ({
    refs: messages.map((message) => store.put(message)),
    raw: store.put(messages),
  });
const scope = { session_id: null, task_id: null, execution_id: null };
const loop = id();
const messages: AgentMessage[] = [
  { role: "user", content: "Run synthetic tool loop", timestamp: 0 },
];
let turn = 0;
const stream: StreamFn = async (model, context, options) => {
  await options?.onPayload?.(
    {
      model: model.id,
      messages: context.messages,
      max_tokens: options?.maxTokens,
    },
    model,
  );
  return replyStream(
    [
      {
        type: "toolCall",
        id: "synthetic-" + turn++,
        name: "synthetic_tool",
        arguments: {},
      },
    ],
    model,
  );
};
const model = { ...fixtureModel, contextWindow: 1000000 };
try {
  if (!analyze)
    for (let n = 0; n < 20; n++) {
      const context = saveContext(
        store,
        messages,
        scope,
        "TASK",
        model.id,
        loop,
        1000000,
      );
      if (
        JSON.stringify(store.read(context.raw_context)) !==
        JSON.stringify(messages)
      )
        throw Error("Reconstruction mismatch");
      const transport = durableStream(store, stream, scope, loop, "TASK");
      const response = await transport(model, { messages }, {});
      const answer = await response.result();
      messages.push(answer);
      const call = answer.content.find((p) => p.type === "toolCall")!;
      messages.push({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [
          {
            type: "text",
            text: "synthetic result " + n + " " + "x".repeat(2048),
          },
        ],
        isError: false,
        timestamp: n,
      });
    }
  const classified: Record<string, number> = {};
  const seen = new Set<string>();
  const add = (kind: string, ref: any) => {
    if (!seen.has(ref.sha256)) {
      seen.add(ref.sha256);
      classified[kind] = (classified[kind] ?? 0) + ref.bytes;
    }
  };
  const contexts = store.all<any>("Context");
  for (const c of contexts)
    for (const m of c.messages) add("message_body", m.content);
  for (const c of contexts) add("raw_context", c.raw_context);
  for (const f of store.projectionFrames)
    for (const m of f.mutations)
      if (m.object_type === "Context") add("context_record", m.snapshot);
  for (const c of store.all<any>("ModelCall"))
    add("logical_request", c.request);
  for (const e of store.logs)
    if (e.event_type === "model.payload")
      add("provider_payload", store.read<any>(e.payload).payload_ref);
  const physical = fs
    .readdirSync(path.join(dir, "objects"))
    .reduce(
      (n, file) => n + fs.statSync(path.join(dir, "objects", file)).size,
      0,
    );
  classified.other =
    physical - Object.values(classified).reduce((a, b) => a + b, 0);
  console.log(
    JSON.stringify({ steps: 20, totals: classified, totalBytes: physical }),
  );
} finally {
  await store.close();
}
