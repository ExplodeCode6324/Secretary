// One real native GUI journey over public HTTP; only model output and initial Scope are synthetic.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../src/pi_secretary/src/model.ts";
import type {
  AuthorizationRequest,
  Operation,
  TaskResult,
} from "../../src/pi_secretary/src/contracts.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-journey-"));
fs.chmodSync(root, 0o700);
let step = 0;
const stream: StreamFn = (model, context, options) => {
  if (
    !JSON.stringify(
      context.messages.filter((m) => m.role === "system"),
    ).includes("TASK_EXECUTOR")
  )
    return fixtureStream(model, context, options);
  step++;
  const calls = [
    {
      name: "write",
      arguments: {
        path: "journey.txt",
        content: "Native journey synthetic result 42\n",
      },
    },
    { name: "bash", arguments: { command: "cat journey.txt" } },
    { name: "bash", arguments: { command: "printf journey-approved" } },
    { name: "bash", arguments: { command: "printf journey-approved" } },
  ];
  const call = calls[step - 1];
  if (call)
    return replyStream(
      [{ type: "toolCall", id: "journey-" + step, ...call }],
      model,
    );
  const packet = context.messages.find(
    (m) =>
      m.role === "user" &&
      contentText(m.content).includes('"secretary.agent-task.v1"'),
  )!;
  const payload = JSON.parse(contentText(packet.content));
  return replyStream(
    [
      {
        type: "toolCall",
        id: "journey-result",
        name: "submit_result",
        arguments: {
          outcome: "SUCCEEDED",
          summary: "Native journey complete",
          criteria: payload.assignment.acceptance_criteria.map(
            (c: { id: string }) => ({
              id: c.id,
              met: true,
              evidence: "Synthetic real filesystem result",
            }),
          ),
          artifacts: ["journey.txt"],
          limitations: ["Controlled model; synthetic temporary files only"],
        },
      },
    ],
    model,
  );
};
const app = await App.open(path.join(root, "core"), {
  model: fixtureModel,
  stream,
});
app.scheduler.scopes.save({
  name: "Journey Scope",
  description: "Synthetic acceptance",
  kind: "NONE",
  root_path: null,
  notes_path: null,
  default_write: "ask",
});
const server = await serveCore(app, 0, undefined, { pump: true });
fs.writeFileSync(
  path.join(root, "core/core-endpoint.json"),
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
const timer = setInterval(() => {
  const approval = app.store.all<AuthorizationRequest>(
    "AuthorizationRequest",
  )[0];
  const result = app.store.all<TaskResult>("TaskResult")[0];
  const target = path.join(root, "journey.json");
  fs.writeFileSync(
    target + ".tmp",
    JSON.stringify({
      approval: approval?.id,
      artifact: result?.artifacts[0]?.artifact_id,
    }),
  );
  fs.renameSync(target + ".tmp", target);
}, 50);
let passed = false;
try {
  const child = spawn(
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
      "-only-testing:SecretaryUITests/SecretaryUITests/testCompleteNativeJourney",
      "test-without-building",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, TEST_RUNNER_SECRETARY_UI_FIXTURE_DIR: root },
    },
  );
  const timeout = setTimeout(() => child.kill("SIGTERM"), 180000);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  clearTimeout(timeout);
  assert.equal(code, 0);
  const operations = app.store.all<Operation>("Operation");
  assert.equal(operations.length, 4);
  assert(operations.every((o) => o.state === "SUCCEEDED"));
  assert.equal(operations[0].rule_id, "builtin:workspace-write");
  assert.equal(operations[1].rule_id, "builtin:readonly-shell");
  assert.equal(app.store.all("AuthorizationRequest").length, 1);
  assert.equal(app.authorization.rulesView().items[0].match_count, 1);
  const result = app.store.all<TaskResult>("TaskResult")[0];
  assert.equal(
    app.store.bytes(result.artifacts[0].content).toString(),
    "Native journey synthetic result 42\n",
  );
  console.log(
    "PASS: native chat -> scoped task -> automatic write/read -> remembered approval -> second automatic operation -> immutable artifact download/system open",
  );
  passed = true;
} finally {
  clearInterval(timer);
  await server.close();
  if (passed) fs.rmSync(root, { recursive: true });
  else console.log("Retained private failed journey:", root);
}
