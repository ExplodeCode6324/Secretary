import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, executions } from "../issue16/helpers.ts";
import {
  Store,
  id,
  revise,
  base,
} from "../../../src/pi_secretary/src/store.ts";
import type {
  TaskPlan,
  Execution,
} from "../../../src/pi_secretary/src/contracts.ts";
import {
  allocateTaskTitle,
  nextExecutionRound,
  validSavedTitle,
} from "../../../src/pi_secretary/src/task-identity.ts";
import { ensureTaskIdentities } from "../../../src/pi_secretary/src/task-identity-migration.ts";
import { guidanceFor } from "../../../src/pi_secretary/src/guidance.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";

const free = () => false;
test("allocation normalizes only names, bounds complete graphemes, excludes invisible/UUID bases and reserves literal suffixes", () => {
  assert.equal(
    allocateTaskTitle("goal", " e\u0301\t中文\u202e 👩‍💻 ", free),
    "é 中文 👩‍💻",
  );
  for (const input of [
    "\u200d\ufe0f",
    "\u0301",
    id(),
    "x" + "\u0301".repeat(100),
  ])
    assert.equal(allocateTaskTitle("fallback", input, free), "fallback");
  assert.equal(allocateTaskTitle(id(), id(), free), "Task");
  assert.equal(allocateTaskTitle("", null, free), "Task");
  assert.throws(() => allocateTaskTitle("goal", "\ud800", free), /UNICODE/);
  assert.throws(
    () => allocateTaskTitle("goal", "中".repeat(400), free),
    /TOO_LARGE/,
  );
  const names = new Set(["A", "A_1", "A_2"]);
  assert.equal(
    allocateTaskTitle("goal", "A", (n) => names.has(n)),
    "A_3",
  );
  assert.equal(
    allocateTaskTitle("goal", "a", (n) => names.has(n)),
    "a",
  );
  const long = "👩‍💻".repeat(20);
  const first = allocateTaskTitle("goal", long, free);
  const second = allocateTaskTitle("goal", long, (n) => n === first);
  assert(validSavedTitle(first) && validSavedTitle(second));
  assert(second.endsWith("_1"));
  assert(!second.includes("\ufffd"));
  assert.throws(
    () =>
      nextExecutionRound({
        identity_version: 1,
        execution_round_high_water: Number.MAX_SAFE_INTEGER,
      } as TaskPlan),
    /EXHAUSTED/,
  );
});

