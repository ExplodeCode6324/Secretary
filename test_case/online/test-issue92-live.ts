/** Paid-provider Issue #92 acceptance. Isolated data, finite budgets; never npm test. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { TerminalApp } from "../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import type {
  Decision,
  MasterAttention,
  Authorization,
} from "../../src/pi_secretary/src/api/contracts.ts";
import type {
  DecisionRequest,
  Operation,
  TaskResult,
} from "../../src/pi_secretary/src/contracts.ts";
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
import { visibleThinking } from "../../src/pi_secretary/src/thinking-preview.ts";
import { TaskBrowserWindow } from "../../src/pi_secretary/src/tui/task-browser.ts";
import type {
  Execution,
  TaskPlan,
  AuthorizationRequest,
} from "../../src/pi_secretary/src/contracts.ts";
import type {
  Message,
  TaskBrowserDetail,
  TaskBrowserMessages,
  TaskBrowserPage,
} from "../../src/pi_secretary/src/api/contracts.ts";
import { configureLiveOutputBudget } from "./issue91-budget.ts";
import { boundedTools } from "./tool-budget.ts";

const root = path.resolve(
  process.argv[2] ?? ".demo-data/issue92/live-" + Date.now(),
);
assert(
  root.startsWith(path.resolve(".demo-data/issue92") + path.sep),
  "ISOLATED_ISSUE92_DIRECTORY_REQUIRED",
);
assert(!fs.existsSync(path.join(root, "core")), "FRESH_DIRECTORY_REQUIRED");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const limits = {
  main_calls: 48,
  task_calls: 48,
  tools: 150,
  total_ms: 1200000,
  request_ms: 90000,
  output_tokens: 8192,
};
process.env.SECRETARY_MAX_OUTPUT_TOKENS = String(limits.output_tokens);
configureLiveOutputBudget(limits.output_tokens);
const keys = JSON.parse(
  fs.readFileSync(".demo-data/live-credentials.json", "utf8"),
) as { main: string; task: string };
const model = getModel("opencode-go", "deepseek-v4.1-flash");
assert(model);
const previousReport = process.argv[3];
const prior = previousReport
  ? JSON.parse(fs.readFileSync(previousReport, "utf8"))
  : null;
const counts = { main: prior?.counts.main ?? 0, task: prior?.counts.task ?? 0 },
  toolBudget = { used: prior?.tool_calls ?? 0, limit: limits.tools },
  start = prior
    ? Date.parse(prior.budget_started_at ?? prior.started_at)
    : Date.now();
const report: any = {
  evidence: "LIVE_MODEL",
  scope:
    process.argv[4] === "--answers-only"
      ? "final-source answer and reconnect smoke; authorization/failure coverage in predecessor"
      : "full",
  provider: model.provider,
  model: model.id,
  reasoning: "low",
  limits,
  started_at: new Date().toISOString(),
  budget_started_at: new Date(start).toISOString(),
  previous_report: previousReport ?? null,
  previous_usage: { counts: { ...counts }, tools: toolBudget.used },
  cases: [],
  calls: [],
  attempts: [],
  source_hashes: Object.fromEntries(
    [
      "master-attention",
      "tui/matter",
      "tui/attention",
      "tui/app",
      "application-service",
      "model",
      "execution-runner",
      "scheduler",
      "task-planning",
      "budget",
    ].map((n) => [n, hash(fs.readFileSync(`src/pi_secretary/src/${n}.ts`))]),
  ),
};
function save() {
  fs.writeFileSync(
    path.join(root, "report.json"),
    JSON.stringify({ ...report, counts, tool_calls: toolBudget.used }, null, 2),
    { mode: 0o600 },
  );
}
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== new URL(model.baseUrl).hostname)
    return realFetch(input, init);
  const payload = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  const entry: any = {
    at: new Date().toISOString(),
    max_tokens: payload.max_tokens ?? payload.max_completion_tokens ?? null,
  };
  report.attempts.push(entry);
  save();
  try {
    const response = await realFetch(input, init);
    entry.status = response.status;
    save();
    return response;
  } catch (e) {
    entry.error = e instanceof Error ? e.name : "transport_error";
    save();
    throw e;
  }
}) as typeof fetch;
const configs = Object.fromEntries(
  (["main", "task"] as const).map((role) => {
    const real = roleModel(model, keys[role], role),
      bounded = boundedTools(real.stream, toolBudget);
    const stream: StreamFn = async (m, c, o) => {
      if (
        ++counts[role] >
          (role === "main" ? limits.main_calls : limits.task_calls) ||
        Date.now() - start > limits.total_ms
      )
        throw Error("LIVE_BUDGET_EXHAUSTED");
      const entry: any = {
        role,
        number: counts[role],
        at: new Date().toISOString(),
      };
      report.calls.push(entry);
      save();
      try {
        const source = await bounded(m, c, {
          ...o,
          signal: o?.signal
            ? AbortSignal.any([
                o.signal,
                AbortSignal.timeout(limits.request_ms),
              ])
            : AbortSignal.timeout(limits.request_ms),
        });
        const response = await source.result();
        entry.tools = response.content
          .filter((part) => part.type === "toolCall")
          .map((part) => ({
            name: part.name,
            arguments:
              part.name === "task_control" ? part.arguments : undefined,
          }));
        entry.stop_reason = response.stopReason;
        entry.returned_at = new Date().toISOString();
        save();
        return source;
      } catch (e) {
        entry.error = String(e);
        save();
        throw e;
      }
    };
    return [role, { model, stream }];
  }),
) as Record<"main" | "task", ModelConfig>;
const app = await App.open(path.join(root, "core"), configs);
// Production pump intentionally remains active, including Main feedback handling.
const server = await serveCore(app, 0),
  client = new CoreClient(server.endpoint);
fs.writeFileSync(
  path.join(root, "core", "core-endpoint.json"),
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
const terminalUI = new VirtualTerminal(120, 40),
  ui = new TerminalApp(
    path.join(root, "core"),
    terminalUI,
    path.join(root, "tui-state"),
  );
const shiftEnter = "\x1b[13;2u";
const es = () => app.store.all<Execution>("Execution");
async function until(check: () => boolean, timeout = 240000) {
  const deadline = Math.min(start + limits.total_ms, Date.now() + timeout);
  while (!check()) {
    if (Date.now() > deadline) throw Error("LIVE_CONDITION_TIMEOUT");
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function scenario(name: string, run: () => Promise<unknown>) {
  const item: any = {
    name,
    at: new Date().toISOString(),
    calls_before: { ...counts },
  };
  report.cases.push(item);
  save();
  try {
    item.evidence = await run();
    item.status = "PASS";
    console.log(name + ": PASS");
  } catch (e) {
    item.status = "FAIL";
    item.error = String(e);
    throw e;
  } finally {
    save();
  }
}
async function task(text: string) {
  const before = new Set(es().map((e) => e.id));
  const request = id();
  await client.command("messages", { request_id: request, text });
  report.inputs ??= [];
  report.inputs.push({ request_id: request, text });
  save();
  await until(() => es().some((e) => !before.has(e.id)));
  const execution = es().find((e) => !before.has(e.id))!;
  return { task_id: execution.task_id, execution_id: execution.id };
}
async function openMatter(item: string, origin: "Main" | "Task") {
  if (ui.page !== origin) {
    terminalUI.sendInput(origin === "Main" ? "/m" : "/t");
    terminalUI.sendInput(shiftEnter);
    assert.equal(ui.page, origin);
  }
  if (origin === "Task") {
    terminalUI.sendInput("/show " + item);
    terminalUI.sendInput(shiftEnter);
  } else {
    await ui.remote!.attention.refresh();
    ui.remote!.attention.enter();
    const row = ui.remote!.attention.page!.items.find((r) => r.id === item);
    assert(row, "LIVE_MATTER_NOT_IN_MAIN");
    ui.remote!.attention.selected = row.key;
    ui.draw();
    terminalUI.sendInput("\r");
  }
  await until(
    () => ui.matters.current?.id === item && !ui.matters.loading,
    15000,
  );
}
async function completed(execution: string) {
  await until(() => terminal(app.store.get<Execution>("Execution", execution)));
  return app.store.get<Execution>("Execution", execution);
}
try {
  ui.start();
  await until(
    () => !!ui.remote?.attention.head && ui.editors.Main.enabled,
    15000,
  );
  for (const origin of ["Main", "Task"] as const)
    await scenario(
      `L1 real Main → Agent question → ${origin} literal Master answer`,
      async () => {
        const label = "ISSUE92-QUESTION-" + origin.toUpperCase();
        const created = await task(
          `请创建一个新的独立 AGENT 任务（不复用旧任务、不指定 Scope），做以下隔离验收。必须把本要求完整交给 Agent：任务首先只调用 request_decision，问题精确为「${label}：请 Master 输入本次未知的验收口令」。只有 Master 知道口令，当前消息没有口令，不得猜测、不得从其他任务取答案。Main 不要 task_control answer；收到反馈后等待 Master 使用客户端事项入口回答。Agent 收到真实回答后，不写文件、不运行 shell、不访问网络，直接 submit_result SUCCEEDED，summary 原样完整引用回答，并说明标签 ${label}。若未回答就保持等待，不得自行完成。`,
        );
        await until(() =>
          app.store
            .all<DecisionRequest>("DecisionRequest")
            .some(
              (d) =>
                d.execution_id === created.execution_id && d.state === "OPEN",
            ),
        );
        const d = app.store
          .all<DecisionRequest>("DecisionRequest")
          .find((d) => d.execution_id === created.execution_id)!;
        assert.equal(d.question, `${label}：请 Master 输入本次未知的验收口令`);
        assert.deepEqual(d.options, []);
        if (origin === "Main") {
          terminalUI.sendInput("live preserved Main draft");
        }
        const saved = ui.editors[origin].snapshot();
        await openMatter(d.id, origin);
        const answer = "/m ISSUE92-MASTER-" + id() + "\n/send literal answer";
        terminalUI.sendInput("\x1b[200~" + answer + "\x1b[201~");
        terminalUI.sendInput(shiftEnter);
        await until(() => !ui.matters.current, 15000);
        const record = await client.query<Decision>("decisions/" + d.id);
        assert.equal(record.answered_by, "MASTER");
        assert.equal(record.state, "ANSWERED");
        assert.deepEqual(record.answer, { value: answer });
        assert(record.answer_request_id);
        const ended = await completed(created.execution_id);
        assert.equal(ended.state, "SUCCEEDED");
        const result = app.store.get<TaskResult>(
          "TaskResult",
          ended.result_id!,
        );
        assert(
          result.summary.includes(answer),
          "REAL_RESUMED_OUTPUT_MISSING_LITERAL_ANSWER",
        );
        if (origin === "Main") {
          assert.deepEqual(ui.editors.Main.snapshot(), saved);
          ui.editors.Main.setText("");
          ui.delivery!.edit("Main", "");
          ui.draw();
        }
        const page = await client.query<MasterAttention>(
          "attention?view=master",
        );
        assert(!page.items.some((r) => r.id === d.id));
        return {
          ...created,
          decision_id: d.id,
          answer_request_id: record.answer_request_id,
          answered_by: record.answered_by,
          result_id: result.id,
          answer_sha256: hash(answer),
          resumed_literal_match: true,
          origin,
        };
      },
    );
  if (process.argv[4] !== "--answers-only") {
    const scratch = path.join(root, "scratch");
    fs.mkdirSync(scratch, { recursive: true });
    const scope = app.scheduler.scopes.save({
      name: "Issue 92 isolated authorization acceptance",
      kind: "DIRECTORY",
      root_path: scratch,
      default_write: "ask",
    });
    let rejectedExecution = "";
    for (const mode of ["APPROVE", "REJECT"] as const)
      await scenario(`L2 real Agent write authorization ${mode}`, async () => {
        const filename = mode.toLowerCase() + ".txt",
          text = "ISSUE92-" + mode + "-" + id();
        const created = await task(
          `请创建新的独立 AGENT 任务，使用已由 Master 设置的 Scope ${scope.id}，不得复用旧任务。任务：只用 write 写相对路径 ${filename}，UTF-8 内容精确为 ${text}；不运行 shell，不访问网络，不写其他路径。该 Scope default_write=ask，必须等待真实授权。写入成功后 submit_result SUCCEEDED 并报告内容；若授权拒绝，停止，不重试或建立新任务。Main 不要改变授权规则。`,
        );
        await until(() =>
          app.store
            .all<AuthorizationRequest>("AuthorizationRequest")
            .some(
              (a) =>
                a.scope.execution_id === created.execution_id &&
                a.state === "PENDING",
            ),
        );
        const a = app.store
          .all<AuthorizationRequest>("AuthorizationRequest")
          .find(
            (a) =>
              a.scope.execution_id === created.execution_id &&
              a.state === "PENDING",
          )!;
        assert.equal(a.action.action, "file.write");
        assert.equal(a.action.resource, path.join(scratch, filename));
        const display = await client.query<Authorization>(
          "authorizations/" + a.id,
        );
        assert(display.display_hash);
        await openMatter(a.id, "Main");
        terminalUI.sendInput("\t");
        if (mode === "REJECT") terminalUI.sendInput("\t");
        terminalUI.sendInput(shiftEnter);
        await until(() => !ui.matters.current, 15000);
        const ended = await completed(created.execution_id);
        assert.equal(ended.state, mode === "APPROVE" ? "SUCCEEDED" : "FAILED");
        const page = await client.query<MasterAttention>(
          "attention?view=master",
        );
        assert(!page.items.some((r) => r.id === a.id));
        const approved = await client.query<Authorization>(
          "authorizations/" + a.id,
        );
        assert(approved.decision_id);
        if (mode === "APPROVE")
          assert.equal(
            fs.readFileSync(path.join(scratch, filename), "utf8"),
            text,
          );
        else {
          assert(!fs.existsSync(path.join(scratch, filename)));
          rejectedExecution = created.execution_id;
          const failure = page.items.find(
            (r) => r.id === created.execution_id,
          )!;
          assert.equal(failure.failure_category, "authorization_rejected");
          assert.equal(failure.cause_evidence, "rejection_proven");
        }
        return {
          ...created,
          authorization_id: a.id,
          operation_id: a.operation_id,
          decision_id: approved.decision_id,
          state: approved.state,
          display_hash: display.display_hash,
          file_exists: fs.existsSync(path.join(scratch, filename)),
          file_sha256:
            mode === "APPROVE"
              ? hash(fs.readFileSync(path.join(scratch, filename)))
              : null,
        };
      });
    await scenario(
      "L2 real missing-input execution failure remains beside rejection failure",
      async () => {
        const created = await task(
          "请创建一个全新的独立 AGENT 任务，不指定 Scope、不复用旧任务。任务需要读取其空白独立 cwd 中的 required-source-issue92.txt 并摘要。该文件确实未提供：必须用 read 实际确认，不得创建文件、不得替换内容、不得运行 shell、不得调用 request_decision。源文件不存在时，验收条件无法满足，使用 submit_result FAILED，如实说明 read 错误及缺失输入。Main 不要自动修复、重试或新建替代任务。",
        );
        const ended = await completed(created.execution_id);
        assert.equal(ended.state, "FAILED");
        const readError = app.store
          .executionEvents(created.execution_id)
          .filter((event) => event.event_type === "agent.message")
          .map((event) => ({
            id: event.event_id,
            message: app.store.read<any>(event.payload),
          }))
          .find(
            ({ message }) =>
              message.role === "toolResult" &&
              message.toolName === "read" &&
              message.isError,
          );
        assert(readError, "REAL_READ_ERROR_REQUIRED");
        const page = await client.query<MasterAttention>(
            "attention?view=master",
          ),
          actual = page.items.find((r) => r.id === created.execution_id),
          rejected = page.items.find((r) => r.id === rejectedExecution);
        assert.equal(actual?.failure_category, "execution_failed");
        assert.equal(actual?.cause_evidence, "recorded_non_rejection");
        assert.equal(rejected?.failure_category, "authorization_rejected");
        await ui.remote!.attention.refresh();
        assert(ui.remote!.attention.head!.counts.execution_failed >= 1);
        assert(ui.remote!.attention.head!.counts.authorization_rejected >= 1);
        return {
          ...created,
          rejected_execution_id: rejectedExecution,
          read_error_event_id: readError.id,
          actual_failure: actual,
          rejected_failure: rejected,
        };
      },
    );
  }
  await scenario(
    "L3 same-domain reconnect preserves Main draft without automatic matter replay",
    async () => {
      if (ui.page !== "Main") {
        terminalUI.sendInput("/m");
        terminalUI.sendInput(shiftEnter);
      }
      terminalUI.sendInput("\x1b[200~LIVE reconnect 草稿\n/preserved\x1b[201~");
      const snapshot = ui.editors.Main.snapshot(),
        before = app.store.all("Input").length;
      const core = await client.core();
      ui.matters.connect(client, core.data_domain_id + ":" + core.mode);
      await ui.matters.refresh();
      assert.deepEqual(ui.editors.Main.snapshot(), snapshot);
      assert.equal(app.store.all("Input").length, before);
      return {
        data_domain_id: core.data_domain_id,
        draft_preserved: true,
        extra_inputs: 0,
        note: "Controller reconnect; full transport loss races separately covered offline.",
      };
    },
  );
  report.status = "PASS";
} catch (e) {
  report.status = "FAIL";
  report.error = String(e);
  console.error(String(e));
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  save();
  await ui.close();
  await server.close();
  globalThis.fetch = realFetch;
}
