import { attachmentTag } from "./attachment-form.ts";
import { putEvidence } from "./evidence.ts";
import { contentText } from "@earendil-works/pi-ai";
import { assertRequestBudget, requestBudget } from "./budget.ts";
import { buildCompaction, projectContext } from "./context-projection.ts";
import { saveContext } from "./context.ts";
import type {
  CompactionJob,
  Consciousness,
  Context,
  Input,
  MainPromptSnapshot,
} from "./contracts.ts";
import type { HostContext } from "./host-context.ts";
import { selectInputProjection } from "./input-projection.ts";
import { BASE_SYSTEM, composeInstructions } from "./instructions.ts";
import { migrateCommitments } from "./memory.ts";
import { Agent, type AgentMessage } from "./model.ts";
import { base, hash, id, revise } from "./store.ts";

type ContextAssemblyContext = Pick<
  HostContext,
  | "memory"
  | "model"
  | "project"
  | "scheduler"
  | "session"
  | "sessionID"
  | "store"
  | "stream"
  | "tools"
  | "world"
>;

export function history(this: ContextAssemblyContext): AgentMessage[] {
  const s = this.session;
  if (!s.last_context_id) return [];
  const c = this.store.get<Context>("Context", s.last_context_id);
  if (c.adapter_version !== "pi-0.87.0" || c.provider_profile !== this.model.id)
    throw Error("INCOMPATIBLE_CONTEXT");
  let messages = this.store.read<AgentMessage[]>(c.raw_context);
  const cs = this.store.get<Consciousness>("Consciousness", s.consciousness_id);
  if (
    cs.last_job_id &&
    cs.maintenance_version !== 3 &&
    !messages.some(attachmentTag)
  ) {
    const job = this.store.get<CompactionJob>("CompactionJob", cs.last_job_id);
    const covered = this.store.read<AgentMessage[]>(job.source_refs[0]);
    if (
      hash(JSON.stringify(messages.slice(0, covered.length))) ===
      hash(JSON.stringify(covered))
    ) {
      const inputHashes = new Set(
        this.store
          .all<Input>("Input")
          .filter(
            (i) => i.session_id === this.sessionID && !i.attachments?.length,
          )
          .map((i) => i.payload.sha256),
      );
      messages = [
        {
          role: "user",
          content:
            "Working memory (source history remains queryable): " +
            JSON.stringify({
              revision: cs.revision,
              items: cs.items,
              commitments: migrateCommitments(cs),
            }),
          timestamp: Date.now(),
        },
        // Model summaries cannot certify that explicit input constraints survived.
        // Keep original user/input messages verbatim in the next model context.
        ...covered.filter(
          (m) =>
            m.role === "user" && inputHashes.has(hash(contentText(m.content))),
        ),
        ...messages.slice(covered.length),
      ];
    }
  }
  return this.project(messages);
}

export function project(
  this: ContextAssemblyContext,
  messages: AgentMessage[],
): AgentMessage[] {
  return projectContext({
    store: this.store,
    sessionID: this.sessionID,
    consciousness: this.memory(),
    messages,
  });
}

