import type { App } from "../../../src/pi_secretary/src/app.ts";
import path from "node:path";
import type { Run } from "./domain.ts";
import { snapshot } from "./snapshot.ts";
import { migrateCommitments } from "../../../src/pi_secretary/src/memory.ts";
import type {
  Consciousness,
  CompactionJob,
} from "../../../src/pi_secretary/src/contracts.ts";
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
import { sha, readJSON, requireThat } from "./io.ts";

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
            refs: [0, 1].map((i) => ({
              path: "objects/" + String(i).repeat(64),
              sha256: String(i).repeat(64),
              bytes: 100000,
              media_type:
                i === 0
                  ? "application/vnd.secretary.message-list+json"
                  : "application/json",
            })),
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
            "Initial resident base; 24 x 2048-byte synthetic sources, two full CAS provenance refs and empty commitments. Actual episode state and crop must be measured live.",
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

/** Read-only replay of a failed, plain-text/no-task maintenance plan. Never opens Core. */
export function replaySummaryCapacity(run: Run) {
  requireThat(run.state === "STOPPED", "CAPACITY_REPLAY_REQUIRES_STOPPED");
  const core = path.join(run.active, "core"),
    state = snapshot(core);
  requireThat(
    !state.records.some((r) => r.record_type === "Execution") &&
      state.records
        .filter((r) => r.record_type === "Input")
        .every(
          (r) =>
            r.producer === "MASTER" &&
            !r.attachments?.length &&
            r.state !== "WITHDRAWN",
        ),
    "CAPACITY_REPLAY_PLAIN_TEXT_ONLY",
  );
  const job = state.records.find(
    (r) =>
      r.record_type === "CompactionJob" &&
      r.validation_errors.some((e) =>
        e.includes("SUMMARY_FIXED_INPUT_CAPACITY_BLOCKED"),
      ),
  ) as CompactionJob | undefined;
  requireThat(job, "CAPACITY_REPLAY_JOB_REQUIRED");
  const cs = state.transactions
    .flatMap((t) => t.records)
    .find(
      (r) =>
        r.record_type === "Consciousness" &&
        r.session_id === job.session_id &&
        r.revision === job.base_revision,
    ) as Consciousness | undefined;
  requireThat(cs, "CAPACITY_REPLAY_BASE_REQUIRED");
  const events = state.transactions.flatMap((t) => t.events);
  requireThat(
    !events.some((e) => e.event_type === "notification.presented"),
    "CAPACITY_REPLAY_NOTIFICATION_UNSUPPORTED",
  );
  const sources = events
    .filter((e) => job.source_event_ids.includes(e.event_id))
    .map((e) => ({
      id: e.event_id,
      text: JSON.stringify({
        event_id: e.event_id,
        sequence: e.sequence,
        source_ref: e.payload,
        message: readJSON(path.join(core, e.payload.path)),
      }),
    }));
  const saved = process.env.SECRETARY_MAIN_CONTEXT_WINDOW,
    results = [];
  try {
    for (const size of [65536, 81920, 98304, 131072])
      for (const modelID of modelIDs) {
        process.env.SECRETARY_MAIN_CONTEXT_WINDOW = String(size);
        try {
          const model = descriptor(modelID),
            plan = createSummaryPlan({
              model,
              refs: job.source_refs,
              items: cs.items,
              commitments: migrateCommitments(cs),
              sources,
              extra: {
                runtime_tasks: [],
                source_end_sequence: job.source_end_sequence,
                delivered_notifications: [],
              },
            });
          results.push({
            model: modelID,
            size,
            status: "PLANNABLE",
            segments: plan.chunks.length,
            outputs: plan.outputs,
            prior_input_bytes: plan.prior_input_bytes,
            ledger_bytes: plan.ledger_bytes,
            reservation_upper_usd:
              (plan.chunks.length *
                (size * model.cost.input +
                  plan.outputs[1] * model.cost.output)) /
              1e6,
          });
        } catch (e) {
          results.push({
            model: modelID,
            size,
            status: "BLOCKED",
            reason: e instanceof Error ? e.message : "UNKNOWN",
          });
        }
      }
  } finally {
    saved === undefined
      ? delete process.env.SECRETARY_MAIN_CONTEXT_WINDOW
      : (process.env.SECRETARY_MAIN_CONTEXT_WINDOW = saved);
  }
  return {
    run: run.id,
    job: job.id,
    journal_digest: state.digest,
    source_refs: job.source_refs,
    results,
    limitation:
      "Exact failing plain-text plan replay; not a guarantee for larger future state or deployment capacity.",
  };
}
