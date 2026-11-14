import type { App } from "../../../src/pi_secretary/src/app.ts";
import type { HostContext } from "../../../src/pi_secretary/src/host-context.ts";
import { Agent } from "../../../src/pi_secretary/src/model.ts";
import {
  requestBudget,
  budgetConfig,
} from "../../../src/pi_secretary/src/budget.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import { assembleMainSystem } from "../../../src/pi_secretary/src/main-system.ts";
import { inputWindowConfig } from "../../../src/pi_secretary/src/input-projection.ts";
import { createSummaryPlan } from "../../../src/pi_secretary/src/summary.ts";
import { configureProfile, descriptor, modelIDs } from "./live-model.ts";
import { sha } from "./io.ts";

/** Actual initial product prompts/tools; forecast sources are explicitly synthetic. No model send. */
export function capacityForecast(app: App) {
  const context = (app.host as unknown as { context: HostContext }).context;
  const tools = context.tools("benchmark-offline-capacity");
  const system = assembleMainSystem(
    app.store,
    getInstructions(app.store).content,
    app.scheduler.scopes.promptContext(),
  ).system;
  const keys = [
    "SECRETARY_MAIN_CONTEXT_WINDOW",
    "SECRETARY_TASK_CONTEXT_WINDOW",
    "SECRETARY_RECENT_INPUT_MAX_COUNT",
    "SECRETARY_RECENT_INPUT_BUDGET_RATIO",
  ];
  const saved = keys.map((k) => process.env[k]);
  const results = [];
  try {
    for (const profile of ["RC", "DEP"] as const) {
      keys.forEach((k) => delete process.env[k]);
      configureProfile(profile);
      for (const id of modelIDs) {
        const model = descriptor(id),
          agent = new Agent({
            streamFn: () => {
              throw Error("OFFLINE_CAPACITY_MUST_NOT_SEND");
            },
            initialState: { model, systemPrompt: system, tools },
          });
        const budget = requestBudget(model, agent.state.messages);
        const window = inputWindowConfig();
        let summary: unknown;
        try {
          const plan = createSummaryPlan({
            model,
            refs: [],
            items: [],
            commitments: [],
            sources: Array.from({ length: 24 }, (_, i) => ({
              id: `forecast-${i}`,
              text: "f".repeat(2048),
            })),
          });
          summary = {
            status: "PLANNABLE",
            outputs: plan.outputs,
            segment_count: plan.chunks.length,
            prior_input_bytes: plan.prior_input_bytes,
            metadata_bytes: plan.metadata_bytes,
          };
        } catch (e) {
          summary = {
            status: "BLOCKED",
            reason: e instanceof Error ? e.message : "UNKNOWN",
          };
        }
        results.push({
          model: id,
          profile,
          budget,
          window,
          recent_input_byte_allowance: Math.min(
            budget.usable_input_tokens * window.ratio,
            Math.max(
              0,
              budget.usable_input_tokens * budgetConfig().target -
                budget.estimated_tokens,
            ),
          ),
          summary,
          system_sha256: sha(system),
          tools_sha256: sha(
            JSON.stringify(
              tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            ),
          ),
          limitation:
            "Initial resident base only; 24 x 2048-byte synthetic sources, empty initial commitments/refs. Actual episode metadata and crop must be measured live.",
        });
      }
    }
  } finally {
    keys.forEach((key, i) =>
      saved[i] === undefined
        ? delete process.env[key]
        : (process.env[key] = saved[i]),
    );
  }
  return results;
}
