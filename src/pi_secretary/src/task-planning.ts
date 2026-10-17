import { Ajv2020 } from "ajv/dist/2020.js";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  Checkpoint,
  DecisionRequest,
  Execution,
  Operation,
  Precondition,
  ProgramRegistration,
  SafetyRule,
  TaskPlan,
  TaskProposal,
  TaskResult,
} from "./contracts.ts";
import { terminal } from "./execution-utils.ts";
import { type AgentMessage } from "./model.ts";
import type { SchedulerContext } from "./scheduler-context.ts";
import { directoryRoot, relativePath } from "./scopes.ts";
import { base, hash, id, now, revise, shape } from "./store.ts";

type TaskPlanningContext = Pick<
  SchedulerContext,
  | "assertAccess"
  | "continuationParent"
  | "continueTask"
  | "detail"
  | "initialize"
  | "model"
  | "proposalFor"
  | "requestStatus"
  | "safePath"
  | "scopes"
  | "sourceRefs"
  | "store"
  | "validateWorkspace"
  | "workspace"
>;

export function propose(
  this: TaskPlanningContext,
  goal: string,
  requestID = id(),
  sessionID: string,
  options: {
    scopeID?: string | null;
    reuse?: string | null;
    programID?: string | null;
    at?: string | null;
    interval?: number | null;
    parent?: string | null;
    materials?: string[] | null;
    constraints?: string[] | null;
    acceptance?: string[] | null;
    deadline?: string | null;
    preconditions?: Precondition[] | null;
  } = {},
): TaskPlan {
  if (!goal.trim()) throw Error("EMPTY_GOAL");
  if (options.reuse != null && !options.reuse.trim())
    throw Error("INVALID_REUSE_TASK");
  const normalized = Object.fromEntries(
    Object.entries(options)
      .filter(([, v]) => v != null)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const fingerprint = hash(
    JSON.stringify({ version: 2, goal, options: normalized, sessionID }),
  );
  // Preserve the old direct-call and Host field order when replaying v1 receipts.
  const { reuse: _reuse, ...legacyOptions } = options;
  const hostOptions = {
    programID: options.programID ?? undefined,
    at: options.at ?? undefined,
    interval: options.interval ?? undefined,
    parent: options.parent ?? undefined,
    materials: options.materials ?? undefined,
    constraints: options.constraints ?? undefined,
    acceptance: options.acceptance ?? undefined,
    deadline: options.deadline ?? undefined,
  };
  const legacy =
    options.reuse || options.scopeID != null
      ? []
      : [
          legacyOptions,
          ...(options.preconditions == null ? [hostOptions] : []),
        ].map((options) => hash(JSON.stringify({ goal, options, sessionID })));
  const old = this.store.receipt<string>(requestID, fingerprint, legacy);
  if (old) return this.store.get<TaskPlan>("TaskPlan", old);
  if (options.at && !Number.isFinite(Date.parse(options.at)))
    throw Error("INVALID_TRIGGER");
  if (
    options.interval != null &&
    (!Number.isFinite(options.interval) || options.interval < 1)
  )
    throw Error("INVALID_INTERVAL");
  if (
    options.deadline != null &&
    !Number.isFinite(Date.parse(options.deadline))
  )
    throw Error("INVALID_DEADLINE");
  if (options.reuse)
    return this.continueTask(goal, requestID, sessionID, options, fingerprint);
  const workScope = this.scopes.active(options.scopeID);
  const program = options.programID
    ? this.store.get<ProgramRegistration>(
        "ProgramRegistration",
        options.programID,
      )
    : null;
  if (program && program.state !== "ENABLED") throw Error("PROGRAM_DISABLED");
  const safety: SafetyRule = {
    record_type: "SafetyRule",
    schema_version: 1,
    ...base(),
    created_by: "MAIN",
    max_known_failure_retries: 0,
    retryable_error_codes: [],
    require_no_effect_for_retry: true,
    stop_on_unknown: true,
    extra_checks: [],
  };
  const proposal: TaskProposal = {
    schema_version: 1,
    record_type: "TaskProposal",
    scope_id: workScope?.id ?? null,
    request_id: requestID,
    request_hash: fingerprint,
    submitted_at: now(),
    session_id: sessionID,
    goal,
    constraints: options.constraints ?? [],
    acceptance_criteria: options.acceptance ?? [
      "Return a saved, queryable result and evidence",
    ],
    trigger: {
      kind: options.at ? "AT" : options.interval ? "INTERVAL" : "IMMEDIATE",
      at: options.at ?? null,
      interval_seconds: options.interval ?? null,
      anchor_at: options.interval ? now() : null,
      timezone: "Etc/UTC",
      event_source: null,
      predicate_id: null,
      missed_policy: "REPORT_ONLY",
      overlap_policy: "QUEUE",
    },
    preconditions: options.preconditions ?? [],
    executor: program
      ? {
          kind: "PROGRAM",
          agent_profile: null,
          program_id: program.id,
          program_revision: program.revision,
          parameters: { goal },
        }
      : {
          kind: "AGENT",
          agent_profile: this.model.id,
          program_id: null,
          program_revision: null,
          parameters: {},
        },
    feedback_policy: {
      terminal: true,
      on_change: false,
      on_blocker: true,
      on_unknown: true,
      milestones: [],
    },
    deadline: options.deadline ?? null,
    context_refs: (options.materials ?? []).map((text) =>
      this.store.put(text, "text/plain"),
    ),
    source_context_refs: (options.materials ?? []).map((text) =>
      this.store.put(text, "text/plain"),
    ),
    parent_execution_id: options.parent ?? null,
    safety_rule_id: safety.id,
    reuse_task_id: null,
  };
  shape(proposal);
  if (options.parent) {
    const parent = this.store.get<Execution>("Execution", options.parent);
    if (!terminal(parent) || parent.retention_state === "RETIRED")
      throw Error("PARENT_NOT_RESUMABLE");
  }
  const parent = options.parent
    ? this.store.get<Execution>("Execution", options.parent)
    : null;
  if (parent) {
    const parentPlan = this.store.get<TaskPlan>("TaskPlan", parent.task_id);
    this.assertAccess(parentPlan, sessionID);
    const original = this.proposalFor(parent);
    const sources = this.sourceRefs(original);
    proposal.source_context_refs!.push(...sources);
    proposal.context_refs.push(...sources);
    if (parent.checkpoint_id) {
      const cp = this.store.get<Checkpoint>("Checkpoint", parent.checkpoint_id);
      if (cp.raw_context) proposal.context_refs.push(cp.raw_context);
    }
    if (parent.result_id)
      proposal.context_refs.push(
        this.store.get<TaskResult>("TaskResult", parent.result_id).detail_ref,
      );
  }
  const taskID = id();
  const plan: TaskPlan = {
    schema_version: 1,
    record_type: "TaskPlan",
    scope_id: proposal.scope_id ?? null,
    ...base(taskID),
    state: "INITIALIZING",
    proposal_request_id: requestID,
    proposal_ref: this.store.put(proposal),
    workspace: taskID,
    trigger: proposal.trigger,
    preconditions: proposal.preconditions,
    executor: proposal.executor,
    feedback_policy: proposal.feedback_policy,
    next_due_at:
      proposal.trigger.kind === "IMMEDIATE" ? null : (options.at ?? now()),
    pending_occurrences: [],
    pending_requests:
      proposal.trigger.kind === "IMMEDIATE"
        ? [
            {
              request_id: requestID,
              occurrence_key: requestID,
              due_at: proposal.submitted_at,
              proposal_ref: this.store.put(proposal),
            },
          ]
        : [],
    active_execution_ids: [],
    deadline: proposal.deadline,
    safety_rule_id: safety.id,
    initialization_error: null,
  };
  this.store.commit(
    [
      safety,
      plan,
      ...(parent
        ? [
            revise(parent, {
              pending_followup_ids: [...parent.pending_followup_ids, taskID],
              last_activity_at: now(),
            }),
          ]
        : []),
    ],
    [
      this.store.event("task.request.accepted", {
        request_id: requestID,
        task_id: taskID,
        occurrence_key:
          proposal.trigger.kind === "IMMEDIATE" ? requestID : null,
        proposal_ref: plan.proposal_ref,
      }),
      this.store.event(
        "task.proposed",
        proposal,
        { session_id: sessionID, task_id: taskID, execution_id: null },
        "MAIN",
      ),
    ],
    { request: requestID, hash: fingerprint, value: taskID },
  );
  this.initialize(taskID);
  return this.store.get<TaskPlan>("TaskPlan", taskID);
}

export function proposalFor(
  this: TaskPlanningContext,
  e: Execution,
): TaskProposal {
  return this.store.read<TaskProposal>(
    e.proposal_ref ??
      this.store.taskPlanAt(e.task_id, e.plan_revision).proposal_ref,
  );
}

export function sourceRefs(this: TaskPlanningContext, proposal: TaskProposal) {
  if (proposal.source_context_refs) return proposal.source_context_refs;
  // Old proposals mixed source materials and derived checkpoint/result evidence.
  const derived = new Set([
    ...this.store
      .all<Checkpoint>("Checkpoint")
      .flatMap((cp) => (cp.raw_context ? [cp.raw_context.sha256] : [])),
    ...this.store.all<TaskResult>("TaskResult").map((r) => r.detail_ref.sha256),
  ]);
  return proposal.context_refs.filter((ref) => !derived.has(ref.sha256));
}

export function promptMaterials(
  this: TaskPlanningContext,
  proposal: TaskProposal,
) {
  const checkpoints = new Set(
    this.store
      .all<Checkpoint>("Checkpoint")
      .flatMap((cp) => (cp.raw_context ? [cp.raw_context.sha256] : [])),
  );
  const sources = new Set(this.sourceRefs(proposal).map((ref) => ref.sha256));
  return proposal.context_refs.map((ref) => {
    if (!checkpoints.has(ref.sha256) || sources.has(ref.sha256))
      return this.store.contentText(ref);
    const messages = this.store.read<AgentMessage[]>(ref);
    // Preserve the immutable raw reference, but do not recursively embed prior system/assignment packets.
    return {
      kind: "parent_execution_evidence",
      raw_context_ref: ref,
      messages: messages
        .filter((m) => m.role === "assistant" || m.role === "toolResult")
        .map((m) => ({
          role: m.role,
          ...(m.role === "toolResult"
            ? { toolName: m.toolName, isError: m.isError }
            : {}),
          content: Array.isArray(m.content)
            ? m.content.filter((part) => part.type !== "thinking")
            : m.content,
        })),
    };
  });
}

export function assertAccess(
  this: TaskPlanningContext,
  p: TaskPlan,
  sessionID: string,
) {
  if (this.store.read<TaskProposal>(p.proposal_ref).session_id !== sessionID)
    throw Error("TASK_NOT_ACCESSIBLE");
}

export function validateWorkspace(this: TaskPlanningContext, p: TaskPlan) {
  if (p.workspace !== p.id) throw Error("WORKSPACE_OWNER");
  const root = path.join(this.workspace, p.workspace);
  for (const dir of [root, path.join(root, "executions")]) {
    if (
      !fs.existsSync(dir) ||
      !fs.lstatSync(dir).isDirectory() ||
      fs.lstatSync(dir).isSymbolicLink()
    )
      throw Error("WORKSPACE_MISSING_OR_UNSAFE");
  }
  const manifest = path.join(root, "workspace.json");
  if (
    fs.lstatSync(manifest).isSymbolicLink() ||
    JSON.parse(fs.readFileSync(manifest, "utf8")).task_id !== p.id
  )
    throw Error("WORKSPACE_OWNER");
  // Also validate the ancestors using the same policy as execution file tools.
  const previous = this.store
    .all<Execution>("Execution")
    .filter((e) => e.task_id === p.id)
    .at(-1);
  const future = p.scope_id ? this.scopes.get(p.scope_id) : null;
  if (future?.kind === "DIRECTORY") {
    directoryRoot(this.store, future.root_path!);
    return;
  }
  if (
    previous?.workspace_binding?.kind === "DIRECTORY" &&
    future?.kind === "NONE"
  ) {
    // The first NONE execution creates its private work directory at binding.
    relativePath(root, "work/workspace-validation");
    return;
  }
  if (previous) this.safePath(previous, "workspace-validation");
  else relativePath(root, "workspace-validation");
}

export function continuationParent(
  this: TaskPlanningContext,
  p: TaskPlan,
  parentID: string,
  sessionID: string,
) {
  this.assertAccess(p, sessionID);
  if (p.state !== "ACTIVE") throw Error("PLAN_NOT_ACTIVE");
  const es = this.store
    .all<Execution>("Execution")
    .filter((e) => e.task_id === p.id);
  const parent = this.store.get<Execution>("Execution", parentID);
  if (parent.task_id !== p.id) throw Error("PARENT_TASK_MISMATCH");
  if (es.some((e) => !terminal(e)) || (p.pending_requests?.length ?? 0))
    throw Error("TASK_BUSY");
  if (!terminal(parent) || parent.retention_state === "RETIRED")
    throw Error("PARENT_NOT_RESUMABLE");
  if (es.at(-1)?.id !== parent.id) throw Error("PARENT_NOT_LATEST");
  if (
    es.some((e) => e.unknown_operation_ids.length) ||
    this.store
      .all<Operation>("Operation")
      .some(
        (o) =>
          o.scope.task_id === p.id &&
          ["WAIT_AUTH", "AUTHORIZED", "DISPATCHED", "RESULT_UNKNOWN"].includes(
            o.state,
          ),
      )
  )
    throw Error("UNRESOLVED_OPERATION");
  if (
    p.pending_occurrences.length ||
    (p.next_due_at && Date.parse(p.next_due_at) <= Date.now())
  )
    throw Error("TASK_BUSY_PERIODIC");
  this.validateWorkspace(p);
  return parent;
}

export function continueTask(
  this: TaskPlanningContext,
  goal: string,
  requestID: string,
  sessionID: string,
  options: Parameters<SchedulerContext["propose"]>[3],
  fingerprint: string,
): TaskPlan {
  if (!options?.parent) throw Error("PARENT_REQUIRED");
  if (options.at != null || options.interval != null)
    throw Error("REUSE_TRIGGER_NOT_ALLOWED");
  const p = this.store.get<TaskPlan>("TaskPlan", options.reuse!);
  if (options.scopeID != null && options.scopeID !== p.scope_id)
    throw Error("SCOPE_CHANGE_NOT_ALLOWED");
  this.scopes.active(p.scope_id);
  const parent = this.continuationParent(p, options.parent, sessionID);
  const original = this.proposalFor(parent);
  if (
    options.programID != null &&
    options.programID !== original.executor.program_id
  )
    throw Error("EXECUTOR_CHANGE_NOT_ALLOWED");
  if (original.executor.kind === "PROGRAM") {
    const program = this.store.get<ProgramRegistration>(
      "ProgramRegistration",
      original.executor.program_id!,
    );
    if (
      program.state !== "ENABLED" ||
      program.revision !== original.executor.program_revision ||
      hash(fs.readFileSync(program.entrypoint)) !== program.code_digest
    )
      throw Error("PROGRAM_CHANGED");
    if (
      !new Ajv2020().validate(
        this.store.read<object>(program.parameters_schema),
        { ...original.executor.parameters, goal },
      )
    )
      throw Error("INVALID_PROGRAM_PARAMETERS");
  }
  const sources = [
    ...new Map(
      [
        ...this.sourceRefs(original),
        ...(options.materials ?? []).map((t) =>
          this.store.put(t, "text/plain"),
        ),
      ].map((ref) => [ref.sha256, ref]),
    ).values(),
  ];
  const refs = [...sources];
  if (parent.checkpoint_id) {
    const cp = this.store.get<Checkpoint>("Checkpoint", parent.checkpoint_id);
    if (cp.raw_context) refs.push(cp.raw_context);
  }
  if (parent.result_id) {
    const r = this.store.get<TaskResult>("TaskResult", parent.result_id);
    refs.push(r.detail_ref);
    for (const artifact of r.artifacts) this.store.bytes(artifact.content);
  }
  refs.push(
    this.store.put({
      parent_execution_id: parent.id,
      decisions: this.store
        .all<DecisionRequest>("DecisionRequest")
        .filter((d) => d.execution_id === parent.id && d.state === "ANSWERED"),
      operations: this.store
        .all<Operation>("Operation")
        .filter((o) => o.scope.execution_id === parent.id)
        .map((o) => ({
          id: o.id,
          state: o.state,
          action: o.action,
          receipt: o.receipt ? this.store.read(o.receipt) : null,
        })),
    }),
  );
  for (const ref of refs) this.store.bytes(ref);
  this.store.get<SafetyRule>("SafetyRule", original.safety_rule_id);
  const proposal: TaskProposal = {
    ...original,
    request_id: requestID,
    request_hash: fingerprint,
    submitted_at: now(),
    session_id: sessionID,
    goal,
    constraints: options.constraints ?? original.constraints,
    acceptance_criteria: options.acceptance ?? original.acceptance_criteria,
    preconditions: options.preconditions ?? original.preconditions,
    deadline: options.deadline ?? original.deadline,
    executor: {
      ...original.executor,
      parameters:
        original.executor.kind === "PROGRAM"
          ? { ...original.executor.parameters, goal }
          : original.executor.parameters,
    },
    trigger: {
      ...original.trigger,
      kind: "IMMEDIATE",
      at: null,
      interval_seconds: null,
      anchor_at: null,
    },
    context_refs: [...new Map(refs.map((r) => [r.sha256, r])).values()],
    source_context_refs: sources,
    parent_execution_id: parent.id,
    reuse_task_id: p.id,
  };
  shape(proposal);
  const ref = this.store.put(proposal);
  const pending = {
    request_id: requestID,
    occurrence_key: requestID,
    due_at: proposal.submitted_at,
    proposal_ref: ref,
  };
  this.store.commit(
    [
      revise(p, { pending_requests: [pending] }),
      revise(parent, {
        pending_followup_ids: [...parent.pending_followup_ids, requestID],
        last_activity_at: now(),
      }),
    ],
    [
      this.store.event(
        "task.request.accepted",
        {
          request_id: requestID,
          task_id: p.id,
          occurrence_key: requestID,
          proposal_ref: ref,
          input: { goal, options, sessionID },
        },
        { session_id: sessionID, task_id: p.id, execution_id: null },
        "MAIN",
      ),
    ],
    { request: requestID, hash: fingerprint, value: p.id },
  );
  return this.store.get<TaskPlan>("TaskPlan", p.id);
}

export function requestStatus(this: TaskPlanningContext, requestID: string) {
  const event = this.store.logs.find(
    (l) =>
      l.event_type === "task.request.accepted" &&
      this.store.read<{ request_id: string }>(l.payload).request_id ===
        requestID,
  );
  if (!event) return null; // v1 receipt remains a valid task association.
  const accepted = this.store.read<{
    request_id: string;
    task_id: string;
    occurrence_key: string | null;
    proposal_ref: TaskPlan["proposal_ref"];
  }>(event.payload);
  const e = this.store
    .all<Execution>("Execution")
    .find(
      (e) =>
        e.task_id === accepted.task_id &&
        e.occurrence_key === accepted.occurrence_key,
    );
  const stopped = this.store.logs.findLast(
    (l) =>
      l.event_type === "task.request.removed" &&
      this.store.read<{ request_id: string }>(l.payload).request_id ===
        requestID,
  );
  return {
    ...accepted,
    execution_id: e?.id ?? null,
    state: e?.state ?? (stopped ? "CANCELLED_OR_REJECTED" : "ACCEPTED"),
    reason: stopped ? this.store.read(stopped.payload) : null,
  };
}

export function query(
  this: TaskPlanningContext,
  sessionID: string,
  taskID?: string | null,
  executionID?: string | null,
) {
  if (taskID && executionID) throw Error("AMBIGUOUS_QUERY");
  if (executionID) {
    const e = this.store.get<Execution>("Execution", executionID);
    this.assertAccess(
      this.store.get<TaskPlan>("TaskPlan", e.task_id),
      sessionID,
    );
    return this.detail(e.id);
  }
  const view = (p: TaskPlan, detail: boolean) => {
    const baseline = this.store.read<TaskProposal>(p.proposal_ref);
    const es = this.store
      .all<Execution>("Execution")
      .filter((e) => e.task_id === p.id);
    const latest = es.at(-1);
    let reason: string | null = null;
    try {
      this.scopes.active(p.scope_id);
      if (!latest) throw Error("NO_PARENT_EXECUTION");
      this.continuationParent(p, latest.id, sessionID);
    } catch (error) {
      reason = (error as Error).message;
    }
    const result = latest?.result_id
      ? this.store.get<TaskResult>("TaskResult", latest.result_id)
      : null;
    const effective = latest ? this.proposalFor(latest) : null;
    const accepted = this.store.logs.findLast(
      (l) =>
        l.event_type === "task.request.accepted" &&
        this.store.read<{ task_id: string }>(l.payload).task_id === p.id,
    );
    const latestRequest = accepted
      ? this.requestStatus(
          this.store.read<{ request_id: string }>(accepted.payload).request_id,
        )
      : null;
    return {
      task_id: p.id,
      scope_id: p.scope_id ?? null,
      state: p.state,
      goal: baseline.goal,
      latest_execution_id: latest?.id ?? null,
      latest_state: latest?.state ?? null,
      active_execution_ids: es.filter((e) => !terminal(e)).map((e) => e.id),
      pending_requests: p.pending_requests ?? [],
      can_continue: reason === null,
      continuation_blocker: reason,
      latest_request: latestRequest,
      ...(detail
        ? {
            baseline,
            effective_proposal: effective,
            proposal_ref: latest?.proposal_ref ?? p.proposal_ref,
            result,
            details: latest ? this.detail(latest.id) : null,
            decisions: this.store
              .all<DecisionRequest>("DecisionRequest")
              .filter(
                (d) =>
                  es.some((e) => e.id === d.execution_id) && d.state === "OPEN",
              ),
          }
        : { result_summary: result?.summary ?? null }),
    };
  };
  if (taskID) {
    const p = this.store.get<TaskPlan>("TaskPlan", taskID);
    this.assertAccess(p, sessionID);
    return view(p, true);
  }
  const plans = this.store
    .all<TaskPlan>("TaskPlan")
    .filter(
      (p) =>
        this.store.read<TaskProposal>(p.proposal_ref).session_id === sessionID,
    );
  return {
    plans: plans.map((p) => view(p, false)),
    programs: this.store.all<ProgramRegistration>("ProgramRegistration"),
  };
}

export function continuationStatus(
  this: TaskPlanningContext,
  taskID: string,
  executionID: string | undefined,
  sessionID: string,
) {
  const p = this.store.get<TaskPlan>("TaskPlan", taskID);
  this.assertAccess(p, sessionID);
  try {
    this.scopes.active(p.scope_id);
    if (!executionID) throw Error("NO_PARENT_EXECUTION");
    this.continuationParent(p, executionID, sessionID);
    return { allowed: true, reason: null };
  } catch (error) {
    return { allowed: false, reason: (error as Error).message.split(":")[0] };
  }
}
