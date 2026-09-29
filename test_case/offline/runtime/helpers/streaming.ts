import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
  replyStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
export function delayedStream(delay = 120, noThinking = false): StreamFn {
  return (_model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const message = await replyStream([]).result();
      stream.push({ type: "start", partial: message });
      for (const [index, type] of (noThinking
        ? ["text"]
        : ["thinking", "text"]
      ).entries()) {
        const block =
          type === "text"
            ? { type: "text" as const, text: "" }
            : {
                type: "thinking" as const,
                thinking: "",
                thinkingSignature: "PRIVATE_SIGNATURE",
              };
        message.content.push(block);
        for (const delta of type === "text"
          ? ["这是", "逐段输出", "的正文。"]
          : ["检查", "输入信息", "。"]) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (options?.signal?.aborted) {
            message.stopReason = "aborted";
            stream.push({ type: "error", reason: "aborted", error: message });
            stream.end(message);
            return;
          }
          if (block.type === "text") {
            block.text += delta;
            stream.push({
              type: "text_delta",
              contentIndex: index,
              delta,
              partial: message,
            });
          } else {
            block.thinking += delta;
            stream.push({
              type: "thinking_delta",
              contentIndex: index,
              delta,
              partial: message,
            });
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
    })();
    return stream;
  };
}
