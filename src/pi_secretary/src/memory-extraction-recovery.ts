import type { Api, Model, AssistantMessage } from "@earendil-works/pi-ai";
import type {
  Context,
  ExtractionRecovery,
  MemoryCommitment,
  ModelCall,
  ObjectRef,
  RecoveryBinding,
  RecoveryRequest,
  Scope,
} from "./contracts.ts";
import { extractionSourceKey } from "./extraction-identity.ts";
import { performance } from "node:perf_hooks";
import { requestBudget } from "./budget.ts";
import type { AgentMessage, StreamFn } from "./model.ts";
import {
  base,
  hash,
  id,
  revise,
  shapeDefinition,
  type Store,
} from "./store.ts";
import {
  activeExtractions,
  EXTRACTION_IMPLEMENTATION,
  EXTRACTION_POLICY,
  EXTRACTION_SYSTEM,
  extractionConfigHash,
  extractionRequest,
  parseExtractionResponse,
} from "./memory-extraction.ts";

export type { RecoveryBinding, RecoveryRequest } from "./contracts.ts";
export type RecoveryOptions = {
  store: Store;
  model: Model<Api>;
  sessionID: string;
  consciousnessRevision: number;
  runtimeConfigHash?: string;
};
export type RecoveryPreflight = {
  group_key: string;
  attempt_id: string;
  loop_id: string;
  status: "BLOCKED" | "READY" | "RECONCILE" | "SUCCEEDED";
  reason: string;
  binding: RecoveryBinding | null;
};
export type RecoveryResult = {
  recovery_id: string;
  status: "CLAIMED" | "SUCCEEDED" | "FAILED" | "BLOCKED";
  quotes: string[];
  reason: string | null;
};
type Attempt = {
  key: string;
  attempt_id?: string;
  policy?: string;
  implementation_version?: string;
  config_hash?: string;
  consciousness_revision?: number;
  source_hash?: string;
  source_ref?: ObjectRef;
  existing_ref?: ObjectRef;
  source_keys?: string[];
  loop_id?: string;
  index?: number;
  call_id?: string | null;
  quotes?: string[];
  error?: string;
  parent_attempt_id?: string | null;
  recovery_request_id?: string | null;
};
function history(store: Store, sessionID: string) {
  return store.logs
    .filter(
      (e) =>
        e.scope.session_id === sessionID &&
        e.event_type.startsWith("memory.extraction."),
    )
    .map((e) => ({
      type: e.event_type,
      scope: e.scope,
      value: store.read<Attempt>(e.payload),
    }));
}
function inspect(options: RecoveryOptions, groupKey: string) {
  try {
    return inspectEvidence(options, groupKey);
  } catch {
    // Missing, malformed or unreadable durable evidence cannot authorize a send
    // or an owner commit. Keep preflight available for the other groups.
    const view: RecoveryPreflight = {
      group_key: groupKey,
      attempt_id: "",
      loop_id: "",
      status: "BLOCKED",
      reason: "INVALID_DURABLE_EVIDENCE",
      binding: null,
    };
    return { view, attempt: undefined, call: undefined, quotes: undefined };
  }
}
function inspectEvidence(options: RecoveryOptions, groupKey: string) {
  const { store, sessionID, model } = options;
  const entries = history(store, sessionID).filter(
    (e) => e.value.key === groupKey,
  );
  const lastStart = entries.findLast(
    (e) => e.type === "memory.extraction.started",
  );
  const attempt = lastStart?.value;
  const view: RecoveryPreflight = {
    group_key: groupKey,
    attempt_id: attempt?.attempt_id ?? "",
    loop_id: attempt?.loop_id ?? "",
    status: "BLOCKED",
    reason: "LEGACY_OR_MISSING_EXACT_EVIDENCE",
    binding: null,
  };
  const blocked = (reason: string) => ({
    view: { ...view, status: "BLOCKED" as const, reason },
    attempt,
    call: undefined as ModelCall | undefined,
    quotes: undefined as string[] | undefined,
  });
  if (
    !attempt?.attempt_id ||
    !attempt.source_ref ||
    !attempt.existing_ref ||
    !attempt.source_hash ||
    !attempt.config_hash ||
    !attempt.implementation_version ||
    !attempt.policy ||
    attempt.consciousness_revision === undefined
  )
    return blocked(view.reason);
  view.binding = {
    group_key: groupKey,
    attempt_id: attempt.attempt_id,
    expected_revision: attempt.consciousness_revision,
    policy: attempt.policy,
    implementation_version: attempt.implementation_version,
    config_hash: attempt.config_hash,
    source_hash: attempt.source_hash,
    model_call_id: null,
    model_request_hash: null,
    actual_payload_hash: null,
  };
  if (
    attempt.policy !== EXTRACTION_POLICY ||
    attempt.implementation_version !== EXTRACTION_IMPLEMENTATION
  )
    return blocked("POLICY_OR_IMPLEMENTATION_CHANGED");
  if (
    attempt.config_hash !==
    extractionConfigHash(model, options.runtimeConfigHash)
  )
    return blocked("CONFIG_CHANGED");
  if (
    hash(JSON.stringify(store.read(attempt.source_ref))) !== attempt.source_hash
  )
    return blocked("SOURCE_EVIDENCE_CHANGED");
  const frozenSource = store.read(attempt.source_ref);
  if (
    hash(
      JSON.stringify({
        policy: attempt.policy,
        session: sessionID,
        source: frozenSource,
      }),
    ) !== groupKey
  )
    return blocked("GROUP_IDENTITY_MISMATCH");
  if (
    attempt.source_keys?.length &&
    (!Array.isArray(frozenSource) ||
      JSON.stringify(frozenSource.map(extractionSourceKey)) !==
        JSON.stringify(attempt.source_keys))
  )
    return blocked("SOURCE_IDENTITY_MISMATCH");
  const sameScope = (value: Scope) =>
    value.session_id === sessionID &&
    value.task_id === null &&
    value.execution_id === null;
  const own = entries.filter((e) => e.value.attempt_id === attempt.attempt_id);
  if (
    own.some(
      (e) =>
        !sameScope(e.scope) ||
        e.value.loop_id !== attempt.loop_id ||
        e.value.source_hash !== attempt.source_hash ||
        e.value.config_hash !== attempt.config_hash ||
        e.value.policy !== attempt.policy ||
        e.value.implementation_version !== attempt.implementation_version ||
        e.value.consciousness_revision !== attempt.consciousness_revision ||
        e.value.source_ref?.sha256 !== attempt.source_ref?.sha256 ||
        e.value.existing_ref?.sha256 !== attempt.existing_ref?.sha256,
    )
  )
    return blocked("ATTEMPT_EVIDENCE_MISMATCH");
  const success = own.findLast((e) => e.type === "memory.extraction.succeeded");
  if (
    !success &&
    attempt.consciousness_revision !== options.consciousnessRevision
  )
    return blocked("REVISION_CHANGED");
  if (activeExtractions.get(store)?.has(attempt.attempt_id))
    return blocked("OLD_EXECUTION_ACTIVE");
  const linked = own.filter((e) => e.type === "memory.extraction.call_linked");
  if (linked.length > 1) return blocked("AMBIGUOUS_MODEL_CALL");
  const callID = linked[0]?.value.call_id;
  const call = callID ? store.find<ModelCall>("ModelCall", callID) : undefined;
  if (success && callID && success.value.call_id !== callID)
    return blocked("SUCCESS_MODEL_CALL_BINDING_MISMATCH");
  if (callID && (!call || !sameScope(call.scope)))
    return blocked("MODEL_CALL_BINDING_MISMATCH");
  if (call) {
    const payloads = store.logs
      .filter((e) => e.event_type === "model.payload")
      .map((e) =>
        store.read<{
          call_id: string;
          context_id: string;
          payload_ref: ObjectRef;
        }>(e.payload),
      )
      .filter((p) => p.call_id === call.id);
    if (
      payloads.length > 1 ||
      payloads.some((p) => p.context_id !== call.context_id)
    )
      return blocked("AMBIGUOUS_ACTUAL_PAYLOAD");
    if (
      store.logs.some(
        (e) =>
          e.event_type === "model.payload" &&
          store.read<{ call_id: string }>(e.payload).call_id === call.id &&
          !sameScope(e.scope),
      )
    )
      return blocked("MODEL_PAYLOAD_SCOPE_MISMATCH");
    if (payloads[0]) store.bytes(payloads[0].payload_ref);
    view.binding = {
      ...view.binding!,
      model_call_id: call.id,
      model_request_hash: call.request.sha256,
      actual_payload_hash: payloads[0]?.payload_ref.sha256 ?? null,
    };
  }
  if (!call) {
    if (success) return blocked("SUCCESS_MISSING_EXACT_MODEL_CALL");
    if (!own.some((e) => e.type === "memory.extraction.failed"))
      return blocked("UNKNOWN_BEFORE_MODEL_LINK");
    return {
      view: {
        ...view,
        status: "READY" as const,
        reason: "FAILED_BEFORE_MODEL_PREPARATION",
      },
      attempt,
      call,
      quotes: undefined,
    };
  }
  // Bind the linked call to its immutable original Context and exact extraction
  // request. Same-session metadata alone is not evidence of the intended call.
  const context = store.find<Context>("Context", call.context_id);
  const contextEvents = store.logs
    .filter((e) => e.event_type === "model.context")
    .map((e) => ({ scope: e.scope, value: store.read<Context>(e.payload) }))
    .filter(
      (e) => e.value.id === call.context_id || e.value.call_id === call.id,
    );
  if (
    !context ||
    contextEvents.length !== 1 ||
    !sameScope(contextEvents[0].scope) ||
    JSON.stringify(contextEvents[0].value) !== JSON.stringify(context) ||
    context.call_id !== call.id ||
    context.session_id !== sessionID ||
    context.execution_id !== null ||
    context.loop_id !== attempt.loop_id ||
    context.purpose !== "COMPACTION" ||
    context.capture_kind !== "MODEL_REQUEST" ||
    context.consciousness_revision !== attempt.consciousness_revision ||
    context.provider_profile !== model.id ||
    call.transport_attempt !== 1
  )
    return blocked("MODEL_CONTEXT_BINDING_MISMATCH");
  const request = store.read<{ messages: AgentMessage[] }>(call.request);
  const exactText = (content: unknown, expected: string) =>
    content === expected ||
    (Array.isArray(content) &&
      content.length === 1 &&
      JSON.stringify(content[0]) ===
        JSON.stringify({ type: "text", text: expected }));
  const expected = JSON.stringify({
    source: store.read(attempt.source_ref),
    existing: store.read(attempt.existing_ref),
  });
  if (
    !request ||
    Object.keys(request).some((k) => k !== "messages") ||
    !Array.isArray(request.messages) ||
    request.messages.length !== 2 ||
    request.messages[0].role !== "system" ||
    request.messages[1].role !== "user" ||
    !exactText(request.messages[0].content, EXTRACTION_SYSTEM) ||
    !exactText(request.messages[1].content, expected) ||
    request.messages.some((m) =>
      Object.keys(m).some((k) => !["role", "content", "timestamp"].includes(k)),
    ) ||
    hash(JSON.stringify(request.messages)) !== context.raw_context.sha256 ||
    context.messages.length !== request.messages.length ||
    context.messages.some(
      (m, i) =>
        m.role !== request.messages[i].role ||
        m.content.sha256 !== hash(JSON.stringify(request.messages[i])),
    ) ||
    context.tools_schema.sha256 !== hash(JSON.stringify([request.messages[0]]))
  )
    return blocked("MODEL_REQUEST_EVIDENCE_MISMATCH");
  if (
    JSON.stringify(context.request_budget) !==
    JSON.stringify(
      requestBudget(model, request.messages, {
        role: "main",
        maxTokens: Math.min(model.maxTokens, 4096),
      }),
    )
  )
    return blocked("MODEL_CONFIG_EVIDENCE_MISMATCH");
  if (success && !call.response)
    return blocked("SUCCESS_MISSING_MODEL_RESPONSE");
  if (call.response) {
    const response = store.read<AssistantMessage>(call.response);
    if (
      !["stop", "length", "toolUse"].includes(response.stopReason) ||
      response.errorMessage
    )
      return blocked("UNKNOWN_PROVIDER_ERROR_OR_ABORT");
    try {
      const quotes = parseExtractionResponse(
        store.read<AssistantMessage>(call.response),
      );
      if (success) {
        if (JSON.stringify(success.value.quotes) !== JSON.stringify(quotes))
          return blocked("SUCCESS_RESPONSE_QUOTES_MISMATCH");
        return {
          view: {
            ...view,
            status: "SUCCEEDED" as const,
            reason: "EXTRACTION_RESULT_ALREADY_COMMITTED",
          },
          attempt,
          call,
          quotes,
        };
      }
      return {
        view: {
          ...view,
          status: "RECONCILE" as const,
          reason: "COMPLETE_RESPONSE_SAVED",
        },
        attempt,
        call,
        quotes,
      };
    } catch {
      if (success) return blocked("SUCCESS_INVALID_MODEL_RESPONSE");
      // A saved terminal provider result proves the old transport finished; a
      // timeout/throw with no result proves no such thing.
      return {
        view: {
          ...view,
          status: "READY" as const,
          reason: "TERMINAL_RESPONSE_INVALID",
        },
        attempt,
        call,
        quotes: undefined,
      };
    }
  }
  if (call.state === "PREPARED")
    return {
      view: { ...view, status: "READY" as const, reason: "PREPARED_NOT_SENT" },
      attempt,
      call,
      quotes: undefined,
    };
  return blocked("UNKNOWN_TRANSPORT_OUTCOME_NOT_ISOLATED");
}
export function listExtractionRecoveryGroups(
  options: RecoveryOptions,
): RecoveryPreflight[] {
  return [
    ...new Set(
      history(options.store, options.sessionID)
        .map((e) => e.value.key)
        .filter(Boolean),
    ),
  ].map((groupKey) => preflightExtractionRecovery({ ...options, groupKey }));
}
export function preflightExtractionRecovery(
  options: RecoveryOptions & { groupKey: string },
): RecoveryPreflight {
  const view = inspect(options, options.groupKey).view;
  if (view.status === "BLOCKED" || !view.binding) return view;
  return { ...view, binding: issueAuthorization(options, view.binding) };
}
const result = (r: ExtractionRecovery): RecoveryResult => ({
  recovery_id: r.id,
  status: r.state,
  quotes: r.quotes,
  reason: r.error,
});
/** Called only by the explicit user command surface. Persist the claim before any await. */
export async function recoverExtractionOnce(
  options: RecoveryOptions & { stream: StreamFn; request: RecoveryRequest },
): Promise<RecoveryResult> {
  const { store, request, sessionID } = options;
  shapeDefinition("RecoveryRequest", request);
  const requestHash = hash(
    JSON.stringify({
      session_id: sessionID,
      request: { request_id: request.request_id, ...requestBinding(request) },
    }),
  );
  const receipt = store.receipt<string>(request.request_id, requestHash);
  if (receipt) {
    const saved = store.get<ExtractionRecovery>("ExtractionRecovery", receipt);
    return saved.state === "CLAIMED"
      ? reconcileConsumed(options, saved)
      : result(saved);
  }
  const current = inspect(options, request.group_key);
  if (
    !current.view.binding ||
    JSON.stringify(baseBinding(request)) !==
      JSON.stringify(current.view.binding)
  )
    throw Error("EXTRACTION_RECOVERY_BINDING_MISMATCH");
  if (current.view.status === "BLOCKED")
    throw Error("EXTRACTION_RECOVERY_BLOCKED: " + current.view.reason);
  verifyAuthorization(options, request);
  const previous = store
    .all<ExtractionRecovery>("ExtractionRecovery")
    .filter(
      (r) => r.session_id === sessionID && r.group_key === request.group_key,
    );
  // There is no lease timeout: a consumed authorization cannot become sendable
  // merely because its process disappeared. Reconcile saved results explicitly.
  const completed = previous.findLast((r) => r.state === "SUCCEEDED");
  if (completed && current.view.status === "SUCCEEDED") {
    store.commit([], [], {
      request: request.request_id,
      hash: requestHash,
      value: completed.id,
    });
    return result(completed);
  }
  const active = previous.findLast((r) => r.state === "CLAIMED");
  if (active)
    return reconcileConsumed(options, active, {
      request: request.request_id,
      hash: requestHash,
      value: active.id,
    });
  const parent = current.attempt!;
  const record: ExtractionRecovery = {
    schema_version: 1,
    record_type: "ExtractionRecovery",
    ...base(),
    session_id: sessionID,
    group_key: request.group_key,
    attempt_id: id(),
    parent_attempt_id: parent.attempt_id!,
    request_id: request.request_id,
    request_hash: requestHash,
    binding_ref: store.put(requestBinding(request)),
    binding_snapshot: requestBinding(request),
    request_snapshot: request,
    generation: Math.max(0, ...previous.map((r) => r.generation)) + 1,
    owner_epoch: store.epoch,
    state: "CLAIMED",
    call_id: null,
    quotes: [],
    error: null,
  };
  const scope = { session_id: sessionID, task_id: null, execution_id: null };
  const attempt: Attempt = {
    ...parent,
    attempt_id: record.attempt_id,
    parent_attempt_id: parent.attempt_id,
    recovery_request_id: request.request_id,
    call_id: null,
  };
  const event = (type: string, more: object = {}) =>
    store.event(
      type,
      { ...attempt, generation: record.generation, ...more },
      scope,
    );
  const authorized = event("memory.extraction.recovery_authorized", {
    request_id: request.request_id,
    request_hash: requestHash,
    authorization_ref: record.binding_ref,
  });
  if (current.quotes) {
    // Deterministic reconciliation has no await and commits its authorization,
    // receipt and completed result together. No crash gap can lose the saved call.
    const done: ExtractionRecovery = {
      ...record,
      state: "SUCCEEDED",
      quotes: current.quotes,
      call_id: current.call?.id ?? null,
    };
    store.commit(
      [done],
      [
        event("memory.extraction.started"),
        authorized,
        ...(current.call
          ? [
              event("memory.extraction.call_linked", {
                call_id: current.call.id,
              }),
            ]
          : []),
        event("memory.extraction.succeeded", {
          quotes: current.quotes,
          call_id: done.call_id,
          reused: true,
        }),
      ],
      { request: request.request_id, hash: requestHash, value: record.id },
    );
    return result(done);
  }
  store.commit([record], [event("memory.extraction.started"), authorized], {
    request: request.request_id,
    hash: requestHash,
    value: record.id,
  });
  let running = activeExtractions.get(store);
  if (!running) activeExtractions.set(store, (running = new Set()));
  running.add(record.attempt_id);
  const assertClaim = () => {
    const latest = store.get<ExtractionRecovery>(
      "ExtractionRecovery",
      record.id,
    );
    const newer = store
      .all<ExtractionRecovery>("ExtractionRecovery")
      .some(
        (r) =>
          r.session_id === sessionID &&
          r.group_key === request.group_key &&
          r.generation > record.generation,
      );
    if (
      latest.state !== "CLAIMED" ||
      newer ||
      latest.owner_epoch !== store.epoch
    )
      throw Error("EXTRACTION_RECOVERY_CLAIM_LOST");
    return latest;
  };
  try {
    const quotes = await extractionRequest({
      store,
      model: options.model,
      stream: options.stream,
      sessionID,
      loopID: parent.loop_id!,
      consciousnessRevision: parent.consciousness_revision!,
      source: store.read(parent.source_ref!),
      existing: store.read<MemoryCommitment[]>(parent.existing_ref!),
      onPrepared: (call) => {
        const latest = assertClaim();
        store.commit(
          [revise(latest, { call_id: call.id })],
          [event("memory.extraction.call_linked", { call_id: call.id })],
        );
      },
    });
    const latest = assertClaim();
    const done = revise(latest, {
      state: "SUCCEEDED" as const,
      quotes,
      call_id: latest.call_id ?? current.call?.id ?? null,
    });
    store.commit(
      [done],
      [
        event("memory.extraction.succeeded", {
          quotes,
          call_id: done.call_id,
          reused: !!current.quotes,
        }),
      ],
    );
    return result(done);
  } catch (error) {
    const latest = assertClaim();
    const failed = revise(latest, {
      state: "FAILED" as const,
      error: String(error).slice(0, 512),
    });
    store.commit(
      [failed],
      [
        event("memory.extraction.failed", {
          call_id: failed.call_id,
          error: failed.error,
        }),
      ],
    );
    return result(failed);
  } finally {
    running.delete(record.attempt_id);
  }
}
/** A consumed request can only reconcile. It never reaches extractionRequest. */
function reconcileConsumed(
  options: RecoveryOptions,
  record: ExtractionRecovery,
  receipt?: { request: string; hash: string; value: string },
): RecoveryResult {
  const { store } = options;
  const current = inspect(options, record.group_key);
  if (current.attempt?.attempt_id !== record.attempt_id)
    return {
      ...result(record),
      status: "BLOCKED",
      reason: "EXTRACTION_RECOVERY_CLAIM_LOST",
    };
  if (current.quotes) {
    const done = revise(record, {
      state: "SUCCEEDED" as const,
      quotes: current.quotes,
      call_id: record.call_id ?? current.call?.id ?? null,
    });
    store.commit(
      [done],
      [
        store.event(
          "memory.extraction.succeeded",
          {
            ...current.attempt,
            quotes: current.quotes,
            call_id: done.call_id,
            generation: record.generation,
            reused: true,
          },
          { session_id: record.session_id, task_id: null, execution_id: null },
        ),
      ],
      receipt,
    );
    return result(done);
  }
  if (current.view.reason === "OLD_EXECUTION_ACTIVE") return result(record);
  if (current.view.reason === "TERMINAL_RESPONSE_INVALID") {
    const failed = revise(record, {
      state: "FAILED" as const,
      error: "TERMINAL_RESPONSE_INVALID",
    });
    store.commit(
      [failed],
      [
        store.event(
          "memory.extraction.failed",
          {
            ...current.attempt,
            call_id: record.call_id,
            error: failed.error,
            generation: record.generation,
          },
          { session_id: record.session_id, task_id: null, execution_id: null },
        ),
      ],
      receipt,
    );
    return result(failed);
  }
  return {
    ...result(record),
    status: "BLOCKED",
    reason:
      "CONSUMED_AUTHORIZATION_RECONCILIATION_ONLY: " + current.view.reason,
  };
}

