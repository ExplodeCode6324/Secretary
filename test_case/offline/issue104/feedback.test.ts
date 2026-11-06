import fs from "node:fs";
import { normalizeContext } from "@earendil-works/pi-ai";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import {
  fixtureModel,
  replyStream,
} from "../../../src/pi_secretary/src/model.ts";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fixture } from "../issue9/helpers.ts";
import { pending } from "./helpers.ts";
import { approvalScope } from "../helpers/approval-scope.ts";
import { id, revise, base } from "../../../src/pi_secretary/src/store.ts";
import {
  authorizationActionable,
  taskFeedback,
} from "../../../src/pi_secretary/src/task-feedback.ts";
import type {
  AuthorizationRequest,
  Execution,
  Feedback,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";

test("WAIT_AUTH outbox is atomic, actionable during recovery READY, delivered once, and never regenerated", () =>
  fixture(async (f) => {
    const e = await pending(f, approvalScope(f.app));
    const scope = { session_id: null, task_id: e.task_id, execution_id: e.id };
    for (const state of ["READY", "DISPATCHING", "RUNNING"] as const)
      f.app.scheduler["setState"](e.id, state);
    await assert.rejects(
      Promise.resolve(
        durableStream(f.app.store, () => replyStream([]), scope, e.id, "TASK", {
          onPrepared: () => {
            throw Error("CRASH_AFTER_PREPARED");
          },
        })(
          fixtureModel,
          normalizeContext({
            messages: [
              { role: "user", content: "recover authorization", timestamp: 0 },
            ],
          }),
        ),
      ),
      /CRASH_AFTER_PREPARED/,
    );
    const op = f.app.authorization.prepare(
      scope,
      "file.write",
      path.join(f.app.scheduler.rootFor(e), "approval.txt"),
      { path: "approval.txt", content: "approval" },
      id(),
      "ABSENT",
    );
    assert.equal(op.state, "WAIT_AUTH");
    const auth = f.app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      op.authorization_id!,
    );
    const feedback = f.app.store
      .all<Feedback>("Feedback")
      .find((x) => x.authorization_id === auth.id)!;
    assert(feedback);
    const frame = f.app.store.projectionFrames.find((x) =>
      x.mutations.some((m) => m.object_id === feedback.id),
    )!;
    assert(frame.mutations.some((m) => m.object_id === auth.id));
    assert(frame.mutations.some((m) => m.object_id === op.id));
    await f.restart();
    assert.equal(f.app.store.get<Execution>("Execution", e.id).state, "READY");
    assert(authorizationActionable(f.app.store, auth.id));
    f.app.host.deliverFeedback();
    f.app.host.deliverFeedback();
    f.app.authorization.recover();
    assert.equal(
      f.app.store
        .all<Feedback>("Feedback")
        .filter((x) => x.authorization_id === auth.id).length,
      1,
    );
    assert.equal(
      f.app.store
        .all<Input>("Input")
        .filter((x) => x.feedback_id === feedback.id).length,
      1,
    );
    const delivery = f.app.store.projectionFrames.find((x) =>
      x.mutations.some(
        (m) =>
          m.object_type === "Input" &&
          f.app.store.read<Input>(m.snapshot).feedback_id === feedback.id,
      ),
    )!;
    assert(delivery.mutations.some((m) => m.object_id === feedback.id));
    await f.restart();
    f.app.host.deliverFeedback();
    assert.equal(
      f.app.store
        .all<Input>("Input")
        .filter((x) => x.feedback_id === feedback.id).length,
      1,
    );
  }));

