import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, directory, executions } from "./helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";

test("reuse validates future root after the previous project root is removed, then supports DIRECTORY to NONE", () =>
  fixture(async (a, _api, root) => {
    const oldRoot = directory(root),
      newRoot = directory(root, "new-root");
    let scope = a.scheduler.scopes.save({
      name: "Moving project",
      kind: "DIRECTORY",
      root_path: oldRoot,
    });
    const p = a.scheduler.propose("First", id(), a.host.sessionID, {
      scopeID: scope.id,
    });
    a.scheduler.tick();
    await a.scheduler.idle();
    const first = executions(a)[0];
    assert.equal(first.state, "SUCCEEDED");
    scope = a.scheduler.scopes.save(
      { root_path: newRoot },
      scope.id,
      scope.revision,
    );
    fs.rmSync(oldRoot, { recursive: true });
    a.scheduler.propose("Use new root", id(), a.host.sessionID, {
      reuse: p.id,
      parent: first.id,
    });
    a.scheduler.tick();
    await a.scheduler.idle();
    const second = executions(a).at(-1)!;
    assert.equal(second.state, "SUCCEEDED");
    assert.equal(second.workspace_binding!.root_path, newRoot);
    assert.equal(first.workspace_binding!.root_path, oldRoot);
    scope = a.scheduler.scopes.save({ kind: "NONE" }, scope.id, scope.revision);
    fs.rmSync(newRoot, { recursive: true });
    a.scheduler.propose("Use private root", id(), a.host.sessionID, {
      reuse: p.id,
      parent: second.id,
    });
    a.scheduler.tick();
    await a.scheduler.idle();
    const third = executions(a).at(-1)!;
    assert.equal(third.state, "SUCCEEDED");
    assert.equal(third.workspace_binding!.kind, "NONE");
    assert.equal(
      third.workspace_binding!.root_path,
      path.join(a.scheduler.workspace, p.id, "work"),
    );
    a.scheduler.scopes.archive(scope.id, scope.revision);
    assert.deepEqual(
      a.scheduler.continuationStatus(p.id, third.id, a.host.sessionID),
      { allowed: false, reason: "SCOPE_ARCHIVED" },
    );
  }));