test("real admission serializes collisions and receipts; queued requests reserve no rounds; continuation/replay keep immutable identities", () =>
  fixture(async (a, api) => {
    const goal = "original\n goal is unchanged";
    const req = id();
    const [p, duplicate, other] = await Promise.all([
      Promise.resolve().then(() =>
        a.scheduler.propose(goal, req, a.host.sessionID, {
          title_candidate: "共享 名称",
        }),
      ),
      Promise.resolve().then(() =>
        a.scheduler.propose(goal, req, a.host.sessionID, {
          title_candidate: "共享 名称",
        }),
      ),
      Promise.resolve().then(() =>
        a.scheduler.propose(goal, id(), a.host.sessionID, {
          title_candidate: "共享 名称",
        }),
      ),
    ]);
    assert.equal(p.id, duplicate.id);
    assert.equal(p.title, "共享 名称");
    assert.equal(other.title, "共享 名称_1");
    assert.equal(a.store.read<any>(p.proposal_ref).goal, goal);
    assert.equal(p.execution_round_high_water, 0);
    assert.throws(
      () =>
        a.scheduler.propose(goal, req, a.host.sessionID, {
          title_candidate: "changed",
        }),
      /CONFLICT/,
    );
    a.scheduler.cancelRequest(
      other.pending_requests![0].request_id,
      a.host.sessionID,
    );
    a.scheduler.tick();
    await a.scheduler.idle();
    for (let n = 2; n <= 7; n++) {
      const previous = executions(a)
        .filter((e) => e.task_id === p.id)
        .at(-1)!;
      assert.equal(previous.execution_round, n - 1);
      assert.throws(
        () =>
          a.scheduler.propose("continue", id(), a.host.sessionID, {
            reuse: p.id,
            parent: previous.id,
            title_candidate: "rename",
          }),
        /TITLE_ON_REUSE/,
      );
      a.scheduler.propose("continue", id(), a.host.sessionID, {
        reuse: p.id,
        parent: previous.id,
        title_candidate: null,
      });
      a.scheduler.tick();
      await a.scheduler.idle();
    }
    const plan = a.store.get<TaskPlan>("TaskPlan", p.id);
    const all = executions(a).filter((e) => e.task_id === p.id);
    assert.deepEqual(
      all.map((e) => e.execution_round),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.equal(plan.execution_round_high_water, 7);
    assert.equal(plan.title, p.title);
    assert.throws(
      () => a.store.commit([revise(plan, { title: "rename" })]),
      /IMMUTABLE/,
    );
    assert.throws(
      () => a.store.commit([revise(plan, { execution_round_high_water: 6 })]),
      /HIGH_WATER/,
    );
    assert.throws(
      () => a.store.commit([revise(all[0], { execution_round: 7 })]),
      /IMMUTABLE/,
    );
    const before = a.store.sequence;
    const detail: any = await api.query(api.principal, `task-browser/${p.id}`);
    assert.deepEqual(
      detail.executions.map((e: any) => e.execution_round).sort(),
      [5, 6, 7],
    );
    const query = (round: string, purpose = "browse") =>
      api.query(
        api.principal,
        "task-browser/resolve",
        new URLSearchParams({
          selector_kind: "title",
          selector: p.title!,
          execution_round: round,
          purpose,
        }),
      );
    const resolved: any = await query("5");
    validate("TaskTargetResolution", resolved);
    assert.equal(resolved.execution_id, all[4].id);
    await assert.rejects(query("4"), /OUTSIDE_RECENT_THREE/);
    for (const invalid of [
      "07",
      "７",
      "0",
      "-1",
      "1.0",
      "1e0",
      "9007199254740992",
      "7 ",
    ])
      await assert.rejects(query(invalid), /INVALID_EXECUTION_ROUND/);
    await assert.rejects(query("7", "guidance"), /TARGET_ENDED/);
    assert.equal(a.store.sequence, before);
  }));

test("old-format multi-mutation journal migrates in creation order and resumes every durable boundary without rewriting old bytes", () =>
  fixture(async (a, _api, root) => {
    const p = a.scheduler.propose("legacy identical", id(), a.host.sessionID);
    a.scheduler.tick();
    await a.scheduler.idle();
    const template = executions(a)[0];
    const oldRoot = path.join(root, "legacy");
    const store = await Store.open(oldRoot);
    fs.cpSync(
      path.join(root, "data", "objects"),
      path.join(oldRoot, "objects"),
      { recursive: true },
    );
    const legacy = { ...p, revision: 1, state: "CLOSED" as const };
    delete legacy.title;
    delete legacy.identity_version;
    delete legacy.execution_round_high_water;
    const other = { ...legacy, ...base() };
    store.commit([legacy, other]);
    const es = Array.from({ length: 130 }, (_, i) => {
      const e: Execution = {
        ...template,
        ...base(),
        task_id: legacy.id,
        plan_revision: 1,
        state: "SUCCEEDED",
        retention_state: i === 0 ? "RETIRED" : "HOT",
        result_id: template.result_id,
        checkpoint_id: null,
        started_at: null,
        ended_at: template.ended_at,
      };
      delete e.execution_round;
      return e;
    });
    store.commit(es);
    await store.close();
    const journalFiles = fs
      .readdirSync(oldRoot)
      .filter((n) => n.includes("journal"));
    assert(journalFiles.length);
    for (let boundary = 1; boundary <= 7; boundary++) {
      const dir = path.join(root, "resume-" + boundary);
      fs.cpSync(oldRoot, dir, { recursive: true });
      const before = new Map(
        journalFiles.map((n) => [n, fs.readFileSync(path.join(dir, n))]),
      );
      let s = await Store.open(dir);
      const commit = s.commit.bind(s);
      let writes = 0;
      s.commit = ((...args: Parameters<Store["commit"]>) => {
        commit(...args);
        if (++writes === boundary)
          throw Error("simulated crash after durable frame");
      }) as Store["commit"];
      try {
        ensureTaskIdentities(s);
      } catch (e) {
        assert.match(String(e), /simulated crash/);
      }
      await s.close();
      s = await Store.open(dir);
      ensureTaskIdentities(s);
      assert.equal(s.get<TaskPlan>("TaskPlan", p.id).title, "legacy identical");
      assert.equal(
        s.get<TaskPlan>("TaskPlan", other.id).title,
        "legacy identical_1",
      );
      assert.deepEqual(
        s
          .indexed<Execution>("Execution", "task_id", [p.id])
          .map((e) => e.execution_round),
        es.map((_, i) => i + 1),
      );
      for (const [n, bytes] of before)
        assert(
          fs
            .readFileSync(path.join(dir, n))
            .subarray(0, bytes.length)
            .equals(bytes),
        );
      const seq = s.sequence;
      ensureTaskIdentities(s);
      assert.equal(s.sequence, seq);
      await s.close();
      s = await Store.open(dir);
      assert.equal(s.sequence, seq);
      await s.close();
    }
  }));

test("selector ambiguity is explicit; archived-running guidance keeps exact-ID capability; unknown targets reject new guidance", () =>
  fixture(async (a, api) => {
    const scope = a.scheduler.scopes.save({ name: "archive", kind: "NONE" });
    const p = a.scheduler.propose("pending", id(), a.host.sessionID, {
      scopeID: scope.id,
      preconditions: [
        {
          condition_id: id(),
          kind: "RESOURCE_PRESENT",
          target: "gate",
          required_revision: null,
        },
      ],
    });
    a.scheduler.tick();
    await a.scheduler.idle();
    const e = executions(a)[0];
    const collision = a.scheduler.propose("other", id(), a.host.sessionID, {
      title_candidate: p.id.slice(0, 8),
      at: "2099-01-01T00:00:00.000Z",
    });
    const locate = (kind: string, value: string) =>
      api.query(
        api.principal,
        "task-browser/locate",
        new URLSearchParams({ selector_kind: kind, selector: value }),
      );
    await assert.rejects(
      locate("auto", collision.title!),
      /AMBIGUOUS_TASK_SELECTOR/,
    );
    assert.equal(
      ((await locate("title", collision.title!)) as any).target,
      collision.id,
    );
    assert.equal(((await locate("id", collision.title!)) as any).target, p.id);
    const g = guidanceFor(a.store);
    const request = id();
    const receipt = g.master(
      a.host.sessionID,
      "master",
      request,
      p.id,
      e.id,
      "steer",
    );
    // Archive lets already-started work continue. This fixture transitions through real running state.
    a.store.commit([revise(e, { state: "READY" })]);
    const ready = a.store.get<Execution>("Execution", e.id);
    a.store.commit([revise(ready, { state: "DISPATCHING" })]);
    a.scheduler.scopes.archive(scope.id, scope.revision);
    await assert.rejects(locate("title", p.title!), /TASK_NOT_BROWSABLE/);
    g.master(a.host.sessionID, "master", id(), p.id, e.id, "still steer");
    const running = a.store.get<Execution>("Execution", e.id);
    a.store.commit([revise(running, { state: "RESULT_UNKNOWN" })]);
    const seq = a.store.sequence;
    assert.throws(
      () => g.master(a.host.sessionID, "master", id(), p.id, e.id, "new"),
      /TARGET_RESULT_UNKNOWN/,
    );
    assert.deepEqual(
      g.master(a.host.sessionID, "master", request, p.id, e.id, "steer"),
      receipt,
    );
    assert.equal(a.store.sequence, seq);
  }));

test("uncertain acceptance acknowledgement replays one title/receipt; pre-append failure reserves nothing", async () => {
  const { Fixture } = await import("../issue9/helpers.ts");
  const { JournalOwner } =
    await import("../../../src/pi_secretary/src/store-lock.ts");
  for (const after of [false, true]) {
    const f = new Fixture();
    await f.open();
    const append = JournalOwner.prototype.append;
    const request = id();
    try {
      JournalOwner.prototype.append = function (
        ...args: Parameters<typeof append>
      ) {
        if (after) append.apply(this, args);
        throw Error("simulated lost ACK");
      };
      assert.throws(
        () =>
          f.app.scheduler.propose("original", request, f.app.host.sessionID, {
            title_candidate: "reserved",
          }),
        /lost ACK/,
      );
      JournalOwner.prototype.append = append;
      await f.restart();
      const p = f.app.scheduler.propose(
        "original",
        request,
        f.app.host.sessionID,
        { title_candidate: "reserved" },
      );
      assert.equal(p.title, "reserved");
      assert.equal(f.app.store.all("TaskPlan").length, 1);
      assert.equal(
        f.app.scheduler.propose("original", request, f.app.host.sessionID, {
          title_candidate: "reserved",
        }).id,
        p.id,
      );
      const next = f.app.scheduler.propose(
        "another",
        id(),
        f.app.host.sessionID,
        { title_candidate: "reserved" },
      );
      assert.equal(next.title, "reserved_1");
    } finally {
      JournalOwner.prototype.append = append;
      await f.close();
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  }
});

test("warm exact resolver and typed completion avoid whole-plan scans and are read-only over HTTP", async () => {
  const { fixture: httpFixture } = await import("../issue9/helpers.ts");
  await httpFixture(async (f) => {
    const p = f.app.scheduler.propose("lookup", id(), f.app.host.sessionID, {
      title_candidate: "精确 目标",
    });
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    for (let n = 0; n < 30; n++)
      f.app.scheduler.propose("unrelated " + n, id(), f.app.host.sessionID, {
        at: "2099-01-01T00:00:00.000Z",
      });
    const route =
      "task-browser/resolve?selector_kind=title&selector=" +
      encodeURIComponent(p.title!) +
      "&execution_round=1&purpose=browse";
    const first: any = await f.client.query(route);
    assert.equal(first.task_id, p.id);
    const plans = (f.server.service.taskBrowser as any).plans as Map<
      string,
      TaskPlan
    >;
    plans.values = () => {
      throw Error("whole-plan scan on hot lookup");
    };
    const seq = f.app.store.sequence;
    assert.deepEqual(await f.client.query(route), first);
    const suggestions: any = await f.client.query(
      "task-browser/suggestions?selector_kind=title&selector=" +
        encodeURIComponent("精确") +
        "&limit=100",
    );
    assert.equal(suggestions.items[0].title, p.title);
    assert(suggestions.items.length <= 20);
    validate("TaskLocatorSuggestions", suggestions);
    assert.equal(f.app.store.sequence, seq);
  });
});
