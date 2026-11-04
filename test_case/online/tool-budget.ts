import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "../../src/pi_secretary/src/model.ts";

/** Relay previews immediately; withhold the terminal success until checks complete. */
export function checkedStream(
  stream: StreamFn,
  complete: (response: AssistantMessage) => void | Promise<void>,
  eventSeen?: (event: AssistantMessageEvent) => void,
): StreamFn {
  return async (model, context, options) => {
    const source = await stream(model, context, options);
    const output = createAssistantMessageEventStream();
    void (async () => {
      let last: AssistantMessage | undefined;
      try {
        for await (const event of source) {
          eventSeen?.(event);
          if ("partial" in event) last = event.partial;
          if (event.type === "done" || event.type === "error") continue;
          output.push(event);
        }
        const response = await source.result();
        last = response;
        await complete(response);
        if (
          response.stopReason === "error" ||
          response.stopReason === "aborted"
        )
          output.push({
            type: "error",
            reason: response.stopReason,
            error: response,
          });
        else if (response.stopReason !== "pending")
          output.push({
            type: "done",
            reason: response.stopReason,
            message: response,
          });
        output.end(response);
      } catch (error) {
        const response: AssistantMessage = {
          ...(last ?? {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            timestamp: Date.now(),
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
          }),
          stopReason: "error",
          errorMessage: String(error),
        };
        output.push({ type: "error", reason: "error", error: response });
        output.end(response);
      }
    })();
    return output;
  };
}

// Every proposal counts, even a failed or rejected final response.
export function boundedTools(
  stream: StreamFn,
  budget: { used: number; limit: number },
): StreamFn {
  return checkedStream(stream, (response) => {
    budget.used += response.content.filter(
      (part) => part.type === "toolCall",
    ).length;
    if (budget.used > budget.limit) throw Error("LIVE_TOOL_BUDGET_EXHAUSTED");
  });
}
