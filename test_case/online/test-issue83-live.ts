/** Paid-provider Issue #83 acceptance. Isolated data, finite budgets; never npm test. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
  process.argv[2] ?? ".demo-data/issue83/live-" + Date.now(),
);
assert(
  root.startsWith(path.resolve(".demo-data/issue83") + path.sep),
  "ISOLATED_ISSUE83_DIRECTORY_REQUIRED",
);
assert(!fs.existsSync(path.join(root, "core")), "FRESH_DIRECTORY_REQUIRED");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const limits = {
  main_calls: 48,
  task_calls: 64,
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
const counts = { main: 0, task: 0 },
  toolBudget = { used: 0, limit: limits.tools },
  start = Date.now();
const report: any = {
  evidence: "LIVE_MODEL",
  provider: model.provider,
  model: model.id,
  reasoning: "low",
  limits,
  started_at: new Date(start).toISOString(),
  cases: [],
  calls: [],
  attempts: [],
  source_hashes: Object.fromEntries(
    [
      "task-browser",
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
let app = await App.open(path.join(root, "core"), configs),
  server = await serveCore(app, 0, undefined, { pump: false }),
  client = new CoreClient(server.endpoint);
const es = () => app.store.all<Execution>("Execution"),
  ps = () => app.store.all<TaskPlan>("TaskPlan");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
function approveFiles() {
  for (const a of app.store
    .all<AuthorizationRequest>("AuthorizationRequest")
    .filter((a) => a.state === "PENDING")) {
    const parameters = app.store.read<{ path?: string }>(
      a.action.parameters_ref,
    );
    assert.equal(a.action.action, "file.write");
    assert.equal(parameters.path, "report.txt");
    assert(
      a.action.resource.startsWith(
        path.join(root, "core", "workspaces") + path.sep,
      ),
    );
    app.authorization.decide({
      schema_version: 1,
      record_type: "ApprovalCommand",
      request_id: id(),
      authorization_id: a.id,
      expected_revision: a.revision,
      display_hash: a.display_hash,
      decision: "APPROVE",
    });
  }
}
async function main(text: string) {
  report.inputs ??= [];
  report.inputs.push({ text, at: new Date().toISOString() });
  save();
  app.host.accept(text);
  await app.host.drain();
  assert.equal(app.host.session.state, "IDLE");
}
async function settle() {
  for (let i = 0; i < 18; i++) {
    if (Date.now() - start > limits.total_ms) throw Error("LIVE_TIME_LIMIT");
    app.scheduler.tick();
    await app.scheduler.idle();
    approveFiles();
    app.host.deliverFeedback();
    await app.host.drain();
    if (es().every(terminal) && ps().every((p) => !p.pending_requests?.length))
      return;
    if (es().some((e) => ["WAIT_DECISION", "RESULT_UNKNOWN"].includes(e.state)))
      throw Error("UNEXPECTED_BLOCKED_EXECUTION");
  }
  throw Error("TASK_DID_NOT_SETTLE");
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
async function allMessages(task: string, execution: string, thinking: boolean) {
  const items: Message[] = [];
  let cursor: string | null = null;
  do {
    const page: TaskBrowserMessages = await client.query<TaskBrowserMessages>(
      `task-browser/${task}/executions/${execution}/messages?limit=50&thinking=${thinking}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
    );
    assert(Buffer.byteLength(JSON.stringify(page)) <= 256 * 1024);
    items.push(...page.items);
    cursor = page.after;
  } while (cursor);
  return items;
}
let taskA = "",
  taskB = "";
try {
  await scenario(
    "L1 Main creates task and three real continuations",
    async () => {
      await main(
        "这是隔离验收目录内的真实任务。请创建一个独立 Agent 任务，不指定 Scope，只允许在自己的 cwd 读写 report.txt，不运行 shell、不访问网络。写入 UTF-8 文本 ISSUE83-ALPHA-R1，并在最终结果标明轮次 R1。",
      );
      await settle();
      assert.equal(ps().length, 1);
      taskA = ps()[0].id;
      assert.equal(es().length, 1);
      assert.equal(es()[0].state, "SUCCEEDED");
      for (const round of [2, 3]) {
        const parent = es()
          .filter((e) => e.task_id === taskA)
          .at(-1)!;
        await main(
          `继续同一任务 ${taskA}，上一执行 ${parent.id}。更新 report.txt 为 ISSUE83-ALPHA-R${round}，保留独立 cwd。不要新建任务；最终结果标明 R${round}。`,
        );
        await settle();
        assert.equal(ps().length, 1);
        assert.equal(es().length, round);
        assert.equal(es().at(-1)!.state, "SUCCEEDED");
      }
      const parent = es().at(-1)!;
      await main(
        `继续同一任务 ${taskA}，上一执行 ${parent.id}，本轮 R4。为了真实验证任务对话长正文和消息分页，请将这轮完整验收要求交给 Agent：只在自身 cwd 操作 report.txt，禁止 shell 和网络。先用 write 写入由你创作的英文说明，至少 6500 个 ASCII 字符、至多 9000 字符，包含 ISSUE83-ALPHA-R4-BEGIN 和 ISSUE83-ALPHA-R4-END，分成多个编号段落。然后恰好调用 read 55 次，每次读取 report.txt 的 offset=1、limit=1；这是有意保留 55 条真实工具结果的分页验收，不允许合并或省略，可一次响应批量调用。最后 submit_result，说明轮次 R4 和实际完成的 read 次数。`,
      );
      await settle();
      const rounds = es().filter((e) => e.task_id === taskA);
      assert.equal(rounds.length, 4);
      assert(rounds.every((e) => e.state === "SUCCEEDED"));
      const detail = await client.query<TaskBrowserDetail>(
        "task-browser/" + taskA,
      );
      assert.deepEqual(
        detail.executions.map((e) => e.id),
        [...rounds]
          .reverse()
          .slice(0, 3)
          .map((e) => e.id),
      );
      const newest = rounds.at(-1)!;
      const messages = await allMessages(taskA, newest.id, true);
      const source = app.store
        .executionEvents(newest.id)
        .filter((e) => e.event_type === "agent.message");
      assert.deepEqual(
        messages.map((m) => m.source_event_id),
        source.map((e) => e.event_id),
      );
      assert(
        messages.length > 50,
        "REAL_CONVERSATION_DID_NOT_CROSS_DEFAULT_PAGE",
      );
      const long = messages.find(
        (m) => m.role === "assistant" && m.next_cursor,
      );
      assert(long, "REAL_BODY_DID_NOT_CROSS_FRAGMENT");
      let text = long.text,
        part = long;
      while (part.next_cursor) {
        part = await client.query<Message>(
          `task-browser/${taskA}/executions/${newest.id}/messages/${long.id}/content?thinking=true&cursor=${encodeURIComponent(part.next_cursor)}`,
        );
        text += part.text;
      }
      assert(text.includes("ISSUE83-ALPHA-R4-BEGIN"));
      assert(text.includes("ISSUE83-ALPHA-R4-END"));
      const thinking = source.filter((e) => {
        const raw = app.store.read<any>(e.payload);
        return (
          Array.isArray(raw.content) &&
          [...visibleThinking(raw.content)].some(Boolean)
        );
      });
      assert(thinking.length, "DISPLAYABLE_LIVE_COT_REQUIRED");
      const noThinking = messages.find(
        (m) => !m.thinking && !m.thinking_preview,
      );
      assert(noThinking, "LIVE_NO_COT_MESSAGE_REQUIRED");
      await assert.rejects(
        client.query(
          `task-browser/${taskA}/executions/${rounds[0].id}/messages`,
        ),
        /EXECUTION_OUTSIDE_RECENT_THREE/,
      );
      return {
        task: taskA,
        executions: rounds.map((e) => e.id),
        latest_three: detail.executions.map((e) => e.id),
        newest_message_count: messages.length,
        message_ids: messages.map((m) => m.id),
        long_message: long.id,
        long_chars: text.length,
        positive_thinking_events: thinking.map((e) => e.event_id),
        absent_thinking_message: noThinking.id,
      };
    },
  );
  await scenario("L2 separate Shared cwd and same filename", async () => {
    await main(
      "请另建一个独立 Agent 任务，和 ALPHA 完全无关，不指定 Scope。只在自己的 cwd 写 report.txt，内容精确为 ISSUE83-BRAVO-INDEPENDENT，不运行 shell 或访问网络。不要复用已有任务。",
    );
    await settle();
    assert.equal(ps().length, 2);
    taskB = ps().find((p) => p.id !== taskA)!.id;
    const files = [taskA, taskB].map((task) => {
      assert.equal(app.store.get<TaskPlan>("TaskPlan", task).scope_id, null);
      const relative = `workspaces/${task}/work/report.txt`,
        bytes = fs.readFileSync(path.join(root, "core", relative));
      return {
        task,
        relative_cwd: path.dirname(relative),
        sha256: hash(bytes),
        bytes: bytes.length,
        content: bytes.toString(),
      };
    });
    assert.notEqual(files[0].relative_cwd, files[1].relative_cwd);
    assert.notEqual(files[0].sha256, files[1].sha256);
    assert(files[0].content.includes("ISSUE83-ALPHA-R4-END"));
    assert(files[1].content.includes("ISSUE83-BRAVO-INDEPENDENT"));
    for (const task of [taskA, taskB]) {
      const located = await client.query<TaskBrowserPage>(
        `task-browser/locate?match=exact&task_id=${task}`,
      );
      assert.equal(located.historical?.scope_name, "Shared");
    }
    return files.map(({ content, ...file }) => file);
  });
  await scenario(
    "L4 real-data Task browsing is read-only and survives restart",
    async () => {
      const sequence = app.store.sequence,
        calls = { ...counts },
        ids = es().map((e) => [e.id, e.retention_state]);
      let thinking = false;
      const browser = new TaskBrowserWindow(client, () => thinking);
      await browser.refresh();
      await browser.search(taskA.slice(0, 8));
      await browser.open(taskA);
      const newest = browser.detail!.executions[0].id;
      await browser.page("after", "page:" + newest + ":after");
      const message = browser.groups.get(newest)!.items.at(-1)!;
      browser.viewport([
        {
          item_id: newest + ":" + message.id,
          region: "body",
          block_start_utf16: 0,
          row_in_block: 0,
          measured_width: 80,
        },
      ]);
      thinking = true;
      await browser.setThinking();
      browser.entries().forEach((e) => e.component.render(80));
      thinking = false;
      await browser.setThinking();
      browser.entries().forEach((e) => e.component.render(120));
      assert.equal(app.store.sequence, sequence);
      assert.deepEqual(counts, calls);
      assert.deepEqual(
        es().map((e) => [e.id, e.retention_state]),
        ids,
      );
      await server.close();
      app = await App.open(path.join(root, "core"), configs);
      server = await serveCore(app, 0, undefined, { pump: false });
      client = new CoreClient(server.endpoint);
      const renewed = new TaskBrowserWindow(client, () => thinking);
      renewed.inherit(browser);
      browser.stop();
      await renewed.refresh();
      assert.equal(renewed.selected, taskA);
      assert.equal(renewed.detail!.executions.length, 3);
      assert.deepEqual(
        es().map((e) => [e.id, e.retention_state]),
        ids,
      );
      assert.deepEqual(counts, calls);
      renewed.stop();
      return {
        before_sequence: sequence,
        after_restart_sequence: app.store.sequence,
        calls,
        execution_retention: ids,
        viewports: ["80x24 virtual rendering", "120x40 virtual rendering"],
        native: "NOT_TESTED",
      };
    },
  );
  await scenario(
    "A1r real missed-AT recovery pauses a task with no work",
    async () => {
      const p = app.scheduler.propose(
        "Missed AT acceptance; do not reschedule unless Master explicitly requests it.",
        id(),
        app.host.sessionID,
        { at: new Date(Date.now() + 1500).toISOString() },
      );
      await server.close();
      await pause(2000);
      app = await App.open(path.join(root, "core"), configs);
      server = await serveCore(app, 0, undefined, { pump: false });
      client = new CoreClient(server.endpoint);
      await app.host.drain();
      const plan = app.store.get<TaskPlan>("TaskPlan", p.id);
      assert.equal(plan.state, "PAUSED");
      assert.equal(es().filter((e) => e.task_id === p.id).length, 0);
      const located = await client.query<TaskBrowserPage>(
        `task-browser/locate?task_id=${p.id}`,
      );
      assert.equal(located.historical?.current, false);
      return {
        task: p.id,
        state: plan.state,
        recovery_model_calls: { ...counts },
        classification: "scheduler recovery background, not UI-caused",
      };
    },
  );
  await scenario(
    "L3 real active interval queues and rejects same-task continuation",
    async () => {
      const before = new Set(ps().map((p) => p.id));
      const deadline = new Date(Date.now() + 60000).toISOString();
      await main(
        `创建一个独立、无 Scope 的真实间隔 Agent 任务，interval_seconds=3，deadline=${deadline}，从现在开始；禁止 shell 和网络。每轮只在自己的 cwd 将 report.txt 写为一份约 7000 字符英文长说明，带 ISSUE83-BUSY 标记，然后提交结果。此任务用于观测运行时排队，稍后验收程序会停止隔离 Core；不要提前缩短说明。`,
      );
      const p = ps().find((p) => !before.has(p.id));
      assert(p);
      assert.equal(p.trigger.kind, "INTERVAL");
      app.scheduler.tick();
      let active: Execution | undefined;
      let projection: TaskBrowserDetail | undefined;
      for (let i = 0; i < 120; i++) {
        await pause(100);
        app.scheduler.tick();
        active = es().find((e) => e.task_id === p.id && !terminal(e));
        const plan = app.store.get<TaskPlan>("TaskPlan", p.id);
        if (active && plan.pending_occurrences.length) {
          projection = await client.query<TaskBrowserDetail>(
            "task-browser/" + p.id,
          );
          break;
        }
      }
      assert(active && projection, "NO_REAL_BUSY_QUEUE_OBSERVED");
      assert(
        projection.task.active_executions.some((e) => e.id === active!.id),
      );
      assert(projection.task.pending_occurrence_count > 0);
      assert.throws(
        () =>
          app.scheduler.propose(
            "continue busy task",
            id(),
            app.host.sessionID,
            { reuse: p.id, parent: active!.id },
          ),
        /TASK_BUSY/,
      );
      const captured = {
        task: p.id,
        execution: active.id,
        state: active.state,
        pending_occurrences: projection.task.pending_occurrence_count,
        task_calls: counts.task,
        continuation: "TASK_BUSY",
        deadline,
      };
      // No more scheduler ticks: pending intervals cannot dispatch after this capture.
      await app.scheduler.idle();
      return {
        ...captured,
        after_model_state: app.store.get<Execution>("Execution", active.id)
          .state,
        stop_policy: "isolated Core closed without ticking queued occurrences",
      };
    },
  );
  report.status = "PASS";
} catch (e) {
  report.status = "FAIL";
  report.first_failure = String(e);
  console.error(String(e));
  process.exitCode = 1;
} finally {
  await server.close();
  globalThis.fetch = realFetch;
  report.finished_at = new Date().toISOString();
  report.final_executions = es().map((e) => ({
    id: e.id,
    task_id: e.task_id,
    state: e.state,
  }));
  save();
  console.log("Evidence: " + path.join(root, "report.json"));
}
