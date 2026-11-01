/** Read-only acceptance against an already completed real-provider Issue #92 domain. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import { TerminalApp } from "../../src/pi_secretary/src/tui/app.ts";
import { VirtualTerminal } from "../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import type { Execution } from "../../src/pi_secretary/src/contracts.ts";
const root = path.resolve(process.argv[2] ?? "");
assert(root.startsWith(path.resolve(".demo-data/issue92") + path.sep));
const live = JSON.parse(
  fs.readFileSync(path.join(root, "report.json"), "utf8"),
);
assert.equal(live.status, "PASS");
const model = getModel("opencode-go", "deepseek-v4.1-flash");
assert(model);
let attempted = 0;
// Deliberate no-model guard in this phase; never reported as a LIVE_MODEL call.
const app = await App.open(path.join(root, "core"), {
  model,
  stream: async () => {
    attempted++;
    throw Error("READ_ONLY_REACHED_MODEL");
  },
});
const server = await serveCore(app, 0, undefined, { pump: false });
fs.writeFileSync(
  path.join(root, "core", "core-endpoint.json"),
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
const terminal = new VirtualTerminal(80, 24),
  ui = new TerminalApp(
    path.join(root, "core"),
    terminal,
    path.join(root, "readonly-state"),
  );
async function until(check: () => boolean) {
  const end = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > end) throw Error("UI_TIMEOUT");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const retention = () =>
  app.store.all<Execution>("Execution").map((e) => ({
    id: e.id,
    retention_state: e.retention_state,
    last_activity_at: e.last_activity_at,
  }));
const report: any = {
  evidence: "REAL_CORE_READONLY",
  producer_run: path.basename(root),
  live_provider_executed_in_this_phase: false,
  production_pump: false,
};
try {
  const actual = live.cases.find((c: any) =>
    c.name.startsWith("L2 real missing-input"),
  );
  const readError = app.store
    .executionEvents(actual.evidence.execution_id)
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
  report.real_read_error_event_id = readError.id;
  ui.start();
  await until(() => !!ui.remote?.attention.head && ui.editors.Main.enabled);
  const before = {
    sequence: app.store.sequence,
    inputs: app.store.all("Input").length,
    model_calls: app.store.all("ModelCall").length,
    retention: retention(),
  };
  terminal.sendInput("\x1b[A");
  assert(ui.remote!.attention.row?.type === "failure");
  terminal.sendInput("\r");
  await until(() => ui.matters.current?.kind === "exception");
  terminal.sendInput("\t");
  terminal.sendInput("\x1b[13;2u");
  terminal.sendInput("/m ignored");
  terminal.sendInput("\x1b");
  assert(!ui.matters.current);
  terminal.sendInput("/t");
  terminal.sendInput("\x1b[13;2u");
  assert.equal(ui.page, "Task");
  terminal.sendInput("/m");
  terminal.sendInput("\x1b[13;2u");
  assert.equal(ui.page, "Main");
  await ui.remote!.attention.refresh();
  await ui.remote!.refresh();
  await ui.matters.refresh();
  const after = {
    sequence: app.store.sequence,
    inputs: app.store.all("Input").length,
    model_calls: app.store.all("ModelCall").length,
    retention: retention(),
  };
  assert.deepEqual(after, before);
  assert.equal(attempted, 0);
  report.status = "PASS";
  report.before = before;
  report.after = after;
  report.attempted_model_calls = attempted;
  console.log("L4 real-domain quiet read-only UI: PASS");
} catch (e) {
  report.status = "FAIL";
  report.error = String(e);
  process.exitCode = 1;
  console.error(String(e));
} finally {
  report.finished_at = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "readonly-report.json"),
    JSON.stringify(report, null, 2),
  );
  await ui.close();
  await server.close();
}
