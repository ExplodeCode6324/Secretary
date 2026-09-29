// Explicit paid-provider acceptance. Natural inputs use no task IDs or tool directives.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { getModel } from "@earendil-works/pi-ai/compat";
import { contentText } from "@earendil-works/pi-ai";
import { boundedTools } from "./tool-budget.ts";
import { App } from "../../src/pi_secretary/src/app.ts";
import { roleModel, type StreamFn } from "../../src/pi_secretary/src/model.ts";
import { id, hash } from "../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  TaskPlan,
  TaskResult,
  AuthorizationRequest,
  Context,
  Operation,
} from "../../src/pi_secretary/src/contracts.ts";
const modelID = process.argv[2] ?? "deepseek-v4.1-flash";
const runID = `task-reuse-${Date.now()}`;
const dir = path.resolve(".demo-data", runID);
const output = path.resolve(
  "test_case/reports/task-reuse-20260929",
  `${runID}.json`,
);
const keys = JSON.parse(
  fs.readFileSync(
    process.env.SECRETARY_CREDENTIALS_FILE ??
      ".demo-data/live-credentials.json",
    "utf8",
  ),
) as { main: string; task: string };
const model = getModel("opencode-go", modelID as never);
assert(model, "Unknown model");
const start = Date.now();
const counts = { main: 0, task: 0 };
const toolBudget = { used: 0, limit: 100 };
const configs = Object.fromEntries(
  (["main", "task"] as const).map((role) => {
    const config = roleModel(model, keys[role]);
    const budgeted = boundedTools(config.stream, toolBudget);
    const stream: StreamFn = (m, c, o) => {
      if (++counts[role] > 48 || Date.now() - start > 720000)
        throw Error("LIVE_BUDGET_EXHAUSTED");
      return budgeted(m, c, {
        ...o,
        signal: o?.signal
          ? AbortSignal.any([o.signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000),
      });
    };
    return [role, { model, stream }];
  }),
) as unknown as {
  main: ReturnType<typeof roleModel>;
  task: ReturnType<typeof roleModel>;
};
let app = await App.open(dir, configs);
const report: any = {
  evidence: "LIVE_MODEL",
  model: modelID,
  provider: "opencode-go",
  reasoning: "low",
  budgets: { calls_per_role: 48, tools: 100, total_ms: 720000, call_ms: 60000 },
  prompt_hashes: Object.fromEntries(
    ["instructions.ts", "task-prompt.ts"].map((f) => [
      f,
      hash(fs.readFileSync(`src/pi_secretary/src/${f}`)),
    ]),
  ),
  code_hashes: Object.fromEntries(
    [
      "src/contracts/contracts.schema.json",
      ...[
        "app",
        "host",
        "scheduler",
        "store",
        "instructions",
        "task-prompt",
      ].map((n) => `src/pi_secretary/src/${n}.ts`),
    ].map((f) => [f, hash(fs.readFileSync(f))]),
  ),
  cases: [],
  started_at: new Date(start).toISOString(),
};
const es = () => app.store.all<Execution>("Execution");
const ps = () => app.store.all<TaskPlan>("TaskPlan");
const lastText = () => {
  const context = app.store.get<Context>(
    "Context",
    app.host.session.last_context_id!,
  );
  const messages = app.store.read<any[]>(context.raw_context);
  return contentText(
    messages
      .findLast((m) => m.role === "assistant")
      ?.content?.filter((x: any) => x.type === "text") ?? [],
  );
};
async function turn(text: string) {
  app.host.accept(text);
  await app.host.drain();
  assert.equal(app.host.session.state, "IDLE", "Main loop did not settle");
  for (let n = 0; n < 24; n++) {
    if (Date.now() - start > 720000) throw Error("LIVE_TIME_LIMIT");
    app.scheduler.tick();
    await app.scheduler.idle();
    for (const a of app.store
      .all<AuthorizationRequest>("AuthorizationRequest")
      .filter((a) => a.state === "PENDING")) {
      const p = app.store.read<{ path?: string }>(a.action.parameters_ref);
      assert.equal(
        a.action.action,
        "file.write",
        "Unexpected action requires manual review",
      );
      assert(
        ["report.md", "separate-delivery.md"].includes(p.path ?? ""),
        "Unexpected output path",
      );
      assert(
        a.action.resource.startsWith(path.join(dir, "workspaces") + path.sep),
        "Authorization escaped isolated workspace",
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
    app.host.deliverFeedback();
    await app.host.drain();
    assert(toolBudget.used <= toolBudget.limit);
    if (
      es().every((e) =>
        ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(e.state),
      ) &&
      ps().every((p) => !p.pending_requests?.length)
    )
      break;
    if (es().some((e) => ["WAIT_DECISION", "RESULT_UNKNOWN"].includes(e.state)))
      throw Error("UNEXPECTED_BLOCKED_EXECUTION");
  }
  assert(
    es().every((e) => e.state === "SUCCEEDED"),
    "A task did not succeed",
  );
  return lastText();
}
function content(e: Execution, file = "report.md") {
  const r = app.store.get<TaskResult>("TaskResult", e.result_id!);
  const artifact = r.artifacts.find((a) => a.workspace_path === file);
  assert(artifact, "Missing immutable artifact");
  const text = app.store.bytes(artifact.content).toString();
  assert.equal(
    text,
    fs.readFileSync(
      path.join(dir, "workspaces", e.task_id, "work", file),
      "utf8",
    ),
  );
  return text;
}
async function scenario(name: string, run: () => Promise<unknown>) {
  const entry: any = { name, start_calls: { ...counts } };
  report.cases.push(entry);
  try {
    entry.evidence = await run();
    entry.pass = true;
    console.log(`${name}: PASS`);
  } catch (e) {
    entry.pass = false;
    entry.error = String(e);
    throw e;
  }
}
let t1 = "",
  e1: Execution,
  e2: Execution,
  e3: Execution,
  firstArtifact = "";
try {
  await scenario("O01", async () => {
    const reply = await turn(
      "请分析这个试点方案是否值得继续：北辰项目上线前每周18个工单，上线后每周12个工单，试点运行了两周。当前只掌握这些数据。请说明支持继续的理由和证据的局限。",
    );
    assert.equal(ps().length, 0);
    assert.equal(es().length, 0);
    assert(reply.length > 40);
    return { reply };
  });
  await scenario("O02", async () => {
    await turn(
      "把刚才北辰试点的数据和分析整理成一份简短中文报告，保存为 report.md。分成第一部分‘试点效果’和第二部分‘后续建议’，引用18和12的工单数据以及两周试点期，明确样本有限，不能确定长期效果。报告需要可以下载或读取的文件。本次工作只读写报告文件，不运行任何命令。",
    );
    assert.equal(ps().length, 1);
    assert.equal(es().length, 1);
    t1 = ps()[0].id;
    e1 = es()[0];
    firstArtifact = content(e1);
    await turn(
      "第二部分补上刚才这条信息：后续预算上限是8万元，来源是我今天给出的预算约束。请更新这份报告，并保留之前的试点数据和证据局限。",
    );
    assert.equal(ps().length, 1);
    assert.equal(es().length, 2);
    e2 = es()[1];
    assert.equal(e2.task_id, t1);
    assert.equal(e2.continuation_of, e1.id);
    const text = content(e2);
    assert(/8\s*万|八万/.test(text));
    assert(text.includes("18") && text.includes("12"));
    const r1 = app.store.get<TaskResult>("TaskResult", e1.result_id!);
    assert.equal(
      app.store.bytes(r1.artifacts[0].content).toString(),
      firstArtifact,
    );
    assert.notEqual(
      app.scheduler.proposalFor(e1).goal,
      app.scheduler.proposalFor(e2).goal,
    );
    return { task: t1, parent: e1.id, execution: e2.id, content: text };
  });
  await scenario("O03", async () => {
    const reply = await turn("第二部分的预算上限依据是什么？");
    assert.equal(es().length, 2);
    assert.equal(ps().length, 1);
    assert(reply.length > 15);
    assert(/8|八/.test(reply));
    return { reply };
  });
  await scenario("O04", async () => {
    await turn(
      "再把这份报告压缩到一页，正文不超过600字，保留刚补充的信息、原始工单数据和证据局限。仍更新 report.md。",
    );
    assert.equal(es().length, 3);
    assert.equal(ps().length, 1);
    e3 = es()[2];
    assert.equal(e3.task_id, t1);
    assert.equal(e3.continuation_of, e2.id);
    const text = content(e3);
    assert([...text.replace(/^#{1,6} .*$/gm, "").trim()].length <= 600);
    assert(/8\s*万|八万/.test(text));
    assert(text.includes("18") && text.includes("12"));
    return { execution: e3.id, content: text };
  });
  await scenario("O05", async () => {
    await app.close();
    app = await App.open(dir, configs);
    app.scheduler.tick();
    await app.scheduler.idle();
    assert.equal(es().length, 3);
    await turn(
      "刚才那份北辰试点报告，再补上一句：下周三复核试点结果。保留预算上限和已有数据，仍保持简短。",
    );
    assert.equal(ps().length, 1);
    assert.equal(es().length, 4);
    const e4 = es()[3];
    assert.equal(e4.task_id, t1);
    assert.equal(e4.continuation_of, e3.id);
    const text = content(e4);
    assert(text.includes("下周三"));
    assert(/8\s*万|八万/.test(text));
    return { execution: e4.id, content: text };
  });
  await scenario("O06", async () => {
    await turn(
      "另做一份独立交付，与北辰报告无关：写一份办公室绿植养护备忘录，包含每周检查土壤湿度、避免积水这两条建议，保存为 separate-delivery.md。",
    );
    assert.equal(ps().length, 2);
    assert.equal(es().length, 5);
    const other = es()[4];
    assert.notEqual(other.task_id, t1);
    return {
      task: other.task_id,
      execution: other.id,
      content: content(other, "separate-delivery.md"),
    };
  });
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  report.calls = counts;
  report.tool_calls = toolBudget.used;
  report.elapsed_ms = Date.now() - start;
  report.executions = es().map((e) => ({
    ...e,
    proposal: app.scheduler.proposalFor(e),
  }));
  report.results = app.store
    .all<TaskResult>("TaskResult")
    .map((r) => ({ ...r, detail: app.store.read(r.detail_ref) }));
  report.operations = app.store.all<Operation>("Operation");
  report.transcript = app.store.logs
    .filter((l) =>
      [
        "main.message",
        "main.tool.result",
        "agent.message",
        "agent.dispatch_prompt",
      ].includes(l.event_type),
    )
    .map((l) => ({
      type: l.event_type,
      scope: l.scope,
      payload: app.store.read(l.payload),
    }));
  await app.close();
  let serialized = JSON.stringify(
    report,
    (k, v) =>
      ["thinking", "thinkingSignature", "textSignature"].includes(k)
        ? undefined
        : k === "content" && Array.isArray(v)
          ? v.filter((x) => x?.type !== "thinking")
          : v,
    2,
  ).replaceAll(dir, "<isolated-test-data>");
  for (const key of Object.values(keys))
    assert(!serialized.includes(key), "Credential appeared in report");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized + "\n");
  console.log(
    JSON.stringify({
      pass: report.pass,
      error: report.error,
      calls: counts,
      report: output,
    }),
  );
}
