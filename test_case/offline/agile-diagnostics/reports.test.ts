// @ts-nocheck -- standalone JavaScript tooling boundary.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, at } from "./fixtures.mjs";
import { readSnapshot } from "../../../scripts/agile-diagnostics/snapshot-reader.mjs";
import {
  usageReport,
  memoryReport,
} from "../../../scripts/agile-diagnostics/reports.mjs";
const using = async (fn) => {
  const f = fixture();
  try {
    await fn(f);
  } finally {
    f.cleanup();
  }
};
function call(f, patch = {}) {
  const c = f.make("ModelCall", {
    state: "RESPONSE_SAVED",
    started_at: at,
    completed_at: at,
    response: f.put({
      model: "synthetic",
      provider: "fixture",
      usage: { input: 10, output: 0, totalTokens: 10 },
    }),
    logical_key: randomUUID().replaceAll("-", "").repeat(2),
    scope: { session_id: randomUUID(), task_id: null, execution_id: null },
    ...patch,
  });
  const ctx = f.make("Context", { id: c.context_id, purpose: "MAIN" });
  return { c, ctx };
}
test("attempts, logical calls, equal response bodies, replay revisions, missing vs zero, saved aborted usage", () =>
  using(async (f) => {
    const { c, ctx } = call(f);
    const failed = {
      ...c,
      id: randomUUID(),
      state: "FAILED",
      response: null,
      transport_attempt: 1,
    };
    const aborted = {
      ...c,
      id: randomUUID(),
      logical_key: randomUUID().replaceAll("-", "").repeat(2),
      state: "INTERRUPTED",
    };
    const equal = {
      ...c,
      id: randomUUID(),
      logical_key: randomUUID().replaceAll("-", "").repeat(2),
    };
    f.commit([ctx, failed, c, aborted, equal]);
    f.commit([{ ...c, revision: 2 }]);
    const s = await readSnapshot(f.seal());
    const r = usageReport(s);
    assert.equal(r.attempts, 4);
    assert.equal(r.saved_successes, 2);
    assert.equal(r.logical_calls, 3);
    assert.equal(r.usage.input.sum, 30);
    assert.equal(r.usage.input.missing, 1);
    assert.equal(r.usage.output.recorded_zero, 3);
    assert.equal(r.usage.cacheRead.sum, null);
    assert.equal(r.usage_by_state.INTERRUPTED.input.sum, 10);
    assert.equal(r.usage_by_state_response["INTERRUPTED:true"].input.sum, 10);
    assert.equal(r.usage_by_state_response["FAILED:false"].input.missing, 1);
    assert.equal(r.physical_sends.availability, "unavailable");
    assert.equal(r.estimated_cost.availability, "unavailable");
  }));
test("cross-day logical attribution, half-open filters and anomaly preserve both usages", () =>
  using(async (f) => {
    const { c, ctx } = call(f, { started_at: "2026-11-13T15:59:59.000Z" }),
      retry = {
        ...c,
        id: randomUUID(),
        started_at: "2026-11-13T16:00:00.000Z",
      };
    f.commit([ctx, c, retry]);
    const s = await readSnapshot(f.seal());
    const all = usageReport(s);
    assert.equal(all.groups.length, 2);
    assert.equal(all.anomalous_multiple_success_groups, 1);
    assert.equal(all.usage.input.sum, 20);
    const r = usageReport(s, { from: retry.started_at, to: at });
    assert.equal(r.attempts, 1);
    assert.equal(r.logical_calls, 0);
    assert.equal(r.partial_window_groups, 1);
  }));
test("pre-send failure and PREPARED do not become network sends; missing identity explicit", () =>
  using(async (f) => {
    const { c, ctx } = call(f, {
      state: "PREPARED",
      response: null,
      started_at: null,
    });
    delete c.logical_key;
    const d = { ...c, id: randomUUID(), state: "FAILED", started_at: at };
    f.commit([ctx, c, d]);
    const r = usageReport(await readSnapshot(f.seal()));
    assert.equal(r.recorded_started_attempts, 1);
    assert.equal(r.payload_prepared_count, 0);
    assert.equal(r.physical_sends.availability, "unavailable");
    assert(r.reconciliation_sample.every((x) => x.identity_unavailable));
  }));
test("COMPACTION subroles use linked job identity, including settings", () =>
  using(async (f) => {
    for (const type of [
      "MemoryExtractionJob",
      "CompactionJob",
      "SettingsApplication",
    ]) {
      const job = f.make(type);
      const { c, ctx } = call(f);
      ctx.purpose = "COMPACTION";
      ctx.loop_id = job.id;
      f.commit([job, ctx, c]);
    }
    const r = usageReport(await readSnapshot(f.seal()));
    assert.deepEqual(
      new Set(r.groups.map((g) => g.role)),
      new Set(["EXTRACTION", "COMPACTION", "SETTINGS_MAINTENANCE"]),
    );
  }));
