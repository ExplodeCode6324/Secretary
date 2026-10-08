import { createHash } from "node:crypto";
import type { Api, Model, Tool } from "@earendil-works/pi-ai";
import {
  getCurrentTools,
  getToolStateChanges,
  toToolDeclaration,
} from "@earendil-works/pi-ai/utils/transcript";
import { clampMaxTokensToContext } from "@earendil-works/pi-ai/api/simple-options";
import type { AgentMessage } from "./model.ts";

export type BudgetRole = "main" | "task";
export const BUDGET_POLICY = "request-utf8-v1";
function integer(
  name: string,
  fallback: number | null,
  minimum = 1,
): number | null {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!raw.trim() || !Number.isSafeInteger(value) || value < minimum)
    throw Error(`BUDGET_CONFIG_INVALID: ${name}`);
  return value;
}
function ratio(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (raw?.trim() === "" || !Number.isFinite(value) || value <= 0 || value >= 1)
    throw Error(`BUDGET_CONFIG_INVALID: ${name}`);
  return value;
}
export function budgetConfig(role: BudgetRole = "main") {
  const prefix = `SECRETARY_${role.toUpperCase()}`;
  const config = {
    policy: BUDGET_POLICY,
    contextLimit: integer(`${prefix}_CONTEXT_WINDOW`, null),
    inputLimit: integer(`${prefix}_INPUT_TOKENS`, null),
    outputLimit: integer(`${prefix}_OUTPUT_TOKENS`, null),
    outputTokens: integer("SECRETARY_MAX_OUTPUT_TOKENS", 4096)!,
    summaryOutputTokens: integer("SECRETARY_COMPACTION_OUTPUT_TOKENS", 16384)!,
    summaryRetryTokens: integer(
      "SECRETARY_COMPACTION_RETRY_OUTPUT_TOKENS",
      32768,
    )!,
    toolReserve: integer("SECRETARY_TOOL_GROWTH_RESERVE", 4096, 0)!,
    safetyTokens: integer("SECRETARY_CONTEXT_SAFETY_TOKENS", null, 0),
    safetyRatio: ratio("SECRETARY_CONTEXT_SAFETY_RATIO", 0.05),
    target: ratio("SECRETARY_COMPACTION_TARGET", 0.3),
    normal: ratio("SECRETARY_COMPACTION_THRESHOLD", 0.6),
    forced: ratio("SECRETARY_COMPACTION_FORCED_THRESHOLD", 0.8),
  };
  if (!(
    config.target >= 0.25 &&
    config.target <= 0.35 &&
    config.target < config.normal &&
    config.normal < config.forced
  ))
    throw Error(
      "BUDGET_CONFIG_INVALID: require 0.25 <= target <= 0.35 < normal < forced < 1",
    );
  if (config.summaryRetryTokens < config.summaryOutputTokens)
    throw Error("BUDGET_CONFIG_INVALID: summary retry is below initial output");
  return config;
}
function validCapacity(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw Error(`BUDGET_CONFIG_INVALID: ${name}`);
  return value;
}
export function effectiveTools(
  messages: AgentMessage[],
  tools?: Tool[],
): Tool[] {
  return tools === undefined
    ? getCurrentTools(messages as Parameters<typeof getCurrentTools>[0])
    : tools.map(toToolDeclaration);
}
// One UTF-8 byte per token is deliberately conservative for text/JSON. Historical
// tool declarations remain counted once in the transcript; effective tools determine
// the future-result reserve. No tokenizer or provider-exact count is claimed.
export function requestTokens(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw Error("CAPACITY_UNCOUNTABLE_REQUEST");
  return Buffer.byteLength(serialized, "utf8") + 256;
}
export type RequestBudget = {
  count_method: "utf8_bytes_upper_estimate_v1";
  policy_id: string;
  estimated_tokens: number;
  effective_context_window: number;
  usable_input_tokens: number;
  requested_output_tokens: number;
  effective_output_tokens: number;
  tool_reserve_tokens: number;
  safety_margin_tokens: number;
  occupancy: number;
  deployment_limit_verified: boolean;
};
export type BudgetOptions = {
  role?: BudgetRole;
  maxTokens?: number;
  tools?: Tool[];
};
export function requestBudget(
  model: Model<Api>,
  messages: AgentMessage[],
  options: BudgetOptions = {},
): RequestBudget {
  const config = budgetConfig(options.role);
  const capacity = Math.min(
    validCapacity(model.contextWindow, "model.contextWindow"),
    config.contextLimit ?? Infinity,
  );
  const requested = validCapacity(
    options.maxTokens ?? config.outputTokens,
    "maxTokens",
  );
  const maximum = Math.min(
    validCapacity(model.maxTokens, "model.maxTokens"),
    config.outputLimit ?? Infinity,
  );
  // Mirror a tool-state update, rather than prepend a second copy of schemas
  // already declared in the transcript. A projected checkpoint may have no
  // declarations yet; in that case this adds precisely the missing tools.
  const changes =
    options.tools === undefined
      ? undefined
      : getToolStateChanges(
          getCurrentTools(messages as Parameters<typeof getCurrentTools>[0]),
          options.tools.map(toToolDeclaration),
        );
  const context = {
    messages:
      changes && (changes.toolsAdded.length || changes.toolsRemoved.length)
        ? [
            ...messages,
            { role: "system" as const, content: "", timestamp: 0, ...changes },
          ]
        : messages,
  };
  for (const message of context.messages) {
    if (
      "content" in message &&
      Array.isArray(message.content) &&
      message.content.some(
        (part) => !["text", "thinking", "toolCall"].includes(part.type),
      )
    )
      throw Error(
        "CAPACITY_UNCOUNTABLE_NON_TEXT: configured estimator only supports text and tool JSON",
      );
  }
  let output = clampMaxTokensToContext(
    model,
    context as Parameters<typeof clampMaxTokensToContext>[1],
    Math.min(requested, maximum),
  );
  if (model.api === "openai-responses") {
    output = Math.max(16, output);
    if (output > maximum)
      throw Error(
        "CAPACITY_OUTPUT_LIMIT: Responses requires at least 16 output tokens",
      );
    if (
      (model.compat as { supportsMaxOutputTokens?: boolean } | undefined)
        ?.supportsMaxOutputTokens === false
    )
      throw Error("CAPACITY_OUTPUT_LIMIT: adapter disables output ceiling");
  }
  const safety =
    config.safetyTokens ??
    Math.max(2048, Math.ceil(capacity * config.safetyRatio));
  const reserve = effectiveTools(messages, options.tools).length
    ? config.toolReserve
    : 0;
  const usable = Math.min(
    capacity - output - reserve - safety,
    (config.inputLimit ?? capacity) - reserve - safety,
  );
  const estimated =
    requestTokens({ model: model.id, ...context }) + 32 * messages.length;
  return {
    count_method: "utf8_bytes_upper_estimate_v1",
    policy_id: createHash("sha256")
      .update(
        JSON.stringify({
          config,
          provider: model.provider,
          api: model.api,
          baseUrl: model.baseUrl,
          model: model.id,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          compat: model.compat,
        }),
      )
      .digest("hex"),
    estimated_tokens: estimated,
    effective_context_window: capacity,
    usable_input_tokens: usable,
    requested_output_tokens: requested,
    effective_output_tokens: output,
    tool_reserve_tokens: reserve,
    safety_margin_tokens: safety,
    occupancy: usable > 0 ? estimated / usable : 1 + estimated,
    deployment_limit_verified: config.contextLimit !== null,
  };
}
export function assertRequestBudget(
  model: Model<Api>,
  messages: AgentMessage[],
  options: BudgetOptions = {},
) {
  const budget = requestBudget(model, messages, options);
  if (
    budget.usable_input_tokens <= 0 ||
    budget.estimated_tokens > budget.usable_input_tokens
  )
    throw Error(
      `CAPACITY_BLOCKED: input=${budget.estimated_tokens}, usable=${budget.usable_input_tokens}, output=${budget.effective_output_tokens}`,
    );
  return budget;
}
export function summaryOutputBudget(
  model: Model<Api>,
  attempt: 1 | 2,
  role: BudgetRole = "main",
) {
  const config = budgetConfig(role);
  const capacity = Math.min(
    validCapacity(model.contextWindow, "model.contextWindow"),
    config.contextLimit ?? Infinity,
  );
  const safety =
    config.safetyTokens ??
    Math.max(2048, Math.ceil(capacity * config.safetyRatio));
  const available = Math.floor((capacity - safety) / 2);
  if (available < 1)
    throw Error("CAPACITY_BLOCKED: no summary input/output budget");
  return Math.min(
    attempt === 1 ? config.summaryOutputTokens : config.summaryRetryTokens,
    validCapacity(model.maxTokens, "model.maxTokens"),
    config.outputLimit ?? Infinity,
    available,
  );
}
// Public provider hook runs after adapter transformations and before its HTTP send.
// Bound both the final body and output field. Missing output caps cannot silently pass.
export function assertFinalPayload(
  model: Model<Api>,
  payload: unknown,
  budget: RequestBudget,
): { inputTokens: number; outputTokens: number } {
  if (model.api !== "openai-completions" && model.api !== "openai-responses")
    throw Error(`CAPACITY_UNSUPPORTED_ADAPTER: ${model.api}`);
  const body = payload as Record<string, unknown>;
  if (!body || typeof body !== "object")
    throw Error("CAPACITY_INVALID_PAYLOAD");
  const fields =
    model.api === "openai-responses"
      ? [body.max_output_tokens]
      : [body.max_tokens, body.max_completion_tokens];
  const values = fields.filter((value) => value !== undefined);
  if (
    values.length !== 1 ||
    typeof values[0] !== "number" ||
    !Number.isSafeInteger(values[0]) ||
    values[0] <= 0
  )
    throw Error("CAPACITY_OUTPUT_LIMIT_MISSING_OR_AMBIGUOUS");
  const output = values[0];
  if (output !== budget.effective_output_tokens)
    throw Error("CAPACITY_OUTPUT_LIMIT_CHANGED_BY_ADAPTER");
  if (body.model !== model.id) throw Error("CAPACITY_PAYLOAD_MODEL_CHANGED");
  const input = requestTokens(body);
  if (input > budget.usable_input_tokens)
    throw Error(
      `CAPACITY_BLOCKED: final payload=${input}, usable=${budget.usable_input_tokens}`,
    );
  return { inputTokens: input, outputTokens: output };
}
