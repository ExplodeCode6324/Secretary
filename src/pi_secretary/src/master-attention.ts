import type { App } from "./app.ts";
import type { Store } from "./store.ts";
import type {
  AuthorizationRequest,
  DecisionRequest,
  Execution,
  Operation,
  Scope,
  TaskPlan,
  TaskProposal,
  TaskResult,
} from "./contracts.ts";
import type { MasterAttention, MasterAttentionItem } from "./api/contracts.ts";
import {
  ApiError,
  Cursors,
  fingerprint,
  type PageKey,
} from "./api/protocol.ts";
import { terminal } from "./execution-utils.ts";

type Provenance = { at: string | null; sequence: number };
type Failure = {
  category: MasterAttentionItem["failure_category"];
  reason: string;
  authorization: string | null;
  operation: string | null;
  authorization_state: string | null;
  operation_state: string | null;
  cause_evidence: MasterAttentionItem["cause_evidence"];
};
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function preview(text: string) {
  let result = "";
  for (const { segment } of [...segmenter.segment(text.slice(0, 4096))].slice(
    0,
    160,
  )) {
    if (Buffer.byteLength(result + segment) > 1024) break;
    result += segment;
  }
  return result.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}

/** Domain ownership is independent of scope archive/browse visibility. */
export function assertMatterScope(
  store: Store,
  sessionID: string,
  scope: Scope,
  taskOwner = (task: TaskPlan) =>
    store.read<TaskProposal>(task.proposal_ref).session_id,
) {
  let task: TaskPlan | undefined;
  if (scope.execution_id) {
    const e = store.get<Execution>("Execution", scope.execution_id);
    if (scope.task_id && scope.task_id !== e.task_id)
      throw new ApiError("NOT_FOUND", 404);
    task = store.get<TaskPlan>("TaskPlan", e.task_id);
  } else if (scope.task_id)
    task = store.get<TaskPlan>("TaskPlan", scope.task_id);
  if (scope.session_id && scope.session_id !== sessionID)
    throw new ApiError("NOT_FOUND", 404);
  if (task && taskOwner(task) !== sessionID)
    throw new ApiError("NOT_FOUND", 404);
  if (!task && !scope.session_id) throw new ApiError("NOT_FOUND", 404);
}

