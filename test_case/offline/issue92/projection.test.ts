import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../issue9/helpers.ts";
import { authorization, decision, execution } from "./helpers.ts";
import { base, id, revise, now } from "../../../src/pi_secretary/src/store.ts";
import type {
  AuthorizationRequest,
  Execution,
  Operation,
  TaskPlan,
} from "../../../src/pi_secretary/src/contracts.ts";
import type {
  MasterAttention,
  Attention,
  Authorization,
} from "../../../src/pi_secretary/src/api/contracts.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
const query = (f: Parameters<typeof authorization>[0], suffix = "") =>
  f.client.query<MasterAttention>("attention?view=master" + suffix);

test("Master PENDING is separate from legacy approval, archived and ended matters remain actionable; ownership closes task-only authorization", () =>
  fixture(async (f) => {
    const e = await execution(f);
    const op = authorization(f, {
      session_id: null,
      task_id: e.task_id,
      execution_id: e.id,
    });
    const a = await f.client.query<Authorization>(
      "authorizations/" + op.authorization_id,
    );
    f.app.scheduler.finish(e.id, "FAILED", {
      error: "seeded real execution error",
    });
    let page = await query(f);
    validate("MasterAttention", page);
    validate("AttentionResponse", page);
    assert(
      page.items.find((i) => i.id === a.id)?.warning?.includes("不能恢复"),
    );
    await f.client.command(`authorizations/${a.id}/decision`, {
      request_id: id(),
      expected_revision: a.revision,
      display_hash: a.display_hash,
      decision: "APPROVE",
    });
    page = await query(f);
    assert(!page.items.some((i) => i.id === a.id));
    const legacy = await f.client.query<Attention>("attention");
    validate("AttentionResponse", legacy);
    assert(legacy.items.some((i) => i.id === a.id));
    const foreign = await execution(f, "foreign", id());
    const bad = authorization(f, {
      session_id: null,
      task_id: foreign.task_id,
      execution_id: null,
    });
    await assert.rejects(
      f.client.query("authorizations/" + bad.authorization_id),
      /NOT_FOUND/,
    );
    const raw = f.app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      bad.authorization_id!,
    );
    await assert.rejects(
      f.client.command(`authorizations/${raw.id}/decision`, {
        request_id: id(),
        expected_revision: String(raw.revision),
        display_hash: raw.display_hash,
        decision: "APPROVE",
      }),
      /NOT_FOUND/,
    );
    assert(!(await query(f)).items.some((i) => i.id === raw.id));
    const scope = f.app.scheduler.scopes.save({
      name: "archive",
      kind: "NONE",
    });
    const p = f.app.store.get<TaskPlan>("TaskPlan", e.task_id);
    f.app.store.commit([revise(p, { scope_id: scope.id })]);
    f.app.scheduler.scopes.archive(scope.id, scope.revision);
    const archived = authorization(f, {
      session_id: null,
      task_id: e.task_id,
      execution_id: null,
    });
    assert(
      (await query(f)).items.some((i) => i.id === archived.authorization_id),
    );
    await assert.rejects(query(f, "&view=master"), /INVALID_QUERY/);
    await assert.rejects(
      f.client.query("attention?view=other"),
      /INVALID_QUERY/,
    );
  }));

test("rejected authorization failures and actual execution failures coexist; newer success and retirement do not remove history", () =>
  fixture(async (f) => {
    const rejected = await execution(f, "rejected"),
      failed = await execution(f, "failed");
    const op = authorization(f, {
      session_id: null,
      task_id: rejected.task_id,
      execution_id: rejected.id,
    });
    const a = await f.client.query<Authorization>(
      "authorizations/" + op.authorization_id,
    );
    await f.client.command(`authorizations/${a.id}/decision`, {
      request_id: id(),
      expected_revision: a.revision,
      display_hash: a.display_hash,
      decision: "REJECT",
    });
    f.app.scheduler.finish(rejected.id, "FAILED", {
      reason: "Authorization rejected/revoked",
      failure_code: "CANCELLED_OPERATION_ON_RESUME",
      cancelled_operation_ids: [op.id],
    });
    f.app.scheduler.finish(failed.id, "FAILED", {
      error: "seeded tool process exited 7",
    });
    const old = f.app.store.get<Execution>("Execution", rejected.id);
    const newer: Execution = {
      ...old,
      ...base(),
      state: "RUNNING",
      retention_state: "HOT",
      continuation_of: old.id,
      occurrence_key: id(),
      result_id: null,
      ended_at: null,
    };
    f.app.store.commit([revise(old, { retention_state: "RETIRED" }), newer]);
    f.app.scheduler.finish(newer.id, "SUCCEEDED", {
      summary: "new success is not disposition",
    });
    const page = await query(f);
    assert.equal(page.counts.authorization_rejected, 1);
    assert.equal(page.counts.execution_failed, 1);
    assert.equal(page.counts.failures, 2);
    const row = page.items.find((i) => i.id === old.id)!;
    assert.equal(row.state, "FAILED");
    assert.equal(row.retention_state, "RETIRED");
    assert.equal(row.authorization_id, a.id);
    assert.equal(
      page.items.find((i) => i.id === failed.id)?.preview,
      "seeded tool process exited 7",
    );
    assert.equal(
      row.initiated_sequence,
      String(f.app.store.firstSequence("TaskResult", old.result_id!)),
    );
  }));

