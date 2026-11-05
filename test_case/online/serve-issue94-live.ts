/** Explicit bounded paid/native acceptance. Not part of npm test. Keeps a manual instance alive. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../src/pi_secretary/src/core-client.ts";
import {
  roleModel,
  type ModelConfig,
  type StreamFn,
} from "../../src/pi_secretary/src/model.ts";
import { modelLifetime } from "../../src/pi_secretary/src/model-retry.ts";
import { imageLeaves } from "../../src/pi_secretary/src/vision.ts";
import { hash, id } from "../../src/pi_secretary/src/store.ts";
import type {
  TaskResult,
  Execution,
  Feedback,
  Input,
} from "../../src/pi_secretary/src/contracts.ts";
import { acceptanceStream, type LiveUsage } from "./acceptance-stream.ts";
import { configureLiveOutputBudget } from "./issue91-budget.ts";
import { checkedStream } from "./tool-budget.ts";
const root = path.resolve(
  process.argv[2] ?? `.demo-data/issue94/live-${Date.now()}`,
);
assert(root.startsWith(path.resolve(".demo-data/issue94") + path.sep));
assert(
  !fs.existsSync(root) || process.argv.includes("--resume"),
  "FRESH_DOMAIN_REQUIRED",
);
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
process.env.SECRETARY_MODE = "live";
const ledgerFile = path.resolve(".demo-data/issue94/provider-usage.json");
const usage: LiveUsage & {
  active_ms: number;
  images: any[];
  task_proposals: number;
} = fs.existsSync(ledgerFile)
  ? JSON.parse(fs.readFileSync(ledgerFile, "utf8"))
  : {
      main: 0,
      task: 0,
      tools: 0,
      calls: [],
      active_ms: 0,
      images: [],
      task_proposals: 0,
    };
const limits = {
  main: 48,
  task: 32,
  tools: 160,
  active_ms: 25 * 60 * 1000,
  output: 8192,
};
const retryThree = process.argv.includes("--retry-three");
if (retryThree)
  assert(
    process.argv.includes("--tasks") &&
      !process.argv.includes("--resume") &&
      usage.task_proposals === 3,
    "EXPECTED_FIRST_THREE_PROPOSALS",
  );
const proposalCap = process.argv.includes("--resume")
  ? usage.task_proposals
  : retryThree
    ? 6
    : 3;
const save = () =>
  fs.writeFileSync(ledgerFile, JSON.stringify(usage, null, 2), { mode: 0o600 });
process.env.SECRETARY_MAX_OUTPUT_TOKENS = String(limits.output);
configureLiveOutputBudget(limits.output);
const mainModel = getModel("openai", "gpt-6-astra"),
  taskModel = mainModel;
const profile = {
  version: 1,
  provider: mainModel.provider,
  api: mainModel.api,
  model: mainModel.id,
  baseUrl: mainModel.baseUrl,
  tokens_per_image: 5226,
  max_side: 4096,
  max_pixels: 4194304,
  source:
    "OpenAI vision (https://developers.openai.com/api/docs/guides/images-vision): 32px patches x 1.2. With <=4Mi pixels and sides <=4096, padded coverage is bounded by 4096+128+128+1 patches. Reserve 5226 tokens including rounding. Isolated acceptance only.",
};
process.env.SECRETARY_VISION_BUDGET_PROFILES = JSON.stringify([profile]);
const apiKey = process.env.OPENAI_API_KEY;
assert(apiKey, "OPENAI_API_KEY_REQUIRED_FOR_ISSUE94");
let app: App;
const configs = Object.fromEntries(
  (["main", "task"] as const).map((role) => {
    const model = role === "main" ? mainModel : taskModel,
      real = roleModel(model, apiKey, role);
    const accounted: StreamFn = async (m, c, o) => {
      if (usage.active_ms >= limits.active_ms)
        throw Error("LIVE_ACTIVE_TIME_CAP");
      const started = Date.now(),
        timer = setTimeout(
          () => modelLifetime(app.store).abort(Error("LIVE_ACTIVE_TIME_CAP")),
          limits.active_ms - usage.active_ms,
        );
      const tracked = checkedStream(real.stream, (response) => {
        usage.active_ms += Date.now() - started;
        clearTimeout(timer);
        if (role === "main") {
          const proposed = response.content.filter(
            (b) => b.type === "toolCall" && b.name === "task_propose",
          ).length;
          usage.task_proposals += proposed;
          save();
          // Three initial proposals and three explicitly authorized replacement tasks.
          if (usage.task_proposals > proposalCap)
            throw Error("ACCEPTANCE_TASK_PROPOSAL_CAP");
        }
        save();
      });
      try {
        return await tracked(m, c, {
          ...o,
          fetch: async (url, init) => {
            const destination = new URL(
              url instanceof Request ? url.url : String(url),
            );
            assert.equal(destination.origin, "https://api.openai.com");
            if (typeof init?.body === "string") {
              const payload = JSON.parse(init.body),
                images = imageLeaves(payload);
              if (images.length) {
                usage.images.push({
                  at: new Date().toISOString(),
                  model: m.id,
                  api: m.api,
                  baseUrl: m.baseUrl,
                  images: images.map(({ mime, sha256, bytes }) => ({
                    mime,
                    sha256,
                    bytes,
                  })),
                  input_ids: app.store
                    .all<Input>("Input")
                    .filter((i) => i.state === "CLAIMED")
                    .map((i) => i.id),
                });
                save();
              }
            }
            const http = await (o?.fetch ?? fetch)(url, { ...init, redirect: "error" });
            fs.appendFileSync(
              path.join(root, "provider-http.jsonl"),
              JSON.stringify({
                at: new Date().toISOString(),
                role,
                model: m.id,
                origin: destination.origin,
                path: destination.pathname,
                status: http.status,
              }) + "\n",
              { mode: 0o600 },
            );
            return http;
          },
        });
      } catch (e) {
        clearTimeout(timer);
        usage.active_ms += Date.now() - started;
        save();
        throw e;
      }
    };
    return [
      role,
      {
        model,
        stream: acceptanceStream(
          accounted,
          role,
          usage,
          { ...limits, cutoff: Infinity },
          save,
        ),
      },
    ];
  }),
) as Record<"main" | "task", ModelConfig>;
app = await App.open(path.join(root, "core"), configs);
const project = path.join(root, "中文 Project");
fs.mkdirSync(project, { recursive: true });
const scope =
  app.store
    .all<import("../../src/pi_secretary/src/contracts.ts").WorkScope>("Scope")
    .find((s) => s.name === "Issue94 directory acceptance") ??
  app.scheduler.scopes.save({
    kind: "DIRECTORY",
    name: "Issue94 directory acceptance",
    root_path: project,
    default_write: "allow",
  });
const server = await serveCore(app, 0),
  client = new CoreClient(server.endpoint);
fs.writeFileSync(
  path.join(root, "core", "core-endpoint.json"),
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
fs.writeFileSync(path.join(root, "server.pid"), String(process.pid));
const manifest = {
  root,
  core: path.join(root, "core"),
  endpoint: path.join(root, "core", "core-endpoint.json"),
  scope_id: scope.id,
  profile,
  limits,
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  source_hashes: Object.fromEntries(
    [
      "main-loop",
      "artifact-delivery",
      "artifact-path",
      "executor-tools",
      "execution-runner",
      "application-service",
      "tui/app",
      "tui/state",
      "tui/delivery",
      "tui/image-import",
      "tui/clipboard-read",
      "tui/open",
    ].map((n) => [n, hash(fs.readFileSync(`src/pi_secretary/src/${n}.ts`))]),
  ),
  models: [mainModel, taskModel].map((m) => ({
    id: m.id,
    api: m.api,
    baseUrl: m.baseUrl,
    input: m.input,
  })),
  started_at: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(root, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  { mode: 0o600 },
);
const reportFile = path.join(root, "observations.json");
const observe = () => {
  const results = app.store.all<TaskResult>("TaskResult");
  const observations = {
    at: new Date().toISOString(),
    session: app.host.session.state,
    executions: app.store.all<Execution>("Execution").map((e) => ({
      id: e.id,
      task_id: e.task_id,
      state: e.state,
      root: e.workspace_binding?.root_path,
      result_id: e.result_id,
    })),
    results: results.map((r) => ({
      id: r.id,
      task_id: r.task_id,
      execution_id: r.execution_id,
      outcome: r.outcome,
      summary: r.summary,
      artifacts: r.artifacts,
    })),
    inputs: app.store.all<Input>("Input").map((i) => ({
      id: i.id,
      request_id: i.dedupe_key,
      state: i.state,
      attachments: i.attachments?.map((a) => ({
        id: a.attachment_id,
        sha256: a.content.sha256,
      })),
    })),
    deliveries: app.store
      .events("main.delivery")
      .map((e) => app.store.read(e.payload)),
    messages: app.store
      .events("main.message")
      .map((e) => app.store.read<any>(e.payload))
      .filter((m) => m.role === "assistant")
      .map((m) => ({
        stopReason: m.stopReason,
        content: m.content.filter((b: any) => b.type === "text"),
      })),
  };
  fs.writeFileSync(reportFile, JSON.stringify(observations, null, 2), {
    mode: 0o600,
  });
};
const timer = setInterval(observe, 2000);
observe();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  modelLifetime(app.store).abort(Error("CORE_STOPPING"));
  observe();
  save();
  await server.close();
}
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => void stop());
console.log(
  JSON.stringify({
    status: "READY",
    root,
    core: manifest.core,
    scope_id: scope.id,
    limits,
  }),
);
if (process.argv.includes("--tasks")) {
  const prompt = `Create exactly three independent acceptance tasks now, then report results; never create replacement or extra tasks. Task A uses Shared (scope_id null), writes report.txt containing exactly ALPHA-19, writes 中文 目录/Report.txt containing exactly ALPHA-CHINESE-23, and writes intermediate.tmp containing scratch; register only the two .txt files with individually useful artifact_descriptions. Task B uses Shared (scope_id null), writes report.txt containing exactly BRAVO-27 and intermediate.tmp containing scratch; register only report.txt with its explanation. Task C uses DIRECTORY scope ${scope.id}, writes report.txt containing exactly CHARLIE-33; register only that file with its explanation. All tasks must use write/read/submit_result only, no shell, no background processes, no external files or network, stay inside their assigned workspace. Each task's acceptance criteria: exact specified content and registered deliverables; explain NOT_VERIFIED provenance. They are explicitly authorized new tasks for an isolated acceptance run. Do not ask questions or assign future dates. Do not manufacture other files. After completion, give a concise final reply for each received result.`;
  await client.command("messages", { request_id: id(), text: prompt });
  console.log("TASKS_REQUESTED");
}
