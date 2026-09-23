import { migrateCommitments } from "./memory.ts";
import { contentText } from "@earendil-works/pi-ai";
import { Store, base, id, now } from "./store.ts";
import type {
  Context,
  Checkpoint,
  Scope,
  Session,
  Consciousness,
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
  } = {},
): Context {
  const raw = store.put(messages);
  const estimated = Math.ceil(store.bytes(raw).length / 3);
  if (estimated + 4096 > budget) throw Error("CAPACITY_BLOCKED");
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
        const previouslyCaptured = store
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
  const c: Context = {
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
    token_budget: budget,
    estimated_tokens: estimated,
    reserve_tokens: 4096,
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
