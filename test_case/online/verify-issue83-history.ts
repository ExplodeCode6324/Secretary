/** Final-source HTTP + VirtualTerminal check of actual recorded model conversations. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { attachCore } from "../../src/pi_secretary/src/core-client.ts";
import { TerminalApp } from "../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { until } from "../offline/issue9/helpers.ts";
import type {
  Message,
  TaskBrowserMessages,
} from "../../src/pi_secretary/src/api/contracts.ts";
const root = path.resolve(process.argv[2] ?? "");
assert(root.startsWith(path.resolve(".demo-data/issue83") + path.sep));
const live = JSON.parse(
  fs.readFileSync(path.join(root, "report.json"), "utf8"),
);
assert.equal(live.status, "PASS");
const task = live.cases[0].evidence.task,
  execution = live.cases[0].evidence.latest_three[0];
const client = await attachCore(path.join(root, "core"));
assert(client);
let cursor: string | null = null;
const messages: Message[] = [];
do {
  const page: TaskBrowserMessages = await client.query(
    `task-browser/${task}/executions/${execution}/messages?thinking=true${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
  );
  messages.push(...page.items);
  cursor = page.after;
} while (cursor);
const generated = messages.find((m) => m.role === "assistant" && m.next_cursor);
assert(generated, "LONG_REAL_ASSISTANT_MESSAGE_REQUIRED");
let text = generated.text,
  part = generated;
while (part.next_cursor) {
  part = await client.query(
    `task-browser/${task}/executions/${execution}/messages/${generated.id}/content?thinking=true&cursor=${encodeURIComponent(part.next_cursor)}`,
  );
  text += part.text;
}
assert(text.includes("ISSUE83-ALPHA-R4-BEGIN"));
assert(text.includes("ISSUE83-ALPHA-R4-END"));
const terminal = new VirtualTerminal(80, 24),
  app = new TerminalApp(
    path.join(root, "core"),
    terminal,
    path.join(root, "final-tui-state"),
  );
const result: any = {
  evidence: "REAL_RECORDED_DATA_HTTP_AND_VIRTUAL_TERMINAL",
  generated_message: generated.id,
  generated_body_chars: text.length,
  recorded_messages: messages.length,
  native_ime:
    "NOT_TESTED: native Terminal.app control rejected by computer-use tool",
};
try {
  app.start();
  await until(
    () => !!app.remote?.taskBrowser.root && app.editors.Task.enabled,
    5000,
  );
  const command = (text: string) => {
    app.editors[app.page].setText("");
    terminal.sendInput(text);
    terminal.sendInput("\x1b[13;2u");
  };
  command("/T");
  command("/search_task " + task.slice(0, 8));
  await until(() => app.remote?.taskBrowser.root?.target === task, 5000);
  assert.equal(app.remote!.taskBrowser.root!.historical!.id, task);
  command("/taskdetail " + task);
  await until(() => app.remote?.taskBrowser.groups.size === 3, 5000);
  assert.deepEqual(
    app.remote!.taskBrowser.detail!.executions.map((e) => e.id),
    live.cases[0].evidence.latest_three,
  );
  result.root_counts = app.remote!.taskBrowser.root!.counts;
  fs.writeFileSync(
    path.join(root, "virtual-80x24.txt"),
    (await terminal.flushAndGetViewport()).join("\n"),
  );
  await app.remote!.taskBrowser.page("after", "page:" + execution + ":after");
  assert(app.remote!.taskBrowser.groups.get(execution)!.items.length > 50);
  command("/M");
  command("/cotv");
  await until(() => app.remote!.history.thinking, 5000);
  command("/T");
  await app.remote!.taskBrowser.refresh();
  assert.equal(app.remote!.taskBrowser.selected, task);
  terminal.resize(120, 40);
  await terminal.flush();
  fs.writeFileSync(
    path.join(root, "virtual-120x40.txt"),
    (await terminal.flushAndGetViewport()).join("\n"),
  );
  terminal.sendInput("\x1b[200~中文 Task 草稿\n/T 和 /back 是正文\x1b[201~");
  const draft = app.editors.Task.getExpandedText();
  terminal.sendInput("\x1b[13;2u");
  assert.equal(app.editors.Task.getExpandedText(), draft);
  assert.equal(Object.keys(app.editors).length, 2);
  app.remote!.taskBrowser.back();
  app.draw();
  assert.equal(app.editors.Task.getExpandedText(), draft);
  result.status = "PASS";
} catch (e) {
  result.status = "FAIL";
  result.error = String(e);
  throw e;
} finally {
  await app.close();
  fs.writeFileSync(
    path.join(root, "final-ui-verification.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
}
console.log(JSON.stringify(result));
