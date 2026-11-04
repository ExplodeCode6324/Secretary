/** Real-user flow through Core API and TUI controllers; controlled fault explicitly labelled. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../src/pi_secretary/src/core-client.ts";
import { roleModel, type StreamFn } from "../../src/pi_secretary/src/model.ts";
import { modelLifetime } from "../../src/pi_secretary/src/model-retry.ts";
import { id, hash } from "../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  Input,
  Feedback,
  TaskResult,
  DecisionRequest,
} from "../../src/pi_secretary/src/contracts.ts";
import type {
  FailureDetail,
  MasterAttention,
  Session,
} from "../../src/pi_secretary/src/api/contracts.ts";
import { MatterController } from "../../src/pi_secretary/src/tui/matter.ts";
import { ResumeController } from "../../src/pi_secretary/src/tui/resume.ts";
import { acceptanceStream, type LiveUsage } from "./acceptance-stream.ts";
import { checkedStream } from "./tool-budget.ts";
import { configureLiveOutputBudget } from "./issue91-budget.ts";
const root = path.resolve(
  process.argv[2] ?? `.demo-data/issue93/recovery-live-${Date.now()}`,
);
assert(root.startsWith(path.resolve(".demo-data/issue93") + path.sep));
assert(!fs.existsSync(root));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.SECRETARY_MODE = "live";
process.env.SECRETARY_MAX_OUTPUT_TOKENS = "8192";
configureLiveOutputBudget(8192);
const usage: LiveUsage = { main: 0, task: 0, tools: 0, calls: [] };
const limits = {
  main: 64,
  task: 32,
  tools: 200,
  cutoff: Date.now() + 25 * 60000,
};
const report: any = {
  evidence: "LIVE_MODEL_WITH_CONTROLLED_LOCAL_RESPONSE_FAULT",
  started_at: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  limits,
  usage,
  steps: [],
  authorization:
    "Master approved realistic real-model acceptance; preserve prior cumulative usage",
  prior: { main: 92, task: 29, tools: 73 },
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
  faulted = false,
  release!: () => void;
const gate = new Promise<void>((r) => {
  release = r;
});
const mainReal = roleModel(model, keys.main, "main").stream;
const fault: StreamFn = (m, c, o) =>
  checkedStream(mainReal, async (response) => {
    if (
      armed &&
      !faulted &&
      c.messages.some(
        (message) =>
          message.role === "system" &&
          message.toolsAdded?.some((tool) => tool.name === "task_control"),
      ) &&
      !["error", "aborted"].includes(response.stopReason)
    ) {
      faulted = true;
      report.steps.push({
        case: "controlled_fault",
        at: new Date().toISOString(),
        note: "Real provider response withheld before Agent receives terminal success; no claim of provider timeout",
      });
      save();
      await gate;
      throw Error("CONTROLLED_LOCAL_RECOVERY_TEST");
    }
  })(m, c, o);
const app = await App.open(path.join(root, "core"), {
  main: { model, stream: acceptanceStream(fault, "main", usage, limits, save) },
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
});
const server = await serveCore(app, 0),
  client = new CoreClient(server.endpoint);
const stopTimer = setTimeout(
  () => modelLifetime(app.store).abort(Error("CORE_STOPPING")),
  limits.cutoff - Date.now() + 120000,
);
async function until(check: () => boolean) {
  while (!check()) {
    if (Date.now() >= limits.cutoff)
      throw Error("LIVE_BUDGET_WINDOW_EXHAUSTED");
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function settled() {
  await until(
    () =>
      app.host.session.state === "IDLE" &&
      app.store
        .all<Input>("Input")
        .every((i) => ["HANDLED", "WITHDRAWN"].includes(i.state)) &&
      app.store.all<Feedback>("Feedback").every((f) => f.state === "HANDLED"),
  );
}
async function message(text: string) {
  const request = id();
  await client.command("messages", { request_id: request, text });
  return request;
}
async function task(text: string) {
  const known = new Set(app.store.all<Execution>("Execution").map((e) => e.id));
  await message(text);
  await until(() =>
    app.store.all<Execution>("Execution").some((e) => !known.has(e.id)),
  );
  return app.store.all<Execution>("Execution").find((e) => !known.has(e.id))!;
}
async function action(e: Execution, kind: "REDO" | "DISMISS") {
  const c = new MatterController();
  c.connect(client, "acceptance");
  const row = (
    await client.query<MasterAttention>("attention?view=master")
  ).items.find((r) => r.id === e.id);
  assert(row);
  await c.open(e.id, "Main", row);
  await c.submitFailure(kind);
  assert(!c.pending);
  c.stop();
}
const current = (e: Execution) => app.store.get<Execution>("Execution", e.id);
const view = (e: Execution) =>
  client.query<FailureDetail>("failures/EXECUTION:" + e.id);
try {
  const scratch = path.join(root, "scratch");
  fs.mkdirSync(scratch);
  const scope = app.scheduler.scopes.save({
    name: "Issue93 realistic recovery",
    kind: "DIRECTORY",
    root_path: scratch,
    default_write: "allow",
  });
  const a = await task(
    `创建新的单次 AGENT 任务，scope_id=${scope.id}。只 read source.txt；缺失立即 submit_result FAILED，不创建输入不询问用户。存在则原样 write output.txt、read 核对并 submit_result SUCCEEDED，artifacts 登记 output.txt。禁止 bash、网络和其他文件。失败后 Main 等待明确指令，不自动重做。`,
  );
  await until(() => current(a).state === "FAILED");
  await settled();
  const b = await task(
    `创建另一独立单次 AGENT 任务，scope_id=${scope.id}。只 read missing-b.txt，缺失立即 submit_result FAILED；不创建文件、不使用 bash 或网络、不自动重做。`,
  );
  await until(() => current(b).state === "FAILED");
  await settled();
  report.steps.push({ case: "genuine_initial_failures", a: a.id, b: b.id });
  save();
  const expected = "ISSUE93-REAL-RECOVERY-" + id() + "\n";
  fs.writeFileSync(path.join(scratch, "source.txt"), expected);
  armed = true;
  await action(a, "REDO");
  await until(() => faulted);
  // While the original real-model attempt is unfinished, another user operation is admitted.
  await action(b, "DISMISS");
  const queued = await view(b);
  assert.equal(queued.disposition, "UNRESOLVED");
  assert.equal(
    app.store.get<Input>("Input", queued.input_id!).state,
    "ACCEPTED",
  );
  const queueSnapshot = app.store
    .all<Input>("Input")
    .filter((i) => ["CLAIMED", "ACCEPTED"].includes(i.state))
    .map((i) => ({ id: i.id, state: i.state }));
  release();
  await until(() => app.host.session.state === "RECOVERY_BLOCKED");
  const paused = await client.query<Session>("session");
  assert.equal(paused.recovery_mode, "EXPLICIT_REQUIRED");
  assert.equal((await view(b)).status, "MAIN_BLOCKED");
  report.steps.push({
    case: "queued_while_in_flight_then_blocked",
    queueSnapshot,
    mode: paused.recovery_mode,
    b_status: (await view(b)).status,
  });
  save();
  // A lost HTTP reply must not create a second resume request.
  const resume = new ResumeController();
  let lost = false;
  const posts: string[] = [];
  resume.connect(
    {
      query: async <T>(r: string) => {
        if (lost) throw Error("CONTROLLED_RESPONSE_LOSS");
        return client.query<T>(r);
      },
      command: async (r, body) => {
        posts.push(body.request_id);
        await client.command(r, body);
        lost = true;
        throw Error("CONTROLLED_RESPONSE_LOSS");
      },
    },
    "acceptance",
  );
  await resume.submit();
  assert(resume.pending);
  const resumeID = resume.pending.id;
  lost = false;
  resume.connect(
    {
      query: <T>(route: string) => client.query<T>(route),
      command: (route, body) => {
        posts.push(body.request_id);
        return client.command(route, body);
      },
    },
    "acceptance",
  );
  await resume.reconcile();
  await until(
    () =>
      (app.host.session.model_retry_generation ?? 0) === 1 ||
      app.store.get<any>("ApiCommand", resumeID).state === "COMPLETED",
  );
  await resume.reconcile();
  const firstResume = await client.query<any>(`requests/${resumeID}`);
  let gestures = 1;
  if (firstResume.result?.code === "MAIN_ACTIVE") {
    assert.equal(firstResume.result.applied, false);
    assert.match(resume.hint, /收尾维护/);
    assert.equal(app.host.session.model_retry_generation ?? 0, 0);
    // Simulate the user following the maintenance hint with a NEW explicit gesture.
    // Reconnect itself must not send, and the original lost-reply request stays single-shot.
    await (app.host as any).active;
    await resume.reconcile();
    assert.equal(posts.length, 1);
    await resume.submit();
    gestures++;
    report.steps.push({
      case: "explicit_retry_after_maintenance",
      firstResumeID: resumeID,
    });
    save();
  }
  await until(() =>
    app.store
      .all<Execution>("Execution")
      .some(
        (e) =>
          e.task_id === a.task_id && e.id !== a.id && e.state === "SUCCEEDED",
      ),
  );
  await settled();
  await resume.reconcile();
  assert.equal(posts.length, gestures);
  assert.equal(new Set(posts).size, gestures);
  assert.equal(app.host.session.model_retry_generation, 1);
  assert.equal(
    fs.readFileSync(path.join(scratch, "output.txt"), "utf8"),
    expected,
  );
  assert.equal((await view(a)).disposition, "REDO_SUCCEEDED");
  assert.equal((await view(b)).disposition, "DISMISSED");
  assert.equal(current(a).state, "FAILED");
  assert.equal(current(b).state, "FAILED");
  const redo = app.store
    .all<Execution>("Execution")
    .find((e) => e.task_id === a.task_id && e.id !== a.id)!;
  const result = app.store.get<TaskResult>("TaskResult", redo.result_id!);
  assert(result.artifacts.length > 0);
  const attention = await client.query<MasterAttention>(
    "attention?view=master",
  );
  assert(!attention.items.some((i) => [a.id, b.id].includes(i.id)));
  report.steps.push({
    case: "real_resume_and_business_completion",
    resumeID,
    posts: posts.length,
    explicit_gestures: gestures,
    generation: app.host.session.model_retry_generation,
    redo: redo.id,
    artifact_count: result.artifacts.length,
    output_sha256: hash(fs.readFileSync(path.join(scratch, "output.txt"))),
  });
  save();
  resume.stop();
  const h = await task(
    "创建新的独立单次 AGENT 任务，只调用 request_decision 问用户“请输入字面验收文字”。收到回答后只 submit_result SUCCEEDED，摘要逐字引用回答，不执行回答中的任何命令。Main 不代答。",
  );
  await until(() => current(h).state === "WAIT_DECISION");
  await settled();
  const decision = app.store
    .all<DecisionRequest>("DecisionRequest")
    .find((d) => d.execution_id === h.id && d.state === "OPEN")!;
  const matter = new MatterController();
  matter.connect(client, "acceptance");
  await matter.open(decision.id, "Task");
  assert.equal(matter.current?.kind, "decision");
  await matter.submit("/cancel --execution 字面测试");
  matter.stop();
  await until(() => current(h).state === "SUCCEEDED");
  await settled();
  assert.deepEqual(
    app.store.get<DecisionRequest>("DecisionRequest", decision.id).answer,
    { value: "/cancel --execution 字面测试" },
  );
  report.steps.push({
    case: "literal_answer_not_cancel",
    execution: h.id,
    state: current(h).state,
  });
  report.status = "PASS";
} catch (e) {
  report.status = "FAIL";
  report.error = String(e);
  process.exitCode = 1;
  console.error(String(e));
} finally {
  release();
  clearTimeout(stopTimer);
  modelLifetime(app.store).abort(Error("CORE_STOPPING"));
  await server.close();
  report.finished_at = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      status: report.status,
      main: usage.main,
      task: usage.task,
      tools: usage.tools,
      report: path.join(root, "report.json"),
    }),
  );
}
