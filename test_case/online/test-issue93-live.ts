import { modelLifetime } from "../../src/pi_secretary/src/model-retry.ts";
/** Explicit paid-provider acceptance for #93; never imported by npm test. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import {
  roleModel,
  type ModelConfig,
  type StreamFn,
} from "../../src/pi_secretary/src/model.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../src/pi_secretary/src/core-client.ts";
import { id, hash } from "../../src/pi_secretary/src/store.ts";
import { terminal } from "../../src/pi_secretary/src/execution-utils.ts";
import { failuresFor } from "../../src/pi_secretary/src/failure-handling.ts";
import type {
  Execution,
  Input,
  TaskPlan,
  TaskResult,
  TaskProposal,
  Operation,
  Feedback,
} from "../../src/pi_secretary/src/contracts.ts";
import type { FailureDetail } from "../../src/pi_secretary/src/api/contracts.ts";
import { MatterController } from "../../src/pi_secretary/src/tui/matter.ts";
import { CancelController } from "../../src/pi_secretary/src/tui/cancel.ts";
import { configureLiveOutputBudget } from "./issue91-budget.ts";
import { boundedTools, checkedStream } from "./tool-budget.ts";
const root = path.resolve(
  process.argv[2] ?? `.demo-data/issue93/live-${Date.now()}`,
);
assert(root.startsWith(path.resolve(".demo-data/issue93") + path.sep));
assert(!fs.existsSync(root), "FRESH_DIRECTORY_REQUIRED");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const selected = process.argv[3];
assert(!selected || selected === "--L3-only", "UNKNOWN_SCENARIO_SELECTOR");
const limits = {
  main: 128,
  task: 96,
  tools: 300,
  total_ms: 2100000,
  output_tokens: 8192,
};
const caseLimits = {
  L1: { main: 32, task: 16, tools: 80, ms: 480000 },
  L2: { main: 40, task: 24, tools: 100, ms: 600000 },
  L3: { main: 32, task: 24, tools: 80, ms: 600000 },
  L4: { main: 12, task: 8, tools: 30, ms: 180000 },
};
type Case = keyof typeof caseLimits;
const ledgerPath = path.join(root, "usage.json");
const ledger: any = fs.existsSync(ledgerPath)
  ? JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
  : {
      started_at: new Date().toISOString(),
      main: 0,
      task: 0,
      tools: 0,
      cases: {},
      runs: [],
    };
ledger.runs.push(root);
let active: Case = "L1";
const start = Date.parse(ledger.started_at);
const report: any = {
  evidence: "LIVE_MODEL",
  scope: selected ?? "full",
  started_at: new Date().toISOString(),
  budget_started_at: ledger.started_at,
  limits,
  caseLimits,
  cases: [],
  calls: [],
  inputs: [],
  faults: [],
  provider: "opencode-go",
  model: "deepseek-v4.1-flash",
  base: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  source_hashes: Object.fromEntries(
    [
      "failure-handling",
      "main-loop",
      "main-tools",
      "task-planning",
      "master-attention",
      "tui/matter",
      "tui/cancel",
    ].map((n) => [n, hash(fs.readFileSync(`src/pi_secretary/src/${n}.ts`))]),
  ),
};
const save = () => {
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), {
    mode: 0o600,
  });
  fs.writeFileSync(
    path.join(root, "report.json"),
    JSON.stringify({ ...report, usage: ledger }, null, 2),
    { mode: 0o600 },
  );
};
function budget() {
  const c = ledger.cases[active];
  if (
    Date.now() - start > limits.total_ms ||
    (c && Date.now() - Date.parse(c.started_at) > caseLimits[active].ms)
  )
    throw Error("LIVE_TIME_BUDGET_EXHAUSTED");
}
process.env.SECRETARY_MAX_OUTPUT_TOKENS = String(limits.output_tokens);
configureLiveOutputBudget(limits.output_tokens);
const keys = JSON.parse(
  fs.readFileSync(".demo-data/live-credentials.json", "utf8"),
) as { main: string; task: string };
const model = getModel("opencode-go", "deepseek-v4.1-flash");
assert(model);
const toolBudget = { used: ledger.tools, limit: limits.tools };
const configs = Object.fromEntries(
  (["main", "task"] as const).map((role) => {
    const real = roleModel(model, keys[role], role),
      bounded = boundedTools(real.stream, toolBudget);
    const stream: StreamFn = async (m, c, o) => {
      budget();
      const usage = ledger.cases[active];
      if (
        ledger[role] >= limits[role] ||
        usage[role] >= caseLimits[active][role] ||
        usage.tools >= caseLimits[active].tools
      )
        throw Error("LIVE_CALL_BUDGET_EXHAUSTED");

      const call: any = {
        role,
        case: active,
        physical_sent: false,
        input_producers:
          role === "main"
            ? app?.store
                .all<Input>("Input")
                .filter((i) => i.state === "CLAIMED")
                .map((i) => i.producer)
            : [],
        at: new Date().toISOString(),
      };
      report.calls.push(call);
      save();
      const started = performance.now();
      const stamp = (field: string) => {
        call[field] = Math.round(performance.now() - started);
      };
      const observed = checkedStream(
        bounded,
        (result) => {
          usage.tools += result.content.filter(
            (x) => x.type === "toolCall",
          ).length;
          ledger.tools = toolBudget.used;
          call.tools = result.content
            .filter((x) => x.type === "toolCall")
            .map((x) => ({ name: x.name }));
          call.stop_reason = result.stopReason;
          call.finished_at = new Date().toISOString();
          stamp("total_ms");
          save();
          if (usage.tools > caseLimits[active].tools)
            throw Error("LIVE_CASE_TOOL_BUDGET_EXHAUSTED");
        },
        (event) => {
          if (call.first_event_ms == null) stamp("first_event_ms");
          stamp("last_event_ms");
        },
      );
      return observed(m, c, {
        ...o,
        onPayload: async (payload, model) => {
          const result = await o?.onPayload?.(payload, model);
          stamp("payload_ms");
          return result;
        },
        fetch: async (url, init) => {
          budget(); // Actual send boundary, including SDK preparation latency.
          if (
            ledger[role] >= limits[role] ||
            usage[role] >= caseLimits[active][role]
          )
            throw Error("LIVE_CALL_BUDGET_EXHAUSTED");
          ledger[role]++;
          usage[role]++;
          call.number = ledger[role];
          call.physical_sent = true;
          stamp("fetch_ms");
          const response = await (o?.fetch ?? globalThis.fetch)(url, init);
          stamp("headers_ms");
          call.http_status = response.status;
          save();
          return response;
        },
      });
    };
    return [role, { model, stream }];
  }),
) as Record<"main" | "task", ModelConfig>;
let app: App, server: Awaited<ReturnType<typeof serveCore>>, client: CoreClient;
const open = async () => {
  app = await App.open(path.join(root, "core"), configs);
  server = await serveCore(app, 0);
  client = new CoreClient(server.endpoint);
};
const stopTimer = setTimeout(
  () => {
    if (app!) modelLifetime(app.store).abort(Error("CORE_STOPPING"));
  },
  Math.max(0, start + limits.total_ms + 120000 - Date.now()),
);
const executions = () => app.store.all<Execution>("Execution");
const current = (e: Execution) => app.store.get<Execution>("Execution", e.id);
async function until(check: () => boolean) {
  while (!check()) {
    budget();
    if (app.host.session.state === "RECOVERY_BLOCKED")
      throw Error("MAIN_RECOVERY_BLOCKED:" + app.host.session.recovery_error);
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function settled() {
  await until(
    () =>
      app.store
        .all<Input>("Input")
        .every((i) => ["HANDLED", "WITHDRAWN"].includes(i.state)) &&
      app.store.all<Feedback>("Feedback").every((f) => f.state === "HANDLED") &&
      app.host.session.state === "IDLE",
  );
}
async function message(text: string) {
  const request = id();
  report.inputs.push({ case: active, request_id: request, text });
  save();
  await client.command("messages", { request_id: request, text });
  return request;
}
async function task(text: string) {
  const old = new Set(executions().map((e) => e.id));
  await message(text);
  await until(() => executions().some((e) => !old.has(e.id)));
  return executions().find((e) => !old.has(e.id))!;
}
async function ended(e: Execution) {
  await until(() => terminal(current(e)));
  await settled();
  return current(e);
}
async function action(e: Execution, kind: "REDO" | "DISMISS") {
  const key = "EXECUTION:" + e.id;
  const row = (
    await client.query<any>("attention?view=master&limit=100")
  ).items.find((i: any) => i.key === key);
  assert(row);
  const c = new MatterController();
  c.connect(client, "live");
  await c.open(e.id, "Main", row);
  assert.equal(c.current?.kind, "failure");
  await c.submitFailure(kind);
  assert(!c.pending, "INTENT_DELIVERY_UNCONFIRMED");
  c.stop();
  await settled();
  return client.query<FailureDetail>("failures/" + key);
}
function noAutonomousWork() {
  for (const call of report.calls)
    if (
      call.role === "main" &&
      call.tools?.some((t: any) => t.name === "task_propose")
    )
      assert(
        call.input_producers?.includes("MASTER"),
        "AUTONOMOUS_PROPOSAL_ATTEMPT",
      );
  for (const l of app.store.events("main.tool.result")) {
    const entry = app.store.read<any>(l.payload);
    if (String(entry.key).includes(":task_propose:"))
      assert(
        app.store
          .all<Input>("Input")
          .some(
            (i) =>
              i.loop_id === entry.key.slice(0, 36) && i.producer === "MASTER",
          ),
        "AUTONOMOUS_PROPOSAL_RESULT",
      );
  }
}
async function scenario(name: Case, run: () => Promise<unknown>) {
  active = name;
  ledger.cases[name] ??= {
    started_at: new Date().toISOString(),
    main: 0,
    task: 0,
    tools: 0,
  };
  const item: any = {
    name,
    at: new Date().toISOString(),
    before: { ...ledger.cases[name] },
  };
  report.cases.push(item);
  save();
  console.log(name + " started");
  try {
    item.evidence = await run();
    noAutonomousWork();
    item.status = "PASS";
    console.log(name + " PASS");
  } catch (e) {
    item.status = "FAIL";
    item.error = String(e);
    throw e;
  } finally {
    item.finished_at = new Date().toISOString();
    save();
  }
}
let oldFailure: Execution, secondFailure: Execution, thirdFailure: Execution;
try {
  await open();
  if (!selected)
    await scenario("L1", async () => {
      const scratch = path.join(root, "l1-scratch");
      fs.mkdirSync(scratch);
      const scope = app.scheduler.scopes.save({
        name: "Issue93 L1 scratch",
        kind: "DIRECTORY",
        root_path: scratch,
        default_write: "allow",
      });
      const content = "ISSUE93-" + id() + "\n";
      report.faults.push({
        declared_at: new Date().toISOString(),
        kind: "CONTROLLED_HARNESS_REPAIR",
        action:
          "After the genuine missing input failure, create ONLY source.txt. Never change a prompt, proposal, Execution or result.",
        path: path.join(scratch, "source.txt"),
        sha256: hash(content),
      });
      save();
      const e = await task(
        `请创建一个新的独立 AGENT 任务，scope_id=${scope.id}，不复用旧任务。完整任务要求：用 read 读取 source.txt；如果不存在，立即 submit_result FAILED，如实报告缺失输入，不得创建 source.txt，不得替换输入或问 Master。若 source.txt 存在，用 write 将其原始 UTF-8 内容逐字写入 output.txt，再 read 核对并 submit_result SUCCEEDED，artifacts 必须包括 output.txt。不使用 bash、网络或其他文件。验收条件：output.txt 字节与 source.txt 相同并登记为 artifact。Main 收到失败只能报告并等待明确指令，不自动恢复。`,
      );
      assert.equal((await ended(e)).state, "FAILED");
      const count = executions().length;
      assert(
        app.store.executionEvents(e.id).some(
          (l) =>
            l.event_type === "agent.message" &&
            (() => {
              const m = app.store.read<any>(l.payload);
              return (
                m.role === "toolResult" && m.toolName === "read" && m.isError
              );
            })(),
        ),
      );
      fs.writeFileSync(path.join(scratch, "source.txt"), content);
      report.faults.push({
        performed_at: new Date().toISOString(),
        path: path.join(scratch, "source.txt"),
        sha256: hash(content),
      });
      save();
      const intent = await action(e, "REDO");
      assert(intent.linked_request_id);
      await until(() =>
        executions().some((x) => x.occurrence_key === intent.linked_request_id),
      );
      const redo = executions().find(
        (x) => x.occurrence_key === intent.linked_request_id,
      )!;
      assert.equal((await ended(redo)).state, "SUCCEEDED");
      assert.equal(executions().length, count + 1);
      const result = app.store.get<TaskResult>(
          "TaskResult",
          current(redo).result_id!,
        ),
        artifact = result.artifacts.find(
          (a) => a.workspace_path === "output.txt",
        );
      assert(artifact);
      assert.equal(app.store.bytes(artifact.content).toString(), content);
      assert.equal(
        fs.readFileSync(path.join(scratch, "output.txt"), "utf8"),
        content,
      );
      const view = await client.query<FailureDetail>(
        "failures/EXECUTION:" + e.id,
      );
      assert.equal(view.disposition, "REDO_SUCCEEDED");
      return {
        original: e.id,
        redo: redo.id,
        request: intent.linked_request_id,
        result: result.id,
        artifact_sha256: artifact.content.sha256,
        verified_by: result.verified_by,
        disposition: view.disposition,
      };
    });
  if (!selected)
    await scenario("L2", async () => {
      oldFailure = await task(
        "请创建新的独立 AGENT 任务、不指定 Scope。只用 read 读取空 cwd 下 never-provided-issue93.txt；不得创建或替换文件、不用 bash/网络、不问 Master。文件不存在时 submit_result FAILED，如实说明原因；验收条件是读取实际文件。Main 只报告终态，等待明确指令，不自主恢复。",
      );
      assert.equal((await ended(oldFailure)).state, "FAILED");
      const intent = await action(oldFailure, "REDO");
      assert(intent.linked_request_id);
      await until(() =>
        executions().some((e) => e.occurrence_key === intent.linked_request_id),
      );
      secondFailure = executions().find(
        (e) => e.occurrence_key === intent.linked_request_id,
      )!;
      assert.equal((await ended(secondFailure)).state, "FAILED");
      assert.equal(
        (await action(oldFailure, "DISMISS")).disposition,
        "DISMISSED",
      );
      await server.close();
      await open();
      assert.equal(
        (
          await client.query<FailureDetail>(
            "failures/EXECUTION:" + oldFailure.id,
          )
        ).disposition,
        "DISMISSED",
      );
      thirdFailure = await task(
        `Master 明确要求对 Task ${oldFailure.task_id} 继续一次独立新工作，parent_execution_id=${secondFailure.id}，保留原 goal、constraints、acceptance、executor。再次实际 read never-provided-issue93.txt，缺失即 submit_result FAILED，不创建文件、不替换要求。此次是新的明确 Master 指令；终态后不要自动再做。`,
      );
      assert.equal((await ended(thirdFailure)).state, "FAILED");
      assert.equal(thirdFailure.task_id, oldFailure.task_id);
      assert.equal(
        (
          await client.query<FailureDetail>(
            "failures/EXECUTION:" + oldFailure.id,
          )
        ).disposition,
        "DISMISSED",
      );
      assert.equal(
        (
          await client.query<FailureDetail>(
            "failures/EXECUTION:" + thirdFailure.id,
          )
        ).disposition,
        "UNRESOLVED",
      );
      return {
        original: oldFailure.id,
        failed_redo: secondFailure.id,
        new_failure: thirdFailure.id,
        restarted: true,
      };
    });
  await scenario("L3", async () => {
    const periodic = await task(
      "Master 明确要求一个 interval_seconds=600 的周期 AGENT 任务，不指定 Scope。每次执行只调用 request_decision，问题为「Issue93 周期：请 Master 提供当前未知口令」。不得猜测口令，不写文件、不用 bash/网络，未回答保持 WAIT_DECISION。Main 不能代答，不能取消或新建替代。",
    );
    await until(() => current(periodic).state === "WAIT_DECISION");
    await settled();
    const before = app.store.get<TaskPlan>("TaskPlan", periodic.task_id);
    assert.equal(before.trigger.kind, "INTERVAL");
    assert(before.next_due_at);
    const cancel = new CancelController();
    cancel.connect(client, "live");
    await cancel.submit("execution", periodic.id);
    assert(cancel.pending?.accepted);
    assert.equal((await ended(periodic)).state, "CANCELLED");
    const after = app.store.get<TaskPlan>("TaskPlan", periodic.task_id);
    assert.equal(after.next_due_at, before.next_due_at);
    assert.equal(after.state, before.state);
    cancel.stop();
    const scratch = path.join(root, "l3-scratch");
    fs.mkdirSync(scratch);
    const scope = app.scheduler.scopes.save({
      name: "Issue93 L3 authorization",
      kind: "DIRECTORY",
      root_path: scratch,
      default_write: "ask",
    });
    const auth = await task(
      `新建独立 AGENT 任务 scope_id=${scope.id}，只 write blocked.txt 内容 ISSUE93；必须等待授权，不使用其他工具绕过。成功才 submit_result；Main 不批准、不代答。`,
    );
    await until(() => current(auth).state === "WAIT_AUTH");
    await settled();
    const request = app.store.read<TaskProposal>(
      current(auth).proposal_ref!,
    ).request_id;
    const c = new CancelController();
    c.connect(client, "live");
    await c.submit("request", request);
    assert(c.pending?.accepted);
    assert.equal((await ended(auth)).state, "CANCELLED");
    assert(!fs.existsSync(path.join(scratch, "blocked.txt")));
    c.stop();
    // Controlled pause: Core admits an ordinary API task request while scheduler ticks are temporarily gated; no model is claimed for this queued branch.
    const tick = app.scheduler.tick.bind(app.scheduler);
    app.scheduler.tick = () => {};
    let queuedRequest: string;
    try {
      const queuedID = id();
      await client.command("task-requests", {
        request_id: queuedID,
        goal: "Controlled queued AGENT request: return queue acceptance; no files, shell or network.",
      });
      const pending = app.store
        .all<TaskPlan>("TaskPlan")
        .flatMap((p) => (p.pending_requests ?? []).map((r) => ({ p, r })))
        .find(
          (x) =>
            !executions().some((e) => e.occurrence_key === x.r.occurrence_key),
        );
      assert(pending);
      queuedRequest = pending.r.request_id;
      const q = new CancelController();
      q.connect(client, "live");
      await q.submit("request", queuedRequest);
      assert(q.pending?.accepted);
      q.stop();
      assert(!executions().some((e) => e.occurrence_key === queuedRequest));
    } finally {
      app.scheduler.tick = tick;
    }
    return {
      wait_decision_execution: periodic.id,
      wait_auth_execution: auth.id,
      request,
      queued_request: queuedRequest!,
      queue_evidence: "CONTROLLED_SCHEDULER_PAUSE",
      future_due: after.next_due_at,
      in_flight_shell: "NOT_TESTED; no in-flight shell cancellation claim",
    };
  });
  if (!selected)
    await scenario("L4", async () => {
      const v = await action(secondFailure, "REDO");
      assert.equal(v.status, "BLOCKED");
      assert.match(v.error ?? "", /LATEST/);
      const before = executions().length;
      assert.equal(
        (await action(secondFailure, "DISMISS")).disposition,
        "DISMISSED",
      );
      assert.equal(executions().length, before);
      const seq = app.store.sequence;
      for (let i = 0; i < 5; i++) {
        await client.query("failures/EXECUTION:" + secondFailure.id);
        await client.query("attention?view=master");
        await client.query("task-browser");
      }
      assert.equal(app.store.sequence, seq, "QUIET_READ_WROTE");
      return {
        nonlatest_failure: secondFailure.id,
        error: v.error,
        quiet_reads: 5,
        retired_live: "NOT_TESTED",
        unknown:
          "Separate credential-free pump=false seeded acceptance; never mixed with live provider",
      };
    });
  report.status = "PASS";
} catch (e) {
  report.status = "FAIL";
  report.error = String(e);
  console.error(String(e));
  process.exitCode = 1;
} finally {
  clearTimeout(stopTimer);
  if (app!) modelLifetime(app.store).abort(Error("CORE_STOPPING"));
  if (server!) await server.close();
  report.finished_at = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      report: path.join(root, "report.json"),
      status: report.status,
      calls: { main: ledger.main, task: ledger.task },
      tools: ledger.tools,
    }),
  );
}
