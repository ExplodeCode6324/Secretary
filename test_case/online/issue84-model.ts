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
      let admissionError: unknown;
      const budget = options.budget;
      const end = (reason: string) => {
        if (attempt && attempt.ended === undefined)
          budget!.end(attempt, Date.now(), reason);
      };
      const checked = checkedStream(adapter.stream, (response) => {
        // The SDK wraps a fetch admission throw as "Connection error".
        // Restore the local refusal so Core never schedules network retries.
        if (admissionError) throw admissionError;
        if (!attempt) return;
        const failed = ["error", "aborted"].includes(response.stopReason);
        const { input, cacheRead, cacheWrite, output } = response.usage;
        if (failed) {
          // Partial usage can be billed. Missing usage stays unknown.
          if (input + cacheRead + cacheWrite > 0) {
            budget!.finish(
              attempt,
              Date.now(),
              response.responseId ?? "",
              input + cacheRead + cacheWrite,
              output,
              response.usage,
            );
            attempt.termination = response.stopReason;
            budget!.save();
          } else end(response.stopReason);
          const generated = response.content
            .filter((p) => p.type === "toolCall")
            .map((p) => p.name);
          if (generated.length) {
            try {
              budget!.tools(role, generated, attempt, false);
            } catch {}
          }
          return;
        }
        budget!.finish(
          attempt,
          Date.now(),
          response.responseId ?? "",
          input + cacheRead + cacheWrite,
          output,
          response.usage,
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
            (args.materials == null ||
              (Array.isArray(args.materials) &&
                args.materials.every((v) => typeof v === "string"))) &&
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
            try {
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
              assert(!attempt, "BUDGET_ISSUE84_MULTIPLE_FETCHES");
            } catch (error) {
              admissionError = error;
              options.violation(String(error));
              throw error;
            }
            const body = init!.body as string;
            let wire: ReturnType<typeof wireBound>;
            try {
              wire = wireBound(body);
            } catch (error) {
              options.violation(String(error));
              admissionError = error;
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
              admissionError = Error("BUDGET_ISSUE84_REHEARSAL_WIRE_HEADROOM");
              throw admissionError;
            }
            if (budget) {
              try {
                attempt = budget.admit(
                  role,
                  wire,
                  role === "main" && kind === "normal"
                    ? options.inputIds()
                    : [],
                  kind,
                );
                attempt.sessionId = opts?.sessionId;
                budget.save();
              } catch (error) {
                admissionError = error;
                throw error;
              }
            }
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