test("INIT_FAILED episode stable through retries, operation state owns UNKNOWN, full-set pagination survives membership growth without writes", () =>
  fixture(async (f) => {
    const e = await execution(f),
      p = f.app.store.get<TaskPlan>("TaskPlan", e.task_id);
    f.app.store.commit([
      revise(p, {
        state: "INIT_FAILED",
        initialization_error: "seeded init failure",
      }),
      revise(e, { state: "RESULT_UNKNOWN" }),
    ]);
    const pending = authorization(f, {
      session_id: null,
      task_id: e.task_id,
      execution_id: e.id,
    });
    const op: Operation = {
      ...pending,
      ...base(),
      state: "RESULT_UNKNOWN",
      effect: "UNKNOWN",
    };
    f.app.store.commit([op]);
    let page = await query(f);
    const init = page.items.find((i) => i.id === p.id)!;
    assert.equal(page.counts.unknown, 1);
    assert(page.items.some((i) => i.id === op.id));
    f.app.store.commit([
      revise(f.app.store.get<TaskPlan>("TaskPlan", p.id), {}),
    ]);
    let again = await query(f);
    assert.equal(again.version, page.version);
    assert.equal(again.items.find((i) => i.id === p.id)?.key, init.key);
    f.app.store.commit([
      revise(f.app.store.get<Operation>("Operation", op.id), {
        state: "FAILED",
        receipt: f.app.store.put({ outcome: "UNVERIFIED" }),
      }),
    ]);
    again = await query(f);
    assert(!again.items.some((i) => i.id === op.id));
    assert(again.items.some((i) => i.id === e.id));
    f.app.store.commit([
      revise(f.app.store.get<TaskPlan>("TaskPlan", p.id), {
        state: "ACTIVE",
        initialization_error: null,
      }),
    ]);
    assert(!(await query(f)).items.some((i) => i.id === p.id));
    f.app.store.commit([
      revise(f.app.store.get<TaskPlan>("TaskPlan", p.id), {
        state: "INIT_FAILED",
        initialization_error: "new episode",
      }),
    ]);
    assert.notEqual(
      (await query(f)).items.find((i) => i.id === p.id)?.key,
      init.key,
    );
    const original = f.app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      op.authorization_id!,
    );
    f.app.store.commit(
      Array.from({ length: 205 }, () => ({ ...original, ...base() })),
    );
    page = await query(f, "&limit=7");
    assert.equal(page.counts.authorizations, 206);
    const rows = [...page.items];
    // A newly pending item does not invalidate an immutable keyset cursor.
    authorization(f);
    const sequence = f.app.store.sequence,
      models = f.app.store.all("ModelCall").length;
    while (page.next_cursor) {
      page = await query(
        f,
        "&limit=7&cursor=" + encodeURIComponent(page.next_cursor),
      );
      rows.push(...page.items);
    }
    assert.equal(rows.length, 208);
    assert.equal(new Set(rows.map((i) => i.key)).size, rows.length);
    assert.equal(f.app.store.sequence, sequence);
    assert.equal(f.app.store.all("ModelCall").length, models);
  }));

test("expiry is time based and a past OPEN decision on a nonwaiting execution is absent", () =>
  fixture(async (f) => {
    const d = await decision(f);
    const op = authorization(f);
    const a = f.app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      op.authorization_id!,
    );
    f.app.store.commit([revise(a, { expires_at: "2000-01-01T00:00:00.000Z" })]);
    assert.equal((await query(f)).counts.authorizations, 0);
    f.app.store.commit([
      revise(f.app.store.get<Execution>("Execution", d.execution_id), {
        state: "READY",
      }),
    ]);
    assert.equal((await query(f)).counts.decisions, 0);
  }));

