import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  roleModel,
  type ModelConfig,
} from "../../../src/pi_secretary/src/model.ts";
import { id, hash } from "../../../src/pi_secretary/src/store.ts";
import { failuresFor } from "../../../src/pi_secretary/src/failure-handling.ts";
import type {
  Execution,
  FailureHandling,
  Input,
  TaskResult,
} from "../../../src/pi_secretary/src/contracts.ts";
import { scriptedFixture } from "../../online/issue84-fixture.ts";

test("rehearsal redo reads the staged source and registers a successful write with error:null", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue84-redo-"));
  const model = getModel("deepseek", "deepseek-flash");
  let app: App;
  const config = (role: "main" | "task"): ModelConfig => {
    const adapter = roleModel(model, "synthetic-key", role);
    return {
      model,
      stream: (m, c, options) =>
        adapter.stream(m, c, {
          ...options,
          fetch: async (_url, init) => {
            assert.equal(typeof init?.body, "string");
            const pending =
              role === "main"
                ? app.store
                    .all<FailureHandling>("FailureHandling")
                    .find(
                      (f) =>
                        f.action === "REDO" &&
                        f.phase === "REQUESTED" &&
                        app.store.get<Input>("Input", f.input_id).state ===
                          "CLAIMED",
                    )
                : undefined;
            return scriptedFixture(
              role,
              init!.body as string,
              undefined,
              pending
                ? {
                    failure_intent_id: pending.intent_id,
                    reuse_task_id: pending.task_id,
                    parent_execution_id: pending.execution_id,
                  }
                : undefined,
            );
          },
        }),
    };
  };
  app = await App.open(dir, { main: config("main"), task: config("task") });
  const server = await serveCore(app, 0, undefined, { pump: false });
  try {
    const plan = app.scheduler.propose(
      "ISSUE84-FAILURE",
      id(),
      app.host.sessionID,
    );
    await app.settle();
    const first = app.store
      .all<Execution>("Execution")
      .find((e) => e.task_id === plan.id)!;
    assert.equal(first.state, "FAILED", "missing source must still fail");
    const root = first.workspace_binding?.root_path;
    assert(root);
    fs.writeFileSync(path.join(root, "source.txt"), "ISSUE84-REDO\n");
    const key = "EXECUTION:" + first.id;
    const client = new CoreClient(server.endpoint);
    await client.command("messages", {
      request_id: id(),
      text: "",
      failure_action: {
        failure_key: key,
        expected_revision: failuresFor(app.store).view(key, app.host.sessionID)
          .revision,
        action: "REDO",
      },
    });
    await app.settle();
    const executions = app.store
      .all<Execution>("Execution")
      .filter((e) => e.task_id === plan.id);
    assert.equal(
      executions.length,
      2,
      "one intent creates exactly one new execution",
    );
    const redo = executions.find((e) => e.id !== first.id)!;
    assert.equal(redo.continuation_of, first.id);
    assert.equal(redo.state, "SUCCEEDED");
    assert.equal(
      app.store.get<Execution>("Execution", first.id).state,
      "FAILED",
    );
    const result = app.store.get<TaskResult>("TaskResult", redo.result_id!);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].content.sha256, hash("ISSUE84-REDO\n"));
    assert.equal(
      fs.readFileSync(path.join(root, "report.txt"), "utf8"),
      "ISSUE84-REDO\n",
    );
    assert.equal(
      failuresFor(app.store).view(key, app.host.sessionID).disposition,
      "REDO_SUCCEEDED",
    );
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
