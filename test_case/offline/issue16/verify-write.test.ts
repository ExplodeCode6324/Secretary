import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, directory, executions } from "./helpers.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { scopeOf } from "../../../src/pi_secretary/src/scheduler.ts";
import type {
  Execution,
  Operation,
} from "../../../src/pi_secretary/src/contracts.ts";

test("verify-write uses bound root after Scope update, keeps hash mismatch unknown and shares final settlement", () =>
  fixture(async (a, _api, root) => {
    const oldRoot = directory(root),
      newRoot = directory(root, "new");
    const s = a.scheduler.scopes.save({
      name: "Verification",
      kind: "DIRECTORY",
      root_path: oldRoot,
    });
    a.scheduler.propose("waiting", id(), a.host.sessionID, {
      scopeID: s.id,
      preconditions: [
        {
          condition_id: id(),
          kind: "RESOURCE_PRESENT",
          target: "never",
          required_revision: null,
        },
      ],
    });
    a.scheduler.tick();
    await a.scheduler.idle();
    const e = executions(a)[0];
    const op = a.authorization.prepare(
      scopeOf(e),
      "file.write",
      path.join(oldRoot, "result.txt"),
      { path: "result.txt", content: "expected" },
    );
    a.store.commit([
      revise(op, { state: "RESULT_UNKNOWN", effect: "UNKNOWN" }),
      revise(e, { state: "RESULT_UNKNOWN" }),
    ]);
    a.scheduler.scopes.save({ root_path: newRoot }, s.id, s.revision);
    fs.writeFileSync(path.join(oldRoot, "result.txt"), "different");
    fs.writeFileSync(path.join(newRoot, "result.txt"), "expected");
    assert.equal(a.scheduler.verifyWrite(op.id).verified, false);
    assert.equal(
      a.store.get<Operation>("Operation", op.id).state,
      "RESULT_UNKNOWN",
    );
    fs.writeFileSync(path.join(oldRoot, "result.txt"), "expected");
    assert.equal(a.scheduler.verifyWrite(op.id).verified, true);
    assert.equal(a.store.get<Execution>("Execution", e.id).state, "FAILED");
    assert.equal(a.store.all("TaskResult").length, 1);
  }));
