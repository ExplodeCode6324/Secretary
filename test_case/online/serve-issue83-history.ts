/** Read-only terminal acceptance against recorded real-provider #83 data. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import { configureLiveOutputBudget } from "./issue91-budget.ts";
const root = path.resolve(process.argv[2] ?? "");
assert(root.startsWith(path.resolve(".demo-data/issue83") + path.sep));
const report = JSON.parse(
  fs.readFileSync(path.join(root, "report.json"), "utf8"),
);
assert.equal(report.status, "PASS");
process.env.SECRETARY_MAX_OUTPUT_TOKENS = String(report.limits.output_tokens);
configureLiveOutputBudget(report.limits.output_tokens);
const model = getModel(report.provider, report.model);
assert(model);
let forbiddenCalls = 0;
const config = {
  model,
  stream: () => {
    forbiddenCalls++;
    throw Error("READ_ONLY_HISTORY_ACCEPTANCE");
  },
};
const app = await App.open(path.join(root, "core"), {
  main: config,
  task: config,
});
const server = await serveCore(app, 0, undefined, { pump: false });
fs.writeFileSync(
  path.join(root, "core", "core-endpoint.json"),
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
const sequence = app.store.sequence,
  started_at = new Date().toISOString();
const snapshot = () =>
  fs.writeFileSync(
    path.join(root, "native-read-only.json"),
    JSON.stringify(
      {
        started_at,
        observed_at: new Date().toISOString(),
        sequence_before: sequence,
        sequence_now: app.store.sequence,
        forbidden_model_calls: forbiddenCalls,
        mode: "real-provider recorded data; scheduler pump disabled; model calls prohibited",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
snapshot();
const timer = setInterval(snapshot, 1000);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    snapshot();
    void server.close().then(() => process.exit(0));
  });
console.log("READ_ONLY_HISTORY_READY");
