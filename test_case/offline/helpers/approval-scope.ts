import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { App } from "../../../src/pi_secretary/src/app.ts";
import type {
  Execution,
  TaskPlan,
} from "../../../src/pi_secretary/src/contracts.ts";
/** Approval regressions explicitly opt out of issue17's default workspace writes. */
export function approvalScope(app: App) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "secretary-ask-")),
  );
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    scopeID: app.scheduler.scopes.save({
      name: "Explicit approval fixture",
      kind: "DIRECTORY",
      root_path: root,
      default_write: "ask",
    }).id,
  };
}
export function taskRoot(app: App, taskID: string) {
  const e = app.store
    .all<Execution>("Execution")
    .find((e) => e.task_id === taskID);
  if (e) return app.scheduler.rootFor(e);
  const p = app.store.get<TaskPlan>("TaskPlan", taskID);
  return p.scope_id
    ? app.scheduler.scopes.get(p.scope_id).root_path!
    : path.join(app.scheduler.workspace, taskID, "work");
}
