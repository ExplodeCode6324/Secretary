/** Shared physical request admission for both dry-paid and real-provider runs. */
import assert from "node:assert/strict";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  roleModel,
  type ModelConfig,
} from "../../src/pi_secretary/src/model.ts";
import { checkedStream } from "./tool-budget.ts";
import { Issue84Budget, wireBound, type Role } from "./issue84-budget.ts";

export const acceptanceModel = getModel("deepseek", "deepseek-flash");
export const acceptanceEndpoint = "https://api.deepseek.com/chat/completions";
export type RequestObservation = ReturnType<typeof wireBound> & {
  role: Role;
  kind: "summary" | "extraction" | "normal";
  at: string;
};
export function acceptanceAdapter(
  role: Role,
  options: {
    key: string;
    budget?: Issue84Budget;
    enabled: () => boolean;
    guard: () => void;
    active: (delta: number) => void;
    approvalScope: () => string | undefined;
    inputIds: () => string[];
    observe: (request: RequestObservation) => void;
    violation: (reason: string) => void;
    scripted?: (body: string) => Promise<Response> | Response;
  },
): ModelConfig {
  const adapter = roleModel(acceptanceModel, options.key, role);
  return {
    model: acceptanceModel,
    stream: async (model, context, opts) => {
      if (!options.enabled()) {
        options.guard();
        throw Error("BUDGET_ISSUE84_GUARDED_START");
      }
      let attempt: ReturnType<Issue84Budget["admit"]> | undefined;
      const budget = options.budget;
      const end = (reason: string) => {
        if (attempt && attempt.ended === undefined)
          budget!.end(attempt, Date.now(), reason);
      };
      const checked = checkedStream(adapter.stream, (response) => {
        if (!attempt) return;
        if (["error", "aborted"].includes(response.stopReason)) {
          end(response.stopReason);
          return;
        }
        const { input, cacheRead, cacheWrite, output } = response.usage;
        budget!.finish(
          attempt,
          Date.now(),
          response.responseId ?? "",
          input + cacheRead + cacheWrite,
          output,
        );
        const calls = response.content.filter(
          (part) => part.type === "toolCall",
        );
        const scopeAllowed = calls.every((part) => {
          if (part.name !== "task_propose") return true;
          const args = part.arguments;
          return (
            !args.program_id &&
            !args.at &&
            !args.interval_seconds &&
            (!args.materials ||
              (Array.isArray(args.materials) && args.materials.length === 0)) &&
            (!args.scope_id || args.scope_id === options.approvalScope())
          );
        });
        // Persist refused proposal/tool batches before withholding terminal success.
        budget!.tools(
          role,
          calls.map((part) => part.name),
          attempt,
          scopeAllowed,
        );
      });
      options.active(1);
      try {
        const events = await checked(model, context, {
          ...opts,
          fetch: async (url, init) => {
            assert.equal(
              url instanceof Request ? url.url : String(url),
              acceptanceEndpoint,
              "BUDGET_ISSUE84_DESTINATION",
            );
            assert.equal(
              typeof init?.body,
              "string",
              "BUDGET_ISSUE84_UNINSPECTABLE_BODY",
            );
            const body = init!.body as string;
            let wire: ReturnType<typeof wireBound>;
            try {
              wire = wireBound(body);
            } catch (error) {
              options.violation(String(error));
              throw error;
            }
            const system = JSON.parse(body)
              .messages.filter((m: { role: string }) => m.role === "system")
              .map((m: { content: unknown }) => JSON.stringify(m.content))
              .join("\n");
            const kind = system.includes("COMMITMENT_EXTRACTION:")
              ? "extraction"
              : system.includes("CONSCIOUSNESS:")
                ? "summary"
                : "normal";
            options.observe({
              ...wire,
              role,
              kind,
              at: new Date().toISOString(),
            });
            if (options.scripted && wire.input > 80_000) {
              options.violation("ISSUE84_REHEARSAL_WIRE_HEADROOM");
              throw Error("ISSUE84_REHEARSAL_WIRE_HEADROOM");
            }
            assert(!attempt, "BUDGET_ISSUE84_MULTIPLE_FETCHES");
            if (budget)
              attempt = budget.admit(role, wire, options.inputIds(), kind);
            const response = options.scripted
              ? await options.scripted(body)
              : await (opts?.fetch ?? fetch)(url, {
                  ...init,
                  redirect: "error",
                });
            if (attempt) {
              attempt.http = response.status;
              attempt.requestId =
                response.headers.get("x-request-id") ?? undefined;
              budget!.save();
            }
            return response;
          },
        });
        void events
          .result()
          .finally(() => {
            try {
              end("stream_ended");
            } finally {
              options.active(-1);
            }
          })
          .catch(() => {});
        return events;
      } catch (error) {
        try {
          end("stream_setup_error");
        } finally {
          options.active(-1);
        }
        throw error;
      }
    },
  };
}
