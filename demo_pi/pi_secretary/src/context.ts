import { Store, base, id, now } from "./store.ts";
import type { Context, Checkpoint, Scope } from "./contracts.ts";
import type { Agent, AgentMessage } from "./model.ts";
export function saveContext(
  store: Store,
  messages: AgentMessage[],
  scope: Scope,
  purpose: Context["purpose"],
  profile: string,
  loopID: string,
  budget = 32768,
): Context {
  const raw = store.put(messages);
  const estimated = Math.ceil(store.bytes(raw).length / 3);
  if (estimated + 4096 > budget) throw Error("CAPACITY_BLOCKED");
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
    consciousness_revision: null,
    input_ids: [],
    pending_tool_call_ids: [],
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
