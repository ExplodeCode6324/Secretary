import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, directory, executions } from "../issue16/helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type { App } from "../../../src/pi_secretary/src/app.ts";
import type {
  AuthorizationRequest,
  Operation,
  WorkScope,
} from "../../../src/pi_secretary/src/contracts.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";

async function setup(a: App, root: string, ask = false) {
  const dir = directory(root);
  const scope = a.scheduler.scopes.save({
    name: "Synthetic scope",
    kind: "DIRECTORY",
    root_path: dir,
    default_write: ask ? "ask" : "allow",
  });
  a.scheduler.propose("Synthetic blocked task", id(), a.host.sessionID, {
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
  const e = revise(executions(a)[0], { state: "RUNNING" as const });
  a.store.commit([e]);
  const callScope = {
    session_id: a.host.sessionID,
    task_id: e.task_id,
    execution_id: e.id,
  };
  return { dir, scope, e, callScope };
}
function approval(a: App, op: Operation) {
  const q = a.store.get<AuthorizationRequest>(
    "AuthorizationRequest",
    op.authorization_id!,
  );
  return {
    schema_version: 1 as const,
    record_type: "ApprovalCommand" as const,
    request_id: id(),
    authorization_id: q.id,
    expected_revision: q.revision,
    display_hash: q.display_hash,
    decision: "APPROVE" as const,
  };
}
test("AUTH-02/03: policy cancellation creates one successor and one real approval for identical writes", () =>
  fixture(async (a, _api, root) => {
    const { dir, scope, callScope } = await setup(a, root);
    const args = { path: "x", content: "synthetic" },
      intent = id();
    const prepare = () =>
      a.authorization.prepare(
        callScope,
        "file.write",
        path.join(dir, "x"),
        args,
        intent,
        "ABSENT",
      );
    const first = prepare();
    assert.equal(first.rule_id, "builtin:workspace-write");
    a.scheduler.scopes.save({ default_write: "ask" }, scope.id, scope.revision);
    assert.throws(() => a.authorization.dispatch(first.id), /RULE_CHANGED/);
    assert.equal(
      a.store.get<Operation>("Operation", first.id).state,
      "CANCELLED",
    );
    const second = prepare();
    assert.notEqual(first.id, second.id);
    assert.equal(second.retry_of, first.id);
    assert.equal(second.state, "WAIT_AUTH");
    assert(second.authorization_id);
    assert.equal(prepare().id, second.id);
    assert.equal(a.store.all("AuthorizationRequest").length, 1);
    assert.equal(fs.existsSync(path.join(dir, "x")), false);
  }));
test("AUTH-06: rejected operation is not regenerated", () =>
  fixture(async (a, _api, root) => {
    const { dir, callScope } = await setup(a, root, true);
    const intent = id(),
      args = { path: "x", content: "test" };
    const prepare = () =>
      a.authorization.prepare(
        callScope,
        "file.write",
        path.join(dir, "x"),
        args,
        intent,
        "ABSENT",
      );
    const op = prepare();
    a.authorization.decide({ ...approval(a, op), decision: "REJECT" });
    assert.equal(prepare().id, op.id);
    assert.equal(prepare().state, "CANCELLED");
    assert.equal(a.store.all("Operation").length, 1);
  }));
test("REM-01/03/04: approve and remember is atomic, replayable, prefix constrained and disables at dispatch", () =>
  fixture(async (a, api, root) => {
    const { dir, callScope } = await setup(a, root, true);
    const prep = (command: string) =>
      a.authorization.prepare(
        callScope,
        "shell.run",
        dir,
        a.authorization.shellParameters(callScope, command, 120, dir),
      );
    const op = prep("npm test"),
      cmd = {
        ...approval(a, op),
        remember: { prefix_tokens: 2, expires_at: null },
      };
    assert.throws(
      () => a.authorization.decide({ ...cmd, display_hash: "0".repeat(64) }),
      /APPROVAL_CONFLICT/,
    );
    assert.equal(a.store.all("AuthorizationRule").length, 0);
    const approved = a.authorization.decide(cmd);
    assert(approved.remembered_rule_id);
    assert.equal(a.authorization.decide(cmd).id, approved.id);
    assert.equal(a.store.all("AuthorizationRule").length, 1);
    const next = prep("npm test -- --grep x");
    assert.equal(next.state, "AUTHORIZED");
    assert.equal(prep("npm install").state, "WAIT_AUTH");
    assert.equal(prep("npm test *.js").state, "WAIT_AUTH");
    const rule = a.store.all<any>("AuthorizationRule")[0];
    api.command(api.principal, `admin/authorization-rules/${rule.id}/disable`, {
      request_id: id(),
      expected_revision: String(rule.revision),
    });
    assert.throws(() => a.authorization.dispatch(next.id), /RULE_CHANGED/);
  }));
test("REM-02: write remember covers only the selected directory under ask", () =>
  fixture(async (a, api, root) => {
    const { dir, callScope } = await setup(a, root, true);
    const prep = (p: string) =>
      a.authorization.prepare(
        callScope,
        "file.write",
        path.join(dir, p),
        { path: p, content: "synthetic" },
        id(),
        "ABSENT",
      );
    const op = prep("src/a");
    const cmd = approval(a, op);
    assert.throws(
      () =>
        a.authorization.decide({
          ...cmd,
          remember: { path_prefix: "other", expires_at: null },
        }),
      /INVALID_REMEMBER/,
    );
    a.authorization.decide({
      ...cmd,
      remember: { path_prefix: "src", expires_at: null },
    });
    assert.equal(prep("src/b").state, "AUTHORIZED");
    assert.equal(prep("src-other/b").state, "WAIT_AUTH");
    const view = await api.query(api.principal, "authorization-rules");
    validate("RulePage", view);
    assert.equal((view as any).builtin_policies.length, 2);
    const detail = await api.query(
      api.principal,
      `authorizations/${op.authorization_id}`,
    );
    assert.equal((detail as any).remember_context.root, dir);
  }));
test("AUTH-04/05: legacy exact hash and unknown effects remain authoritative", () =>
  fixture(async (a, _api, root) => {
    const { dir, callScope } = await setup(a, root, true),
      args = { path: "x", content: "test" };
    const r = a.authorization.rule("file.write", path.join(dir, "x"), args);
    const op = a.authorization.prepare(
      callScope,
      "file.write",
      path.join(dir, "x"),
      args,
    );
    assert.equal(op.rule_id, r.id);
    a.authorization.dispatch(op.id);
    a.authorization.finish(op.id, { synthetic: true }, "UNKNOWN");
    assert.throws(
      () =>
        a.authorization.prepare(
          callScope,
          "file.write",
          path.join(dir, "x"),
          args,
        ),
      /RELATED_EFFECT_UNKNOWN/,
    );
    const view = a.authorization.rulesView();
    assert.equal(view.items[0].match_count, 1);
    const time = view.items[0].last_matched_at;
    a.store.commit([
      revise(a.store.get<Operation>("Operation", op.id), {
        error: "later diagnostic",
      }),
    ]);
    assert.equal(a.authorization.rulesView().items[0].last_matched_at, time);
  }));
test("API-01: owner rule union and Scope default_write validate strictly", () =>
  fixture(async (a, api, root) => {
    const { dir } = await setup(a, root, true);
    api.command(api.principal, "admin/authorization-rules", {
      request_id: id(),
      action: "shell.run",
      resource: dir,
      constraints: { kind: "command-prefix", command_prefix: ["npm", "test"] },
    });
    assert.throws(
      () =>
        api.command(api.principal, "admin/authorization-rules", {
          request_id: id(),
          action: "shell.run",
          resource: dir,
          parameters: {},
          constraints: { kind: "command-prefix", command_prefix: ["npm"] },
        }),
      /INVALID_REQUEST/,
    );
    validate(
      "Scope",
      await api.query(
        api.principal,
        `scopes/${a.store.all<WorkScope>("Scope")[0].id}`,
      ),
    );
  }));

test("AUTH-02 tool path: identical write after RULE_CHANGED waits on a real request, rejected retry returns error", () =>
  fixture(async (a, _api, root) => {
    const { scope, e, dir } = await setup(a, root);
    fs.writeFileSync(path.join(dir, "ready"), "ready");
    const write = (a.scheduler as any)
      .tools(e)
      .find((t: any) => t.name === "write");
    const dispatch = a.authorization.dispatch.bind(a.authorization);
    let flip = true;
    a.authorization.dispatch = (...args: Parameters<typeof dispatch>) => {
      if (flip) {
        flip = false;
        a.scheduler.scopes.save(
          { default_write: "ask" },
          scope.id,
          scope.revision,
        );
      }
      return dispatch(...args);
    };
    const args = { path: "same.txt", content: "synthetic" };
    await assert.rejects(() => write.execute("first", args), /RULE_CHANGED/);
    await write.execute("second", args);
    const waiting = a.store.get<any>("Execution", e.id);
    assert.equal(waiting.state, "WAIT_AUTH");
    assert.equal(waiting.waiting_request_ids.length, 1);
    const q = a.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      waiting.waiting_request_ids[0],
    );
    const op = a.store.get<Operation>("Operation", q.operation_id);
    a.authorization.decide({ ...approval(a, op), decision: "REJECT" });
    a.store.commit([revise(waiting, { state: "RUNNING" })]);
    const result = await write.execute("third", args);
    assert.equal(result.terminate, true);
    assert.equal(JSON.parse(result.content[0].text).state, "CANCELLED");
    assert.equal(
      JSON.parse(result.content[0].text).error,
      "WRITE_NOT_DISPATCHABLE",
    );
    assert.equal(a.store.get<any>("Execution", e.id).state, "RUNNING");
    assert.equal(a.store.all("Operation").length, 2);
  }));
test("REM-04 commit failure publishes neither approval nor remembered rule", () =>
  fixture(async (a, _api, root) => {
    const { dir, callScope } = await setup(a, root, true);
    const op = a.authorization.prepare(
      callScope,
      "file.write",
      path.join(dir, "x"),
      { path: "x", content: "x" },
    );
    const cmd = {
      ...approval(a, op),
      remember: { path_prefix: ".", expires_at: null },
    };
    const commit = a.store.commit.bind(a.store);
    a.store.commit = (records, ...rest) => {
      if (records.some((r) => r.record_type === "AuthorizationRule"))
        throw Error("SYNTHETIC_COMMIT_FAILURE");
      return commit(records, ...rest);
    };
    assert.throws(
      () => a.authorization.decide(cmd),
      /SYNTHETIC_COMMIT_FAILURE/,
    );
    assert.equal(a.store.all("AuthorizationRule").length, 0);
    assert.equal(a.store.get<Operation>("Operation", op.id).state, "WAIT_AUTH");
    a.store.commit = commit;
    a.authorization.decide(cmd);
    assert.equal(a.store.all("AuthorizationRule").length, 1);
  }));
test("AUTH-04 expiry and program-id constraints do not broaden authority", () =>
  fixture(async (a, _api, root) => {
    const { dir, callScope } = await setup(a, root, true),
      program = id();
    const r = a.authorization.rule("program.run", dir, undefined, {
      kind: "program",
      program_id: program,
    });
    const op = a.authorization.prepare(callScope, "program.run", dir, {
      program_id: program,
      parameters: { arbitrary: 1 },
    });
    assert.equal(op.rule_id, r.id);
    assert.equal(
      a.authorization.prepare(callScope, "program.run", dir, {
        program_id: id(),
        parameters: {},
      }).state,
      "WAIT_AUTH",
    );
    a.store.commit([revise(r, { expires_at: "2000-01-01T00:00:00Z" })]);
    assert.throws(() => a.authorization.dispatch(op.id), /RULE_CHANGED/);
    assert.throws(
      () =>
        a.authorization.rule(
          "shell.run",
          dir,
          undefined,
          { kind: "command-prefix", command_prefix: ["npm"] },
          "2000-01-01T00:00:00Z",
        ),
      /INVALID_RULE_TIME/,
    );
  }));

test("AUTH-03 shell successor recomputes execution mode without changing original command", () =>
  fixture(async (a, _api, root) => {
    const { dir, callScope } = await setup(a, root),
      intent = id();
    const prepare = () =>
      a.authorization.prepare(
        callScope,
        "shell.run",
        dir,
        a.authorization.shellParameters(callScope, "cat x", 120, dir, intent),
        intent,
      );
    fs.writeFileSync(path.join(dir, "x"), "safe");
    const first = prepare();
    assert.equal(first.rule_id, "builtin:readonly-shell");
    fs.unlinkSync(path.join(dir, "x"));
    assert.throws(() => a.authorization.dispatch(first.id), /RULE_CHANGED/);
    const next = prepare();
    assert.equal(next.state, "WAIT_AUTH");
    assert.equal(
      a.store.read<any>(next.action.parameters_ref).execution,
      undefined,
    );
    assert.equal(prepare().id, next.id);
    assert.throws(
      () =>
        a.authorization.prepare(
          callScope,
          "shell.run",
          dir,
          { command: "cat other", timeout: 120, cwd: dir },
          intent,
        ),
      /INTENT_CONFLICT/,
    );
  }));
