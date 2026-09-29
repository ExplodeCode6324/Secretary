import {
  createAssistantMessageEventStream,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "../../src/pi_secretary/src/model.ts";

// Test-only budget gate. Forward the real provider events unchanged, after counting
// every tool call, including terminal submit_result calls with no next model turn.
export function boundedTools(
  stream: StreamFn,
  budget: { used: number; limit: number },
): StreamFn {
  return async (model, context, options) => {
    const source = await stream(model, context, options);
    const events: AssistantMessageEvent[] = [];
    for await (const event of source) events.push(event);
    const response = await source.result();
    const count = response.content.filter(
      (part) => part.type === "toolCall",
    ).length;
    if (budget.used + count > budget.limit) throw Error("LIVE_TOOL_LIMIT");
    budget.used += count;
    const output = createAssistantMessageEventStream();
    queueMicrotask(() => {
      for (const event of events) output.push(event);
      output.end(response);
    });
    return output;
  };
}
