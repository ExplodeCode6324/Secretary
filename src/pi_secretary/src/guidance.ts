import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Agent, AgentMessage } from "./model.ts";
import type {
  Checkpoint,
  Context,
  DecisionRequest,
  Execution,
  Feedback,
  Guidance,
  GuidanceInjection,
  GuidanceReceipt,
  Input,
  ModelCall,
  Operation,
  TaskPlan,
  TaskProposal,
} from "./contracts.ts";
import { Store, base, hash, id, now, revise, type Stored } from "./store.ts";
import { scopeOf, stableID, terminal } from "./execution-utils.ts";

// Delivered as task context, keeping ordinary Main requests unchanged.
export const GUIDANCE_CONTEXT = {
  guidance_scope: "THIS_EXECUTION_ONLY",
  persistent_changes: "USE_CONTINUATION",
  reporting: "QUIET_UNLESS_CONFLICT",
} as const;
export const GUIDANCE_LIMITS = {
  instructionBytes: 16384,
  count: 64,
  totalBytes: 65536,
} as const;
export type GuidanceDisposition = Pick<
  GuidanceReceipt,
  | "guidance_id"
  | "outcome"
  | "explanation"
  | "effective_requirements"
  | "conflicts_with"
  | "resolution_refs"
>;
type Runtime = {
  agent: Agent;
  attempt: string;
  held: boolean;
  cutoff: number;
  callID?: string;
  queued: Set<string>;
};
const instances = new WeakMap<Store, GuidanceService>();
export function guidanceFor(store: Store) {
  let service = instances.get(store);
  if (!service) instances.set(store, (service = new GuidanceService(store)));
  return service;
}
function messageHash(value: unknown): string {
  const m = value as { role?: string; content?: unknown };
  const content =
    Array.isArray(m.content) && m.content.every((p) => p.type === "text")
      ? m.content.map((p) => p.text).join("")
      : m.content;
  return hash(JSON.stringify({ role: m.role, content }));
}
export class GuidanceService {
  private runtimes = new Map<string, Runtime>();
  constructor(readonly store: Store) {}
  list(eid: string) {
    return this.store.indexed<Guidance>("Guidance", "execution_id", [eid]);
  }
  cutoff(eid: string) {
    return this.list(eid).at(-1)?.sequence ?? 0;
  }
  private injections(eid: string) {
    return this.store.indexed<GuidanceInjection>(
      "GuidanceInjection",
      "execution_id",
      [eid],
    );
  }
  target(session: string, task: string, eid: string) {
    const e = this.store.find<Execution>("Execution", eid);
    const p = this.store.find<TaskPlan>("TaskPlan", task);
    if (!e || !p) throw Error("TARGET_NOT_FOUND");
    if (
      e.task_id !== task ||
      this.store.read<TaskProposal>(p.proposal_ref).session_id !== session
    )
      throw Error("TARGET_MISMATCH");
    if (e.state === "RESULT_UNKNOWN") throw Error("TARGET_RESULT_UNKNOWN");
    if (terminal(e)) throw Error("TARGET_ENDED");
    if (e.cancel_requested || e.state === "CANCEL_REQUESTED")
      throw Error("TARGET_CANCELLING");
    const proposal = this.store.read<TaskProposal>(
      e.proposal_ref ?? p.proposal_ref,
    );
    if (proposal.executor.kind !== "AGENT")
      throw Error("GUIDANCE_UNSUPPORTED_EXECUTOR");
    return e;
  }
  master(
    session: string,
    owner: string,
    request: string,
    task: string,
    eid: string,
    text: string,
  ) {
    return this.admit(
      session,
      request,
      task,
      eid,
      text,
      "MASTER",
      { owner_id: owner, request_id: request },
      true,
    );
  }
  main(
    session: string,
    loop: string,
    rawCall: string,
    request: string,
    args: { id: string; task_id?: string; text?: string },
  ) {
    const contexts = this.store.indexed<Context>("Context", "loop_id", [loop]);
    const call = contexts
      .map((c) => this.store.find<ModelCall>("ModelCall", c.call_id))
      .find((c) => {
        if (
          c?.state !== "RESPONSE_SAVED" ||
          !c.response ||
          c.scope.session_id !== session
        )
          return false;
        return this.store
          .read<AssistantMessage>(c.response)
          .content.some(
            (t) =>
              t.type === "toolCall" &&
              t.id === rawCall &&
              t.name === "task_control" &&
              JSON.stringify(t.arguments) === JSON.stringify(args),
          );
      });
    if (!call) throw Error("GUIDANCE_SOURCE_UNPROVEN");
    return this.admit(
      session,
      request,
      args.task_id ?? "",
      args.id,
      args.text ?? "",
      "MAIN",
      {
        loop_id: loop,
        call_id: call.id,
        tool_call_id: rawCall,
        request_id: request,
      },
      false,
    );
  }
  private admit(
    session: string,
    request: string,
    task: string,
    eid: string,
    text: string,
    source: Guidance["source"],
    provenance: unknown,
    inform: boolean,
  ) {
    const digest = hash(
      JSON.stringify({ session, request, task, eid, text, source, provenance }),
    );
    const old = this.store.receipt<string>(request, digest);
    if (old) return this.store.get<Guidance>("Guidance", old);
    const existing = this.store.indexed<Guidance>("Guidance", "request_id", [
      request,
    ])[0];
    if (existing) {
      if (existing.request_hash !== digest) throw Error("REQUEST_CONFLICT");
      return existing;
    }
    if (
      this.store.hasRequestIdentity(request) ||
      this.store.find("ApiCommand", request)
    )
      throw Error("REQUEST_CONFLICT");
    const e = this.target(session, task, eid);
    if (!text.trim()) throw Error("GUIDANCE_EMPTY");
    const bytes = Buffer.byteLength(text);
    if (bytes > GUIDANCE_LIMITS.instructionBytes)
      throw Error("GUIDANCE_TOO_LARGE");
    const all = this.list(eid);
    if (
      all.length >= GUIDANCE_LIMITS.count ||
      all.reduce((n, g) => n + g.text_bytes, 0) + bytes >
        GUIDANCE_LIMITS.totalBytes
    )
      throw Error("GUIDANCE_LIMIT_REACHED");
    const g: Guidance = {
      ...base(),
      schema_version: 1,
      record_type: "Guidance",
      task_id: task,
      execution_id: eid,
      session_id: session,
      source,
      source_ref: this.store.put({
        ...(provenance as object),
        ...(inform ? { input_id: stableID("guidance-input:" + request) } : {}),
      }),
      request_id: request,
      request_hash: digest,
      text: this.store.put(text, "text/plain"),
      text_bytes: bytes,
      sequence: (all.at(-1)?.sequence ?? 0) + 1,
      sent_at: now(),
      received_at: null,
      guided_at: null,
      disposition: "PENDING",
      receipt_id: null,
      closed_reason: null,
    };
    const changes: Stored[] = [g];
    if (inform) {
      const input: Input = {
        ...base(stableID("guidance-input:" + request)),
        schema_version: 1,
        record_type: "Input",
        session_id: session,
        dedupe_key: request,
        producer: "MASTER",
        state: "ACCEPTED",
        payload: this.store.put(
          JSON.stringify({
            guidance_id: g.id,
            task_id: task,
            execution_id: eid,
            text,
            delivery: "ALREADY_ACCEPTED_DO_NOT_RESEND",
            informational: true,
            ...GUIDANCE_CONTEXT,
          }),
          "text/plain",
        ),
        loop_id: null,
        received_at: now(),
        feedback_id: null,
        guidance_id: g.id,
      };
      changes.push(input);
    }
    this.store.commit(
      changes,
      [
        this.store.event(
          "guidance.sent",
          { guidance_id: g.id, text: g.text },
          scopeOf(e),
          source === "MASTER" ? "MASTER_UI" : "MAIN",
        ),
        ...(inform
          ? [
              this.store.event(
                "input.accepted",
                changes[1],
                { session_id: session, task_id: null, execution_id: null },
                "MASTER_UI",
              ),
            ]
          : []),
      ],
      { request, hash: digest, value: g.id },
    );
    // No await or scheduler pump between durable admission and steering.
    this.deliver(eid);
    return g;
  }
  register(eid: string, agent: Agent, attempt: string, held: boolean) {
    this.runtimes.set(eid, {
      agent,
      attempt,
      held,
      cutoff: this.cutoff(eid),
      queued: new Set(),
    });
  }
  unregister(eid: string) {
    this.runtimes.delete(eid);
  }
  private represented(eid: string, messages: readonly unknown[]) {
    const result = new Set<string>();
    const hashes = messages.map(messageHash);
    for (const injection of this.injections(eid)) {
      const index = injection.message_index;
      if (index !== null && hashes[index] === injection.message_hash)
        for (const gid of injection.guidance_ids) result.add(gid);
    }
    return result;
  }
  private envelope(g: Guidance) {
    return {
      guidance_id: g.id,
      source: g.source,
      sequence: g.sequence,
      text_hash: g.text.sha256,
      text: this.store.bytes(g.text).toString(),
      authority:
        g.source === "MASTER" ? "MASTER_INSTRUCTION" : "MAIN_SUGGESTION",
    };
  }
  private inject(eid: string, ids: string[], content: string): AgentMessage {
    const r = this.runtimes.get(eid)!;
    const message: AgentMessage = {
      role: "user",
      content,
      timestamp: Date.now(),
    };
    const injection: GuidanceInjection = {
      ...base(),
      schema_version: 1,
      record_type: "GuidanceInjection",
      execution_id: eid,
      guidance_ids: ids,
      attempt_id: r.attempt,
      message: this.store.put(message),
      message_hash: messageHash(message),
      message_index: null,
      checkpoint_id: null,
      received_at: null,
    };
    this.store.commit([injection]);
    for (const gid of ids) r.queued.add(gid);
    return message;
  }
  initialPacket(eid: string, packet: string): string {
    const r = this.runtimes.get(eid)!;
    r.cutoff = this.cutoff(eid);
    const included = this.represented(eid, r.agent.state.messages);
    const missing = this.list(eid).filter(
      (g) => !g.closed_reason && !included.has(g.id),
    );
    if (!missing.length) return packet;
    const content = JSON.stringify({
      ...JSON.parse(packet),
      guidance: missing.map((g) => this.envelope(g)),
      guidance_injection_nonce: id(),
    });
    this.inject(
      eid,
      missing.map((g) => g.id),
      content,
    );
    return content;
  }
  deliver(eid: string) {
    const r = this.runtimes.get(eid);
    if (
      !r ||
      r.held ||
      this.store.get<Execution>("Execution", eid).state !== "RUNNING"
    )
      return;
    const included = this.represented(eid, r.agent.state.messages);
    for (const g of this.list(eid)) {
      if (g.closed_reason || included.has(g.id) || r.queued.has(g.id)) continue;
      r.agent.steer(
        this.inject(
          eid,
          [g.id],
          JSON.stringify({
            protocol: "secretary.guidance.v1",
            nonce: id(),
            guidance: this.envelope(g),
          }),
        ),
      );
    }
  }
  nextTurn(eid: string) {
    const r = this.runtimes.get(eid)!;
    r.held = false;
    r.cutoff = this.cutoff(eid); // Before Pi's steering poll, never after its awaited emits.
    this.deliver(eid);
  }
  checkpoint(eid: string, cp: Checkpoint, messages: readonly AgentMessage[]) {
    const hashes = messages.map(messageHash);
    const changes: Stored[] = [];
    const received = new Set<string>();
    for (const injection of this.injections(eid)) {
      if (injection.received_at) continue;
      const index = hashes.indexOf(injection.message_hash);
      if (index < 0) continue;
      changes.push(
        revise(injection, {
          message_index: index,
          checkpoint_id: cp.id,
          received_at: now(),
        }),
      );
      for (const gid of injection.guidance_ids) received.add(gid);
    }
    for (const gid of received) {
      const g = this.store.get<Guidance>("Guidance", gid);
      if (!g.received_at) changes.push(revise(g, { received_at: now() }));
      this.runtimes.get(eid)?.queued.delete(gid);
    }
    if (changes.length) this.store.commit(changes);
  }
  requestCutoff(eid: string) {
    return this.runtimes.get(eid)?.cutoff ?? 0;
  }
  checkRequest(eid: string, context: { messages: unknown[] }, cutoff: number) {
    const included = this.represented(eid, context.messages);
    const missing = this.list(eid).filter(
      (g) => !g.closed_reason && g.sequence <= cutoff && !included.has(g.id),
    );
    if (missing.length) {
      this.store.commit(
        [],
        [
          this.store.event(
            "guidance.request_blocked",
            {
              cutoff,
              missing_guidance_ids: missing.map((g) => g.id),
              request_ref: this.store.put(context),
              sent: false,
            },
            scopeOf(this.store.get<Execution>("Execution", eid)),
          ),
        ],
      );
      throw Error(
        "GUIDANCE_NOT_PROCESSED: request missing " +
          missing.map((g) => g.id).join(","),
      );
    }
  }
  prepared(eid: string, call: ModelCall) {
    const r = this.runtimes.get(eid);
    if (r) r.callID = call.id;
  }
  currentCall(eid: string) {
    return this.runtimes.get(eid)?.callID;
  }
  coverage(eid: string, callID?: string) {
    if (!callID) return new Set<string>();
    const call = this.store.get<ModelCall>("ModelCall", callID);
    if (call.scope.execution_id !== eid) throw Error("GUIDANCE_CALL_MISMATCH");
    return this.represented(
      eid,
      this.store.read<{ messages: unknown[] }>(call.request).messages,
    );
  }
  response(eid: string) {
    const callID = this.currentCall(eid);
    if (!callID) throw Error("GUIDANCE_CALL_UNPROVEN");
    const call = this.store.get<ModelCall>("ModelCall", callID);
    if (call.state !== "RESPONSE_SAVED" || !call.response)
      throw Error("GUIDANCE_RESPONSE_UNPROVEN");
    return { call, message: this.store.read<AssistantMessage>(call.response) };
  }
  assertTool(eid: string, toolID: string, name: string, args: unknown) {
    const { message } = this.response(eid);
    if (
      !message.content.some(
        (t) =>
          t.type === "toolCall" &&
          t.id === toolID &&
          t.name === name &&
          JSON.stringify(t.arguments) === JSON.stringify(args),
      )
    )
      throw Error("GUIDANCE_TOOL_UNPROVEN");
  }
  // Returns mutations, so completion can commit the whole response's receipts atomically.
  receipts(eid: string): Stored[] {
    const { call, message } = this.response(eid),
      covered = this.coverage(eid, call.id);
    const changes: Stored[] = [];
    const outcomes = new Map<string, GuidanceDisposition>();
    for (const t of message.content) {
      if (t.type !== "toolCall" || t.name !== "guidance_receipt") continue;
      const items = (t.arguments as { items?: GuidanceDisposition[] }).items;
      if (!Array.isArray(items) || !items.length || items.length > 64)
        throw Error("INVALID_GUIDANCE_RECEIPT");
      for (const item of items) {
        if (
          !item ||
          !covered.has(item.guidance_id) ||
          !["ADOPTED", "CONFLICT", "CANNOT_APPLY"].includes(item.outcome) ||
          typeof item.explanation !== "string" ||
          !item.explanation.trim() ||
          item.explanation.length > 4000 ||
          typeof item.effective_requirements !== "string" ||
          !item.effective_requirements.trim() ||
          item.effective_requirements.length > 8000 ||
          !Array.isArray(item.conflicts_with) ||
          !Array.isArray(item.resolution_refs) ||
          item.conflicts_with.length > 64 ||
          item.resolution_refs.length > 64
        )
          throw Error("INVALID_GUIDANCE_RECEIPT");
        const prior = outcomes.get(item.guidance_id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(item))
          throw Error("CONTRADICTORY_GUIDANCE_RECEIPTS");
        if (prior) continue;
        outcomes.set(item.guidance_id, item);
        const g = this.store.get<Guidance>("Guidance", item.guidance_id);
        if (!g.received_at || g.execution_id !== eid)
          throw Error("GUIDANCE_NOT_RECEIVED");
        for (const gid of item.conflicts_with)
          if (this.store.get<Guidance>("Guidance", gid).execution_id !== eid)
            throw Error("GUIDANCE_CONFLICT_TARGET");
        for (const ref of item.resolution_refs) {
          const newer = this.store.find<Guidance>("Guidance", ref),
            decision = this.store.find<DecisionRequest>("DecisionRequest", ref);
          if (
            newer
              ? newer.execution_id !== eid ||
                newer.sequence <= g.sequence ||
                !covered.has(newer.id)
              : !decision ||
                decision.execution_id !== eid ||
                decision.state !== "ANSWERED"
          )
            throw Error("GUIDANCE_RESOLUTION_UNPROVEN");
        }
        if (
          item.outcome === "ADOPTED" &&
          (["CONFLICT", "CANNOT_APPLY"].includes(g.disposition) ||
            (g.source === "MAIN" &&
              item.conflicts_with.some(
                (gid) =>
                  this.store.get<Guidance>("Guidance", gid).source === "MASTER",
              )))
        ) {
          const oldConflicts = g.receipt_id
            ? this.store.get<GuidanceReceipt>("GuidanceReceipt", g.receipt_id)
                .conflicts_with
            : [];
          const master =
            g.source === "MASTER" ||
            [...item.conflicts_with, ...oldConflicts].some(
              (gid) =>
                this.store.get<Guidance>("Guidance", gid).source === "MASTER",
            );
          const resolved = item.resolution_refs.some((ref) => {
            const n = this.store.find<Guidance>("Guidance", ref);
            const d = this.store.find<DecisionRequest>("DecisionRequest", ref);
            return master
              ? n?.source === "MASTER" || d?.answered_by === "MASTER"
              : !!n || !!d;
          });
          if (!resolved) throw Error("GUIDANCE_RESOLUTION_REQUIRED");
        }
        const rid = stableID(
          "guidance-receipt:" + call.id + ":" + t.id + ":" + g.id,
        );
        if (this.store.find("GuidanceReceipt", rid)) continue;
        const receipt: GuidanceReceipt = {
          ...base(rid),
          schema_version: 1,
          record_type: "GuidanceReceipt",
          execution_id: eid,
          guidance_id: g.id,
          call_id: call.id,
          tool_call_id: t.id,
          outcome: item.outcome,
          explanation: item.explanation,
          effective_requirements: item.effective_requirements,
          conflicts_with: item.conflicts_with,
          resolution_refs: item.resolution_refs,
          observed_at: now(),
        };
        changes.push(
          receipt,
          revise(g, {
            disposition: item.outcome,
            receipt_id: rid,
            guided_at:
              item.outcome === "ADOPTED" ? (g.guided_at ?? now()) : g.guided_at,
          }),
        );
      }
    }
    return changes;
  }
  projected(eid: string, changes: Stored[] = []) {
    const updates = new Map(
      changes
        .filter((r): r is Guidance => r.record_type === "Guidance")
        .map((g) => [g.id, g]),
    );
    return this.list(eid).map((g) => updates.get(g.id) ?? g);
  }
  gate(
    eid: string,
    kind: "success" | "effect" | "ordinary",
    changes: Stored[] = [],
  ): "ALLOW" | "PENDING" | "FAIL" | "CONFLICT" {
    const covered = this.coverage(eid, this.currentCall(eid)),
      all = this.projected(eid, changes).filter((g) => !g.closed_reason);
    if (
      kind === "success" &&
      all.some((g) => covered.has(g.id) && g.disposition === "PENDING")
    )
      return "FAIL";
    if (all.some((g) => !covered.has(g.id))) return "PENDING";
    if (all.some((g) => ["CONFLICT", "CANNOT_APPLY"].includes(g.disposition)))
      return "CONFLICT";
    if (kind !== "ordinary" && all.some((g) => g.disposition !== "ADOPTED"))
      return "PENDING";
    return "ALLOW";
  }
  commitReceipts(eid: string, changes: Stored[]) {
    if (changes.length) this.store.commit(changes);
    this.waitForConflict(eid);
  }
  waitForConflict(eid: string) {
    const conflicts = this.list(eid).filter((g) =>
      ["CONFLICT", "CANNOT_APPLY"].includes(g.disposition),
    );
    if (!conflicts.length) return;
    const e = this.store.get<Execution>("Execution", eid);
    if (
      terminal(e) ||
      e.cancel_requested ||
      ["WAIT_AUTH", "RESULT_UNKNOWN"].includes(e.state)
    )
      return;
    let key = stableID(
      "guidance-conflict:" +
        eid +
        ":" +
        conflicts.map((g) => g.receipt_id).join(":"),
    );
    // One open question per receipt set and answer epoch. An answer does not
    // itself certify adoption; unresolved guidance must return to an explicit wait.
    let previous = this.store.find<DecisionRequest>("DecisionRequest", key);
    while (previous?.state === "ANSWERED") {
      key = stableID(
        "guidance-conflict-reopen:" + key + ":" + previous.answer_request_id,
      );
      previous = this.store.find<DecisionRequest>("DecisionRequest", key);
    }
    if (previous) {
      if (previous.state === "OPEN" && e.state !== "WAIT_DECISION")
        this.store.commit([
          revise(e, {
            state: "WAIT_DECISION",
            waiting_request_ids: [previous.id],
          }),
        ]);
      return;
    }
    const needsMaster = conflicts.some(
      (g) =>
        g.source === "MASTER" ||
        (g.receipt_id &&
          this.store
            .get<GuidanceReceipt>("GuidanceReceipt", g.receipt_id)
            .conflicts_with.some(
              (gid) =>
                this.store.get<Guidance>("Guidance", gid).source === "MASTER",
            )),
    );
    const d: DecisionRequest = {
      ...base(key),
      schema_version: 1,
      record_type: "DecisionRequest",
      state: "OPEN",
      task_id: e.task_id,
      execution_id: eid,
      question:
        "Guidance needs a decision: " +
        conflicts
          .map(
            (g) =>
              this.store.get<GuidanceReceipt>("GuidanceReceipt", g.receipt_id!)
                .explanation,
          )
          .join("\n"),
      options: [],
      impact: "Resolve guidance before this execution can continue",
      materials: conflicts.map((g) => g.text),
      deadline: null,
      answer: null,
      answered_by: null,
      answer_request_id: null,
      ...(needsMaster ? { required_answerer: "MASTER" as const } : {}),
      guidance_ids: conflicts.map((g) => g.id),
    };
    const f: Feedback = {
      ...base(stableID("guidance-feedback:" + key)),
      schema_version: 1,
      record_type: "Feedback",
      scope_id: e.scope_id ?? null,
      state: "QUEUED",
      task_id: e.task_id,
      execution_id: eid,
      kind: "DECISION_REQUIRED",
      summary: d.question,
      detail_ref: this.store.put(d),
      result_id: null,
      decision_request_id: d.id,
      input_id: null,
      created_at: now(),
    };
    this.store.commit(
      [
        d,
        revise(e, { state: "WAIT_DECISION", waiting_request_ids: [d.id] }),
        f,
      ],
      [this.store.event("decision.requested", d, scopeOf(e))],
    );
  }
  settlement(eid: string, reason: string, changes: Stored[] = []): Stored[] {
    return this.projected(eid, changes)
      .filter((g) => !g.closed_reason)
      .map((g) => ({
        ...g,
        revision: this.store.get<Guidance>("Guidance", g.id).revision + 1,
        updated_at: now(),
        disposition:
          g.disposition === "PENDING"
            ? ("UNPROCESSED" as const)
            : g.disposition,
        closed_reason: reason,
      }));
  }
  summary(eid: string, changes: Stored[] = []) {
    return this.projected(eid, changes).map((g) => ({
      guidance_id: g.id,
      source: g.source,
      disposition: g.disposition,
      receipt_id: g.receipt_id,
      received_at: g.received_at,
      guided_at: g.guided_at,
      closed_reason: g.closed_reason,
    }));
  }
  obsolete(op: Operation) {
    return this.list(op.scope.execution_id!).filter(
      (g) =>
        !g.closed_reason &&
        !this.coverage(op.scope.execution_id!, op.generating_call_id).has(g.id),
    );
  }
  retire(eid: string) {
    const changes: Stored[] = [];
    for (const op of this.store.indexed<Operation>(
      "Operation",
      "scope.execution_id",
      [eid],
    )) {
      if (
        op.state !== "AUTHORIZED" ||
        op.effect !== "NOT_STARTED" ||
        op.process
      )
        continue;
      const missing = this.obsolete(op);
      if (!missing.length) continue;
      const evidence = this.store.put({
        operation_id: op.id,
        prior_state: op.state,
        prior_effect: op.effect,
        generating_call_id: op.generating_call_id ?? null,
        never_dispatched: true,
      });
      changes.push(
        revise(op, {
          state: "CANCELLED",
          error: "SUPERSEDED_BY_GUIDANCE",
          guidance_supersession: {
            reason: "SUPERSEDED_BY_GUIDANCE",
            guidance_ids: missing.map((g) => g.id),
            at: now(),
            evidence,
          },
        }),
      );
    }
    if (changes.length) this.store.commit(changes);
    return changes.length > 0;
  }
  isRetired(op: Operation) {
    const proof = op.guidance_supersession;
    if (!proof || proof.reason !== "SUPERSEDED_BY_GUIDANCE") return false;
    const evidence = this.store.read<{
      operation_id: string;
      never_dispatched?: boolean;
      not_started?: boolean;
    }>(proof.evidence);
    return (
      evidence.operation_id === op.id &&
      ((op.state === "CANCELLED" &&
        op.effect === "NOT_STARTED" &&
        evidence.never_dispatched === true) ||
        (op.effect === "NOT_APPLIED" && evidence.not_started === true))
    );
  }
  view(g: Guidance) {
    const e = this.store.get<Execution>("Execution", g.execution_id);
    return {
      id: g.id,
      task_id: g.task_id,
      execution_id: g.execution_id,
      source: g.source,
      text: this.store.bytes(g.text).toString(),
      revision: String(g.revision),
      sequence: String(g.sequence),
      sent_at: g.sent_at,
      received_at: g.received_at,
      guided_at: g.guided_at,
      disposition: g.disposition,
      reason:
        g.closed_reason ??
        (e.state === "RESULT_UNKNOWN"
          ? "UNKNOWN_EFFECT"
          : e.state === "RUNNING"
            ? null
            : e.state),
      receipt: g.receipt_id
        ? this.store.get<GuidanceReceipt>("GuidanceReceipt", g.receipt_id)
        : null,
    };
  }
}
