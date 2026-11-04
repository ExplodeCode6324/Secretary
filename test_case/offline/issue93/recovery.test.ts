import test from "node:test";
import assert from "node:assert/strict";
import { fixture, until } from "../issue9/helpers.ts";
import { execution } from "../issue92/helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { failuresFor } from "../../../src/pi_secretary/src/failure-handling.ts";
import { ResumeController } from "../../../src/pi_secretary/src/tui/resume.ts";
import {
  parseInput,
  parseDraft,
} from "../../../src/pi_secretary/src/tui/input.ts";
import { plainSnapshot } from "../../../src/pi_secretary/src/tui/draft.ts";
import type {
  Session,
  RequestStatus,
} from "../../../src/pi_secretary/src/api/contracts.ts";
import type {
  ApiCommand,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";

function block(
  f: Parameters<Parameters<typeof fixture>[0]>[0],
  state = "RECOVERY_BLOCKED",
) {
  f.app.store.commit([
    revise(f.app.host.session, {
      state,
      recovery_error: "Error: secret-token-and-path",
      model_blocked_call: null,
    } as any),
  ]);
}
test("resume state/revision guards at admission and dispatch; duplicate and competing IDs", () =>
  fixture(async (f) => {
    block(f);
    const revision = String(f.app.host.session.revision),
      ids = [id(), id()];
    // Synchronous admission ensures both commands queue before either dispatches.
    for (const request_id of ids)
      f.server.service.command(f.server.service.principal, "session/resume", {
        request_id,
        expected_revision: revision,
      });
    await until(() =>
      ids.every(
        (r) =>
          f.app.store.get<ApiCommand>("ApiCommand", r).state === "COMPLETED",
      ),
    );
    assert.equal(f.app.host.session.model_retry_generation, 1);
    const results = await Promise.all(
      ids.map((r) => f.client.query<RequestStatus>(`requests/${r}`)),
    );
    assert.deepEqual(
      results.map((r) => (r.result as any).applied),
      [true, false],
    );
    assert.equal((results[1].result as any).code, "SESSION_CHANGED");
    await f.client.command("session/resume", {
      request_id: ids[0],
      expected_revision: revision,
    });
    assert.equal(f.app.host.session.model_retry_generation, 1);
    await assert.rejects(
      f.client.command("session/resume", {
        request_id: id(),
        expected_revision: revision,
      }),
      /SESSION_CHANGED/,
    );
  }));
test("session recovery modes are safe and blocked failure is derived, read-only and durable", () =>
  fixture(async (f) => {
    const e = await execution(f);
    f.app.scheduler.finish(e.id, "FAILED", { error: "original failure" });
    const key = "EXECUTION:" + e.id;
    await f.client.command("messages", {
      request_id: id(),
      text: "",
      failure_action: {
        failure_key: key,
        expected_revision: "0",
        action: "DISMISS",
      },
    });
    block(f);
    const seq = f.app.store.sequence;
    const session = await f.client.query<Session>("session");
    assert.equal(session.recovery_mode, "EXPLICIT_REQUIRED");
    assert.doesNotMatch(session.recovery_message, /secret-token|path/);
    const detail = failuresFor(f.app.store).view(key, f.app.host.sessionID);
    assert.equal(detail.status, "MAIN_BLOCKED");
    assert.equal(detail.disposition, "UNRESOLVED");
    assert.equal(f.app.store.sequence, seq);
    const changes = f.server.service.changes.changes(
      f.server.service.changes.cursor(seq - 1),
    );
    assert.match(JSON.stringify(changes), /attention/);
    assert.match(JSON.stringify(changes), /failures/);
    for (const [error, expected] of [
      ["AbortError", "取消"],
      ["BUDGET_LIMIT", "保护上限"],
    ]) {
      f.app.store.commit([
        revise(f.app.host.session, { recovery_error: error }),
      ]);
      assert.match(
        (await f.client.query<Session>("session")).recovery_message,
        new RegExp(expected),
      );
    }
    block(f, "CAPACITY_BLOCKED");
    assert.equal(
      (await f.client.query<Session>("session")).recovery_mode,
      "CAPACITY_COMPACTION_REQUIRED",
    );
    await assert.rejects(
      f.client.command("session/resume", {
        request_id: id(),
        expected_revision: String(f.app.host.session.revision),
      }),
      /SESSION_CHANGED/,
    );
    await f.restart();
    assert.equal(
      failuresFor(f.app.store).view(key, f.app.host.sessionID).status,
      "MAIN_BLOCKED",
    );
  }));
test("legacy resume refuses an active drain, while crash-left RUNNING remains recoverable", () =>
  fixture(async (f) => {
    let release!: () => void;
    const host = f.app.host as any;
    host.active = new Promise<void>((r) => {
      release = r;
    });
    const revision = f.app.host.session.revision;
    assert.deepEqual(await f.app.host.resume(), {
      applied: false,
      code: "MAIN_ACTIVE",
    });
    assert.equal(f.app.host.session.revision, revision);
    release();
    host.active = undefined;
    f.app.store.commit([revise(f.app.host.session, { state: "RUNNING" })]);
    assert.equal((await f.app.host.resume()).applied, true);
  }));
test("resume lost response reconciles same ID; restart UNKNOWN never silently re-dispatches", () =>
  fixture(async (f) => {
    block(f);
    const c = new ResumeController();
    let offline = false;
    const posts: string[] = [];
    c.connect(
      {
        query: async <T>(r: string) => {
          if (offline) throw Error("offline");
          return f.client.query<T>(r);
        },
        command: async (r, b) => {
          posts.push(b.request_id);
          await f.client.command(r, b);
          offline = true;
          throw Error("lost");
        },
      },
      "domain",
    );
    await c.submit();
    const request = c.pending!.id;
    assert.equal(posts.length, 1);
    await until(
      () =>
        f.app.store.get<ApiCommand>("ApiCommand", request).state ===
        "COMPLETED",
    );
    offline = false;
    c.connect(f.client, "domain");
    await c.reconcile();
    assert(!c.pending);
    assert.match(c.hint, /Main 当前 IDLE/);
    assert.equal(f.app.host.session.model_retry_generation, 1);
    const record = f.app.store.get<ApiCommand>("ApiCommand", request);
    f.app.store.commit([revise(record, { state: "RUNNING" })]);
    await f.restart();
    assert.equal(
      f.app.store.get<ApiCommand>("ApiCommand", request).state,
      "UNKNOWN",
    );
    assert.equal(f.app.host.session.model_retry_generation, 1);
    c.stop();
  }));
test("resume is Main-only, explicit, argument-free, and pasted commands stay literal", () => {
  assert.deepEqual(parseInput("/resume", "Main"), { kind: "resume" });
  for (const s of ["/resume now", "/resume\n"])
    assert.equal(parseInput(s, "Main").kind, "error");
  assert.equal(parseInput("/resume", "Task").kind, "error");
  assert.equal(parseDraft(plainSnapshot("/resume"), "Main").kind, "error");
});

test("an original LOCAL batch and later inputs remain queued until explicit guarded recovery", () =>
  fixture(async (f) => {
    const stream = f.app.host.stream;
    (f.app.host as any).stream = () => {
      throw Error("synthetic local interruption");
    };
    f.app.host.accept("first input", id(), "MASTER");
    await f.app.host.drain();
    f.app.host.accept("later input", id(), "MASTER");
    await f.app.host.drain();
    assert.equal(f.app.host.session.state, "RECOVERY_BLOCKED");
    assert.deepEqual(
      f.app.store.all<Input>("Input").map((i) => i.state),
      ["CLAIMED", "ACCEPTED"],
    );
    (f.app.host as any).stream = stream;
    const c = new ResumeController();
    c.connect(f.client, "domain");
    await c.submit();
    await until(() =>
      f.app.store.all<Input>("Input").every((i) => i.state === "HANDLED"),
    );
    await c.reconcile();
    assert.equal(f.app.host.session.state, "IDLE");
    assert.equal(f.app.host.session.model_retry_generation, 1);
    c.stop();
  }));
