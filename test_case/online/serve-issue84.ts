/** Local operator service for the #84 combined acceptance, outside npm test. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { getModel } from "@earendil-works/pi-ai/compat";
import sharp from "sharp";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../src/pi_secretary/src/core-client.ts";
import { id, hash } from "../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  FailureHandling,
  Input,
  TaskPlan,
} from "../../src/pi_secretary/src/contracts.ts";
import {
  roleModel,
  type ModelConfig,
  type StreamFn,
} from "../../src/pi_secretary/src/model.ts";
import { modelLifetime } from "../../src/pi_secretary/src/model-retry.ts";
import { checkedStream } from "./tool-budget.ts";
import { scriptedFixture } from "./issue84-fixture.ts";
import {
  Issue84Budget,
  outputCap,
  wireBound,
  phases,
  type Phase,
  type Role,
} from "./issue84-budget.ts";

const [mode, option] = process.argv.slice(2);
assert(mode === "rehearsal" || mode === "live", "USE_REHEARSAL_OR_LIVE");
assert(option === undefined || option === "--resume", "UNRECOGNIZED_OPTION");
const paid = mode === "live";
const resume = option === "--resume";
const base = fs.realpathSync(".demo-data/issue84");
assert.equal(
  base,
  path.resolve(".demo-data/issue84"),
  "UNSAFE_ACCEPTANCE_ROOT",
);
const root = path.join(base, mode);
if (resume) assert.equal(fs.realpathSync(root), root, "UNSAFE_DOMAIN_ROOT");
const core = path.join(root, "core");
if (resume) assert.equal(fs.realpathSync(core), core, "UNSAFE_CORE_ROOT");
const write = (file: string, value: unknown) =>
  fs.writeFileSync(
    path.join(root, file),
    JSON.stringify(value, null, 2) + "\n",
    { mode: 0o600 },
  );
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
const head = git("rev-parse", "HEAD");
const source = git("rev-parse", "HEAD^{tree}");
const manifestPath = path.join(root, "manifest.json");
const prior = resume ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
assert(!prior || prior.source === source, "CANDIDATE_TREE_CHANGED");
assert(
  !paid || !git("status", "--porcelain", "--untracked-files=no"),
  "TRACKED_WORKTREE_DIRTY",
);

if (paid) {
  const approval = JSON.parse(
    fs.readFileSync(path.join(base, "preflight.json"), "utf8"),
  );
  assert.equal(approval.source, source, "PREFLIGHT_WRONG_CANDIDATE");
  assert.equal(approval.status, "PASS", "PREFLIGHT_NOT_PASSED");
}
const key = paid ? process.env.DEEPSEEK_API_KEY : "issue84-fixture";
assert(key, "ISSUE84_DEEPSEEK_API_KEY_REQUIRED");
delete process.env.DEEPSEEK_API_KEY;
if (!resume) fs.mkdirSync(root, { mode: 0o700 });
const model = getModel("deepseek", "deepseek-flash");
const endpoint = "https://api.deepseek.com/chat/completions";
assert(
  model.api === "openai-completions" &&
    model.input.includes("image") &&
    new URL(model.baseUrl).origin === new URL(endpoint).origin,
  "UNEXPECTED_MODEL",
);
const profile = {
  version: 1,
  provider: model.provider,
  api: model.api,
  model: model.id,
  baseUrl: model.baseUrl,
  tokens_per_image: 1024,
  max_side: 2000,
  max_pixels: 4_000_000,
  source: "DeepSeek official vision guide, isolated issue #84 acceptance",
};
Object.assign(process.env, {
  SECRETARY_MODE: "live",
  SECRETARY_MAIN_CONTEXT_WINDOW: "90000",
  SECRETARY_MAIN_OUTPUT_TOKENS: String(outputCap),
  SECRETARY_TASK_OUTPUT_TOKENS: String(outputCap),
  SECRETARY_MAX_OUTPUT_TOKENS: String(outputCap),
  SECRETARY_VISION_BUDGET_PROFILES: JSON.stringify([profile]),
});
const dsn = "postgresql://secretary84@127.0.0.1:55484/secretary84_" + mode;
let app: App;
let budget: Issue84Budget;
let enabled = false;
let guardCalls = 0;
let active = 0;
let approvalScope: string | undefined;
const observedBounds = { main: 0, task: 0 };
const config = (role: Role): ModelConfig => {
  const real = roleModel(model, key, role);
  const stream: StreamFn = (m, c, opts) => {
    if (!enabled) {
      guardCalls++;
      throw Error("BUDGET_ISSUE84_GUARDED_START");
    }
    let attempt: ReturnType<Issue84Budget["admit"]> | undefined;
    const verified = checkedStream(real.stream, (response) => {
      if (!attempt || ["error", "aborted"].includes(response.stopReason))
        return;
      const { input, cacheRead, cacheWrite, output } = response.usage;
      budget.finish(
        attempt,
        Date.now(),
        response.responseId ?? "",
        input + cacheRead + cacheWrite,
        output,
      );
      for (const part of response.content) {
        if (part.type !== "toolCall" || part.name !== "task_propose") continue;
        const args = part.arguments;
        assert(
          !args.program_id &&
            !args.at &&
            !args.interval_seconds &&
            (!args.materials ||
              (Array.isArray(args.materials) && args.materials.length === 0)) &&
            (!args.scope_id || args.scope_id === approvalScope),
          "BUDGET_ISSUE84_TASK_SCOPE",
        );
      }
      budget.tools(
        role,
        response.content
          .filter((part) => part.type === "toolCall")
          .map((part) => part.name),
        attempt,
      );
    });
    const run = verified(m, c, {
      ...opts,
      fetch: async (url, init) => {
        assert.equal(
          url instanceof Request ? url.url : String(url),
          endpoint,
          "BUDGET_ISSUE84_DESTINATION",
        );
        assert(
          typeof init?.body === "string",
          "BUDGET_ISSUE84_UNINSPECTABLE_BODY",
        );
        const wire = wireBound(init.body);
        observedBounds[role] = Math.max(observedBounds[role], wire.input);
        if (!paid) {
          assert(wire.input <= 80_000, "ISSUE84_REHEARSAL_WIRE_HEADROOM");
          const redo =
            role === "main"
              ? app.store
                  .all<FailureHandling>("FailureHandling")
                  .find(
                    (item) =>
                      item.phase === "REQUESTED" &&
                      item.action === "REDO" &&
                      app.store.get<Input>("Input", item.input_id).state ===
                        "CLAIMED",
                  )
              : undefined;
          return scriptedFixture(
            role,
            init.body,
            approvalScope,
            redo?.execution_id
              ? {
                  failure_intent_id: redo.intent_id,
                  reuse_task_id: redo.task_id,
                  parent_execution_id: redo.execution_id,
                }
              : undefined,
          );
        }
        assert(!attempt, "BUDGET_ISSUE84_MULTIPLE_FETCHES");
        attempt = budget.admit(
          role,
          wire,
          app.store
            .all<Input>("Input")
            .filter((item) => item.state === "CLAIMED")
            .map((item) => item.id),
        );
        const response = await fetch(url, { ...init, redirect: "error" });
        attempt.http = response.status;
        attempt.requestId = response.headers.get("x-request-id") ?? undefined;
        budget.save();
        return response;
      },
    });
    if (!paid) return run;
    active++;
    return Promise.resolve(run).then(
      (events) => {
        void events
          .result()
          .finally(() => {
            active--;
          })
          .catch(() => {});
        return events;
      },
      (error) => {
        active--;
        throw error;
      },
    );
  };
  return { model, stream };
};
app = await App.open(core, { main: config("main"), task: config("task") }, dsn);
const fingerprint = app.settings.runtimeHash;
const tally = () => ({
  inputs: app.store.all("Input").length,
  executions: app.store.all("Execution").length,
  modelCalls: app.store.all("ModelCall").length,
  deliveries: app.store.events("main.delivery").length,
});
try {
  assert(
    !app.settings.blocked &&
      (!prior ||
        (prior.fingerprint === fingerprint &&
          prior.visionHash === hash(JSON.stringify(profile)))),
    "ISSUE84_RUNTIME_FINGERPRINT_CHANGED",
  );
  if (paid) budget = new Issue84Budget(path.join(root, "usage.json"), resume);
  await app.world!.migrate();
  if (!resume) {
    const before = tally();
    await app.settle();
    assert.deepEqual(tally(), before, "ISSUE84_GUARDED_START_CHANGED_WORK");
    assert.equal(guardCalls, 0, "ISSUE84_GUARDED_START_REACHED_MODEL");
    if (!paid) {
      const scope = {
        session_id: app.host.sessionID,
        task_id: null,
        execution_id: null,
      };
      const events = Array.from({ length: 216 }, (_, i) =>
        app.store.event(
          "main.message",
          {
            role: "assistant",
            stopReason: "stop",
            content: [
              {
                type: "text",
                text: `彩排历史 ${String(i + 1).padStart(3, "0")} · **Markdown**`,
              },
            ],
          },
          scope,
        ),
      );
      app.store.commit([], events);
      write("seed.json", {
        kind: "SYNTHETIC_HISTORY",
        first: events[0].event_id,
        last: events.at(-1)?.event_id,
        count: events.length,
      });
    }
    const marker = randomBytes(5).toString("hex").toUpperCase();
    await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="760" height="200">
      <rect width="760" height="200" fill="white"/><text x="40" y="130" font-size="78"
      font-family="monospace" fill="black">${marker}</text></svg>`),
    )
      .png()
      .toFile(path.join(root, "vision.png"));
    write("vision-oracle.json", {
      marker,
      sha256: hash(fs.readFileSync(path.join(root, "vision.png"))),
    });
  }
  write("manifest.json", {
    head,
    source,
    fingerprint,
    visionHash: hash(JSON.stringify(profile)),
    mode,
    profile,
    lock: hash(fs.readFileSync("package-lock.json")),
    node: process.version,
    tui: "0.87.0",
    core,
    database: "secretary84_" + mode,
  });
} catch (error) {
  await app.close();
  throw error;
}
enabled = true;
const server = await serveCore(app, 0, () => {
  void stop();
});
write("service.json", { pid: process.pid });
fs.writeFileSync(
  path.join(core, "core-endpoint.json"),
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
const client = new CoreClient(server.endpoint);
const scopeFile = path.join(root, "approval-scope.json");
if (fs.existsSync(scopeFile))
  approvalScope = JSON.parse(fs.readFileSync(scopeFile, "utf8")).id;
const idle = () =>
  !app.activitySnapshot().activities.some((a) => a.scope === "maintenance") &&
  active === 0 &&
  !app.settings.blocked &&
  !app.host.session.active_loop_id &&
  !app.store
    .all<Input>("Input")
    .some((item) => ["ACCEPTED", "CLAIMED"].includes(item.state)) &&
  !app.store
    .all<Execution>("Execution")
    .some(
      (item) =>
        ![
          "SUCCEEDED",
          "FAILED",
          "CANCELLED",
          "EXPIRED",
          "RESULT_UNKNOWN",
        ].includes(item.state),
    ) &&
  !app.store
    .all<TaskPlan>("TaskPlan")
    .some((item) => item.pending_requests?.length);
const snapshot = () => {
  write("observations.json", {
    head,
    mode,
    ...tally(),
    observedBounds,
    guardCalls,
    phase: paid ? budget.state.phase : "rehearsal",
    idle: idle(),
    session: app.host.session.state,
    inputs: app.store.all<Input>("Input"),
    executions: app.store.all("Execution"),
    results: app.store.all("TaskResult"),
    decisions: app.store.all("DecisionRequest"),
    authorizations: app.store.all("AuthorizationRequest"),
    failures: app.store.all("FailureHandling"),
    deliveries: app.store.events("main.delivery"),
    messages: app.store.events("main.message"),
  });
};
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  try {
    const [verb, phase] = line.trim().split(/\s+/);
    if (verb === "status")
      return console.log(
        JSON.stringify({ idle: idle(), ...tally(), observedBounds }),
      );
    if (
      verb === "approval-scope" &&
      idle() &&
      (!paid || budget.state.phase === "matters")
    ) {
      const directory = path.join(root, "approval");
      fs.mkdirSync(directory, { mode: 0o700, recursive: true });
      approvalScope = app.scheduler.scopes.save({
        kind: "DIRECTORY",
        name: "Issue84 disposable approval",
        root_path: directory,
        default_write: "ask",
      }).id;
      write("approval-scope.json", { id: approvalScope, directory });
      return console.log("APPROVAL_SCOPE " + approvalScope);
    }
    if (verb === "next" && paid && idle() && phases.includes(phase as Phase)) {
      budget.advance(phase as Phase);
      return console.log("PHASE " + phase);
    }
    if (
      verb === "release-reserve" &&
      paid &&
      active === 0 &&
      app.host.session.state === "RECOVERY_BLOCKED"
    ) {
      budget.releaseReserve();
      return console.log("RESERVE RELEASED FOR " + budget.state.phase);
    }
    console.error("COMMAND_REFUSED");
  } catch (error) {
    console.error(String(error));
  }
});
snapshot();
const timer = setInterval(snapshot, 1500);
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  input.close();
  enabled = false;
  modelLifetime(app.store).abort(Error("CORE_STOPPING"));
  snapshot();
  await server.close();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void stop();
  });
console.log(
  JSON.stringify({
    ready: true,
    core,
    head,
    mode,
    vision: path.join(root, "vision.png"),
  }),
);
if (!resume && !paid && process.env.ISSUE84_REHEARSAL_SMOKE === "1")
  await client.command("messages", {
    request_id: id(),
    text: "彩排探测，只回复一行。",
  });
