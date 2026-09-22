// Agent execution is upstream source, not a local reimplementation of its loop.
export { Agent } from "../../pi_resource/packages/agent/src/agent.ts";
export type {
  AgentMessage,
  AgentTool,
  StreamFn,
} from "../../pi_resource/packages/agent/src/types.ts";
import type { StreamFn } from "../../pi_resource/packages/agent/src/types.ts";
import {
  createAssistantMessageEventStream,
  contentText,
  type AssistantMessage,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import { getModel, streamSimple } from "@earendil-works/pi-ai/compat";
export const fixtureModel: Model<Api> = {
  id: "secretary-fixture",
  name: "Offline fixture (not a language model)",
  api: "openai-completions",
  provider: "fixture",
  baseUrl: "http://127.0.0.1/disabled",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32768,
  maxTokens: 4096,
};
export function replyStream(
  content: AssistantMessage["content"],
  model = fixtureModel,
) {
  const s = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((c) => c.type === "toolCall") ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    s.push({
      type: "done",
      reason: message.stopReason as "stop" | "toolUse",
      message,
    });
    s.end(message);
  });
  return s;
}
export const fixtureStream: StreamFn = (model, context) => {
  const latest = context.messages.at(-1);
  const system = context.messages
    .filter((m) => m.role === "system")
    .map((m) => JSON.stringify(m))
    .join(" ");
  if (latest?.role === "toolResult")
    return replyStream(
      [
        {
          type: "text",
          text: "已保存结构化结果：" + contentText(latest.content),
        },
      ],
      model,
    );
  const text = latest ? contentText(latest.content) : "";
  if (system.includes("CONSCIOUSNESS"))
    return replyStream(
      [
        {
          type: "text",
          text: JSON.stringify({
            items: [
              {
                tier: "ACTIVE",
                summary: "Offline fixture preserves full source: " + text,
                goals: [],
                constraints: [],
                decisions: [],
                open_questions: [],
                unfulfilled_commitments: [],
                task_refs: [],
                pending_owner: "MAIN",
              },
            ],
          }),
        },
      ],
      model,
    );
  if (system.includes("TASK_EXECUTOR"))
    return replyStream(
      [{ type: "text", text: "离线执行样例完成。目标：" + text }],
      model,
    );
  if (text.startsWith("task:"))
    return replyStream(
      [
        {
          type: "toolCall",
          id: "task-" + context.messages.length,
          name: "task_propose",
          arguments: { goal: text.slice(5).trim() },
        },
      ],
      model,
    );
  return replyStream(
    [{ type: "text", text: "[离线验证模式] 已处理：" + text }],
    model,
  );
};
export function modelConfig() {
  if (process.env.SECRETARY_MODE !== "live")
    return { model: fixtureModel, stream: fixtureStream };
  const provider = process.env.SECRETARY_PROVIDER,
    modelID = process.env.SECRETARY_MODEL;
  if (!provider || !modelID)
    throw Error("Live mode requires SECRETARY_PROVIDER and SECRETARY_MODEL");
  const model = getModel(
    provider as Parameters<typeof getModel>[0],
    modelID as never,
  );
  if (!model) throw Error("Unknown Pi model");
  return { model, stream: streamSimple as StreamFn };
}

import type { TSchema } from "typebox";
import type { AgentTool } from "../../pi_resource/packages/agent/src/types.ts";
export function tool<T extends TSchema>(value: AgentTool<T>): AgentTool {
  return value as AgentTool;
}
