import type { App } from "./app.ts";
import type { Store } from "./store.ts";
import type {
  TaskPlan,
  TaskProposal,
  Execution,
  WorkScope,
  TaskResult,
  AuthorizationRequest,
  DecisionRequest,
} from "./contracts.ts";
import type {
  Message,
  TaskBrowserTask,
  TaskBrowserGroup,
  TaskBrowserRow,
  TaskBrowserPage,
  TaskBrowserExecution,
  TaskBrowserDetail,
  TaskBrowserMessages,
} from "./api/contracts.ts";
import { ApiError, Cursors, fingerprint, limitOf } from "./api/protocol.ts";
import { terminal } from "./execution-utils.ts";
import {
  visibleThinking,
  thinkingPreview,
  type DisplayBlock,
} from "./thinking-preview.ts";

const PAGE_BYTES = 240 * 1024;
const compareID = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const desc = (a: string | null, b: string | null) =>
  a === b
    ? 0
    : a === null
      ? 1
      : b === null
        ? -1
        : Date.parse(b) - Date.parse(a);
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
const fragment = (value: string, offset = 0, length = 4096) => {
  const sample = value.slice(offset, offset + length + 4096);
  let end = 0;
  for (const piece of graphemes.segment(sample)) {
    const next = piece.index + piece.segment.length;
    if (next > length) {
      if (end) break;
      if (next === sample.length && offset + next < value.length)
        throw new ApiError("GRAPHEME_EXCEEDS_FRAGMENT_BOUND", 413);
      end = next;
      break;
    }
    end = next;
  }
  return sample.slice(0, end);
};
const preview = (value: string | null | undefined) =>
  value == null ? null : fragment(value);
const validTime = (value: string | null | undefined): value is string =>
  !!value && Number.isFinite(Date.parse(value));

/** Business facts only. No read marks an execution viewed or changes its retention. */
export function effectiveSchedule(p: TaskPlan, asOf: string) {
  return (
    p.state === "ACTIVE" &&
    ["AT", "INTERVAL"].includes(p.trigger.kind) &&
    validTime(p.next_due_at) &&
    (!p.deadline ||
      (validTime(p.deadline) &&
        Date.parse(p.deadline) >
          Math.max(Date.parse(asOf), Date.parse(p.next_due_at))))
  );
}
export function actionableFailure(e: Execution, executions: Execution[]) {
  return (
    e.state === "FAILED" &&
    !executions.some(
      (n) =>
        n.task_id === e.task_id &&
        executions.indexOf(n) > executions.indexOf(e),
    )
  );
}
export function applicableAuthorization(a: AuthorizationRequest, asOf: string) {
  return (
    ["PENDING", "APPROVED"].includes(a.state) &&
    (!a.expires_at || a.expires_at > asOf)
  );
}
export function applicableDecision(
  d: DecisionRequest,
  e: Execution | undefined | (() => Execution | undefined),
  asOf: string,
) {
  return (
    d.state === "OPEN" &&
    (!d.deadline || d.deadline > asOf) &&
    (typeof e === "function" ? e() : e)?.state === "WAIT_DECISION"
  );
}

