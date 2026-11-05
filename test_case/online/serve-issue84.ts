/** Local operator service for the #84 combined acceptance, outside npm test. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
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
import {
  acceptanceAdapter,
  acceptanceModel as model,
  type RequestObservation,
} from "./issue84-model.ts";
import {
  freezeAcceptanceConfig,
  profile,
  requireEmptyDatabase,
  maintenancePending,
  acceptanceKey,
} from "./issue84-config.ts";
import { modelLifetime } from "../../src/pi_secretary/src/model-retry.ts";
import { checkedStream } from "./tool-budget.ts";
import { scriptedFixture, fixtureResponse } from "./issue84-fixture.ts";
import {
  MemoryRecoveryFixture,
  memoryRecoveryCheck,
} from "./issue84-memory-recovery.ts";
import {
  Issue84Budget,
  outputCap,
  wireBound,
  phases,
  type Phase,
  type Role,
} from "./issue84-budget.ts";

const [mode, option] = process.argv.slice(2);
assert(
  ["rehearsal", "dry", "calibration", "live"].includes(mode),
  "USE_REHEARSAL_DRY_CALIBRATION_OR_LIVE",
);
assert(option === undefined || option === "--resume", "UNRECOGNIZED_OPTION");
const paid = mode === "live";
const budgeted = paid || mode === "dry";
const resume = option === "--resume";
const base = fs.realpathSync(".demo-data/issue84");
assert.equal(
  base,
  path.resolve(".demo-data/issue84"),
  "UNSAFE_ACCEPTANCE_ROOT",
);
const run = process.env.ISSUE84_RUN ?? "";
assert(!run || /^[a-z0-9_]{1,24}$/.test(run), "INVALID_RUN_LABEL");
const runBase = run ? path.join(base, "runs", run) : base;
fs.mkdirSync(runBase, { recursive: true, mode: 0o700 });
const root = path.join(runBase, mode);
if (resume) assert.equal(fs.realpathSync(root), root, "UNSAFE_DOMAIN_ROOT");
const core = path.join(root, "core");
if (resume) assert.equal(fs.realpathSync(core), core, "UNSAFE_CORE_ROOT");
const write = (file: string, value: unknown) => {
  fs.writeFileSync(
    path.join(root, file + ".next"),
    JSON.stringify(value, null, 2) + "\n",
    { mode: 0o600 },
  );
  fs.renameSync(path.join(root, file + ".next"), path.join(root, file));
};
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
const head = git("rev-parse", "HEAD");
const source = git("rev-parse", "HEAD^{tree}");
const manifestPath = path.join(root, "manifest.json");
assert(
  !resume || fs.existsSync(manifestPath),
  "PARTIAL_FIRST_START_REQUIRES_NEW_RUN",
);
assert(
  resume || !fs.existsSync(root),
  "EXISTING_ROOT_REQUIRES_RESUME_OR_NEW_RUN",
);
const prior = resume ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
assert(!prior || prior.source === source, "CANDIDATE_TREE_CHANGED");
assert(
  !git("status", "--porcelain", "--untracked-files=no"),
  "TRACKED_WORKTREE_DIRTY",
);

const policy = paid ? "observe" : (process.env.ISSUE84_POLICY ?? "observe");
assert(policy === "observe" || policy === "bounded", "INVALID_POLICY");
const configIdentity = freezeAcceptanceConfig(policy);
if (paid) {
  const preflight = JSON.parse(
    fs.readFileSync(path.join(runBase, "preflight.json"), "utf8"),
  );
  assert.equal(preflight.source, source, "PREFLIGHT_WRONG_CANDIDATE");
  assert.equal(
    preflight.configHash,
    configIdentity.hash,
    "PREFLIGHT_WRONG_CONFIG",
  );
  assert.equal(preflight.status, "PASS", "PREFLIGHT_NOT_PASSED");
  assert(
    Array.isArray(preflight.evidence) && preflight.evidence.length >= 6,
    "PREFLIGHT_MISSING_EVIDENCE",
  );
  for (const evidence of preflight.evidence) {
    assert.equal(
      hash(fs.readFileSync(evidence.path)),
      evidence.sha256,
      "PREFLIGHT_EVIDENCE_CHANGED",
    );
  }
  assert(
    Date.now() - Date.parse(preflight.checkedAt) < 24 * 60 * 60 * 1000,
    "PREFLIGHT_EXPIRED",
  );
}
const key = paid ? acceptanceKey("DEEPSEEK_API_KEY") : "issue84-fixture";
delete process.env.DEEPSEEK_API_KEY;
delete process.env.OPENAI_API_KEY;
const database = "secretary84_" + (run ? run + "_" : "") + mode;
const dsn = "postgresql://secretary84@127.0.0.1:55484/" + database;
const freshness = resume ? prior.freshness : await requireEmptyDatabase(dsn);
if (!resume) fs.mkdirSync(root, { mode: 0o700 });
let app: App;
let budget: Issue84Budget;
let enabled = false;
let guardCalls = 0;
let active = 0;
let approvalScope: string | undefined;
const previousObservation = resume
  ? JSON.parse(fs.readFileSync(path.join(root, "observations.json"), "utf8"))
  : null;
const observedBounds = previousObservation?.observedBounds ?? {
  main: 0,
  task: 0,
};
const requests: RequestObservation[] = previousObservation?.requests ?? [];
let activePeak = previousObservation?.activePeak ?? 0;
let shutdownRefusals = 0;
let stopping = false;
let inject429 = 0;
let holdNext = false;
let forbiddenNext = false;
const memoryFixture = new MemoryRecoveryFixture();
const wireViolations: string[] = previousObservation?.wireViolations ?? [];
const operatorActions: object[] = previousObservation?.operatorActions ?? [];
if (budgeted) {
  const history =
    paid && !resume
      ? {
          path: process.env.ISSUE84_HISTORY!,
          sha256: process.env.ISSUE84_HISTORY_SHA256!,
        }
      : undefined;
  if (paid && !resume)
    assert(history?.path && history.sha256, "HISTORY_PROVENANCE_REQUIRED");
  budget = new Issue84Budget(
    path.join(root, "usage.json"),
    resume,
    policy,
    history,
  );
}
const config = (role: Role): ModelConfig =>
  acceptanceAdapter(role, {
    key,
    budget: budgeted ? budget : undefined,
    enabled: () => enabled,
    guard: () => {
      if (stopping) shutdownRefusals++;
      else guardCalls++;
    },
    active: (delta) => {
      active += delta;
      activePeak = Math.max(activePeak, active);
    },
    approvalScope: () => approvalScope,
    inputIds: () =>
      app.store
        .all<Input>("Input")
        .filter((i) => i.state === "CLAIMED")
        .map((i) => i.id),
    observe: (request) => {
      requests.push(request);
      observedBounds[role] = Math.max(observedBounds[role], request.input);
    },
    violation: (reason) => {
      wireViolations.push(reason);
    },
    scripted: paid
      ? undefined
      : async (body) => {
          const recovery = memoryFixture.respond(body);
          if (recovery) return recovery;
          if (holdNext) {
            holdNext = false;
            await new Promise((resolve) => setTimeout(resolve, 30_000));
          }
          await new Promise((resolve) =>
            setTimeout(resolve, role === "task" && mode === "dry" ? 600 : 40),
          );
          if (forbiddenNext) {
            forbiddenNext = false;
            return fixtureResponse("", [
              { name: "bash", args: { command: "must not execute" } },
            ]);
          }
          if (inject429) {
            inject429--;
            return new Response(
              JSON.stringify({
                error: {
                  message: "synthetic rate limit",
                  type: "rate_limit_error",
                },
              }),
              { status: 429, headers: { "content-type": "application/json" } },
            );
          }
          const redo =
            role === "main"
              ? app.store
                  .all<FailureHandling>("FailureHandling")
                  .find(
                    (f) =>
                      f.phase === "REQUESTED" &&
                      f.action === "REDO" &&
                      app.store.get<Input>("Input", f.input_id).state ===
                        "CLAIMED",
                  )
              : undefined;
          return scriptedFixture(
            role,
            body,
            approvalScope,
            redo?.execution_id
              ? {
                  failure_intent_id: redo.intent_id,
                  reuse_task_id: redo.task_id,
                  parent_execution_id: redo.execution_id,
                }
              : undefined,
            mode === "calibration",
          );
        },
  });
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
  await app.world!.migrate();
  if (!resume) {
    const before = tally();
    await app.settle();
    assert.deepEqual(tally(), before, "ISSUE84_GUARDED_START_CHANGED_WORK");
    assert.equal(guardCalls, 0, "ISSUE84_GUARDED_START_REACHED_MODEL");
    if (mode === "rehearsal") {
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
    policy,
    fingerprint,
    visionHash: hash(JSON.stringify(profile)),
    mode,
    profile,
    lock: hash(fs.readFileSync("package-lock.json")),
    node: process.version,
    tui: JSON.parse(
      fs.readFileSync(
        "node_modules/@earendil-works/pi-tui/package.json",
        "utf8",
      ),
    ).version,
    configHash: configIdentity.hash,
    config: configIdentity.manifest,
    freshness,
    starts: [
      ...(prior?.starts ?? []),
      {
        at: new Date().toISOString(),
        head,
        fingerprint,
        guardedCalls: guardCalls,
        resume,
      },
    ],
    core,
    database,
  });
} catch (error) {
  await app.close();
  throw error;
}
enabled = true;
if (!resume && policy === "observe" && ["dry", "calibration"].includes(mode)) {
  try {
    write("memory-recovery.json", {
      head,
      source,
      ...(await memoryRecoveryCheck(app, memoryFixture)),
    });
  } catch (error) {
    await app.close();
    throw error;
  }
}
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
const quiescent = () =>
  !app
    .activitySnapshot()
    .activities.some(
      (a) => a.scope === "maintenance" && a.status === "running",
    ) &&
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
const idle = () => quiescent() && !maintenancePending(app);
const sessionStates: string[] = previousObservation?.sessionStates ?? [];
const snapshot = () => {
  if (!sessionStates.includes(app.host.session.state))
    sessionStates.push(app.host.session.state);
  write("observations.json", {
    head,
    mode,
    ...tally(),
    observedBounds,
    guardCalls,
    policy,
    phase: budgeted ? budget.state.phase : mode,
    modelCallRecords: app.store.all("ModelCall"),
    requests,
    activePeak,
    shutdownRefusals,
    wireViolations,
    operatorActions,
    compactionJobs: app.store.all("CompactionJob"),
    extractionJobs: app.store.all("MemoryExtractionJob"),
    operations: app.store.all("Operation"),
    maintenancePending: maintenancePending(app),
    idle: idle(),
    quiescent: quiescent(),
    session: app.host.session.state,
    sessionStates,
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
      (policy === "observe" ? quiescent() : idle()) &&
      (!budgeted || budget.state.phase === "matters")
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
    if (
      verb === "next" &&
      budgeted &&
      (policy === "observe" ? quiescent() : idle()) &&
      phases.includes(phase as Phase)
    ) {
      operatorActions.push({
        action: "next",
        at: new Date().toISOString(),
        from: budget.state.phase,
        to: phase,
        maintenancePending: maintenancePending(app),
      });
      budget.advance(phase as Phase);
      return console.log("PHASE " + phase);
    }
    if (
      verb === "native-vision" &&
      budgeted &&
      (policy === "observe" ? quiescent() : idle())
    ) {
      budget.revisitNativeVision();
      operatorActions.push({
        action: "native-vision",
        at: new Date().toISOString(),
      });
      return console.log("NATIVE_VISION_READY");
    }
    if (
      verb === "release-reserve" &&
      budgeted &&
      active === 0 &&
      (app.host.session.state === "RECOVERY_BLOCKED" || quiescent())
    ) {
      budget.releaseReserve();
      operatorActions.push({
        action: "release-reserve",
        phase: budget.state.phase,
        at: new Date().toISOString(),
        simulated: mode === "dry",
      });
      return console.log("RESERVE RELEASED FOR " + budget.state.phase);
    }
    if (
      verb === "retry-maintenance" &&
      budgeted &&
      quiescent() &&
      (policy === "observe" || budget.state.release === budget.state.phase)
    ) {
      operatorActions.push({
        action: "session/compact",
        phase: budget.state.phase,
        at: new Date().toISOString(),
        simulated: mode === "dry",
      });
      void client
        .command("session/compact", { request_id: id() })
        .then(() => console.log("MAINTENANCE_RETRY_ACCEPTED"))
        .catch((error) => console.error(String(error)));
      return;
    }
    if (verb === "fault-tool" && mode === "dry" && active === 0) {
      forbiddenNext = true;
      return console.log("FAULT_TOOL_ARMED");
    }
    if (verb === "fault-429" && mode === "dry" && active === 0) {
      inject429 = phase === "2" ? 2 : 1;
      return console.log("FAULT_429_ARMED");
    }
    if (verb === "fault-hold" && mode === "dry" && active === 0) {
      holdNext = true;
      return console.log("FAULT_HOLD_ARMED");
    }
    console.error("COMMAND_REFUSED");
  } catch (error) {
    console.error(String(error));
  }
});
snapshot();
const timer = setInterval(
  snapshot,
  mode === "dry" || mode === "calibration" ? 100 : 1500,
);
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  input.close();
  enabled = false;
  stopping = true;
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
    root,
    vision: path.join(root, "vision.png"),
  }),
);
if (
  !resume &&
  mode === "rehearsal" &&
  process.env.ISSUE84_REHEARSAL_SMOKE === "1"
)
  await client.command("messages", {
    request_id: id(),
    text: "彩排探测，只回复一行。",
  });