test("SEEDED contradictory cause, late decision and interrupted result never become rejection failures", () =>
  fixture(async (f) => {
    const cases = ["RULE_CHANGED", "late", "interrupted", "forged"];
    const ids: string[] = [];
    for (const scenario of cases) {
      const e = await execution(f, scenario);
      ids.push(e.id);
      const pending = authorization(f, {
        session_id: null,
        task_id: e.task_id,
        execution_id: e.id,
      });
      const a = await f.client.query<Authorization>(
        "authorizations/" + pending.authorization_id,
      );
      if (scenario === "interrupted")
        await f.client.command(`authorizations/${a.id}/decision`, {
          request_id: id(),
          expected_revision: a.revision,
          display_hash: a.display_hash,
          decision: "REJECT",
        });
      if (scenario === "RULE_CHANGED") {
        const ruleCancel: Operation = {
          ...pending,
          ...base(),
          state: "CANCELLED",
          authorization_id: null,
          error: "RULE_CHANGED",
        };
        f.app.store.commit([ruleCancel]);
        await f.client.command(`authorizations/${a.id}/decision`, {
          request_id: id(),
          expected_revision: a.revision,
          display_hash: a.display_hash,
          decision: "APPROVE",
        });
      }
      f.app.scheduler.finish(
        e.id,
        "FAILED",
        scenario === "interrupted"
          ? {
              reason:
                "Execution interrupted before a result was durably recorded",
            }
          : { reason: "Authorization rejected/revoked" },
      );
      if (scenario === "late")
        await f.client.command(`authorizations/${a.id}/decision`, {
          request_id: id(),
          expected_revision: a.revision,
          display_hash: a.display_hash,
          decision: "REJECT",
        });
    }
    const page = await query(f);
    assert.equal(page.counts.authorization_rejected, 0);
    for (let i = 0; i < ids.length; i++) {
      const row = page.items.find((r) => r.id === ids[i])!;
      assert.equal(row.failure_category, "execution_failed");
      assert.equal(
        row.cause_evidence,
        cases[i] === "interrupted" ? "recorded_non_rejection" : "inconsistent",
      );
      if (cases[i] === "interrupted")
        assert(
          row.authorization_id,
          "rejection remains a linked fact, not the proven cause",
        );
    }
  }));

test("real Core rejection resume writes classified failure; partial decisions have no failure; approve/revoke is distinct", () =>
  fixture(async (f) => {
    for (const mode of ["REJECT", "REVOKE"] as const) {
      const e = await execution(f, mode),
        scope = { session_id: null, task_id: e.task_id, execution_id: e.id };
      const one = authorization(f, scope),
        two = authorization(f, scope);
      f.app.store.commit([
        revise(f.app.store.get<Execution>("Execution", e.id), {
          state: "WAIT_AUTH",
          waiting_request_ids: [one.authorization_id!, two.authorization_id!],
        }),
      ]);
      let a = await f.client.query<Authorization>(
        "authorizations/" + one.authorization_id,
      );
      if (mode === "REVOKE") {
        await f.client.command(`authorizations/${a.id}/decision`, {
          request_id: id(),
          expected_revision: a.revision,
          display_hash: a.display_hash,
          decision: "APPROVE",
        });
        a = await f.client.query<Authorization>("authorizations/" + a.id);
      }
      await f.client.command(`authorizations/${a.id}/decision`, {
        request_id: id(),
        expected_revision: a.revision,
        display_hash: a.display_hash,
        decision: mode,
      });
      f.app.scheduler.tick();
      await f.app.scheduler.idle();
      assert.equal(
        f.app.store.get<Execution>("Execution", e.id).state,
        "WAIT_AUTH",
      );
      assert(
        !(await query(f)).items.some(
          (r) => r.type === "failure" && r.id === e.id,
        ),
      );
      const second = await f.client.query<Authorization>(
        "authorizations/" + two.authorization_id,
      );
      await f.client.command(`authorizations/${second.id}/decision`, {
        request_id: id(),
        expected_revision: second.revision,
        display_hash: second.display_hash,
        decision: "APPROVE",
      });
      f.app.scheduler.tick();
      await f.app.scheduler.idle();
      const row = (await query(f)).items.find((r) => r.id === e.id)!;
      assert.equal(row.state, "FAILED");
      assert.equal(
        row.failure_category,
        mode === "REJECT" ? "authorization_rejected" : "authorization_revoked",
      );
      assert.equal(row.cause_evidence, "rejection_proven");
      assert.equal(row.authorization_id, a.id);
      assert.equal(row.operation_id, one.id);
    }
  }));