export function crop(
  this: ContextAssemblyContext,
  original: AgentMessage[],
  eligible: number,
): AgentMessage[] {
  const cs = this.memory();
  const candidate = buildCompaction({
    store: this.store,
    sessionID: this.sessionID,
    consciousness: { ...cs, revision: cs.revision + 1 },
    messages: original,
    protectedFromIndex: eligible,
    model: this.model,
    searchReady:
      this.world?.memorySearch?.state === "ready" &&
      this.world.memorySearch.indexedSequence >= this.store.sequence,
  });
  if (!candidate) return this.project(original);
  const sourceRef = putEvidence(this.store, candidate.source),
    messagesRef = putEvidence(this.store, candidate.replacement);
  if (
    cs.context_compaction?.source_ref.sha256 === sourceRef.sha256 &&
    cs.context_compaction.messages_ref.sha256 === messagesRef.sha256
  )
    return this.project(original);
  const before = requestBudget(this.model, this.project(original)),
    after = requestBudget(this.model, candidate.projected);
  if (after.estimated_tokens >= before.estimated_tokens)
    return this.project(original);
  const job: CompactionJob = {
    schema_version: 1,
    record_type: "CompactionJob",
    ...base(),
    session_id: this.sessionID,
    state: "COMMITTED",
    base_revision: cs.revision,
    source_refs: [sourceRef],
    source_event_ids: [],
    covered_event_ids: [],
    candidate_ref: messagesRef,
    validation_errors: [],
    mode: "CONTEXT_COMPACTION",
    policy_id: before.policy_id,
    source_end_sequence: cs.covered_event_sequence ?? 0,
    target_reached: candidate.targetReached,
  };
  this.store.commit(
    [
      job,
      revise(cs, {
        ...(candidate.inputProjectionRef
          ? { input_projection_ref: candidate.inputProjectionRef }
          : {}),
        context_compaction: {
          ...(candidate.source.some(attachmentTag)
            ? { attachment_form_version: 1 as const }
            : {}),
          job_id: job.id,
          source_ref: sourceRef,
          messages_ref: messagesRef,
          source_end_sequence: cs.covered_event_sequence ?? 0,
        },
      }),
    ],
    [
      this.store.event("context.compacted", {
        job_id: job.id,
        before,
        after,
        target_reached: candidate.targetReached,
        reason: candidate.targetReached
          ? "TARGET_REACHED"
          : "PRESERVED_INPUT_OR_ACTIVE_PROTOCOL_EXCEEDS_TARGET",
      }),
    ],
  );
  return this.project(original);
}

export function prepareSettingsInputs(
  this: ContextAssemblyContext,
  applicationID: string,
  source: import("./settings-memory.ts").SettingsSource,
  messages: AgentMessage[],
  content: string,
) {
  const agent = new Agent({
    initialState: {
      model: this.model,
      systemPrompt:
        composeInstructions(content) + this.scheduler.scopes.promptContext(),
      tools: this.tools(id()),
    },
    streamFn: this.stream,
  });
  const system = agent.state.messages[0];
  const selected = selectInputProjection({
    store: this.store,
    consciousness: this.memory(),
    messages: [system, ...messages],
    model: this.model,
    protectedFromIndex: messages.length + 1,
    searchReady:
      this.world?.memorySearch?.state === "ready" &&
      this.world.memorySearch.indexedSequence >= this.store.sequence,
    pending: { id: applicationID, source },
  });
  return { ...selected, messages: selected.messages.slice(1) };
}

export function prepareSettingsContext(
  this: ContextAssemblyContext,
  applicationID: string,
  content: string,
  instructionsRevision: number,
  messages: AgentMessage[],
  memoryRevision: number,
) {
  const loopID = id();
  const agent = new Agent({
    streamFn: this.stream,
    initialState: {
      model: this.model,
      systemPrompt:
        composeInstructions(content) + this.scheduler.scopes.promptContext(),
      tools: this.tools(loopID),
    },
  });
  const system = agent.state.messages[0];
  if (system.role !== "system") throw Error("SYSTEM_MESSAGE_MISSING");
  const snapshot: MainPromptSnapshot = {
    schema_version: 1,
    record_type: "MainPromptSnapshot",
    ...base(loopID),
    session_id: this.sessionID,
    base_prompt_version: hash(BASE_SYSTEM),
    instructions_revision: instructionsRevision,
    system_prompt_hash: hash(contentText(system.content)),
    system_message: this.store.put(system),
    settings_application_id: applicationID,
  };
  assertRequestBudget(this.model, [system, ...messages]);
  this.store.commit([snapshot]);
  return saveContext(
    this.store,
    [system, ...messages],
    { session_id: this.sessionID, task_id: null, execution_id: null },
    "MAIN",
    this.model.id,
    loopID,
    this.model.contextWindow,
    { consciousnessRevision: memoryRevision, inputIDs: [] },
  );
}
