// Explicit paid-provider test; isolated data, no Scheduler pump or production changes.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { getModel } from "@earendil-works/pi-ai/compat";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../src/app.ts";
import {
  roleModel,
  fixtureModel,
  fixtureStream,
  type StreamFn,
} from "../src/model.ts";
import { getInstructions, saveInstructions } from "../src/instructions.ts";
import type { Context, ModelCall } from "../src/contracts.ts";
const keys = JSON.parse(
  fs.readFileSync(
    process.env.SECRETARY_CREDENTIALS_FILE ??
      ".demo-data/live-credentials.json",
    "utf8",
  ),
);
const model = getModel("opencode-go", "deepseek-v4.1-flash");
const config = roleModel(model, keys.main);
let calls = 0;
const stream: StreamFn = (m, c, o) => {
  if (++calls > 16) throw Error("TEST_CALL_LIMIT");
  return config.stream(m, c, o);
};
const dir = path.resolve(".demo-data", "instructions-live-" + Date.now());
const report: any = {
  model: model.id,
  directory: dir,
  started_at: new Date().toISOString(),
  cases: [],
};
const app = await App.open(dir, {
  main: { model, stream },
  task: { model: fixtureModel, stream: fixtureStream },
});
async function turn(name: string, text: string, language: "zh" | "en") {
  app.host.accept(text);
  await app.host.drain();
  assert.equal(app.host.session.state, "IDLE");
  const c = app.store.get<Context>(
    "Context",
    app.host.session.last_context_id!,
  );
  const messages = app.store.read<any[]>(c.raw_context);
  const response = contentText(
    messages
      .findLast((m) => m.role === "assistant")
      .content.filter((x: any) => x.type === "text"),
  );
  assert(response.length > 0);
  const languagePassed =
    /[\u3400-\u9fff]/u.test(response) === (language === "zh");
  assert.equal(c.instructions_revision, getInstructions(app.store).revision);
  report.cases.push({
    name,
    response,
    language,
    instructions_revision: c.instructions_revision,
    context_id: c.id,
    pass: languagePassed,
  });
  console.log(name + (languagePassed ? ": PASS" : ": LANGUAGE_MISMATCH"));
}
try {
  await turn(
    "default Chinese with English input and material",
    'Explain this short report in one sentence. This is a communication test only; do not create any tasks. Report: "CPU utilization is 12 percent. Disk utilization is 48 percent."',
    "zh",
  );
  await turn(
    "Chinese after English log/tool material",
    "Read the recent conversation log using memory_read and briefly state what report we discussed. Do not create tasks.",
    "zh",
  );
  await app.host.compact();
  assert.equal(app.host.memoryStatus().state, "COMMITTED");
  await turn(
    "explicit English override after compaction",
    "For this reply only, answer in English in one sentence: what report did we discuss? Do not use tools or create tasks.",
    "en",
  );
  await turn(
    "return to default Chinese",
    "Summarize the report again briefly. Do not use tools or create tasks.",
    "zh",
  );
  saveInstructions(
    app.store,
    "默认使用英语回复，称呼用户为 Master。保持简短。用户明确指定语言时按用户要求。",
    getInstructions(app.store).revision,
  );
  await turn(
    "new custom default English on same conversation",
    "概括一下之前的报告即可，不用工具，也不要新建任务。",
    "en",
  );
  assert.equal(app.store.all("TaskPlan").length, 0);
  assert.equal(app.store.all("Operation").length, 0);
  report.tool_reads = app.store.logs.filter(
    (e) => e.event_type === "main.tool.result",
  ).length;
  assert(report.tool_reads > 0);
  report.model_calls = app.store.all<ModelCall>("ModelCall").length;
  report.mechanism_pass = true;
  report.pass = report.cases.every((c: { pass: boolean }) => c.pass);
  if (!report.pass) process.exitCode = 1;
} catch (e) {
  report.pass = false;
  report.error = String(e);
  process.exitCode = 1;
} finally {
  await app.close();
  report.completed_at = new Date().toISOString();
  fs.writeFileSync(
    "pi_secretary/reports/instructions-20260923/live.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({ pass: report.pass, calls, error: report.error }),
  );
}
