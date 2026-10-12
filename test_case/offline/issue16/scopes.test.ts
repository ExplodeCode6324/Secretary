import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { validate } from "../../../src/pi_secretary/src/api/protocol.ts";
import {
  replyStream,
  fixtureStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Execution,
  WorkScope,
} from "../../../src/pi_secretary/src/contracts.ts";
import { fixture, directory, executions } from "./helpers.ts";

test("owner Scope CRUD is revisioned, replayable and exposes bounded public DTOs", () =>
  fixture(async (a, api, root) => {
    const body = {
      request_id: id(),
      name: "Synthetic project",
      kind: "DIRECTORY",
      root_path: directory(root),
    };
    const receipt = api.command(api.principal, "scopes", body);
    assert.deepEqual(api.command(api.principal, "scopes", body), receipt);
    assert.throws(
      () => api.command(api.principal, "scopes", { ...body, name: "changed" }),
      /REQUEST_CONFLICT/,
    );
    const s = a.store.all<WorkScope>("Scope")[0];
    assert.equal(s.notes_path, ".secretary/NOTES.md");
    validate("Scope", await api.query(api.principal, `scopes/${s.id}`));
    validate("ScopePage", await api.query(api.principal, "scopes"));
    assert.throws(
      () =>
        api.command(api.principal, `scopes/${s.id}`, {
          request_id: id(),
          expected_revision: "2",
          name: "changed",
        }),
      /REVISION_CONFLICT/,
    );
    api.command(api.principal, `scopes/${s.id}`, {
      request_id: id(),
      expected_revision: "1",
      name: "updated",
    });
    api.command(api.principal, `scopes/${s.id}/archive`, {
      request_id: id(),
      expected_revision: "2",
    });
    assert.equal(a.scheduler.scopes.get(s.id).state, "ARCHIVED");
    assert(fs.existsSync(body.root_path));
    assert.throws(
      () =>
        a.scheduler.propose("new", id(), a.host.sessionID, { scopeID: s.id }),
      /SCOPE_ARCHIVED/,
    );
    assert.throws(
      () =>
        api.command(api.principal, "scopes", {
          ...body,
          request_id: id(),
          state: "ACTIVE",
        }),
      /INVALID_REQUEST/,
    );
  }));

test("DIRECTORY rejects overlapping roots, data roots, symlink parents and unsafe notes", () =>
  fixture(async (a, _api, root) => {
    const create = (p: string, notes?: string) =>
      a.scheduler.scopes.save({
        name: "Synthetic",
        kind: "DIRECTORY",
        root_path: p,
        notes_path: notes,
      });
    for (const p of [a.store.dir, root, directory(a.store.dir, "child")])
      assert.throws(() => create(p), /SCOPE_ROOT_RESERVED/);
    const project = directory(root);
    create(project);
    assert.throws(() => create(project), /SCOPE_ROOT_CONFLICT/);
    assert.throws(
      () => create(directory(project, "nested")),
      /SCOPE_ROOT_CONFLICT/,
    );
    const sibling = directory(root, "sibling");
    assert.doesNotThrow(() => create(sibling));
    const link = path.join(root, "link");
    fs.symlinkSync(sibling, link);
    assert.throws(() => create(link), /SYMLINK_REJECTED/);
    assert.throws(() => create(path.join(link, "nested")), /SYMLINK_REJECTED/);
    assert.throws(
      () => create(directory(root, "unsafe"), "../outside"),
      /INVALID_PATH/,
    );
    assert.throws(() => create(path.join(root, "missing")), /ENOENT/);
    // A source checkout is allowed when its runtime data lives outside it.
    const source = directory(root, "source");
    fs.mkdirSync(path.join(source, ".git"));
    assert.doesNotThrow(() => create(source));
  }));

test("Execution freezes root, rejects binding edits and exposes queued old-root conflicts", () =>
  fixture(async (a, _api, root) => {
    const oldRoot = directory(root),
      newRoot = directory(root, "new");
    const scope = a.scheduler.scopes.save({
      name: "A",
      kind: "DIRECTORY",
      root_path: oldRoot,
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
    const e = executions(a)[0];
    assert.equal(a.scheduler.rootFor(e), oldRoot);
    assert.equal(
      fs.existsSync(path.join(a.scheduler.workspace, e.task_id, "work")),
      false,
    );
    assert.throws(
      () =>
        a.store.commit([
          revise(e, {
            workspace_binding: { ...e.workspace_binding!, root_path: newRoot },
          }),
        ]),
      /EXECUTION_WORKSPACE_IMMUTABLE/,
    );
    a.scheduler.scopes.save({ root_path: newRoot }, scope.id, scope.revision);
    assert.equal(a.scheduler.rootFor(e), oldRoot);
    a.scheduler.scopes.save({
      name: "B",
      kind: "DIRECTORY",
      root_path: oldRoot,
    });
    fs.writeFileSync(path.join(oldRoot, "ready"), "yes");
    a.scheduler.tick();
    await a.scheduler.idle();
    const blocked = executions(a)[0];
    assert.equal(blocked.state, "WAIT_PRECONDITION");
    assert.equal(
      blocked.condition_results.at(-1)?.reason,
      "SCOPE_ROOT_CONFLICT",
    );
  }));

const decision: StreamFn = (m, c, o) =>
  JSON.stringify(c.messages.filter((x) => x.role === "system")).includes(
    "TASK_EXECUTOR",
  )
    ? replyStream(
        [
          {
            type: "toolCall",
            id: "ask",
            name: "request_decision",
            arguments: { question: "Synthetic decision" },
          },
        ],
        m,
      )
    : fixtureStream(m, c, o);
test("DIRECTORY serializes same-tick tasks through WAIT_DECISION; NONE tasks run concurrently", () =>
  fixture(async (a, _api, root) => {
    const scoped = a.scheduler.scopes.save({
      name: "Shared",
      kind: "DIRECTORY",
      root_path: directory(root),
    });
    for (let n = 0; n < 2; n++)
      a.scheduler.propose("ask", id(), a.host.sessionID, {
        scopeID: scoped.id,
      });
    a.scheduler.tick();
    await a.scheduler.idle();
    let es = executions(a);
    assert.deepEqual(
      es.map((e) => e.state),
      ["WAIT_DECISION", "WAIT_PRECONDITION"],
    );
    assert.equal(es[1].condition_results.at(-1)?.reason, "SCOPE_BUSY");
    a.scheduler.scopes.save({ kind: "NONE" }, scoped.id, scoped.revision);
    a.scheduler.tick();
    await a.scheduler.idle();
    assert.equal(executions(a)[1].state, "WAIT_PRECONDITION");
    await a.scheduler.cancel(es[0].id);
    a.scheduler.tick();
    await a.scheduler.idle();
    assert.equal(executions(a)[1].state, "WAIT_DECISION");
    const none = a.scheduler.scopes.save({ name: "Group", kind: "NONE" });
    for (let n = 0; n < 2; n++)
      a.scheduler.propose("ask", id(), a.host.sessionID, {
        scopeID: none.id,
      });
    a.scheduler.tick();
    await a.scheduler.idle();
    es = executions(a).filter((e) => e.scope_id === none.id);
    assert(es.every((e) => e.state === "WAIT_DECISION"));
    assert.notEqual(
      es[0].workspace_binding!.root_path,
      es[1].workspace_binding!.root_path,
    );
  }, decision));
