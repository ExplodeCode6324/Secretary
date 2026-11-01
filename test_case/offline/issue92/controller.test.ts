import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../issue9/helpers.ts";
import { decision, authorization } from "./helpers.ts";
import { MatterController } from "../../../src/pi_secretary/src/tui/matter.ts";
import { AttentionWindow } from "../../../src/pi_secretary/src/tui/attention.ts";
import type {
  Decision,
  Authorization,
} from "../../../src/pi_secretary/src/api/contracts.ts";
import type {
  AuthorizationRequest,
  DecisionRequest,
} from "../../../src/pi_secretary/src/contracts.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";

test("directed slash answer from either origin is MASTER-authored with one identity; no Main input/retention write", () =>
  fixture(async (f) => {
    for (const origin of ["Main", "Task"] as const) {
      const d = await decision(f);
      const c = new MatterController();
      c.connect(f.client, "fixture");
      const inputs = f.app.store.all("Input").length;
      let exit = "";
      c.onExit = (p, result) => {
        assert.equal(p, origin);
        exit = result;
      };
      await c.open(d.id, origin);
      assert.equal(c.current?.kind, "decision");
      const sequence = f.app.store.sequence;
      const value = "/show literal\n/m /t /send 保留 原样";
      await Promise.all([c.submit(value), c.submit(value)]);
      const saved = await f.client.query<Decision>(`decisions/${d.id}`);
      assert.equal(saved.answered_by, "MASTER");
      assert.deepEqual(saved.answer, { value });
      assert(saved.answer_request_id);
      assert.equal(exit, "success");
      assert.equal(c.current, undefined);
      assert.equal(c.pending, undefined);
      assert.equal(f.app.store.all("Input").length, inputs);
      const retention = f.app.store.projectionFrames
        .slice(sequence)
        .flatMap((frame) => frame.log_records)
        .filter((r) => String(r).includes("viewed"));
      assert.equal(retention.length, 0);
      c.stop();
    }
  }));

test("lost response stays frozen, edits cannot allocate another request; same ID retry and reconnect reconcile real business state", () =>
  fixture(async (f) => {
    const d = await decision(f);
    const c = new MatterController();
    const posts: string[] = [];
    let offline = false,
      lose = true;
    const client = {
      query: <T>(route: string) => {
        if (offline) return Promise.reject(Error("offline"));
        return f.client.query<T>(route);
      },
      command: async (
        route: string,
        body: { request_id: string; [k: string]: unknown },
      ) => {
        posts.push(body.request_id);
        const receipt = await f.client.command(route, body);
        if (lose) {
          offline = true;
          throw Error("lost response");
        }
        return receipt;
      },
    };
    c.connect(client, "fixture");
    await c.open(d.id, "Task");
    await c.submit("/rawmessage literal");
    const original = c.pending?.id;
    assert(original);
    assert(c.current);
    assert.equal(posts.length, 1);
    await c.submit("modified");
    assert.equal(posts.length, 1);
    assert.equal(c.pending?.id, original);
    offline = false;
    lose = false;
    await c.submit("/rawmessage literal");
    assert.deepEqual(posts, [original, original]);
    assert.equal(c.current, undefined);
    const d2 = await decision(f);
    await c.open(d2.id, "Main");
    lose = true;
    await c.submit("second");
    assert(c.pending);
    c.connect(f.client, "fixture");
    await c.refresh();
    assert.equal(c.pending, undefined);
    assert.equal(c.current, undefined);
    assert.equal(posts.length, 3);
    c.stop();
  }));