test("withdrawn/expired/cancelled authorization settles SUPPRESSED without Input; Main-only auth stays outside Task outbox", () =>
  fixture(async (f) => {
    const e = await pending(f, approvalScope(f.app));
    for (const disposition of ["revoke", "expire", "cancel"]) {
      const op = f.app.authorization.prepare(
        { session_id: null, task_id: e.task_id, execution_id: e.id },
        "file.write",
        path.join(f.app.scheduler.rootFor(e), disposition),
        { path: disposition, content: "x" },
        id(),
        "ABSENT",
      );
      const a = f.app.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        op.authorization_id!,
      );
      if (disposition === "revoke")
        f.app.store.commit([revise(a, { state: "REVOKED" })]);
      if (disposition === "expire")
        f.app.store.commit([
          revise(a, { expires_at: "2000-01-01T00:00:00.000Z" }),
        ]);
      if (disposition === "cancel")
        f.app.store.commit([
          revise(f.app.store.get<Execution>("Execution", e.id), {
            cancel_requested: true,
          }),
        ]);
      f.app.host.deliverFeedback();
      const feedback = f.app.store
        .all<Feedback>("Feedback")
        .find((x) => x.authorization_id === a.id)!;
      assert.equal(feedback.state, "SUPPRESSED");
      assert(feedback.suppressed_at);
      assert(feedback.suppressed_reason);
      assert.equal(feedback.input_id, null);
      assert(
        !f.app.store
          .all<Input>("Input")
          .some((x) => x.feedback_id === feedback.id),
      );
    }
    const count = f.app.store.all<Feedback>("Feedback").length;
    f.app.authorization.prepare(
      { session_id: f.app.host.sessionID, task_id: null, execution_id: null },
      "shell.run",
      f.dir,
      { command: "echo synthetic" },
    );
    assert.equal(f.app.store.all<Feedback>("Feedback").length, count);
  }));

test("UNKNOWN is one execution episode, atomic and legacy random IDs cover upgrade", () =>
  fixture(async (f) => {
    const e = await pending(f);
    const detail = f.app.store.put({ synthetic: true });
    for (const state of ["READY", "DISPATCHING", "RUNNING"] as const)
      f.app.scheduler["setState"](e.id, state);
    const operationIDs = [];
    for (const name of ["unknown-one", "unknown-two"]) {
      const op = f.app.authorization.prepare(
        { session_id: null, task_id: e.task_id, execution_id: e.id },
        "file.write",
        path.join(f.app.scheduler.rootFor(e), name),
        { path: name, content: "x" },
        id(),
        "ABSENT",
      );
      f.app.authorization.dispatch(op.id);
      f.app.authorization.finish(op.id, { error: name }, "UNKNOWN");
      operationIDs.push(op.id);
    }
    f.app.scheduler["setState"](
      e.id,
      "RESULT_UNKNOWN",
      {},
      {
        summary: "Specific runner error",
        detail,
      },
    );
    assert.deepEqual(
      f.app.store.get<Execution>("Execution", e.id).unknown_operation_ids,
      operationIDs,
    );
    const first = f.app.store
      .all<Feedback>("Feedback")
      .find((x) => x.kind === "UNKNOWN")!;
    assert(first);
    assert.equal(first.summary, "Specific runner error");
    assert.deepEqual(first.detail_ref, detail);
    const frame = f.app.store.projectionFrames.find((x) =>
      x.mutations.some((m) => m.object_id === first.id),
    )!;
    assert(frame.mutations.some((m) => m.object_id === e.id));
    f.app.scheduler.feedback(e.id, "UNKNOWN", "second operation", detail);
    assert.equal(
      f.app.store.all<Feedback>("Feedback").filter((x) => x.kind === "UNKNOWN")
        .length,
      1,
    );
    f.app.host.deliverFeedback();
    f.app.host.deliverFeedback();
    assert.equal(
      f.app.store.all<Input>("Input").filter((i) => i.feedback_id === first.id)
        .length,
      1,
    );
    await f.restart();
    f.app.scheduler.feedback(e.id, "UNKNOWN", "after restart", detail);
    assert.equal(
      f.app.store.all<Feedback>("Feedback").filter((x) => x.kind === "UNKNOWN")
        .length,
      1,
    );
    const legacy = await pending(f);
    const old: Feedback = {
      ...base(),
      record_type: "Feedback",
      schema_version: 1,
      scope_id: legacy.scope_id,
      task_id: legacy.task_id,
      execution_id: legacy.id,
      kind: "UNKNOWN",
      state: "QUEUED",
      summary: "Legacy random fact",
      detail_ref: detail,
      result_id: null,
      decision_request_id: null,
      input_id: null,
      created_at: new Date().toISOString(),
    };
    f.app.store.commit([old]);
    const built = taskFeedback(f.app.store, legacy, "UNKNOWN", "new", detail);
    assert.equal(built.fresh, false);
    assert.equal(built.record.id, old.id);
  }));