/** Rebuildable indexes follow existing journal frames; authoritative data stays in Store. */
export class TaskBrowser {
  private frame = 0;
  private plans = new Map<string, TaskPlan>();
  private scopes = new Map<string, WorkScope>();
  private executions = new Map<string, Map<string, Execution>>();
  private executionSignatures = new Map<string, string>();
  private factsCache = new Map<
    string,
    {
      created: Execution[];
      rounds: Execution[];
      active: Execution[];
      unknown: string[];
      failed: boolean;
    }
  >();
  private proposals = new Map<string, { hash: string; value: TaskProposal }>();
  constructor(
    readonly app: App,
    readonly cursors: Cursors,
  ) {}
  get store(): Store {
    return this.app.store;
  }
  private sync() {
    for (; this.frame < this.store.projectionFrames.length; this.frame++) {
      for (const m of this.store.projectionFrames[this.frame].mutations) {
        if (m.object_type === "TaskPlan")
          this.plans.set(m.object_id, this.store.get("TaskPlan", m.object_id));
        if (m.object_type === "Scope")
          this.scopes.set(m.object_id, this.store.get("Scope", m.object_id));
        if (m.object_type === "Execution") {
          const e = this.store.get<Execution>("Execution", m.object_id);
          let bucket = this.executions.get(e.task_id);
          if (!bucket) this.executions.set(e.task_id, (bucket = new Map()));
          const signature = fingerprint([
            e.state,
            e.started_at,
            e.ended_at,
            e.retention_state,
            e.result_id,
            e.plan_revision,
            e.unknown_operation_ids,
          ]);
          if (this.executionSignatures.get(e.id) !== signature) {
            this.factsCache.delete(e.task_id);
            this.executionSignatures.set(e.id, signature);
          }
          bucket.set(e.id, e);
        }
      }
    }
  }
  private created(type: string, id: string) {
    const sequence = this.store.firstSequence(type, id);
    const frame = this.store.projectionFrames[sequence - 1];
    const first = frame?.mutations.find(
      (m) =>
        m.object_type === type &&
        m.object_id === id &&
        m.expected_revision === 0,
    );
    return {
      at: first ? frame.committed_at : null,
      sequence: String(sequence),
    };
  }
  private proposal(p: TaskPlan) {
    const cached = this.proposals.get(p.id);
    if (cached?.hash === p.proposal_ref.sha256) return cached.value;
    const value = this.store.read<TaskProposal>(p.proposal_ref);
    this.proposals.set(p.id, { hash: p.proposal_ref.sha256, value });
    return value;
  }
  private facts(taskID: string) {
    const cached = this.factsCache.get(taskID);
    if (cached) return cached;
    const created = [...(this.executions.get(taskID)?.values() ?? [])];
    const rounds = [...created].sort(
      (a, b) => desc(this.invoked(a), this.invoked(b)) || compareID(a.id, b.id),
    );
    const last = created.at(-1);
    const facts = {
      created,
      rounds,
      active: created.filter((e) => !terminal(e)),
      unknown: [...new Set(created.flatMap((e) => e.unknown_operation_ids))],
      failed: !!last && actionableFailure(last, created),
    };
    this.factsCache.set(taskID, facts);
    return facts;
  }
  private attention(at: string) {
    const byTask = new Map<string, { ids: string[]; expires: string[] }>();
    const add = (
      taskID: string | null | undefined,
      id: string,
      expires: string | null,
    ) => {
      const p = taskID ? this.plans.get(taskID) : undefined;
      if (!p || !this.browsable(p)) return;
      let bucket = byTask.get(p.id);
      if (!bucket) byTask.set(p.id, (bucket = { ids: [], expires: [] }));
      bucket.ids.push(id);
      if (expires) bucket.expires.push(expires);
    };
    for (const a of this.store.all<AuthorizationRequest>(
      "AuthorizationRequest",
    ))
      if (applicableAuthorization(a, at))
        add(
          a.scope.execution_id
            ? this.store.find<Execution>("Execution", a.scope.execution_id)
                ?.task_id
            : a.scope.task_id,
          a.id,
          a.expires_at,
        );
    for (const d of this.store.all<DecisionRequest>("DecisionRequest")) {
      const e = this.store.find<Execution>("Execution", d.execution_id);
      if (applicableDecision(d, e, at)) add(e?.task_id, d.id, d.deadline);
    }
    return byTask;
  }
  private browsable(p: TaskPlan) {
    return (
      this.proposal(p).session_id === this.app.host.sessionID &&
      (!p.scope_id || this.scopes.get(p.scope_id)?.state === "ACTIVE")
    );
  }
  private task(id: string) {
    const p = this.plans.get(id);
    if (!p || !this.browsable(p)) throw new ApiError("TASK_NOT_BROWSABLE", 404);
    return p;
  }
  private rounds(p: TaskPlan) {
    return this.facts(p.id).rounds;
  }
  private invoked(e: Execution) {
    return e.started_at ?? this.created("Execution", e.id).at;
  }
  private executionView(p: TaskPlan, e: Execution): TaskBrowserExecution {
    const created = this.created("Execution", e.id);
    const kind = this.store.taskPlanAt(p.id, e.plan_revision).executor.kind;
    return {
      id: e.id,
      state: e.state,
      kind,
      retention_state: e.retention_state,
      created_at: created.at,
      created_sequence: created.sequence,
      started_at: e.started_at,
      ended_at: e.ended_at,
      invoked_at: this.invoked(e),
      ordering_source: e.started_at
        ? "started_at"
        : created.at
          ? "created_at"
          : "unavailable",
      history_availability:
        kind === "PROGRAM"
          ? "not_agent"
          : this.store
                .executionEvents(e.id)
                .some((l) => l.event_type === "agent.message")
            ? "recorded"
            : "no_recorded_messages",
    };
  }
  private projection(
    p: TaskPlan,
    at: string,
    attention = this.attention(at),
  ): TaskBrowserTask {
    const { active, rounds, unknown, failed } = this.facts(p.id),
      latest = rounds[0];
    const attentionIDs = attention.get(p.id)?.ids ?? [];
    const reasons: string[] = [];
    if (active.length) reasons.push("nonterminal_execution");
    if (p.pending_requests?.length) reasons.push("queued_request");
    if (p.pending_occurrences.length) reasons.push("queued_occurrence");
    const scheduled = effectiveSchedule(p, at);
    if (scheduled) reasons.push("future_schedule");
    if (["INITIALIZING", "INIT_FAILED"].includes(p.state))
      reasons.push(p.state.toLowerCase());
    if (attentionIDs.length) reasons.push("attention");
    if (unknown.length) reasons.push("unknown_operation");
    if (failed) reasons.push("actionable_failure");
    const goal = this.proposal(p).goal;
    const result = latest?.result_id
      ? this.store.find<TaskResult>("TaskResult", latest.result_id)
      : undefined;
    const dues = [
      ...(p.pending_requests ?? []).map((r) => r.due_at),
      ...p.pending_occurrences,
    ]
      .filter(validTime)
      .sort();
    return {
      id: p.id,
      scope_id: p.scope_id ?? null,
      scope_name: p.scope_id ? this.scopes.get(p.scope_id)!.name : "Shared",
      revision: String(p.revision),
      goal: fragment(goal),
      goal_truncated: fragment(goal).length < goal.length,
      state: p.state,
      executor: p.executor.kind,
      trigger: p.trigger.kind,
      next_due_at: p.next_due_at,
      deadline: p.deadline,
      schedule_status: scheduled
        ? "scheduled"
        : p.trigger.kind === "EVENT"
          ? "unsupported_trigger"
          : p.deadline &&
              p.deadline <=
                (p.next_due_at && p.next_due_at > at ? p.next_due_at : at)
            ? "deadline_ineligible"
            : "not_scheduled",
      current_reasons: reasons,
      active_executions: active.map((e) => this.executionView(p, e)),
      latest_execution: latest ? this.executionView(p, latest) : null,
      pending_request_count: p.pending_requests?.length ?? 0,
      pending_occurrence_count: p.pending_occurrences.length,
      pending_due_at: dues[0] ?? null,
      attention_ids: attentionIDs,
      unknown_operation_ids: unknown,
      latest_result: result
        ? preview(`${result.outcome}: ${result.summary}`)
        : null,
      initialization_error: preview(p.initialization_error),
      current: reasons.length > 0,
    };
  }
  private listing(at: string) {
    const attention = this.attention(at);
    const tasks = [...this.plans.values()]
      .filter((p) => this.browsable(p))
      .map((p) => this.projection(p, at, attention));
    const groups = new Map<
      string,
      { group: TaskBrowserGroup; tasks: TaskBrowserTask[] }
    >();
    for (const task of tasks.filter((t) => t.current)) {
      const id = task.scope_id ? "scope:" + task.scope_id : "shared:null";
      let group = groups.get(id);
      if (!group) {
        const created = task.scope_id
          ? this.created("Scope", task.scope_id)
          : null;
        groups.set(
          id,
          (group = {
            group: {
              id,
              scope_id: task.scope_id,
              name: task.scope_name,
              count: 0,
              created_at: created?.at ?? null,
              created_sequence: created?.sequence ?? null,
              active_at: null,
            },
            tasks: [],
          }),
        );
      }
      group.tasks.push(task);
      group.group.count++;
      for (const e of task.active_executions)
        if (
          e.invoked_at &&
          (!group.group.active_at || e.invoked_at > group.group.active_at)
        )
          group.group.active_at = e.invoked_at;
    }
    const ordered = [...groups.values()].sort((a, b) => {
      const aa = a.tasks.some((t) => t.active_executions.length),
        bb = b.tasks.some((t) => t.active_executions.length);
      if (aa !== bb) return aa ? -1 : 1;
      if (aa)
        return (
          desc(a.group.active_at, b.group.active_at) ||
          compareID(a.group.id, b.group.id)
        );
      if (!!a.group.scope_id !== !!b.group.scope_id)
        return a.group.scope_id ? -1 : 1;
      return (
        desc(a.group.created_at, b.group.created_at) ||
        compareID(a.group.id, b.group.id)
      );
    });
    const rows: TaskBrowserRow[] = [];
    for (const g of ordered) {
      rows.push({ id: g.group.id, kind: "group", group: g.group });
      g.tasks.sort(
        (a, b) =>
          desc(
            a.latest_execution?.invoked_at ?? null,
            b.latest_execution?.invoked_at ?? null,
          ) || compareID(a.id, b.id),
      );
      for (const t of g.tasks) rows.push({ id: t.id, kind: "task", task: t });
    }
    const counts = {
      scopes: ordered.filter((g) => g.group.scope_id).length,
      archived_scopes: [...this.scopes.values()].filter(
        (s) => s.state === "ARCHIVED",
      ).length,
      shared_tasks: groups.get("shared:null")?.group.count ?? 0,
    };
    // Content/checkpoint changes refresh visible rows, but do not invalidate list traversal.
    const generation = fingerprint({
      keys: rows.map((r) => r.id),
      counts,
      groups: ordered.map((g) => [g.group.id, g.group.count]),
    });
    const deadlines = [...this.plans.values()]
      .filter((p) => this.browsable(p) && effectiveSchedule(p, at))
      .map((p) => p.deadline);
    const expiry = [
      ...deadlines,
      ...[...attention.values()].flatMap((v) => v.expires),
    ]
      .filter((v): v is string => !!v && v > at)
      .sort();
    return { rows, tasks, counts, generation, valid_until: expiry[0] ?? null };
  }
  private page<T extends { id: string }>(
    rows: T[],
    q: URLSearchParams,
    scope: string,
    around?: string,
  ) {
    const limit = q.has("limit") ? limitOf(q) : 50;
    let start = 0,
      end = rows.length;
    if (around) {
      start = rows.findIndex((r) => r.id === around);
      if (start < 0) throw new ApiError("BROWSER_ITEM_NOT_FOUND", 404);
      if (q.get("direction") === "before") {
        end = start + 1;
        start = Math.max(0, end - limit);
      } else end = Math.min(rows.length, start + limit);
    } else if (q.has("cursor")) {
      const c = this.cursors.decode<{ id: string }>(scope, q.get("cursor")!);
      const pos = rows.findIndex((r) => r.id === c.id);
      if (pos < 0) throw new ApiError("BROWSER_RESET_REQUIRED", 409);
      if (q.get("direction") === "before") {
        end = pos;
        start = Math.max(0, end - limit);
      } else {
        start = pos + 1;
        end = Math.min(rows.length, start + limit);
      }
    } else end = Math.min(end, limit);
    let items = rows.slice(start, end),
      bytes = 2;
    const bounded: T[] = [];
    for (const row of items) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (bytes + size > PAGE_BYTES) {
        if (!bounded.length) throw new ApiError("BROWSER_ROW_TOO_LARGE", 413);
        break;
      }
      bounded.push(row);
      bytes += size;
    }
    items = bounded;
    end = start + items.length;
    return {
      items,
      before:
        start > 0 && items.length
          ? this.cursors.encode(scope, { id: items[0].id })
          : null,
      after:
        end < rows.length && items.length
          ? this.cursors.encode(scope, { id: items.at(-1)!.id })
          : null,
    };
  }
  query(
    path: string,
    q: URLSearchParams,
  ): TaskBrowserPage | TaskBrowserDetail | TaskBrowserMessages | Message {
    this.sync();
    const parts = path.split("/");
    const allowed =
      parts.length === 1
        ? ["limit", "cursor", "direction"]
        : parts[1] === "locate"
          ? ["task_id", "match", "suggest", "limit"]
          : parts.length === 2
            ? ["cursor", "thinking"]
            : parts.length === 5
              ? ["limit", "cursor", "direction", "message_id", "thinking"]
              : ["cursor", "thinking"];
    for (const key of q.keys())
      if (!allowed.includes(key) || q.getAll(key).length !== 1)
        throw new ApiError("INVALID_QUERY");
    for (const key of ["thinking", "suggest"])
      if (q.has(key) && !["true", "false"].includes(q.get(key)!))
        throw new ApiError("INVALID_QUERY");
    if (
      q.has("direction") &&
      !["before", "after"].includes(q.get("direction")!)
    )
      throw new ApiError("INVALID_QUERY");
    if (q.has("limit")) limitOf(q);
    const at = new Date().toISOString();
    if (parts.length === 1 || parts[1] === "locate") {
      const list = this.listing(at);
      let target: string | null = null,
        historical: TaskBrowserTask | null = null,
        suggestions: string[] = [];
      if (parts[1] === "locate") {
        if (parts.length !== 2) throw new ApiError("NOT_FOUND", 404);
        const token = q.get("task_id") ?? "";
        if (
          (!token && q.get("suggest") !== "true") ||
          !/^[0-9A-Za-z-]*$/.test(token ?? "") ||
          !["exact", "prefix"].includes(q.get("match") ?? "exact")
        )
          throw new ApiError("INVALID_LOCATOR");
        const matches = list.tasks.filter(
          (t) =>
            t.id === token ||
            (q.get("match") === "prefix" && t.id.startsWith(token)),
        );
        if (q.get("suggest") === "true")
          suggestions = matches
            .map((t) => t.id)
            .sort(compareID)
            .slice(0, q.has("limit") ? limitOf(q) : 20);
        else {
          const exact = matches.find((t) => t.id === token);
          if (!exact && matches.length !== 1)
            throw new ApiError(
              matches.length ? "AMBIGUOUS_TASK_ID" : "TASK_NOT_BROWSABLE",
              matches.length ? 409 : 404,
            );
          const hit = exact ?? matches[0];
          target = hit.id;
          if (!hit.current) historical = hit;
        }
      }
      const page = this.page(
        list.rows,
        q,
        "task-browser:" + list.generation,
        historical ? undefined : (target ?? undefined),
      );
      if (page.items[0]?.kind === "task") {
        const groupID = page.items[0].task.scope_id
          ? "scope:" + page.items[0].task.scope_id
          : "shared:null";
        const header = list.rows.find((r) => r.id === groupID);
        if (header?.kind === "group")
          page.items.unshift({ ...header, id: "continued:" + header.id });
      }
      return {
        ...page,
        counts: list.counts,
        generation: list.generation,
        version: String(this.store.sequence),
        as_of: at,
        valid_until: list.valid_until,
        target,
        historical,
        suggestions,
      };
    }
    const p = this.task(parts[1]);
    if (parts.length === 2) {
      const task = this.projection(p, at),
        proposal = this.proposal(p);
      const latest = this.rounds(p)[0];
      const result = latest?.result_id
        ? this.store.find<TaskResult>("TaskResult", latest.result_id)
        : null;
      const text = [
        proposal.goal,
        ...proposal.constraints.map((s) => "Constraint: " + s),
        ...proposal.acceptance_criteria.map((s) => "Acceptance: " + s),
        ...(p.initialization_error
          ? ["Initialization error: " + p.initialization_error]
          : []),
        ...(p.pending_requests ?? []).map(
          (r) =>
            `Queued request ${r.request_id}; occurrence ${r.occurrence_key}; due ${r.due_at}`,
        ),
        ...p.pending_occurrences.map((due) => "Queued occurrence due " + due),
        ...(result
          ? [
              `Result ${result.outcome}: ${result.summary}`,
              ...result.limitations,
            ]
          : []),
      ].join("\n\n");
      const message = this.content(
        {
          id: "detail:" + p.id,
          kind: "message",
          revision: BigInt("0x" + fingerprint(text)).toString(),
          role: "system",
          text,
          call_id: null,
          incomplete: false,
          next_cursor: null,
          task_id: p.id,
        },
        q,
        "detail:" + p.id,
      );
      return {
        ...message,
        task,
        executions: this.rounds(p)
          .slice(0, 3)
          .map((e) => this.executionView(p, e)),
      };
    }
    if (parts[2] !== "executions" || parts[4] !== "messages")
      throw new ApiError("NOT_FOUND", 404);
    const execution = this.rounds(p)
      .slice(0, 3)
      .find((e) => e.id === parts[3]);
    if (!execution) throw new ApiError("EXECUTION_OUTSIDE_RECENT_THREE", 404);
    const events = this.store
      .executionEvents(execution.id)
      .filter((e) => e.event_type === "agent.message");
    const mode = q.get("thinking") === "true";
    const eventMessage = (eid: string): Message => {
      const event = events.find((e) => e.event_id === eid);
      if (!event) throw new ApiError("MESSAGE_NOT_FOUND", 404);
      try {
        const raw = this.store.read<{
          role: string;
          content: string | DisplayBlock[];
          stopReason?: string;
          toolCallId?: string;
          toolName?: string;
          isError?: boolean;
        }>(event.payload);
        const blocks = Array.isArray(raw.content) ? raw.content : [];
        const text =
          typeof raw.content === "string"
            ? raw.content
            : blocks
                .map((b) =>
                  b.type === "text"
                    ? (b.text ?? "")
                    : b.type === "thinking"
                      ? ""
                      : b.type === "toolCall"
                        ? `Tool ${String((b as any).name)} (${String((b as any).id)})\n${JSON.stringify((b as any).arguments)}`
                        : `[${b.type}: non-text content]`,
                )
                .filter(Boolean)
                .join("\n");
        return {
          id: event.event_id,
          kind: "message",
          revision: String(event.sequence),
          role: raw.role,
          at: event.occurred_at,
          text,
          thinking: mode ? [...visibleThinking(blocks)].join("\n") : undefined,
          thinking_preview: thinkingPreview(blocks),
          call_id: raw.toolCallId ?? null,
          ...(raw.toolName ? { tool_name: raw.toolName } : {}),
          ...(raw.isError || raw.stopReason === "error"
            ? { outcome: "failed" as const }
            : raw.stopReason === "aborted"
              ? { outcome: "interrupted" as const }
              : raw.stopReason === "length"
                ? { outcome: "truncated" as const }
                : raw.stopReason === "stop"
                  ? { outcome: "completed" as const }
                  : raw.stopReason === "toolUse"
                    ? { outcome: "continued" as const }
                    : {}),
          incomplete: false,
          next_cursor: null,
          persistence: "durable",
          source_event_id: event.event_id,
          task_id: p.id,
          execution_id: execution.id,
        };
      } catch {
        throw new ApiError("AGENT_MESSAGE_UNAVAILABLE", 410);
      }
    };
    const scope = `agent:${p.id}:${execution.id}:${mode}`;
    if (parts.length === 7 && parts[6] === "content")
      return this.content(eventMessage(parts[5]), q, scope);
    if (parts.length !== 5) throw new ApiError("NOT_FOUND", 404);
    const identities = events.map((e) => ({ id: e.event_id }));
    const page = this.page(
      identities,
      q,
      scope,
      q.get("message_id") ?? undefined,
    );
    let unavailable = false;
    const items = page.items.map((row) => {
      try {
        return this.content(
          eventMessage(row.id),
          new URLSearchParams({ thinking: String(mode) }),
          scope,
        );
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.code !== "AGENT_MESSAGE_UNAVAILABLE"
        )
          throw error;
        unavailable = true;
        return {
          id: row.id,
          kind: "message" as const,
          revision: "1",
          role: "system",
          text: "Agent message unavailable",
          call_id: null,
          incomplete: true,
          next_cursor: null,
          task_id: p.id,
          execution_id: execution.id,
        };
      }
    });
    // Messages carry only small initial fragments; cap the complete response as well.
    while (
      items.length > 1 &&
      Buffer.byteLength(JSON.stringify(items)) > PAGE_BYTES
    )
      items.pop();
    const last = items.at(-1)?.id;
    const lastIndex = identities.findIndex((i) => i.id === last);
    return {
      items,
      before: page.before,
      after:
        last && lastIndex < identities.length - 1
          ? this.cursors.encode(scope, { id: last })
          : null,
      generation: scope,
      version: String(this.store.sequence),
      availability: unavailable
        ? "partially_unavailable"
        : events.length
          ? "recorded"
          : this.executionView(p, execution).history_availability,
    };
  }
  private content(
    message: Message,
    q: URLSearchParams,
    scope: string,
  ): Message {
    scope +=
      ":" +
      message.id +
      ":" +
      message.revision +
      ":" +
      (q.get("thinking") === "true");
    const position = q.has("cursor")
      ? this.cursors.decode<{ body: number; thinking: number }>(
          scope,
          q.get("cursor")!,
        )
      : { body: 0, thinking: 0 };
    const full = message.text,
      thought = q.get("thinking") === "true" ? (message.thinking ?? "") : "";
    if (
      ![position.body, position.thinking].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      position.body > full.length ||
      position.thinking > thought.length
    )
      throw new ApiError("CURSOR_EXPIRED", 409);
    const text = fragment(full, position.body),
      thinking = fragment(thought, position.thinking);
    const next = {
      body: position.body + text.length,
      thinking: position.thinking + thinking.length,
    };
    return {
      ...message,
      text,
      ...(q.get("thinking") === "true" ? { thinking } : {}),
      next_cursor:
        next.body < full.length || next.thinking < thought.length
          ? this.cursors.encode(scope, next)
          : null,
    };
  }
}
