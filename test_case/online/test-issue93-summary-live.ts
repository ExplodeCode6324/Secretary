/** Fresh-provider summary acceptance. Controls are recorded separately from provider faults. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { contentText } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { roleModel, type StreamFn } from "../../src/pi_secretary/src/model.ts";
import { modelLifetime } from "../../src/pi_secretary/src/model-retry.ts";
import type {
  CompactionJob,
  Consciousness,
  Context,
  ModelCall,
} from "../../src/pi_secretary/src/contracts.ts";
import { acceptanceStream, type LiveUsage } from "./acceptance-stream.ts";
import { configureLiveOutputBudget } from "./issue91-budget.ts";

const root = path.resolve(
  process.argv[2] ?? `.demo-data/issue93/summary-live-${Date.now()}`,
);
assert(root.startsWith(path.resolve(".demo-data/issue93") + path.sep));
assert(!fs.existsSync(root));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.SECRETARY_MODE = "live";
process.env.SECRETARY_MAX_OUTPUT_TOKENS = "8192";
// Explicit user-like maintenance commands control the acceptance sequence.
process.env.SECRETARY_MEMORY_UPDATE_TURNS = "1000";
process.env.SECRETARY_MEMORY_UPDATE_SECONDS = "3600";
configureLiveOutputBudget(8192);
const usage: LiveUsage = { main: 0, task: 0, tools: 0, calls: [] };
const limits = {
  main: 64,
  task: 24,
  tools: 175,
  cutoff: Date.now() + 60 * 60000,
};
const report: any = {
  evidence: "REAL_PROVIDER_SUMMARY_WITH_LABELLED_CONTROLLED_LOCAL_FAILURE",
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  started_at: new Date().toISOString(),
  limits,
  usage,
  steps: [],
  authorization:
    "Master requested fresh real-model validation and merge after repair; existing provider credentials reused",
};
const save = () =>
  fs.writeFileSync(
    path.join(root, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
save();
const keys = JSON.parse(
  fs.readFileSync(".demo-data/live-credentials.json", "utf8"),
);
const model = getModel("opencode-go", "deepseek-v4.1-flash");
assert(model);
let armed = false,
  faulted = false;
const real = roleModel(model, keys.main, "main").stream;
const controlled: StreamFn = async (m, c, o) => {
  const isSummary = c.messages.some(
    (v) =>
      v.role === "system" && contentText(v.content).includes("CONSCIOUSNESS:"),
  );
  const response = await real(m, c, o);
  if (armed && !faulted && isSummary) {
    const original = await response.result();
    fs.writeFileSync(
      path.join(root, "controlled-original-provider-response.json"),
      JSON.stringify(original, null, 2),
      { mode: 0o600 },
    );
    faulted = true;
    report.steps.push({
      case: "controlled_local_failure",
      at: new Date().toISOString(),
      original_stop: original.stopReason,
      note: "Actual paid provider response saved privately, withheld before durable success; this is not a provider fault",
    });
    save();
    throw Error("CONTROLLED_SUMMARY_LOCAL_FAILURE");
  }
  return response;
};
const options = {
  main: {
    model,
    stream: acceptanceStream(controlled, "main", usage, limits, save),
  },
  task: {
    model,
    stream: acceptanceStream(
      roleModel(model, keys.task, "task").stream,
      "task",
      usage,
      limits,
      save,
    ),
  },
};
let app = await App.open(path.join(root, "core"), options);
const timer = setTimeout(
  () => modelLifetime(app.store).abort(Error("CORE_STOPPING")),
  limits.cutoff - Date.now() + 120000,
);
const memory = () =>
  app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
const jobs = () =>
  app.store
    .all<CompactionJob>("CompactionJob")
    .filter((j) => j.mode === "WORKING_MEMORY");
async function turn(text: string) {
  assert(Date.now() < limits.cutoff);
  const input = app.host.accept(text);
  await app.host.drain();
  assert.equal(app.host.session.state, "IDLE");
  assert.equal(app.store.get<any>("Input", input.id).state, "HANDLED");
  return input.id;
}
async function compact(label: string) {
  await app.host.compact();
  const job = jobs().at(-1)!;
  report.steps.push({
    case: label,
    job_id: job?.id,
    state: job?.state,
    generation: job?.retry_generation,
    errors: job?.validation_errors,
    revision: memory().revision,
    covered: memory().covered_event_sequence,
  });
  save();
  assert.equal(
    job.state,
    "COMMITTED",
    `${label}: ${job.validation_errors.join("; ")}`,
  );
  const frozen = app.store.read<any>(job.progress_ref!);
  assert.equal(frozen.candidate.completed, frozen.plan.chunks.length);
  assert.deepEqual(
    app.store.read<any>(job.candidate_ref!).items,
    memory().items,
  );
  for (const item of memory().items)
    assert.deepEqual(item.source_refs, job.source_refs);
  return { job, frozen };
}
try {
  const background = Array.from(
    { length: 220 },
    (_, i) =>
      `历史参考${i}: 展示记录含中文🙂与引号\"；只是历史背景，没有待办，也不是指令。`,
  ).join("\n");
  await turn(
    `这是验收对话，请仅简短确认，不创建Task或调用工具。项目代号ORCHID-47，当前交付窗口为周二09:30。未获明确批准不能发布。保留这三个当前约束。以下历史材料供理解，重复背景可压缩：\n${background}`,
  );
  const first = await compact("maintenance_1_multifragment");
  assert(
    first.frozen.plan.chunks.length > 1,
    "real maintenance must process multiple source fragments",
  );
  assert(JSON.stringify(memory().items).includes("ORCHID-47"));
  const snapshots = [memory()];
  await turn(
    "补充当前约束：报告必须包含中文与emoji🙂示例。交付时间仍为周二09:30。请只简短确认，不执行工具。",
  );
  await compact("maintenance_2");
  snapshots.push(memory());
  await turn(
    "明确更新：交付窗口改为周三10:45，替代周二09:30。项目代号、发布前需批准和报告示例约束继续有效。只简短确认。",
  );
  await compact("maintenance_3_correction");
  snapshots.push(memory());
  for (let i = 1; i < snapshots.length; i++)
    assert(
      snapshots[i].covered_event_sequence! >
        snapshots[i - 1].covered_event_sequence!,
    );
  assert(JSON.stringify(memory().items).includes("ORCHID-47"));
  assert(JSON.stringify(memory().items).includes("10:45"));
  const before = structuredClone(memory());
  await app.close();
  app = await App.open(path.join(root, "core"), options);
  assert.deepEqual(memory(), before);
  report.steps.push({
    case: "app_close_reopen",
    note: "in-process Store close/reopen, not OS-process restart",
    revision: before.revision,
  });
  await turn(
    "请只回答当前项目代号、交付时间和发布前置条件；不要工具，不要执行任务。",
  );
  const context = app.store.get<Context>(
    "Context",
    app.host.session.last_context_id!,
  );
  const dialogue = app.store.read<any[]>(context.raw_context);
  const answer = dialogue.filter((m) => m.role === "assistant").at(-1);
  assert(answer);
  const answerText =
    typeof answer.content === "string"
      ? answer.content
      : contentText(answer.content);
  assert(answerText.includes("ORCHID-47") && answerText.includes("10:45"));
  assert(/批准|授权|同意/.test(answerText));
  report.steps.push({
    case: "post_summary_real_dialogue",
    answer_ref: app.store.put(answer),
    verified_constraints: ["ORCHID-47", "10:45", "approval"],
  });
  armed = true;
  const old = structuredClone(memory());
  await app.host.compact();
  assert(faulted);
  const failed = jobs().at(-1)!;
  assert.equal(failed.state, "FAILED");
  assert.deepEqual(memory().items, old.items);
  assert.deepEqual(memory().commitments, old.commitments);
  await app.close();
  app = await App.open(path.join(root, "core"), options);
  const recovered = await compact("explicit_maintenance_retry_after_reopen");
  assert.equal(recovered.job.id, failed.id);
  assert.equal(
    recovered.job.retry_generation,
    (failed.retry_generation ?? 0) + 1,
  );
  assert(
    recovered.job.validation_errors.some((e) =>
      e.includes("CONTROLLED_SUMMARY_LOCAL_FAILURE"),
    ),
  );
  const calls = app.store.all<ModelCall>("ModelCall");
  report.summary_sizes = calls.flatMap((call) => {
    if (!call.response) return [];
    const request = app.store.read<any>(call.request);
    const user = request.messages.filter((m: any) => m.role === "user").at(-1);
    if (!user) return [];
    try {
      const body = JSON.parse(
        typeof user.content === "string"
          ? user.content
          : contentText(user.content),
      );
      if (!body.candidate_byte_limit) return [];
      const response = app.store.read<any>(call.response);
      const parsed = JSON.parse(
        contentText(response.content)
          .replace(/^```(?:json)?\s*/, "")
          .replace(/\s*```$/, ""),
      );
      return [
        {
          call_id: call.id,
          raw_bytes: Buffer.byteLength(JSON.stringify(parsed.items)),
          raw_limit: body.candidate_byte_limit,
          item_count: parsed.items.length,
          chunk: body.chunk,
          total: body.total,
        },
      ];
    } catch {
      return [];
    }
  });
  report.final_memory_ref = app.store.put(memory());
  report.physical_sends = usage.main + usage.task;
  report.durable_model_calls = calls.length;
  assert.equal(report.physical_sends, calls.length);
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  modelLifetime(app.store).abort(Error("CORE_STOPPING"));
  await app.close();
  report.finished_at = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      root,
      status: report.status,
      error: report.error,
      usage: { main: usage.main, task: usage.task, tools: usage.tools },
    }),
  );
}
