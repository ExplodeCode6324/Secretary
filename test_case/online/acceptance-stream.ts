/** Acceptance-only timing/accounting. Core remains the sole attempt deadline owner. */
import type { StreamFn } from "../../src/pi_secretary/src/model.ts";
import { boundedTools, checkedStream } from "./tool-budget.ts";
export type LiveUsage = {
  main: number;
  task: number;
  tools: number;
  calls: Record<string, any>[];
  rejected?: number;
};
export function acceptanceStream(
  stream: StreamFn,
  role: "main" | "task",
  usage: LiveUsage,
  limits: { main: number; task: number; tools: number; cutoff: number },
  save: () => void,
  enabled: () => boolean = () => true,
): StreamFn {
  const toolBudget = {
    get used() {
      return usage.tools;
    },
    set used(n: number) {
      usage.tools = n;
    },
    limit: limits.tools,
  };
  return async (model, context, options) => {
    const call: Record<string, any> = {
      role,
      at: new Date().toISOString(),
      physical_sent: false,
      payload_ms: null,
      fetch_ms: null,
      headers_ms: null,
      first_event_ms: null,
      last_event_ms: null,
      total_ms: null,
    };
    const started = performance.now();
    const stamp = (key: string) => {
      call[key] = Math.round(performance.now() - started);
    };
    const check = () => {
      if (
        !enabled() ||
        Date.now() >= limits.cutoff ||
        usage[role] >= limits[role] ||
        usage.tools >= limits.tools
      ) {
        usage.rejected = (usage.rejected ?? 0) + 1;
        call.rejected = "LIVE_BUDGET_ADMISSION_REFUSED";
        save();
        throw Error("LIVE_BUDGET_ADMISSION_REFUSED");
      }
    };
    usage.calls.push(call);
    try {
      check();
      const observed = checkedStream(
        boundedTools(stream, toolBudget),
        (response) => {
          call.stop_reason = response.stopReason;
          call.tool_names = response.content
            .filter((p) => p.type === "toolCall")
            .map((p) => p.name);
          call.termination = options?.signal?.aborted
            ? options.signal.reason?.name === "TimeoutError"
              ? "CORE_DEADLINE"
              : "CORE_PARENT_CANCEL"
            : response.stopReason === "error"
              ? "STREAM_ERROR"
              : "COMPLETED";
          call.finished_at = new Date().toISOString();
          stamp("total_ms");
          save();
        },
        () => {
          if (call.first_event_ms === null) stamp("first_event_ms");
          stamp("last_event_ms");
        },
      );
      return await observed(model, context, {
        ...options,
        onPayload: async (payload, model) => {
          const changed = await options?.onPayload?.(payload, model);
          stamp("payload_ms");
          return changed;
        },
        fetch: async (url, init) => {
          check();
          usage[role]++;
          call.number = usage[role];
          call.physical_sent = true;
          stamp("fetch_ms");
          save();
          const response = await (options?.fetch ?? globalThis.fetch)(
            url,
            init,
          );
          stamp("headers_ms");
          call.http_status = response.status;
          save();
          return response;
        },
      });
    } catch (error) {
      call.termination = call.rejected
        ? "ADMISSION_REFUSED"
        : "STREAM_SETUP_ERROR";
      call.finished_at = new Date().toISOString();
      stamp("total_ms");
      save();
      throw error;
    }
  };
}
