// Explicit bounded live acceptance; synthetic data and isolated Store only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { App } from "../../src/pi_secretary/src/app.ts";
import {
  modelConfig,
  fixtureModel,
  fixtureStream,
  type StreamFn,
} from "../../src/pi_secretary/src/model.ts";
import { getInstructions } from "../../src/pi_secretary/src/instructions.ts";
import { emptySettings } from "../../src/pi_secretary/src/settings-payload.ts";
import { id } from "../../src/pi_secretary/src/store.ts";
import type {
  SettingsApplication,
  Input,
} from "../../src/pi_secretary/src/contracts.ts";
const report = process.argv[2];
if (!report) throw Error("report path required");
const keys = JSON.parse(
  fs.readFileSync(
    process.env.SECRETARY_CREDENTIALS_FILE ??
      ".demo-data/live-credentials.json",
    "utf8",
  ),
);
process.env.SECRETARY_MODE = "live";
process.env.SECRETARY_MAIN_PROVIDER ??= "opencode-go";
process.env.SECRETARY_MAIN_MODEL ??= "deepseek-v4.1-flash";
process.env.SECRETARY_MAIN_API_KEY = keys.main;
const config = modelConfig("main"),
  started = Date.now(),
  deadline = AbortSignal.timeout(15 * 60 * 1000);
let calls = 0,
  pass = false,
  error: string | undefined;
const samples: unknown[] = [];
const save = () =>
  fs.writeFileSync(
    report,
    JSON.stringify(
      {
        pass,
        status: pass ? "complete" : error ? "failed" : "running",
        model: config.model.id,
        calls,
        budget: 12,
        elapsed_ms: Date.now() - started,
        samples,
        error,
      },
      null,
      2,
    ),
  );
const stream: StreamFn = async (m, c, o) => {
  if (calls >= 12 || deadline.aborted) throw Error("LIVE_BUDGET_EXCEEDED");
  calls++;
  save();
  const response = await config.stream(m, c, {
    ...o,
    signal: AbortSignal.any([deadline, ...(o?.signal ? [o.signal] : [])]),
  });
  // Consume no second stream; result() is the provider's completion promise.
  const result = await response.result();
  if (result.content.some((x) => x.type === "toolCall"))
    throw Error("LIVE_TOOL_CALL_FORBIDDEN");
  return response;
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-activity-live-"));
const app = await App.open(dir, {
  main: { model: config.model, stream },
  task: { model: fixtureModel, stream: fixtureStream },
});
let revision = -1;
const timer = setInterval(() => {
  const s = app.activitySnapshot();
  if (s.activity_revision === revision) return;
  revision = s.activity_revision;
  samples.push({
    at_ms: Date.now() - started,
    activities: s.activities.map((a) => ({
      kind: a.kind,
      phase: a.phase,
      status: a.status,
      progress: a.progress,
    })),
    queue: s.queue,
  });
  save();
}, 50);
try {
  save();
  app.host.accept(
    "合成显示验收：请只回复一句简短中文问候，不调用工具、不承诺后续行动。",
  );
  await app.host.drain();
  assert.equal(app.host.session.state, "IDLE");
  app.settings.save(
    {
      ...emptySettings(),
      instructions: {
        content: "请使用简洁中文。",
        expected_revision: getInstructions(app.store).revision,
      },
    },
    app.settings.draft().revision,
  );
  const a = app.settings.request(
    app.settings.draft().revision,
    id(),
  ) as SettingsApplication;
  const input = app.host.accept("合成排队验收：请只回复已收到。不要使用工具。");
  await app.settings.tick();
  assert.equal(
    app.store.get<SettingsApplication>("SettingsApplication", a.id).state,
    "APPLIED",
  );
  await app.host.drain();
  assert.equal(app.store.get<Input>("Input", input.id).state, "HANDLED");
  assert.equal(app.store.all("TaskPlan").length, 0);
  assert.equal(app.store.all("Operation").length, 0);
  assert(
    samples.some((s: any) =>
      s.activities.some(
        (a: any) => a.kind === "model" && a.status === "running",
      ),
    ),
  );
  assert(
    samples.some(
      (s: any) =>
        s.activities.some((a: any) => a.kind === "settings") &&
        s.queue.accepted === 1,
    ),
  );
  assert(
    !app.activitySnapshot().activities.some((a) => a.status === "running"),
  );
  pass = true;
} catch (e) {
  error = String(e).includes("BUDGET")
    ? "LIVE_BUDGET_EXCEEDED"
    : "LIVE_ASSERTION_OR_PROVIDER_FAILED";
  process.exitCode = 1;
} finally {
  clearInterval(timer);
  save();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(
    JSON.stringify({ pass, calls, error, elapsed_ms: Date.now() - started }),
  );
}