test("a suppressed authorization notification does not pin an otherwise settled execution", () =>
  fixture(async (f) => {
    const e = await pending(f, approvalScope(f.app));
    const op = f.app.authorization.prepare(
      { session_id: null, task_id: e.task_id, execution_id: e.id },
      "file.write",
      path.join(f.app.scheduler.rootFor(e), "retire.txt"),
      { path: "retire.txt", content: "x" },
      id(),
      "ABSENT",
    );
    f.app.scheduler.cancel(e.id);
    f.app.host.deliverFeedback();
    const feedback = f.app.store.all<Feedback>("Feedback");
    assert.equal(
      feedback.find((f) => f.authorization_id === op.authorization_id)?.state,
      "SUPPRESSED",
    );
    await f.app.host.drain();
    f.app.scheduler.retire(Date.now() + 30 * 86400000);
    assert.equal(
      f.app.store.get<Execution>("Execution", e.id).retention_state,
      "RETIRED",
    );
  }));

for (const cancelled of [false, true])
  test(`restart without unknown effects emits only RESULT (cancelled=${cancelled})`, () =>
    fixture(async (f) => {
      const e = await pending(f);
      f.app.scheduler["setState"](e.id, "READY");
      f.app.scheduler["setState"](e.id, "DISPATCHING", {
        cancel_requested: cancelled,
      });
      await f.restart();
      assert.equal(
        f.app.store.get<Execution>("Execution", e.id).state,
        "FAILED",
      );
      assert.deepEqual(
        f.app.store
          .all<Feedback>("Feedback")
          .filter((x) => x.execution_id === e.id)
          .map((x) => x.kind),
        ["RESULT"],
      );
      f.app.host.deliverFeedback();
      assert.equal(
        f.app.store.all<Input>("Input").filter((i) => i.feedback_id).length,
        1,
      );
    }));

test("PROGRAM authorization is atomic and approval before delivery suppresses the notification", () =>
  fixture(async (f) => {
    const script = path.join(f.dir, "program.mjs");
    fs.writeFileSync(script, "console.log('{}')");
    const program = f.app.scheduler.registerProgram(script, "outbox fixture");
    const p = f.app.scheduler.propose(
      "Program approval",
      id(),
      f.app.host.sessionID,
      { programID: program.id },
    );
    f.app.scheduler.tick();
    await f.app.scheduler.idle();
    const e = f.app.store
      .all<Execution>("Execution")
      .find((e) => e.task_id === p.id)!;
    assert.equal(e.state, "WAIT_AUTH");
    const a = f.app.store
      .all<AuthorizationRequest>("AuthorizationRequest")
      .find((a) => a.scope.execution_id === e.id)!;
    const notice = f.app.store
      .all<Feedback>("Feedback")
      .find((x) => x.authorization_id === a.id)!;
    assert(notice);
    const frame = f.app.store.projectionFrames.find((f) =>
      f.mutations.some((m) => m.object_id === notice.id),
    )!;
    assert(frame.mutations.some((m) => m.object_id === a.id));
    f.app.authorization.decide({
      schema_version: 1,
      record_type: "ApprovalCommand",
      request_id: id(),
      authorization_id: a.id,
      expected_revision: a.revision,
      display_hash: a.display_hash,
      decision: "APPROVE",
    });
    f.app.host.deliverFeedback();
    assert.equal(
      f.app.store.get<Feedback>("Feedback", notice.id).state,
      "SUPPRESSED",
    );
    assert(
      !f.app.store.all<Input>("Input").some((i) => i.feedback_id === notice.id),
    );
  }));