test("APPROVED disappears before any dispatch; revision/display change invalidates without executing", () =>
  fixture(async (f) => {
    const op = authorization(f),
      c = new MatterController(),
      window = new AttentionWindow(f.client);
    c.connect(f.client, "fixture");
    await window.refresh();
    assert(window.head?.items.some((i) => i.id === op.authorization_id));
    await c.open(op.authorization_id!, "Main");
    await c.submit("");
    assert.equal(c.pending, undefined);
    assert.match(c.hint, /明确选择/);
    await c.submit("", "APPROVE");
    assert.equal(c.current, undefined);
    const saved = await f.client.query<Authorization>(
      "authorizations/" + op.authorization_id,
    );
    assert.equal(saved.state, "APPROVED");
    await window.refresh();
    assert(!window.head?.items.some((i) => i.id === op.authorization_id));
    const op2 = authorization(f);
    await c.open(op2.authorization_id!, "Task");
    const a = f.app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      op2.authorization_id!,
    );
    f.app.store.commit([revise(a, { display_hash: "0".repeat(64) })]);
    let result = "";
    c.onExit = (_p, r) => (result = r);
    await c.refresh();
    assert.equal(c.current, undefined);
    assert.equal(result, "invalid");
    assert.equal(
      f.app.store.get<AuthorizationRequest>("AuthorizationRequest", a.id).state,
      "PENDING",
    );
    c.stop();
    window.stop();
  }));

test("a Main answer or external authorization is invalidation, never reported as our completion", () =>
  fixture(async (f) => {
    const d = await decision(f),
      c = new MatterController();
    c.connect(f.client, "fixture");
    await c.open(d.id, "Main");
    f.app.scheduler.answer(d.id, "Main agent answer", id(), "MAIN");
    let result = "";
    c.onExit = (_p, r) => (result = r);
    await c.refresh();
    assert.equal(c.current, undefined);
    assert.equal(result, "invalid");
    c.stop();
  }));

test("wall-clock expiry exits a matter and refreshes a selected list without a Store write", () =>
  fixture(async (f) => {
    const d = await decision(f),
      record = f.app.store.get<DecisionRequest>("DecisionRequest", d.id);
    f.app.store.commit([
      revise(record, { deadline: new Date(Date.now() + 700).toISOString() }),
    ]);
    const c = new MatterController(),
      window = new AttentionWindow(f.client);
    c.connect(f.client, "fixture");
    await window.refresh();
    window.enter();
    await c.open(d.id, "Task");
    assert(c.current);
    const sequence = f.app.store.sequence;
    await new Promise((r) => setTimeout(r, 850));
    assert.equal(c.current, undefined);
    assert.equal(window.head?.counts.decisions, 0);
    assert.equal(f.app.store.sequence, sequence);
    c.stop();
    window.stop();
  }));

test("reconnect during detail loading restarts the read and a late old response cannot trap or replace the editor", () =>
  fixture(async (f) => {
    const d = await decision(f),
      c = new MatterController();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    c.connect(
      {
        query: async <T>(route: string) => {
          await gate;
          return f.client.query<T>(route);
        },
        command: f.client.command.bind(f.client),
      },
      "fixture",
    );
    const old = c.open(d.id, "Main");
    assert(c.loading);
    c.connect(f.client, "fixture");
    const { until } = await import("../issue9/helpers.ts");
    await until(() => c.current?.id === d.id && !c.loading);
    release();
    await old;
    assert.equal(c.current?.id, d.id);
    assert.equal(c.loading, false);
    c.stop();
  }));

test("revision-only initialization retries do not redraw the attention window", () =>
  fixture(async (f) => {
    const { execution } = await import("./helpers.ts");
    const e = await execution(f);
    const p = f.app.store.get<
      import("../../../src/pi_secretary/src/contracts.ts").TaskPlan
    >("TaskPlan", e.task_id);
    f.app.store.commit([
      revise(p, { state: "INIT_FAILED", initialization_error: "same error" }),
    ]);
    const window = new AttentionWindow(f.client);
    let changes = 0;
    window.onChange = () => changes++;
    await window.refresh();
    assert.equal(changes, 1);
    for (let i = 0; i < 5; i++)
      f.app.store.commit([
        revise(f.app.store.get<typeof p>("TaskPlan", p.id), {}),
      ]);
    await window.refresh();
    assert.equal(changes, 1);
    f.app.store.commit([
      revise(f.app.store.get<typeof p>("TaskPlan", p.id), {
        initialization_error: "different error",
      }),
    ]);
    await window.refresh();
    assert.equal(changes, 2);
    window.stop();
  }));
