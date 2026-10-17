import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, directory, executions } from "../issue16/helpers.ts";
import {
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  Operation,
  AuthorizationRequest,
} from "../../../src/pi_secretary/src/contracts.ts";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { fixtureModel } from "../../../src/pi_secretary/src/model.ts";

const tasks = (c: any) =>
  JSON.stringify(c.messages.filter((m: any) => m.role === "system")).includes(
    "TASK_EXECUTOR",
  );
test("PROC-01: scheduler automatically writes and directly runs readonly command in temporary workspace", () => {
  let calls = 0;
  const stream: StreamFn = (m, c, o) => {
    if (tasks(c)) {
      calls++;
      if (calls === 1)
        return replyStream(
          [
            {
              type: "toolCall",
              id: "write",
              name: "write",
              arguments: { path: "synthetic.txt", content: "hello" },
            },
          ],
          m,
        );
      if (calls === 2)
        return replyStream(
          [
            {
              type: "toolCall",
              id: "shell",
              name: "bash",
              arguments: { command: "cat synthetic.txt" },
            },
          ],
          m,
        );
    }
    return fixtureStream(m, c, o);
  };
  return fixture(async (a) => {
    a.scheduler.propose("synthetic sequence", id(), a.host.sessionID);
    a.scheduler.tick();
    await a.scheduler.idle();
    assert.equal(a.store.all("AuthorizationRequest").length, 0);
    const ops = a.store.all<Operation>("Operation");
    assert.equal(ops.length, 2);
    assert.deepEqual(
      ops.map((o) => o.rule_id),
      ["builtin:workspace-write", "builtin:readonly-shell"],
    );
    assert(ops.every((o) => o.state === "SUCCEEDED"));
    assert.match(JSON.stringify(a.store.read(ops[1].receipt!)), /hello/);
    assert.equal(executions(a)[0].state, "SUCCEEDED");
  }, stream);
});
test("PROC-02: one-shot and remembered shell use identical bash environment and cwd", () => {
  let calls = 0;
  const stream: StreamFn = (m, c, o) => {
    if (tasks(c)) {
      calls++;
      if (calls <= 2)
        return replyStream(
          [
            {
              type: "toolCall",
              id: `shell-${calls}`,
              name: "bash",
              arguments: { command: "printf synthetic" },
            },
          ],
          m,
        );
    }
    return fixtureStream(m, c, o);
  };
  return fixture(async (a) => {
    a.scheduler.propose("synthetic shell", id(), a.host.sessionID);
    a.scheduler.tick();
    await a.scheduler.idle();
    const q = a.store.all<AuthorizationRequest>("AuthorizationRequest")[0];
    a.authorization.decide({
      schema_version: 1,
      record_type: "ApprovalCommand",
      request_id: id(),
      authorization_id: q.id,
      expected_revision: q.revision,
      display_hash: q.display_hash,
      decision: "APPROVE",
      remember: { prefix_tokens: 2, expires_at: null },
    });
    await a.scheduler.run(executions(a)[0].id);
    const ops = a.store.all<Operation>("Operation");
    assert.equal(ops.length, 2);
    assert(ops.every((o) => o.state === "SUCCEEDED"));
    const params = ops.map((o) => a.store.read<any>(o.action.parameters_ref));
    assert.deepEqual(params[0], params[1]);
    assert.equal(params[1].execution, undefined);
    for (const op of ops)
      assert.match(JSON.stringify(a.store.read(op.receipt!)), /synthetic/);
    assert.equal(a.authorization.rulesView().items[0].match_count, 1);
  }, stream);
});
test("AUTH-03: successor approval and remembered rule survive actual Store reopen", () =>
  fixture(async (a, _api, root) => {
    const dir = directory(root),
      scope = a.scheduler.scopes.save({
        name: "Synthetic",
        kind: "DIRECTORY",
        root_path: dir,
      });
    a.scheduler.propose("wait", id(), a.host.sessionID, {
      scopeID: scope.id,
      preconditions: [
        {
          condition_id: id(),
          kind: "RESOURCE_PRESENT",
          target: "ready",
          required_revision: null,
        },
      ],
    });
    a.scheduler.tick();
    await a.scheduler.idle();
    let e = executions(a)[0];
    for (const state of ["READY", "DISPATCHING", "RUNNING"] as const) {
      e = revise(e, { state });
      a.store.commit([e]);
    }
    const cs = {
        session_id: a.host.sessionID,
        task_id: e.task_id,
        execution_id: e.id,
      },
      args = { path: "x", content: "x" },
      intent = id();
    const first = a.authorization.prepare(
      cs,
      "file.write",
      path.join(dir, "x"),
      args,
      intent,
      "ABSENT",
    );
    a.scheduler.scopes.save({ default_write: "ask" }, scope.id, scope.revision);
    assert.throws(() => a.authorization.dispatch(first.id), /RULE_CHANGED/);
    const next = a.authorization.prepare(
      cs,
      "file.write",
      path.join(dir, "x"),
      args,
      intent,
      "ABSENT",
    );
    const q = a.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      next.authorization_id!,
    );
    const cmd = {
      schema_version: 1 as const,
      record_type: "ApprovalCommand" as const,
      request_id: id(),
      authorization_id: q.id,
      expected_revision: q.revision,
      display_hash: q.display_hash,
      decision: "APPROVE" as const,
      remember: { path_prefix: ".", expires_at: null },
    };
    a.authorization.decide(cmd);
    await a.close();
    const reopened = await App.open(a.store.dir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    try {
      assert.equal(
        reopened.authorization.prepare(
          cs,
          "file.write",
          path.join(dir, "x"),
          args,
          intent,
          "ABSENT",
        ).id,
        next.id,
      );
      assert.equal(
        reopened.authorization.decide(cmd).remembered_rule_id,
        reopened.store.all<any>("AuthorizationRule")[0].id,
      );
      assert.equal(reopened.store.all("Operation").length, 2);
      assert.equal(reopened.store.all("AuthorizationRequest").length, 1);
    } finally {
      await reopened.close();
    }
  }));
