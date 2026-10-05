import { requestTokens, type RequestBudget } from "./budget.ts";
import { migrateCommitments } from "./memory.ts";
import {
  contentText,
  type Api,
  type Model,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { Store, base, id, now } from "./store.ts";
import type {
  Context,
  ModelCall,
  Input,
  Checkpoint,
  Scope,
  Session,
  Consciousness,
  MainPromptSnapshot,
} from "./contracts.ts";
import type { Agent, AgentMessage } from "./model.ts";
export function saveContext(
  store: Store,
  messages: AgentMessage[],
  scope: Scope,
  purpose: Context["purpose"],
  profile: string,
  loopID: string,
  budget = 32768,
  metadata: {
    consciousnessRevision?: number | null;
    inputIDs?: string[];
    captureKind?: "CHECKPOINT" | "MODEL_REQUEST";
    budget?: RequestBudget;
    sourceContextID?: string | null;
    compactionJobID?: string | null;
    protectedFromIndex?: number;
  } = {},
): Context {
  const raw = store.put(messages);
  const estimated =
    metadata.budget?.estimated_tokens ?? requestTokens(messages);
  // A checkpoint is recovery evidence, even when no model could accept it.
  // Sending is authorized separately using the complete model-specific request.
  if (
    metadata.captureKind === "MODEL_REQUEST" &&
    (!metadata.budget ||
      metadata.budget.usable_input_tokens <= 0 ||
      estimated > metadata.budget.usable_input_tokens)
  )
    throw Error("CAPACITY_BLOCKED: model request requires a passing budget");
  const pending = new Set<string>();
  let memoryRevision: number | null = null;
  for (const m of messages) {
    if (m.role === "assistant")
      for (const part of m.content)
        if (part.type === "toolCall") pending.add(part.id);
    if (m.role === "toolResult") pending.delete(m.toolCallId);
    if (
      memoryRevision === null &&
      m.role === "user" &&
      contentText(m.content).startsWith(
        "Working memory (source history remains queryable): ",
      )
    ) {
      try {
        const text = contentText(m.content);
        const parsed = JSON.parse(
          text.slice(
            "Working memory (source history remains queryable): ".length,
          ),
        );
        const session = scope.session_id
          ? store.find<Session>("Session", scope.session_id)
          : undefined;
        const cs = session
          ? store.get<Consciousness>("Consciousness", session.consciousness_id)
          : undefined;
        const canonical = cs
          ? "Working memory (source history remains queryable): " +
            JSON.stringify({
              revision: cs.revision,
              items: cs.items,
              commitments: migrateCommitments(cs),
            })
          : null;
        const previouslyCaptured =
          text !== canonical &&
          store
            .all<Context>("Context")
            .some(
              (c) =>
                c.session_id === scope.session_id &&
                c.consciousness_revision === parsed.revision &&
                c.messages.some(
                  (entry) =>
                    entry.role === "user" &&
                    contentText(
                      store.read<{ content: string }>(entry.content).content,
                    ) === text,
                ),
            );
        if (text === canonical || previouslyCaptured)
          memoryRevision = parsed.revision ?? null;
      } catch {}
    }
  }
  const session = scope.session_id
    ? store.find<Session>("Session", scope.session_id)
    : undefined;
  const prompt =
    purpose === "MAIN"
      ? store.find<MainPromptSnapshot>("MainPromptSnapshot", loopID)
      : undefined;
  const c: Context = {
    ...(prompt
      ? {
          settings_application_id: prompt.settings_application_id ?? null,
          base_prompt_version: prompt.base_prompt_version,
          instructions_revision: prompt.instructions_revision,
          system_prompt_hash: prompt.system_prompt_hash,
        }
      : {}),
    schema_version: 1,
    record_type: "Context",
    ...base(),
    session_id: scope.session_id,
    execution_id: scope.execution_id,
    loop_id: loopID,
    call_id: id(),
    purpose,
    messages: messages.map((m) => ({
      message_id: id(),
      role:
        m.role === "toolResult"
          ? "tool"
          : m.role === "assistant"
            ? "assistant"
            : m.role === "system"
              ? "system"
              : "user",
      content: store.put(m),
      tool_call_id: m.role === "toolResult" ? m.toolCallId : null,
      source_event_ids: [],
    })),
    raw_context: raw,
    provider_profile: profile,
    adapter_version: "pi-0.87.0",
    tools_schema: store.put(messages.filter((m) => m.role === "system")),
    consciousness_revision:
      metadata.consciousnessRevision === undefined
        ? memoryRevision
        : metadata.consciousnessRevision,
    input_ids:
      metadata.inputIDs ??
      (session?.active_loop_id === loopID ? session.claimed_input_ids : []),
    pending_tool_call_ids: [...pending],
    capture_kind: metadata.captureKind ?? "CHECKPOINT",
    ...(metadata.budget ? { request_budget: metadata.budget } : {}),
    ...(metadata.sourceContextID
      ? { source_context_id: metadata.sourceContextID }
      : {}),
    ...(metadata.compactionJobID
      ? { compaction_job_id: metadata.compactionJobID }
      : {}),
    ...(metadata.protectedFromIndex === undefined
      ? {}
      : { protected_from_index: metadata.protectedFromIndex }),
    token_budget: metadata.budget?.effective_context_window ?? budget,
    estimated_tokens: estimated,
    reserve_tokens: metadata.budget
      ? metadata.budget.effective_output_tokens +
        metadata.budget.tool_reserve_tokens +
        metadata.budget.safety_margin_tokens
      : 0,
    omitted_refs: [],
    wm_fact_versions: [],
  };
  store.commit([c], [store.event("model.context", c, scope)]);
  return c;
}
export function checkpoint(
  store: Store,
  agent: Agent,
  taskID: string,
  executionID: string,
): Checkpoint {
  const context = saveContext(
    store,
    agent.state.messages,
    { session_id: null, task_id: taskID, execution_id: executionID },
    "TASK",
    agent.state.model.id,
    executionID,
    agent.state.model.contextWindow,
  );
  const cp: Checkpoint = {
    schema_version: 1,
    record_type: "Checkpoint",
    ...base(),
    task_id: taskID,
    execution_id: executionID,
    executor_kind: "AGENT",
    context_id: context.id,
    raw_context: context.raw_context,
    program_resume_ref: null,
    continuation: store.put({
      completed: true,
      pending_tool_calls: [...agent.state.pendingToolCalls],
    }),
    artifact_refs: [],
    completed_operation_ids: [],
    pending_operation_ids: [],
    pending_tool_call_ids: [...agent.state.pendingToolCalls],
    adapter_version: context.adapter_version,
    provider_profile: context.provider_profile,
  };
  store.commit([cp]);
  return cp;
}

const requestViews = new WeakMap<
  Store,
  {
    position: number;
    contexts: Map<string, Context>;
    usages: Map<string, { sha: string; usage: AssistantMessage["usage"] }>;
  }
>();
/** The UI describes a request separately from recovery evidence and future inputs. */
export function contextStatus(
  store: Store,
  session: Session,
  model: Model<Api>,
) {
  let cache = requestViews.get(store);
  if (!cache) {
    cache = { position: 0, contexts: new Map(), usages: new Map() };
    requestViews.set(store, cache);
  }
  for (const event of store.logs.slice(cache.position)) {
    if (event.event_type !== "model.context") continue;
    const context = store.read<Context>(event.payload);
    if (
      context.purpose === "MAIN" &&
      context.capture_kind === "MODEL_REQUEST" &&
      context.session_id
    )
      cache.contexts.set(context.session_id, context);
  }
  cache.position = store.logs.length;
  const context = cache.contexts.get(session.id);
  const facts = context?.request_budget;
  const checkpoint = session.last_context_id
    ? store.find<Context>("Context", session.last_context_id)
    : undefined;
  const call = context
    ? store.find<ModelCall>("ModelCall", context.call_id)
    : undefined;
  let observed = cache.usages.get(session.id);
  if (call?.response && observed?.sha !== call.response.sha256) {
    const response = store.read<AssistantMessage>(call.response);
    observed = { sha: call.response.sha256, usage: response.usage };
    cache.usages.set(session.id, observed);
  }
  const usage =
    call?.response && observed?.sha === call.response.sha256
      ? observed.usage
      : undefined;
  const pending = store.select<Input>(
    "Input",
    (input) => input.session_id === session.id && input.state === "ACCEPTED",
    Number.MAX_SAFE_INTEGER,
  ).length;
  return {
    used: context?.estimated_tokens ?? null,
    budget:
      facts?.effective_context_window ??
      context?.token_budget ??
      model.contextWindow,
    reserve: context?.reserve_tokens ?? null,
    context_id: context?.id ?? null,
    capture_kind: context?.capture_kind ?? null,
    model: context?.provider_profile ?? null,
    current_model: model.id,
    call_state: call?.state ?? null,
    method:
      facts?.count_method ?? (context ? "historical_rough_estimate" : null),
    usable_input: facts?.usable_input_tokens ?? null,
    occupancy: facts?.occupancy ?? null,
    requested_output: facts?.requested_output_tokens ?? null,
    effective_output: facts?.effective_output_tokens ?? null,
    tool_reserve: facts?.tool_reserve_tokens ?? null,
    safety_margin: facts?.safety_margin_tokens ?? null,
    deployment_limit_verified: facts?.deployment_limit_verified ?? false,
    observed_usage: usage
      ? {
          input: usage.input,
          output: usage.output,
          cache_read: usage.cacheRead,
          cache_write: usage.cacheWrite,
          total: usage.totalTokens,
        }
      : null,
    checkpoint: checkpoint
      ? {
          id: checkpoint.id,
          capture_kind: checkpoint.capture_kind,
          estimated_tokens: checkpoint.estimated_tokens,
        }
      : null,
    next_request_budget: null,
    pending_inputs: pending,
  };
}
