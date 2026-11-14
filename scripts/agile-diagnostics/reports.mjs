import { sha, fail } from "./io.mjs";
const fields = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
const unavailable = (reason) => ({ availability: "unavailable", reason });
const label = (value) =>
  typeof value === "string" && /^[\w./:@-]{1,128}$/.test(value)
    ? value
    : "unclassified";
const time = (value) =>
  value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const counts = (list) =>
  Object.fromEntries(
    [...new Set(list)].map((k) => [k, list.filter((v) => v === k).length]),
  );
function tokens(rows) {
  return Object.fromEntries(
    fields.map((k) => {
      const values = rows
        .map((r) => r.usage?.[k])
        .filter((v) => Number.isFinite(v) && v >= 0);
      if (
        values.some((v) => !Number.isSafeInteger(v)) ||
        !Number.isSafeInteger(values.reduce((a, b) => a + b, 0))
      )
        fail("USAGE_NUMERIC_PRECISION");
      return [
        k,
        {
          sum: values.length ? values.reduce((a, b) => a + b, 0) : null,
          known: values.length,
          missing: rows.length - values.length,
          recorded_zero: values.filter((x) => x === 0).length,
        },
      ];
    }),
  );
}
function role(s, ctx) {
  if (!ctx) return "UNCLASSIFIED";
  if (ctx.purpose !== "COMPACTION")
    return ["MAIN", "TASK"].includes(ctx.purpose)
      ? ctx.purpose
      : "UNCLASSIFIED";
  if (s.get("MemoryExtractionJob", ctx.loop_id)) return "EXTRACTION";
  if (s.get("CompactionJob", ctx.loop_id)) return "COMPACTION";
  if (s.get("SettingsApplication", ctx.loop_id)) return "SETTINGS_MAINTENANCE";
  return "COMPACTION_UNATTRIBUTED";
}
export function usageReport(s, options = {}) {
  const from = options.from ? time(options.from) : -Infinity,
    to = options.to ? time(options.to) : time(s.manifest.as_of) + 1;
  if (from === null || to === null || from >= to) fail("INVALID_TIME_RANGE");
  const timezone = options.timezone ?? "Asia/Hong_Kong";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const selectedScope = (r) =>
    (!options.task || r.scope?.task_id === options.task) &&
    (!options.execution || r.scope?.execution_id === options.execution);
  const selectedTime = (n) => n !== null && n >= from && n < to;
  const calls = s
    .all("ModelCall")
    .filter(selectedScope)
    .map((c) => {
      const ctx = s.get("Context", c.context_id),
        at = time(c.started_at) ?? time(s.first.get("ModelCall:" + c.id)?.at);
      const response = c.response ? s.json(c.response) : null;
      return {
        id: c.id,
        logical: c.logical_key ?? c.id,
        identity_unavailable: !c.logical_key,
        at,
        time_source: c.started_at ? "started_at" : "first_commit",
        day: at === null ? "unavailable" : fmt.format(new Date(at)),
        state: c.state,
        started: !!c.started_at,
        response_present: !!response,
        usage: response?.usage,
        role: role(s, ctx),
        model: label(response?.model ?? ctx?.provider_profile),
        provider: label(response?.provider),
        task: c.scope.task_id,
        execution: c.scope.execution_id,
      };
    });
  const selected = calls.filter((c) => selectedTime(c.at)),
    groups = new Map(),
    logical = new Map();
  for (const c of calls) {
    const rows = logical.get(c.logical) ?? [];
    rows.push(c);
    logical.set(c.logical, rows);
  }
  for (const c of selected) {
    const key = JSON.stringify([
      c.day,
      c.task,
      c.execution,
      c.role,
      c.model,
      c.provider,
    ]);
    const rows = groups.get(key) ?? [];
    rows.push(c);
    groups.set(key, rows);
  }
  const logicalRows = [...logical.values()].map((rows) => {
    const ordered = [...rows].sort(
      (a, b) => (a.at ?? Infinity) - (b.at ?? Infinity),
    );
    return {
      group: sha(ordered[0].logical).slice(0, 16),
      first_at: ordered[0].at,
      attempts: rows.length,
      selected_attempts: rows.filter((c) => selectedTime(c.at)).length,
      successes: rows.filter((c) => c.state === "RESPONSE_SAVED").length,
      identity_unavailable: rows.some((c) => c.identity_unavailable),
    };
  });
  const payloads = new Set(),
    selectedIds = new Set(selected.map((c) => c.id));
  for (const e of s.events.filter((e) => e.event_type === "model.payload")) {
    const p = s.json(e.payload);
    if (selectedIds.has(p.call_id)) payloads.add(p.call_id);
  }
  const auths = s.all("AuthorizationRequest").filter(selectedScope),
    authRows = [],
    repeats = new Map();
  for (const a of auths) {
    const created = time(s.first.get("AuthorizationRequest:" + a.id)?.at);
    if (!selectedTime(created)) continue;
    const decision = time(s.firstDecision.get("AuthorizationRequest:" + a.id)),
      expiry = time(a.expires_at),
      asOf = time(s.manifest.as_of);
    const expired = !decision && expiry !== null && expiry <= asOf;
    const row = {
      id: a.id,
      state: a.state,
      wait_ms:
        decision !== null && created !== null && decision >= created
          ? decision - created
          : null,
      pending_age_ms:
        !decision && !expired && a.state === "PENDING" && created !== null
          ? asOf - created
          : null,
      pending_past_expiry: expired && a.state === "PENDING",
      inferred_expiry_interval_ms:
        expired && created !== null ? Math.max(0, expiry - created) : null,
    };
    if (a.action?.parameters_ref && a.action.parameters_hash) {
      const data = s.bytes(a.action.parameters_ref);
      if (sha(data) !== a.action.parameters_hash)
        fail("PARAMETERS_HASH_MISMATCH");
      const key = sha(
        JSON.stringify([
          a.action.action,
          a.action.resource,
          a.scope?.session_id,
          a.scope?.task_id,
          a.scope?.execution_id,
          a.action.expected_resource_revision,
          a.action.parameters_hash,
        ]),
      );
      const members = repeats.get(key) ?? [];
      members.push({
        id: a.id,
        retry: !!s.get("Operation", a.operation_id)?.retry_of,
      });
      repeats.set(key, members);
    } else row.repeat_availability = "unavailable";
    authRows.push(row);
  }
  const operations = s
    .all("Operation")
    .filter(selectedScope)
    .filter((o) => selectedTime(time(s.first.get("Operation:" + o.id)?.at)));
  const ruleUse = operations
    .filter((o) => o.rule_id)
    .map((o) => ({
      id: o.rule_id,
      revision: o.rule_revision,
      kind: o.rule_id.startsWith("builtin:")
        ? "builtin"
        : s.get("AuthorizationRule", o.rule_id)
          ? "user_rule"
          : "unclassified",
    }));
  const repeated = [...repeats]
    .filter(([, v]) => v.length > 1)
    .map(([key, rows]) => ({
      group: key.slice(0, 16),
      requests: rows.length,
      extra_requests: rows.length - 1,
      retry_linked: rows.filter((r) => r.retry).length,
      independent: rows.filter((r) => !r.retry).length,
    }));
  const aggregate = (rows) => ({
    attempts: rows.length,
    states: counts(rows.map((r) => r.state)),
    response_presence: counts(
      rows.map((r) => r.state + ":" + r.response_present),
    ),
    saved_successes: rows.filter((r) => r.state === "RESPONSE_SAVED").length,
    usage: tokens(rows),
    usage_by_state_response: Object.fromEntries(
      [...new Set(rows.map((r) => r.state + ":" + r.response_present))].map(
        (key) => [
          key,
          tokens(
            rows.filter((r) => r.state + ":" + r.response_present === key),
          ),
        ],
      ),
    ),
    usage_by_state: Object.fromEntries(
      [...new Set(rows.map((r) => r.state))].map((state) => [
        state,
        tokens(rows.filter((r) => r.state === state)),
      ]),
    ),
  });
  const detailLimit = s.limits.details;
  return {
    format: "secretary-usage-report-v1",
    as_of: s.manifest.as_of,
    generated_at: new Date().toISOString(),
    selection: {
      from: options.from ?? null,
      to: options.to ?? s.manifest.as_of,
      timezone,
      task: options.task ?? null,
      execution: options.execution ?? null,
      interval: "[from,to); omitted to includes capture timestamp",
    },
    ...aggregate(selected),
    identity_unavailable_calls: selected.filter((c) => c.identity_unavailable)
      .length,
    recorded_started_attempts: selected.filter((c) => c.started).length,
    payload_prepared_count: payloads.size,
    physical_sends: unavailable(
      "No durable network-send evidence; IN_FLIGHT and payload precede fetch",
    ),
    estimated_cost: unavailable("No source/version-qualified price metadata"),
    usage_provenance:
      "Recorded SDK/provider values; absent values unknown; zero does not prove free usage; not context occupancy",
    logical_calls: logicalRows.filter((x) => selectedTime(x.first_at)).length,
    logical_groups_intersecting_window: logicalRows.filter(
      (x) => x.selected_attempts,
    ).length,
    partial_window_groups: logicalRows.filter(
      (x) => x.selected_attempts && x.selected_attempts !== x.attempts,
    ).length,
    anomalous_multiple_success_groups: logicalRows.filter(
      (x) => x.selected_attempts && x.successes > 1,
    ).length,
    unclassified_time_calls: calls.filter((c) => c.at === null).length,
    groups: [...groups.values()].slice(0, detailLimit).map((rows) => ({
      day: rows[0].day,
      task_id: rows[0].task,
      execution_id: rows[0].execution,
      role: rows[0].role,
      model: rows[0].model,
      provider: rows[0].provider,
      ...aggregate(rows),
    })),
    group_count: groups.size,
    groups_truncated: groups.size > detailLimit,
    authorization: {
      requests: authRows.length,
      states: counts(authRows.map((a) => a.state)),
      completed_wait_known: authRows.filter((a) => a.wait_ms !== null).length,
      completed_wait_ms: authRows.reduce((n, a) => n + (a.wait_ms ?? 0), 0),
      pending_past_expiry: authRows.filter((a) => a.pending_past_expiry).length,
      expiry_is_inferred_not_decision: true,
      remembered_rule_creations: auths.filter(
        (a) => a.remembered_rule_id && authRows.some((r) => r.id === a.id),
      ).length,
      rule_uses: counts(ruleUse.map((r) => r.kind)),
      repeated_groups: repeated.slice(0, detailLimit),
      repeated_group_count: repeated.length,
      repeated_groups_truncated: repeated.length > detailLimit,
      sample: authRows.slice(0, Math.min(20, detailLimit)),
      sample_truncated: authRows.length > Math.min(20, detailLimit),
    },
    reconciliation_sample: selected
      .slice(0, Math.min(20, detailLimit))
      .map(({ usage, logical, ...r }) => ({
        ...r,
        usage: Object.fromEntries(
          fields.map((k) => [
            k,
            Number.isFinite(usage?.[k]) && usage[k] >= 0 ? usage[k] : null,
          ]),
        ),
      })),
    read: s.metrics(),
  };
}
export function memoryReport(s) {
  const asOf = s.manifest.as_of;
  const field = (value, source, reason) => ({
    source,
    scope: "captured session",
    method: "static recorded metadata projection",
    observed_at: new Date().toISOString(),
    as_of: asOf,
    availability:
      value === null || value === undefined ? "unavailable" : "available",
    ...(value === null || value === undefined
      ? { reason: reason ?? "No captured source" }
      : { value }),
  });
  const sessions = s.all("Session"),
    session = sessions.find((x) => x.id === s.manifest.session_id);
  const cs = session && s.get("Consciousness", session.consciousness_id);
  const jobs = s
      .all("CompactionJob")
      .filter((x) => x.session_id === session?.id),
    latest = jobs.at(-1),
    success = jobs.filter((j) => j.state === "COMMITTED").at(-1);
  const activation =
    cs?.settings_application_id &&
    s.get("SettingsApplication", cs.settings_application_id);
  const activationNewer =
    activation && (!latest || activation.updated_at > latest.updated_at);
  const extractions = s
    .all("MemoryExtractionJob")
    .filter((x) => x.session_id === session?.id);
  const prompts = s
      .all("MainPromptSnapshot")
      .filter((x) => x.session_id === session?.id),
    prompt = prompts.at(-1);
  const recall = prompt?.recall_ref ? s.json(prompt.recall_ref) : null;
  const contexts = s.all("Context").filter((x) => x.session_id === session?.id),
    ctx = contexts.at(-1);
  const cp = s.manifest.search_checkpoint?.row,
    seq = cp ? Number(cp.journal_sequence) : null;
  const checkpoint = cp
    ? {
        source_match: cp.source_id === s.frames.get(1),
        policy_match: cp.policy_version === s.manifest.search_policy,
        sequence_digest_match: s.frames.get(seq) === cp.journal_digest,
        actual_counts: "not_verified_no_scan",
        stored_document_count: cp.document_count,
        stored_chunk_count: cp.chunk_count,
        indexed_journal_sequence: cp.journal_sequence,
        lag:
          cp.source_id === s.frames.get(1) &&
          s.frames.get(seq) === cp.journal_digest
            ? s.metrics().sequence - seq
            : null,
        acceptance: "not_verified",
      }
    : null;
  const allowedError = (error) =>
    typeof error !== "string"
      ? null
      : ([
          "CAPACITY",
          "TIMEOUT",
          "INTERRUPTED",
          "INVALID",
          "MISSING",
          "CONFLICT",
          "CANCELLED",
        ].find((k) => error.toUpperCase().includes(k)) ?? "UNCLASSIFIED");
  const pending = extractions.filter(
    (j) => !j.merged && (j.state !== "FAILED" || j.next_attempt_at !== null),
  );
  const failed = extractions.filter(
    (j) => j.state === "FAILED" && !j.next_attempt_at,
  );
  const scalarBudget = ctx?.request_budget
    ? Object.fromEntries(
        Object.entries(ctx.request_budget).filter(
          ([k, v]) =>
            [
              "estimated_tokens",
              "effective_context_window",
              "usable_input_tokens",
              "occupancy",
              "count_method",
              "deployment_limit_verified",
              "effective_output_tokens",
            ].includes(k) && ["number", "string", "boolean"].includes(typeof v),
        ),
      )
    : null;
  let payload = null;
  const capacity = [];
  for (const e of s.events) {
    if (e.scope?.session_id !== session?.id) continue;
    const p = s.json(e.payload);
    if (e.event_type === "model.payload")
      payload = {
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        count_method: p.count_method,
        source_event_sequence: e.sequence,
      };
    else
      capacity.push({
        source_event_sequence: e.sequence,
        sent: p.sent === false ? false : null,
        category: allowedError(p.error),
      });
  }
  return {
    format: "secretary-memory-report-v1",
    as_of: asOf,
    atomic_live_snapshot: false,
    revision: field(cs?.revision, "Session→Consciousness"),
    coverage: field(
      cs?.covered_event_sequence,
      "Consciousness.covered_event_sequence",
    ),
    maintenance: field(
      session
        ? {
            state: activationNewer
              ? "SETTINGS_APPLIED"
              : (latest?.state ?? "NOT_NEEDED"),
            latest_created_job: latest?.id ?? null,
            latest_success_at:
              activation &&
              (!success || activation.updated_at > success.updated_at)
                ? activation.updated_at
                : (success?.updated_at ?? null),
            retry_round: latest?.retry_round ?? 0,
            next_attempt_at: latest?.next_attempt_at ?? null,
            mode: latest?.mode ?? null,
            error_categories: [
              ...new Set((latest?.validation_errors ?? []).map(allowedError)),
            ],
            ordering:
              "first mutation sequence and index; revisions retain insertion position",
          }
        : null,
      "CompactionJob / SettingsApplication",
    ),
    extraction: field(
      session
        ? {
            pending: pending.length,
            failed: failed.length,
            pending_reasons: counts(
              pending.map((j) => allowedError(j.error) ?? "NO_RECORDED_ERROR"),
            ),
            failed_reasons: counts(
              failed.map((j) => allowedError(j.error) ?? "NO_RECORDED_ERROR"),
            ),
          }
        : null,
      "MemoryExtractionJob latest revisions",
    ),
    search_checkpoint: field(
      checkpoint,
      "captured read-only mem.checkpoint",
      s.manifest.search_checkpoint?.availability ?? "not captured",
    ),
    live_search: field(
      null,
      "live query not performed by reporter",
      "Checkpoint is not proof of current availability",
    ),
    recall: field(
      recall
        ? {
            prompt_id: prompt.id,
            prompt_updated_at: prompt.updated_at,
            recall_mode: ["off", "shadow", "on"].includes(recall.recall_mode)
              ? recall.recall_mode
              : null,
            profile_mode: ["off", "on"].includes(recall.profile_mode)
              ? recall.profile_mode
              : null,
            hits: Array.isArray(recall.hits) ? recall.hits.length : null,
            status: ["hit", "no_hit", "unavailable"].includes(recall.status)
              ? recall.status
              : "unclassified",
            query_truncated: recall.query_truncated ?? null,
          }
        : null,
      "MainPromptSnapshot.recall_ref; historical prompt only",
    ),
    request_budget: field(
      scalarBudget,
      "latest-created Context.request_budget; recorded estimate, not cumulative usage",
    ),
    latest_payload_estimate: field(
      payload,
      "model.payload scalar facts; not physical CAS bytes or network sends",
    ),
    capacity_blocks: field(
      {
        count: capacity.length,
        sample: capacity.slice(-s.limits.details),
        truncated: capacity.length > s.limits.details,
      },
      "model.capacity_blocked events",
    ),
    read: s.metrics(),
  };
}
