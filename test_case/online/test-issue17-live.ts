// Explicit live acceptance, isolated synthetic files only. Never included in npm test.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  roleModel,
  type StreamFn,
} from "../../src/pi_secretary/src/model.ts";
import { id } from "../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  AuthorizationRequest,
  Operation,
} from "../../src/pi_secretary/src/contracts.ts";
const evidence = process.env.SECRETARY_ISSUE17_EVIDENCE;
if (!evidence)
  throw Error("Set SECRETARY_ISSUE17_EVIDENCE to a private evidence directory");
const keyFile =
  process.env.SECRETARY_CREDENTIALS_FILE ?? ".demo-data/live-credentials.json";
if (!fs.existsSync(keyFile))
  throw Error("LIVE_MODEL_NOT_RUN: credentials unavailable");
const keys = JSON.parse(fs.readFileSync(keyFile, "utf8"));
const modelID = process.env.SECRETARY_TASK_MODEL ?? "gpt-5.6-luna";
const model = getModel("opencode-go", modelID as never);
const config = roleModel(model, keys.task);
let calls = 0;
const started = Date.now();
const stream: StreamFn = (m, c, o) => {
  if (++calls > 16 || Date.now() - started > 360000)
    throw Error("LIVE_BUDGET_EXHAUSTED");
  return config.stream(m, c, {
    ...o,
    signal: o?.signal
      ? AbortSignal.any([o.signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000),
  });
};
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "issue17-live-")),
);
const report: Record<string, unknown> = {
  evidence: "LIVE_MODEL",
  model: modelID,
  cases: [],
  started_at: new Date().toISOString(),
};
try {
  for (const mode of ["allow", "ask", "unknown"] as const) {
    const app = await App.open(path.join(root, mode, "data"), {
      main: { model: fixtureModel, stream: fixtureStream },
      task: { model, stream },
    });
    try {
      const project = path.join(root, mode, "project");
      fs.mkdirSync(project, { recursive: true });
      fs.writeFileSync(path.join(project, "input.txt"), "synthetic sample\n");
      const scope = app.scheduler.scopes.save({
        name: "Synthetic acceptance",
        kind: "DIRECTORY",
        root_path: project,
        default_write: mode === "ask" ? "ask" : "allow",
      });
      let injected = false;
      const finish = app.authorization.finish.bind(app.authorization);
      if (mode === "unknown")
        app.authorization.finish = (...args: Parameters<typeof finish>) => {
          const op = app.store.get<Operation>("Operation", args[0]);
          if (!injected && op.action.action === "file.write") {
            injected = true;
            return finish(
              args[0],
              { synthetic: "unknown result fixture" },
              "UNKNOWN",
            );
          }
          return finish(...args);
        };
      app.scheduler.propose(
        'In this synthetic project, inspect the directory with ls, read input.txt, then write output.txt containing "synthetic result" and report completion. If an operation requires approval, wait. If its result is unknown, stop and report the uncertainty without retrying.',
        id(),
        app.host.sessionID,
        { scopeID: scope.id },
      );
      app.scheduler.tick();
      await app.scheduler.idle();
      let e = app.store.all<Execution>("Execution")[0];
      if (mode === "ask") {
        assert.equal(e.state, "WAIT_AUTH");
        assert(!fs.existsSync(path.join(project, "output.txt")));
        const pending = app.store
          .all<AuthorizationRequest>("AuthorizationRequest")
          .filter((q) => q.state === "PENDING");
        assert.equal(pending.length, 1);
        const q = pending[0];
        assert.equal(q.action.action, "file.write");
        assert.equal(q.action.resource, path.join(project, "output.txt"));
        app.authorization.decide({
          schema_version: 1,
          record_type: "ApprovalCommand",
          request_id: id(),
          authorization_id: q.id,
          expected_revision: q.revision,
          display_hash: q.display_hash,
          decision: "APPROVE",
        });
        await app.scheduler.run(e.id);
        e = app.store.get("Execution", e.id);
      }
      const ops = app.store.all<Operation>("Operation");
      if (mode !== "unknown") {
        assert.equal(e.state, "SUCCEEDED");
        assert.match(
          fs.readFileSync(path.join(project, "output.txt"), "utf8"),
          /synthetic result/,
        );
      } else {
        assert(injected);
        assert.equal(
          ops.filter((o) => o.action.action === "file.write").length,
          1,
        );
        assert(ops.some((o) => o.state === "RESULT_UNKNOWN"));
      }
      assert(ops.some((o) => o.rule_id === "builtin:readonly-shell"));
      (report.cases as unknown[]).push({
        mode,
        state: e.state,
        operations: ops.map((o) => ({
          action: o.action.action,
          state: o.state,
          rule_id: o.rule_id,
        })),
      });
    } finally {
      await app.close();
    }
  }
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  report.calls = calls;
  report.elapsed_ms = Date.now() - started;
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(
    path.join(evidence, "live.json"),
    JSON.stringify(report, null, 2),
  );
  fs.rmSync(root, { recursive: true, force: true });
}
