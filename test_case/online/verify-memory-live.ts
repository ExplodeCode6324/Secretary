// Maintenance-only harness: never pumps Scheduler or registers task/action tools.
import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert/strict";
import { App } from "../../src/pi_secretary/src/app.ts";
import { Agent, modelConfig } from "../../src/pi_secretary/src/model.ts";
import { durableStream } from "../../src/pi_secretary/src/transport.ts";
import { id } from "../../src/pi_secretary/src/store.ts";
import type {
  Consciousness,
  CompactionJob,
  Context,
} from "../../src/pi_secretary/src/contracts.ts";
const directory = process.argv[2];
const report = process.argv[3];
if (!directory || !report)
  throw Error("Usage: verify-memory-live.ts DATA_DIRECTORY REPORT_JSON");
const keys = JSON.parse(
  fs.readFileSync(
    process.env.SECRETARY_CREDENTIALS_FILE ??
      ".demo-data/live-credentials.json",
    "utf8",
  ),
);
Object.assign(process.env, {
  SECRETARY_MODE: "live",
  SECRETARY_MAIN_PROVIDER: "opencode-go",
  SECRETARY_TASK_PROVIDER: "opencode-go",
  SECRETARY_MAIN_MODEL: "deepseek-v4.1-flash",
  SECRETARY_TASK_MODEL: "gpt-5.6-luna",
  SECRETARY_MAIN_API_KEY: keys.main,
  SECRETARY_TASK_API_KEY: keys.task,
});
const main = modelConfig("main"),
  task = modelConfig("task");
const app = await App.open(path.resolve(directory), { main, task });
try {
  const before = app.host.memoryStatus();
  const effects = JSON.stringify(app.store.all("Operation"));
  const executionCount = app.store.all("Execution").length;
  const inputs = app.store.all("Input").length;
  const existing = app.store.all<CompactionJob>("CompactionJob").at(-1);
  if (
    process.argv.includes("--force") ||
    !(
      existing?.state === "COMMITTED" &&
      existing.memory_version === 2 &&
      existing.source_refs[0].sha256 ===
        app.store.get<Consciousness>(
          "Consciousness",
          app.host.session.consciousness_id,
        ).pending_raw_refs[0]?.sha256
    )
  )
    await app.host.compact();
  const after = app.host.memoryStatus();
  assert.equal(after.state, "COMMITTED");
  const current = app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
  const preview = app.host.previewContext();
  assert(
    preview.some(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes(`"revision":${current.revision}`),
    ),
  );
  assert.equal(JSON.stringify(app.store.all("Operation")), effects);
  assert.equal(app.store.all("Execution").length, executionCount);
  assert.equal(app.store.all("Input").length, inputs);
  const probe = new Agent({
    initialState: {
      model: main.model,
      systemPrompt:
        "READ_ONLY_MEMORY_AUDIT: You have no tools and must not execute or propose tasks. Summarize the current test progress and unresolved obligations from the supplied working memory in Chinese. Distinguish historical states from current ones. This is a maintenance probe, not a user instruction to take action.",
      messages: preview.filter((m) => m.role !== "system"),
      tools: [],
    },
    streamFn: durableStream(
      app.store,
      main.stream,
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      id(),
      "MAIN",
    ),
  });
  await probe.prompt(
    "只读检查：说明当前任务进展、尚待处理事项，以及记忆中是否存在过时状态；不要执行任何操作。",
  );
  if (probe.state.errorMessage) throw Error(probe.state.errorMessage);
  const answer = probe.state.messages
    .filter((m) => m.role === "assistant")
    .at(-1);
  const context = app.store.all<Context>("Context").at(-1)!;
  assert.equal(context.capture_kind, "MODEL_REQUEST");
  assert.equal(context.consciousness_revision, current.revision);
  assert.equal(JSON.stringify(app.store.all("Operation")), effects);
  const output = {
    checked_at: new Date().toISOString(),
    evidence: "LIVE_MODEL",
    directory: path.resolve(directory),
    session: app.host.sessionID,
    before,
    after,
    latest_job: app.store.all<CompactionJob>("CompactionJob").at(-1),
    summary: current.items,
    next_request: {
      context_id: context.id,
      consciousness_revision: context.consciousness_revision,
      capture_kind: context.capture_kind,
      estimated_tokens: context.estimated_tokens,
    },
    probe_answer: answer,
    operation_unchanged: true,
    inputs_unchanged: app.store.all("Input").length === inputs,
    execution_count: executionCount,
  };
  fs.writeFileSync(report, JSON.stringify(output, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      report,
      state: after.state,
      revision: after.revision,
      attempts: after.attempt,
      operations_unchanged: true,
    }),
  );
} finally {
  await app.close();
}