test("authorization wait keeps first decision through revoke; expiry is inferred; exact repeats split retries", () =>
  using(async (f) => {
    const params = f.put({ synthetic: 1 }),
      scope = { session_id: randomUUID(), task_id: null, execution_id: null };
    const op = f.make("Operation", {
      scope,
      rule_id: "builtin:workspace-write",
    });
    const a = f.make("AuthorizationRequest", {
      scope,
      operation_id: op.id,
      state: "PENDING",
      decided_at: null,
      expires_at: "2026-11-14T01:00:00.000Z",
    });
    a.action.parameters_ref = params;
    a.action.parameters_hash = params.sha256;
    const b = { ...a, id: randomUUID(), operation_id: randomUUID() };
    const retry = { ...op, id: b.operation_id, retry_of: op.id };
    f.commit([op, retry, a, b]);
    f.commit([
      {
        ...a,
        revision: 2,
        state: "APPROVED",
        decision_id: randomUUID(),
        decided_by: "MASTER_UI",
        decided_at: "2026-11-14T00:01:00.000Z",
      },
    ]);
    f.commit([
      {
        ...a,
        revision: 3,
        state: "REVOKED",
        decision_id: randomUUID(),
        decided_by: "MASTER_UI",
        decided_at: "2026-11-14T00:10:00.000Z",
      },
    ]);
    const r = usageReport(await readSnapshot(f.seal()));
    assert.equal(r.authorization.requests, 2);
    assert.equal(r.authorization.completed_wait_ms, 60000);
    assert.equal(r.authorization.pending_past_expiry, 1);
    assert.equal(r.authorization.repeated_group_count, 1);
    assert.equal(r.authorization.repeated_groups[0].retry_linked, 1);
    assert.equal(r.authorization.rule_uses.builtin, 2);
  }));
test("parameter bytes and full scope distinguish authorization groups", () =>
  using(async (f) => {
    for (const [param, task] of [
      [{ a: 1, b: 2 }, null],
      [{ b: 2, a: 1 }, null],
      [{ a: 1, b: 2 }, randomUUID()],
    ]) {
      const a = f.make("AuthorizationRequest", {
          scope: {
            session_id: "00000000-0000-4000-8000-000000000001",
            task_id: task,
            execution_id: null,
          },
        }),
        p = f.put(param);
      a.action.parameters_ref = p;
      a.action.parameters_hash = p.sha256;
      f.commit([a]);
    }
    const r = usageReport(await readSnapshot(f.seal()));
    assert.equal(r.authorization.repeated_group_count, 0);
  }));
test("memory has explicit unavailable sources; checkpoint partial match is never readiness", () =>
  using(async (f) => {
    f.commit();
    const s = await readSnapshot(
      f.seal({
        search_policy: 1,
        search_checkpoint: {
          row: {
            source_id: "wrong",
            policy_version: 1,
            journal_sequence: 1,
            journal_digest: "wrong",
            document_count: 2,
            chunk_count: 3,
          },
        },
      }),
    );
    const r = memoryReport(s);
    assert.equal(r.revision.availability, "unavailable");
    assert.equal(r.live_search.availability, "unavailable");
    assert.equal(r.search_checkpoint.value.lag, null);
    assert.equal(r.search_checkpoint.value.acceptance, "not_verified");
    assert.equal(
      r.search_checkpoint.value.actual_counts,
      "not_verified_no_scan",
    );
  }));
test("memory preserves job insertion order and exact extraction pending predicate", () =>
  using(async (f) => {
    const session = f.make("Session"),
      cs = f.make("Consciousness", { id: session.consciousness_id }),
      a = f.make("CompactionJob", {
        session_id: session.id,
        state: "COMMITTED",
      }),
      b = f.make("CompactionJob", { session_id: session.id, state: "FAILED" });
    const ex = f.make("MemoryExtractionJob", {
        session_id: session.id,
        state: "FAILED",
        merged: false,
        next_attempt_at: null,
      }),
      retry = {
        ...ex,
        id: randomUUID(),
        next_attempt_at: "2026-11-16T00:00:00.000Z",
      };
    f.commit([session, cs, a, b, ex, retry]);
    f.commit([{ ...a, revision: 2, updated_at: "2026-11-14T01:00:00.000Z" }]);
    const r = memoryReport(
      await readSnapshot(f.seal({ session_id: session.id })),
    );
    assert.equal(r.maintenance.value.latest_created_job, b.id);
    assert.equal(r.extraction.value.pending, 1);
    assert.equal(r.extraction.value.failed, 1);
  }));