/** A rebuildable read projection; no read receipts, retention changes or UI journal. */
export class MasterAttentionProjection {
  private owners = new Map<string, string>();
  private failures = new Map<string, { version: string; value: Failure }>();
  private frame = 0;
  private decisions = new Map<
    string,
    { state: string; request: string; sequence: number }
  >();
  private cancelled = new Map<string, number>();
  private states = new Map<string, string>();
  private episodes = new Map<string, Provenance>();
  constructor(
    readonly app: App,
    readonly cursors: Cursors,
  ) {
    this.sync();
  }
  private get store() {
    return this.app.store;
  }
  private sync() {
    for (; this.frame < this.store.projectionFrames.length; this.frame++) {
      const frame = this.store.projectionFrames[this.frame];
      for (const m of frame.mutations) {
        if (m.object_type === "AuthorizationRequest") {
          const a = this.store.read<AuthorizationRequest>(m.snapshot),
            old = this.decisions.get(a.id);
          if (a.scope.execution_id) this.failures.delete(a.scope.execution_id);
          if (
            ["REJECTED", "REVOKED"].includes(a.state) &&
            a.decision_id &&
            (!old || old.state !== a.state || old.request !== a.decision_id)
          )
            this.decisions.set(a.id, {
              state: a.state,
              request: a.decision_id,
              sequence: frame.sequence,
            });
          continue;
        }
        if (!["Execution", "Operation", "TaskPlan"].includes(m.object_type))
          continue;
        const record = this.store.read<Execution | Operation | TaskPlan>(
          m.snapshot,
        );
        if (record.record_type === "Execution") this.failures.delete(record.id);
        if (record.record_type === "Operation" && record.scope.execution_id)
          this.failures.delete(record.scope.execution_id);
        const key = m.object_type + ":" + m.object_id;
        const previous = this.states.get(key);
        if (previous !== record.state) {
          if (m.object_type === "Operation" && record.state === "CANCELLED")
            this.cancelled.set(record.id, frame.sequence);
          if (
            ["RESULT_UNKNOWN", "INIT_FAILED", "FAILED"].includes(record.state)
          )
            this.episodes.set(key, {
              at: frame.committed_at,
              sequence: frame.sequence,
            });
          else this.episodes.delete(key);
          this.states.set(key, record.state);
        }
      }
    }
  }
  private created(type: string, id: string): Provenance {
    const sequence = this.store.firstSequence(type, id);
    return {
      sequence,
      at: this.store.projectionFrames[sequence - 1]?.committed_at ?? null,
    };
  }
  private owns(scope: Scope) {
    try {
      assertMatterScope(this.store, this.app.host.sessionID, scope, (task) => {
        const hash = task.proposal_ref.sha256;
        let owner = this.owners.get(hash);
        if (owner === undefined) {
          owner = this.store.read<TaskProposal>(task.proposal_ref).session_id;
          this.owners.set(hash, owner);
        }
        return owner;
      });
      return true;
    } catch (e) {
      if (/NOT_FOUND/.test(String(e))) return false;
      throw e;
    }
  }
  private row(
    type: MasterAttentionItem["type"],
    id: string,
    revision: number,
    state: string,
    scope: Scope,
    provenance: Provenance,
    text: string,
    route: string,
  ): MasterAttentionItem {
    const execution = scope.execution_id
      ? this.store.get<Execution>("Execution", scope.execution_id)
      : undefined;
    return {
      type,
      id,
      key: `${type}:${id}:${provenance.sequence}`,
      revision: String(revision),
      state,
      session_id: this.app.host.sessionID,
      task_id: execution?.task_id ?? scope.task_id,
      execution_id: scope.execution_id,
      operation_id: null,
      authorization_id: null,
      authorization_state: null,
      operation_state: null,
      cause_evidence: null,
      execution_state: execution?.state ?? null,
      retention_state: execution?.retention_state ?? null,
      warning: null,
      preview: preview(text),
      initiated_at: provenance.at,
      initiated_sequence: String(provenance.sequence),
      expires_at: null,
      actionable: type === "authorization" || type === "decision",
      failure_category: null,
      detail_route: route,
    };
  }
  failure(e: Execution): Failure {
    this.sync();
    const result = e.result_id
      ? this.store.find<TaskResult>("TaskResult", e.result_id)
      : undefined;
    const version = `${e.revision}:${e.result_id}:${result?.revision}:${result?.detail_ref.sha256}`;
    const cached = this.failures.get(e.id);
    if (cached?.version === version) return { ...cached.value };
    const value = this.classifyFailure(e);
    this.failures.set(e.id, { version, value });
    return { ...value };
  }
  private classifyFailure(e: Execution): Failure {
    const unavailable = (reason: string) => ({
      category: "unclassified" as const,
      reason,
      authorization: null,
      operation: null,
      authorization_state: null,
      operation_state: null,
      cause_evidence: "unavailable" as const,
    });
    if (!e.result_id) return unavailable("失败原因不可用");
    const result = this.store.find<TaskResult>("TaskResult", e.result_id);
    if (!result || result.execution_id !== e.id || result.outcome !== "FAILED")
      return unavailable("失败结果关联不可用");
    const failedAt = this.store.firstSequence("TaskResult", result.id);
    if (!failedAt) return unavailable("失败发起来源不可用");
    let detail: Record<string, unknown>;
    try {
      detail = this.store.read(result.detail_ref);
    } catch {
      return unavailable("失败详情不可用");
    }
    if (!detail || typeof detail !== "object" || Array.isArray(detail))
      return unavailable("失败详情结构不可用");
    const reason =
      typeof detail.reason === "string"
        ? detail.reason
        : typeof detail.error === "string"
          ? detail.error
          : result.summary;
    const keys = Object.keys(detail).sort();
    const legacy =
      keys.length === 1 && detail.reason === "Authorization rejected/revoked";
    const resumed =
      detail.failure_code === "CANCELLED_OPERATION_ON_RESUME" &&
      Array.isArray(detail.cancelled_operation_ids) &&
      keys.join(",") === "cancelled_operation_ids,failure_code,reason";
    const recorded = legacy || resumed;
    const linked = this.store
      .indexed<Operation>("Operation", "scope.execution_id", [e.id])
      .filter(
        (o) =>
          o.scope.execution_id === e.id &&
          o.state === "CANCELLED" &&
          o.authorization_id &&
          this.owns(o.scope),
      )
      .flatMap((o) => {
        const a = this.store.find<AuthorizationRequest>(
          "AuthorizationRequest",
          o.authorization_id!,
        );
        const proof = a && this.decisions.get(a.id);
        if (
          !a ||
          a.operation_id !== o.id ||
          a.scope.execution_id !== e.id ||
          !this.owns(a.scope) ||
          !["REJECTED", "REVOKED"].includes(a.state) ||
          a.decided_by !== "MASTER_UI" ||
          !a.decision_id ||
          !proof ||
          proof.request !== a.decision_id ||
          proof.state !== a.state ||
          proof.sequence >= failedAt ||
          this.cancelled.get(o.id) !== proof.sequence
        )
          return [];
        return [{ a, o }];
      });
    const proven = recorded
      ? linked.find(
          ({ o }) =>
            legacy ||
            (detail.cancelled_operation_ids as unknown[]).includes(o.id),
        )
      : undefined;
    const fact = proven ?? linked[0];
    return {
      category: proven
        ? proven.a.state === "REJECTED"
          ? "authorization_rejected"
          : "authorization_revoked"
        : "execution_failed",
      cause_evidence: proven
        ? "rejection_proven"
        : recorded
          ? "inconsistent"
          : "recorded_non_rejection",
      reason,
      authorization: fact?.a.id ?? null,
      operation: fact?.o.id ?? null,
      authorization_state: fact?.a.state ?? null,
      operation_state: fact?.o.state ?? null,
    };
  }
  query(q: URLSearchParams): MasterAttention {
    this.sync();
    const asOf = new Date().toISOString();
    const items: MasterAttentionItem[] = [];
    const deadlines: string[] = [];
    for (const a of this.store.all<AuthorizationRequest>(
      "AuthorizationRequest",
    )) {
      if (
        a.state !== "PENDING" ||
        (a.expires_at && a.expires_at <= asOf) ||
        !this.owns(a.scope)
      )
        continue;
      const row = this.row(
        "authorization",
        a.id,
        a.revision,
        a.state,
        a.scope,
        this.created("AuthorizationRequest", a.id),
        `${a.action.action} · ${a.action.resource}`,
        `authorizations/${a.id}`,
      );
      row.operation_id = a.operation_id;
      row.authorization_id = a.id;
      row.expires_at = a.expires_at;
      if (a.expires_at) deadlines.push(a.expires_at);
      if (
        row.retention_state === "RETIRED" ||
        (row.execution_state &&
          terminal({ state: row.execution_state } as Execution))
      )
        row.warning = "所属执行已结束；批准仅决定授权，不能恢复此执行";
      items.push(row);
    }
    for (const d of this.store.all<DecisionRequest>("DecisionRequest")) {
      const scope: Scope = {
        session_id: null,
        task_id: d.task_id,
        execution_id: d.execution_id,
      };
      if (
        d.state !== "OPEN" ||
        (d.deadline && d.deadline <= asOf) ||
        !this.owns(scope)
      )
        continue;
      if (
        this.store.get<Execution>("Execution", d.execution_id).state !==
        "WAIT_DECISION"
      )
        continue;
      const row = this.row(
        "decision",
        d.id,
        d.revision,
        d.state,
        scope,
        this.created("DecisionRequest", d.id),
        d.question,
        `decisions/${d.id}`,
      );
      row.expires_at = d.deadline;
      if (d.deadline) deadlines.push(d.deadline);
      items.push(row);
    }
    const unknownOwners = new Set<string>();
    for (const op of this.store.all<Operation>("Operation")) {
      if (op.state !== "RESULT_UNKNOWN" || !this.owns(op.scope)) continue;
      if (op.scope.execution_id) unknownOwners.add(op.scope.execution_id);
      const row = this.row(
        "unknown",
        op.id,
        op.revision,
        op.state,
        op.scope,
        this.episodes.get("Operation:" + op.id) ?? { at: null, sequence: 0 },
        `${op.action.action} · ${op.error ?? "操作结果未知"}`,
        `operations/${op.id}`,
      );
      row.operation_id = op.id;
      items.push(row);
    }
    for (const e of this.store.indexed<Execution>("Execution", "state", [
      "FAILED",
      "RESULT_UNKNOWN",
    ])) {
      const scope: Scope = {
        session_id: null,
        task_id: e.task_id,
        execution_id: e.id,
      };
      if (!this.owns(scope)) continue;
      if (e.state === "FAILED") {
        const failure = this.failure(e);
        const result = e.result_id
          ? this.store.find<TaskResult>("TaskResult", e.result_id)
          : undefined;
        const provenance =
          result?.execution_id === e.id && result.outcome === "FAILED"
            ? this.created("TaskResult", result.id)
            : { at: null, sequence: 0 };
        const row = this.row(
          "failure",
          e.id,
          e.revision,
          e.state,
          scope,
          provenance,
          failure.reason,
          `executions/${e.id}`,
        );
        row.failure_category = failure.category;
        row.authorization_id = failure.authorization;
        row.operation_id = failure.operation;
        row.authorization_state = failure.authorization_state;
        row.operation_state = failure.operation_state;
        row.cause_evidence = failure.cause_evidence;
        items.push(row);
      } else if (e.state === "RESULT_UNKNOWN" && !unknownOwners.has(e.id)) {
        items.push(
          this.row(
            "unknown",
            e.id,
            e.revision,
            e.state,
            scope,
            this.episodes.get("Execution:" + e.id) ?? { at: null, sequence: 0 },
            "执行结果未知；操作/进程停止状态待核对",
            `executions/${e.id}`,
          ),
        );
      }
    }
    for (const p of this.store.indexed<TaskPlan>("TaskPlan", "state", [
      "INIT_FAILED",
    ])) {
      const scope: Scope = {
        session_id: null,
        task_id: p.id,
        execution_id: null,
      };
      if (p.state !== "INIT_FAILED" || !this.owns(scope)) continue;
      const row = this.row(
        "failure",
        p.id,
        p.revision,
        p.state,
        scope,
        this.episodes.get("TaskPlan:" + p.id) ?? { at: null, sequence: 0 },
        p.initialization_error ?? "初始化失败",
        `tasks/${p.id}`,
      );
      row.failure_category = "initialization_failed";
      row.cause_evidence = "recorded_non_rejection";
      items.push(row);
    }
    const counts: MasterAttention["counts"] = {
      authorizations: 0,
      decisions: 0,
      failures: 0,
      unknown: 0,
      authorization_rejected: 0,
      authorization_revoked: 0,
      execution_failed: 0,
      initialization_failed: 0,
      unclassified: 0,
      total: items.length,
    };
    for (const row of items) {
      counts[
        row.type === "authorization"
          ? "authorizations"
          : row.type === "decision"
            ? "decisions"
            : row.type === "failure"
              ? "failures"
              : "unknown"
      ]++;
      if (row.failure_category) counts[row.failure_category]++;
    }
    const key = (r: MasterAttentionItem): PageKey => [
      r.initiated_at ? 0 : 1,
      r.initiated_at ? -Date.parse(r.initiated_at) : 0,
      -Number(r.initiated_sequence),
      r.type,
      r.key,
    ];
    const page = this.cursors.page(
      `attention:master:${this.app.host.sessionID}`,
      items,
      q,
      key,
    );
    // No revision-only digest churn from repeated initialization attempts/checkpoints.
    const version = fingerprint(
      items
        .map(({ revision, ...row }) => row)
        .sort((a, b) => a.key.localeCompare(b.key)),
    );
    return {
      ...page,
      view: "master",
      version,
      counts,
      as_of: asOf,
      valid_until: deadlines.sort()[0] ?? null,
      session_id: this.app.host.sessionID,
    };
  }
}