function baseBinding(request: RecoveryBinding): RecoveryBinding {
  return {
    group_key: request.group_key,
    attempt_id: request.attempt_id,
    expected_revision: request.expected_revision,
    policy: request.policy,
    implementation_version: request.implementation_version,
    config_hash: request.config_hash,
    source_hash: request.source_hash,
    model_call_id: request.model_call_id,
    model_request_hash: request.model_request_hash,
    actual_payload_hash: request.actual_payload_hash,
  };
}

/** Tickets authorize only new consumption; durable receipts always take priority. */
export const RECOVERY_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
type IssuedAuthorization = {
  binding: RecoveryBinding;
  issuedWall: number;
  issuedMono: number;
  lastWall: number;
  invalid: boolean;
};
const authorizations = new WeakMap<Store, Map<string, IssuedAuthorization>>();
const authorizationKey = (options: RecoveryOptions, binding: RecoveryBinding) =>
  JSON.stringify([options.sessionID, binding.group_key]);
function liveAuthorization(ticket: IssuedAuthorization): boolean {
  const wall = Date.now(),
    mono = performance.now();
  if (
    !Number.isFinite(wall) ||
    !Number.isFinite(mono) ||
    wall < ticket.lastWall ||
    wall < ticket.issuedWall ||
    wall >= ticket.issuedWall + RECOVERY_AUTHORIZATION_TTL_MS ||
    mono < ticket.issuedMono ||
    mono - ticket.issuedMono >= RECOVERY_AUTHORIZATION_TTL_MS
  )
    ticket.invalid = true;
  ticket.lastWall = Math.max(ticket.lastWall, wall);
  return !ticket.invalid;
}
function issueAuthorization(
  options: RecoveryOptions,
  binding: RecoveryBinding,
): RecoveryBinding {
  let tickets = authorizations.get(options.store);
  if (!tickets) authorizations.set(options.store, (tickets = new Map()));
  const key = authorizationKey(options, binding),
    old = tickets.get(key);
  if (
    old &&
    liveAuthorization(old) &&
    JSON.stringify(baseBinding(old.binding)) === JSON.stringify(binding)
  )
    return { ...old.binding };
  const wall = Date.now(),
    mono = performance.now();
  const issued = {
    ...binding,
    authorization_id: id(),
    issued_at: new Date(wall).toISOString(),
    expires_at: new Date(wall + RECOVERY_AUTHORIZATION_TTL_MS).toISOString(),
  };
  tickets.set(key, {
    binding: issued,
    issuedWall: wall,
    issuedMono: mono,
    lastWall: wall,
    invalid: false,
  });
  return { ...issued };
}
function verifyAuthorization(
  options: RecoveryOptions,
  request: RecoveryRequest,
) {
  const ticket = authorizations
    .get(options.store)
    ?.get(authorizationKey(options, request));
  if (
    !ticket ||
    !request.authorization_id ||
    !request.issued_at ||
    !request.expires_at ||
    JSON.stringify(requestBinding(request)) !== JSON.stringify(ticket.binding)
  )
    throw Error(
      "EXTRACTION_RECOVERY_AUTHORIZATION_BINDING_MISMATCH: re-preflight required",
    );
  if (!liveAuthorization(ticket))
    throw Error(
      "EXTRACTION_RECOVERY_AUTHORIZATION_EXPIRED: re-preflight required",
    );
}
function requestBinding(request: RecoveryBinding): RecoveryBinding {
  return {
    ...baseBinding(request),
    ...(request.authorization_id === undefined
      ? {}
      : { authorization_id: request.authorization_id }),
    ...(request.issued_at === undefined
      ? {}
      : { issued_at: request.issued_at }),
    ...(request.expires_at === undefined
      ? {}
      : { expires_at: request.expires_at }),
  };
}
