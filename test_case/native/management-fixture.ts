// Controlled synthetic records are seeded through domain services or Store in this test only.
// The Swift client under test uses authenticated public HTTP exclusively.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../src/pi_secretary/src/model.ts";
import { id, base, revise } from "../../src/pi_secretary/src/store.ts";
import { interrupted } from "../offline/issue18/helpers.ts";
import { withTestDatabase } from "../offline/helpers/postgres.ts";
import type {
  Execution,
  TaskResult,
} from "../../src/pi_secretary/src/contracts.ts";

async function run(dsn?: string) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-management-fixture-"),
  );
  fs.chmodSync(root, 0o700);
  const app = await App.open(
    path.join(root, "core"),
    { model: fixtureModel, stream: fixtureStream },
    dsn,
  );
  if (app.world) await app.world.migrate();
  const task = app.scheduler.propose(
    "Native management synthetic artifacts",
    id(),
    app.host.sessionID,
  );
  await app.settle();
  const execution = app.store
    .all<Execution>("Execution")
    .find((e) => e.task_id === task.id)!;
  const result = app.store
    .all<TaskResult>("TaskResult")
    .find((r) => r.execution_id === execution.id)!;
  const artifact = {
    artifact_id: id(),
    name: "result.txt",
    content: app.store.put("native artifact 中文", "text/plain"),
    workspace_path: "result.txt",
    producing_operation_id: null,
  };
  app.store.commit([
    {
      ...result,
      ...base(),
      artifacts: [artifact, { ...artifact, artifact_id: id() }],
    },
  ]);
  const approvals: string[] = [];
  for (let n = 0; n < 4; n++) {
    const t = app.scheduler.propose(
      "Native approval " + n,
      id(),
      app.host.sessionID,
    );
    await app.settle();
    const e = app.store
      .all<Execution>("Execution")
      .find((e) => e.task_id === t.id)!;
    const op = app.authorization.prepare(
      { session_id: null, task_id: t.id, execution_id: e.id },
      "shell.run",
      e.workspace_binding!.root_path,
      { command: "printf native-" + n },
    );
    assert.ok(op.authorization_id);
    approvals.push(op.authorization_id);
    app.store.commit([
      revise(e, {
        state: "WAIT_AUTH",
        waiting_request_ids: [op.authorization_id],
      }),
    ]);
  }
  const decisionTask = app.scheduler.propose(
    "Native decision",
    id(),
    app.host.sessionID,
  );
  await app.settle();
  const de = app.store
    .all<Execution>("Execution")
    .find((e) => e.task_id === decisionTask.id)!;
  const decision = {
    ...base(),
    record_type: "DecisionRequest" as const,
    schema_version: 1 as const,
    state: "OPEN" as const,
    task_id: decisionTask.id,
    execution_id: de.id,
    question: "Choose synthetic option",
    options: ["A", "B"],
    impact: "Synthetic only",
    materials: [],
    deadline: null,
    answer: null,
    answered_by: null,
    answer_request_id: null,
  };
  app.store.commit([
    decision,
    revise(de, { state: "WAIT_DECISION", waiting_request_ids: [decision.id] }),
  ]);
  const operations = Array.from({ length: 4 }, () => {
    const { op } = interrupted(app);
    app.store.commit([
      revise(op, {
        receipt: app.store.put({
          stdout: "中文😀".repeat(12000),
          stderr: "",
          truncated: true,
        }),
      }),
    ]);
    return op.id;
  });
  const server = await serveCore(app, 0, undefined, { pump: false });
  fs.writeFileSync(
    path.join(root, "core/core-endpoint.json"),
    JSON.stringify(server.endpoint),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(root, "manifest.json"),
    JSON.stringify({
      approvals,
      decision: decision.id,
      operations,
      artifact: artifact.artifact_id,
      execution: execution.id,
      task: task.id,
      world: !!app.world,
    }),
    { mode: 0o600 },
  );
  let passed = false;
  try {
    const executable = process.argv[2];
    assert.ok(
      executable && (executable === "--ui" || path.isAbsolute(executable)),
    );
    const child =
      executable === "--ui"
        ? spawn(
            "xcodebuild",
            [
              "-project",
              "src/secretary_macos/Secretary.xcodeproj",
              "-scheme",
              "Secretary",
              "-destination",
              "platform=macOS",
              "-derivedDataPath",
              ".build/native",
              "-test-timeouts-enabled",
              "YES",
              "-default-test-execution-time-allowance",
              "75",
              "-maximum-test-execution-time-allowance",
              "90",
              "-only-testing:SecretaryUITests/SecretaryUITests/testManagementTaskScopeAndDraft",
              "-only-testing:SecretaryUITests/SecretaryUITests/testManagementApprovalAndUnknown",
              "-only-testing:SecretaryUITests/SecretaryUITests/testManagementArtifactDownload",
              "test-without-building",
            ],
            {
              stdio: "inherit",
              env: {
                ...process.env,
                TEST_RUNNER_SECRETARY_UI_FIXTURE_DIR: root,
              },
            },
          )
        : spawn(executable, ["--management", root], {
            stdio: "inherit",
            env: { ...process.env, SECRETARY_MODE: "fixture" },
          });
    const timeout = setTimeout(() => child.kill("SIGTERM"), 240000);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    clearTimeout(timeout);
    assert.equal(code, 0, "native management probe failed");
    passed = true;
  } finally {
    await server.close();
    if (passed) fs.rmSync(root, { recursive: true });
    else console.log("Retained private management fixture:", root);
  }
}
const dsn = process.env.SECRETARY_TEST_DATABASE_URL;
if (!dsn)
  console.log(
    "World database coverage not run: provide SECRETARY_TEST_DATABASE_URL for isolated PostgreSQL acceptance.",
  );
if (dsn) await withTestDatabase(dsn, run);
else await run();
