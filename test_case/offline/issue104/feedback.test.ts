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
    const current = f.app.store.get<Execution>("Execution", e.id);
    f.app.store.commit([revise(current, { state: "READY" })]);
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
    for (const state of [
      "READY",
      "DISPATCHING",
      "RUNNING",
      "RESULT_UNKNOWN",
    ] as const)
      f.app.scheduler["setState"](e.id, state);
    const first = f.app.store
      .all<Feedback>("Feedback")
      .find((x) => x.kind === "UNKNOWN")!;
    assert(first);
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
