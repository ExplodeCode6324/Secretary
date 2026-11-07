import { TerminalApp } from "../../src/pi_secretary/src/tui/app.ts";
/** Isolated acceptance only. Product Core, model adapters and TerminalApp are unchanged. */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
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
import { id, hash, revise } from "../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  TaskPlan,
  TaskResult,
  ModelCall,
  Input,
  AuthorizationRule,
  Operation,
} from "../../src/pi_secretary/src/contracts.ts";
import type { AuthorizationRequest } from "../../src/pi_secretary/src/contracts.ts";
import { LocalFiles } from "../../src/pi_secretary/src/tui/state.ts";
import { GuidanceDelivery } from "../../src/pi_secretary/src/tui/guidance-delivery.ts";
import { DraftEditor } from "../../src/pi_secretary/src/tui/input.ts";
import { parseGuide } from "../../src/pi_secretary/src/tui/guide-command.ts";
import { VirtualTerminal } from "../../src/pi_resource/packages/tui/test/virtual-terminal.ts";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { AcceptanceBudget } from "./issue106-budget.ts";
import { checkedStream } from "./tool-budget.ts";
const root = path.resolve(process.argv[2]);
assert(
  root === path.resolve(".demo-data/issue106/acceptance"),
  "ISOLATED_ROOT_REQUIRED",
);
const config = JSON.parse(
  fs.readFileSync(path.join(root, "config.json"), "utf8"),
);
assert(
  config.root === root && config.dsn.includes("issue106_acceptance"),
  "ISOLATED_DATABASE_REQUIRED",
);
const owner = new LocalFiles(path.join(root, "owner"));
await owner.open("issue106_acceptance", "live");
const budget = new AcceptanceBudget(path.join(root, "budget.json"));
const credential = "/Users/muy/Desktop/Codex_Work/secretary-core/.env.local";
const st = fs.lstatSync(credential);
assert(
  st.isFile() &&
    !st.isSymbolicLink() &&
    st.uid === process.getuid?.() &&
    !(st.mode & 0o077),
  "UNSAFE_CREDENTIAL_FILE",
);
const key = parseEnv(fs.readFileSync(credential, "utf8")).DEEPSEEK_API_KEY;
assert(typeof key === "string" && key.trim(), "DEEPSEEK_API_KEY_REQUIRED");
const model = getModel("deepseek", "deepseek-flash");
process.env.SECRETARY_MODE = "live";
process.env.SECRETARY_DATA = path.join(root, "core");
let app: App,
  inflight = 0,
  closing = false,
  pumpEnabled = budget.value.phase === "ACTIVE",
  pumpJob: Promise<void> | undefined;
let onPhysical: ((role: string) => Promise<void>) | undefined;
const evidence = path.join(root, "provider.jsonl");
const record = (v: unknown) =>
  fs.appendFileSync(evidence, JSON.stringify(v) + "\n", { mode: 0o600 });
const configs = Object.fromEntries(
  (["main", "task"] as const).map((role) => {
    const adapter = roleModel(model, key, role);
    const stream: StreamFn = async (m, c, o) => {
      budget.admit();
      inflight++;
      let finished = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          inflight--;
        }
      };
      try {
        const output = await checkedStream(adapter.stream, (response) => {
          try {
            budget.proposals(
              response.content.filter((p) => p.type === "toolCall").length,
            );
            record({
              at: new Date().toISOString(),
              role,
              kind: "response",
              stop: response.stopReason,
              tools: response.content
                .filter((p) => p.type === "toolCall")
                .map((p) => p.name),
            });
          } finally {
            finish();
          }
        })(m, c, {
          ...o,
          fetch: async (url, init) => {
            const destination = new URL(
              url instanceof Request ? url.url : String(url),
            );
            assert.equal(destination.origin, "https://api.deepseek.com");
            budget.attempt(role);
            record({
              at: new Date().toISOString(),
              kind: "request",
              role,
              ordinal: budget.value.physical,
              body_hash:
                typeof init?.body === "string" ? hash(init.body) : null,
            });
            const pending = fetch(url, { ...init, redirect: "error" });
            void pending.catch(() => {});
            await onPhysical?.(role);
            const response = await pending;
            record({
              at: new Date().toISOString(),
              kind: "http",
              role,
              status: response.status,
            });
            return response;
          },
        });
        void output.result().then(finish, finish);
        return output;
      } catch (e) {
        finish();
        throw e;
      }
    };
    return [role, { model, stream }];
  }),
) as Record<"main" | "task", ModelConfig>;
app = await App.open(path.join(root, "core"), configs, config.dsn);
const server = await serveCore(app, 0, () => void shutdown(), { pump: false });
const client = new CoreClient(server.endpoint);
const endpointFile = path.join(root, "core", "core-endpoint.json");
fs.writeFileSync(endpointFile, JSON.stringify(server.endpoint), {
  mode: 0o600,
});
const controlToken = randomBytes(32).toString("hex");
const socket = path.join(root, "control.sock");
if (fs.existsSync(socket)) fs.unlinkSync(socket); // Exclusive owner lock is already held.
let scenario:
  | {
      task: string;
      execution: string;
      scope: string;
      title: string;
      round: number;
      authorization: string;
      project: string;
    }
  | undefined;
const scenarioFile = path.join(root, "scenario.json");
if (fs.existsSync(scenarioFile))
  scenario = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, timeout = 180000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= end) throw Error("ACCEPTANCE_WAIT_TIMEOUT");
    await sleep(100);
  }
}
const auths = () => app.store.all<AuthorizationRequest>("AuthorizationRequest");
const ready = () => {
  if (!budget.value.manual_started_at) {
    budget.requireReserve();
    assert(inflight === 0, "MODEL_WORK_IN_FLIGHT");
    const masterRoot = path.join(root, "master-state");
    for (const name of fs.readdirSync(masterRoot, { recursive: true })) {
      const filename = path.join(masterRoot, String(name));
      const st = fs.lstatSync(filename);
      assert(!st.isSymbolicLink(), "UNSAFE_MASTER_DRAFT_ROOT");
      if (path.basename(filename) !== "state.json") continue;
      const local = JSON.parse(fs.readFileSync(filename, "utf8"));
      assert(
        !local.pending &&
          !local.guidancePending &&
          !local.recovery &&
          !local.guidanceRecovery &&
          Object.values(local.drafts).every(
            (d: any) => !d.raw && !d.materials?.length,
          ),
        "MASTER_DRAFT_ROOT_NOT_EMPTY",
      );
    }
  }
  assert(scenario, "NO_PREPARED_SCENARIO");
  const e = app.store.get<Execution>("Execution", scenario.execution),
    a = app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      scenario.authorization,
    );
  assert(
    e.state === "WAIT_AUTH" &&
      a.state === "PENDING" &&
      (!a.expires_at || Date.parse(a.expires_at) > Date.now()),
    "SCENARIO_NOT_READY_RUN_PREPARE_TASK",
  );
  assert(
    app.world?.memorySearch.status().status === "ready",
    "WORLD_NOT_READY",
  );
  assert(
    !budget.value.refusals.some((r) => r.phase === "ARMED_FOR_MASTER"),
    "UNEXPECTED_ARMED_MODEL_ACTIVITY",
  );
  assert(
    app.host.session.state !== "RECOVERY_BLOCKED",
    "MAIN_RECOVERY_REQUIRED",
  );
};
function status() {
  let readiness = "READY";
  try {
    ready();
  } catch (e) {
    readiness = (e as Error).message;
  }
  return {
    running: !closing,
    readiness,
    phase: budget.value.phase,
    pid: process.pid,
    instance_id: server.endpoint.instance_id,
    data_domain_id: server.endpoint.data_domain_id,
    endpoint: server.endpoint.url,
    candidate: config.sha,
    models: { main: model.id, task: model.id },
    root,
    world: app.world?.memorySearch.status(),
    inflight,
    pumpEnabled,
    budget: budget.value,
    remaining: budget.remaining(),
    manual_deadline_hkt: budget.value.manual_deadline
      ? new Date(budget.value.manual_deadline).toLocaleString("en-GB", {
          timeZone: "Asia/Hong_Kong",
        })
      : "NOT STARTED: first Master connect starts two hours; Mac sleep counts",
    scenario,
    guide: scenario
      ? `/guide ${JSON.stringify(scenario.title)} ${scenario.round} 改为只读取 first.txt，不再写文件。最终报告包含 GUIDE106_MASTER；先通过 guidance_receipt 明确处理本次引导。`
      : null,
  };
}
async function drain() {
  pumpEnabled = false;
  await pumpJob;
  await app.scheduler.idle();
  await app.host.drain();
  await until(() => inflight === 0);
  await app.world?.memorySearch.catchUp();
}
async function prepare() {
  budget.prepare();
  pumpEnabled = false;
  assert(!inflight, "MODEL_BUSY");
  const project = path.join(root, "projects", id());
  fs.mkdirSync(project, { recursive: true, mode: 0o700 });
  // Fresh exact root cannot inherit a prior scope's remembered authorization.
  assert(
    !app.store
      .all<AuthorizationRule>("AuthorizationRule")
      .some(
        (r) =>
          r.state === "ENABLED" &&
          r.resource_prefixes.some((prefix) => project.startsWith(prefix)),
      ),
    "REMEMBERED_RULE_MATCH",
  );
  fs.writeFileSync(
    path.join(project, "first.txt"),
    "The orchard contains seven apple trees.\n",
  );
  fs.writeFileSync(
    path.join(project, "second.txt"),
    "The warehouse contains eleven crates.\n",
  );
  const scope = app.scheduler.scopes.save({
    kind: "DIRECTORY",
    name: "Issue106 Master acceptance " + id().slice(0, 8),
    root_path: project,
    default_write: "ask",
  });
  const p = app.scheduler.propose(
    "Read first.txt, then request a write of draft.txt containing a factual draft. Use the write tool, not bash. Wait for Master authorization before any write. After approval finish with a factual saved report. Master may refine the permitted source and no-write requirements during the authorization hold; honor the latest guidance and record guidance_receipt. Do not ask Main to approve.",
    id(),
    app.host.sessionID,
    {
      scopeID: scope.id,
      title_candidate: "引导验收 等待授权",
      acceptance: [
        "Report factual evidence from the source subset allowed by the latest Master instruction.",
      ],
    },
  );
  app.scheduler.tick();
  await app.scheduler.idle();
  const e = app.store
    .all<Execution>("Execution")
    .find((e) => e.task_id === p.id)!;
  const a = auths().find(
    (a) =>
      a.state === "PENDING" &&
      app.store.get<Operation>("Operation", a.operation_id).scope
        .execution_id === e.id,
  );
  assert(e.state === "WAIT_AUTH" && a, "REAL_WAIT_AUTH_REQUIRED");
  scenario = {
    task: p.id,
    execution: e.id,
    scope: scope.id,
    title: p.title!,
    round: e.execution_round!,
    authorization: a.id,
    project,
  };
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario, null, 2), {
    mode: 0o600,
  });
  await drain();
  if (!budget.value.manual_started_at) budget.arm();
  else pumpEnabled = true;
  ready();
  return status();
}
async function rehearse() {
  assert(budget.value.phase === "PREPARING", "REHEARSAL_PREPARATION_ONLY");
  pumpEnabled = false;
  const startUsage = structuredClone(budget.value);
  await client.command("messages", {
    request_id: id(),
    text: "This is an isolated acceptance health check. Reply briefly with exactly MAIN106_READY. Do not create tasks, schedules, or make changes.",
  });
  await app.host.drain();
  assert(budget.value.roles.main > 0, "REAL_MAIN_NOT_CALLED");
  const reports = [];
  for (const unavailable of [false, true]) {
    if (unavailable)
      app.store.commit([
        revise(app.host.session, {
          state: "RECOVERY_BLOCKED",
          recovery_error: "isolated acceptance Main unavailable",
        }),
      ]);
    const p = app.scheduler.propose(
      "Read first.txt then second.txt and report their facts. Master may refine the allowed source subset while you run. Do not write or use bash. Record guidance_receipt and submit_result with a factual summary.",
      id(),
      app.host.sessionID,
      {
        title_candidate: unavailable ? "真实模型 Main离线" : "真实模型 运行中",
        acceptance: [
          "Report facts from the source subset allowed by the latest Master guidance.",
        ],
        preconditions: [
          {
            condition_id: id(),
            kind: "RESOURCE_PRESENT",
            target: "gate",
            required_revision: null,
          },
        ],
      },
    );
    app.scheduler.tick();
    await app.scheduler.idle();
    const e = app.store
      .all<Execution>("Execution")
      .find((e) => e.task_id === p.id)!;
    const workspace = app.scheduler.rootFor(e);
    fs.writeFileSync(
      path.join(workspace, "first.txt"),
      "The orchard contains seven apple trees.\n",
    );
    fs.writeFileSync(
      path.join(workspace, "second.txt"),
      "The warehouse contains eleven crates.\n",
    );
    const local = new LocalFiles(path.join(root, "rehearsal-state", e.id));
    const core = await client.core();
    const state = await local.open(core.data_domain_id, core.mode);
    const delivery = new GuidanceDelivery(state, local);
    const frozen = {
      endpoint: client.endpoint,
      core: client.core.bind(client),
      query: client.query.bind(client),
      changes: client.changes.bind(client),
      syncCursor: client.syncCursor.bind(client),
      command: async (
        route: string,
        body: { request_id: string; [key: string]: unknown },
      ) => {
        await client.command(route, body);
        throw Error("CONTROLLED_RESPONSE_LOSS_AFTER_REAL_ACCEPTANCE");
      },
    };
    await delivery.connect(frozen);
    const editor = new DraftEditor(
      new TuiAltScreen(new VirtualTerminal()),
      () => "Task",
    );
    const raw = `/guide ${JSON.stringify(p.title)} ${e.execution_round} Read only first.txt; do not read second.txt and do not write. Include GUIDE106_LIVE in the final summary. Explicitly process this instruction with guidance_receipt before successful completion.`;
    editor.handleInput(raw);
    state.drafts.Task = { raw, snapshot: editor.snapshot(), generation: 1 };
    let sent = false;
    onPhysical = async (role) => {
      if (role === "task" && !sent) {
        sent = true;
        await delivery.submit(raw, editor.snapshot(), parseGuide(raw)!);
      }
    };
    fs.writeFileSync(path.join(workspace, "gate"), "ready");
    app.scheduler.ready(e.id);
    await app.scheduler.run(e.id);
    onPhysical = undefined;
    delivery.close();
    await local.close();
    const restored = await local.open(core.data_domain_id, core.mode),
      resumed = new GuidanceDelivery(restored, local);
    await resumed.connect(client);
    await resumed.reconcile();
    const g = restored.guidanceLast?.guidance;
    assert(g?.guided_at && g.received_at, "REAL_GUIDANCE_NOT_GUIDED");
    assert.equal(g.disposition, "ADOPTED");
    const end = app.store.get<Execution>("Execution", e.id),
      result = end.result_id
        ? app.store.get<TaskResult>("TaskResult", end.result_id)
        : null;
    assert.equal(end.state, "SUCCEEDED");
    assert(
      result?.summary.includes("GUIDE106_LIVE"),
      "REAL_BEHAVIOR_MARKER_MISSING",
    );
    assert.equal(
      app.store.all<Input>("Input").filter((i) => i.guidance_id === g.id)
        .length,
      1,
    );
    reports.push({
      unavailable,
      task: p.id,
      execution: e.id,
      guidance: g,
      result,
      request: restored.guidanceLast?.id,
      physical: budget.value.physical,
      calls: app.store
        .all<ModelCall>("ModelCall")
        .filter((c) => c.scope.execution_id === e.id)
        .map((c) => ({
          id: c.id,
          state: c.state,
          request: c.request.sha256,
          response: c.response?.sha256,
        })),
    });
    resumed.close();
    await local.close();
    if (unavailable)
      app.store.commit([
        revise(app.host.session, { state: "IDLE", recovery_error: null }),
      ]);
  }
  await drain();
  const report = {
    at: new Date().toISOString(),
    startUsage,
    endUsage: budget.value,
    reports,
    native: "NOT_TESTED",
    master: "PENDING",
  };
  fs.writeFileSync(
    path.join(root, "rehearsal.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  return report;
}
async function tuiRehearse() {
  assert(budget.value.phase === "PREPARING", "REHEARSAL_PREPARATION_ONLY");
  pumpEnabled = false;
  const terminal = new VirtualTerminal(110, 32);
  const ui = new TerminalApp(
    path.join(root, "core"),
    terminal,
    path.join(root, "rehearsal-state", "product-tui"),
  );
  ui.start();
  try {
    await until(
      () => !!ui.guidance?.client && !!ui.remote?.attention.head,
      10000,
    );
    const p = app.scheduler.propose(
      "Read first.txt then second.txt and report the facts. Master may refine source permissions while running. Do not use bash or write tools. Record guidance_receipt and finish with submit_result.",
      id(),
      app.host.sessionID,
      {
        title_candidate: "真实 TUI 流式引导",
        acceptance: [
          "Report evidence from the latest permitted source subset.",
        ],
        preconditions: [
          {
            condition_id: id(),
            kind: "RESOURCE_PRESENT",
            target: "gate",
            required_revision: null,
          },
        ],
      },
    );
    app.scheduler.tick();
    await app.scheduler.idle();
    const e = app.store
      .all<Execution>("Execution")
      .find((e) => e.task_id === p.id)!;
    const work = app.scheduler.rootFor(e);
    fs.writeFileSync(
      path.join(work, "first.txt"),
      "Permitted orchard evidence: seven apple trees.\n",
    );
    fs.writeFileSync(
      path.join(work, "second.txt"),
      "Excluded warehouse evidence: eleven crates.\n",
    );
    terminal.sendInput("/t");
    terminal.sendInput("\x1b[13;2u");
    terminal.sendInput("/taskdetail " + JSON.stringify(p.title));
    terminal.sendInput("\x1b[13;2u");
    await until(() => ui.remote?.taskBrowser.selected === p.id);
    terminal.sendInput("/follow " + e.id);
    terminal.sendInput("\x1b[13;2u");
    let sent = false;
    const observations: unknown[] = [];
    onPhysical = async (role) => {
      if (role !== "task" || sent) return;
      sent = true;
      terminal.sendInput(
        `/guide ${JSON.stringify(p.title)} ${e.execution_round} `,
      );
      terminal.sendInput(
        "\x1b[200~Read only first.txt. Do not read second.txt and do not write.\nInclude GUIDE106_TUI in the final factual summary; acknowledge with guidance_receipt.  \x1b[201~",
      );
      terminal.sendInput("\x1b[13;2u");
      await until(() => ui.delivery?.state.guidanceLast?.status === "ACCEPTED");
      observations.push({
        at: Date.now(),
        phase: "accepted_during_real_request",
        execution: app.store.get<Execution>("Execution", e.id).state,
        request: ui.delivery!.state.guidanceLast!.id,
      });
    };
    const samples = setInterval(() => {
      if (
        ui.remote?.taskBrowser
          .entries()
          .some((entry) => entry.id.includes(e.id))
      )
        observations.push({
          at: Date.now(),
          state: app.store.get<Execution>("Execution", e.id).state,
          viewport: terminal.getViewport().join("\n"),
        });
    }, 400);
    try {
      fs.writeFileSync(path.join(work, "gate"), "ready");
      app.scheduler.ready(e.id);
      await app.scheduler.run(e.id);
    } finally {
      clearInterval(samples);
      onPhysical = undefined;
    }
    await ui.guidance!.reconcile();
    await ui.remote!.taskBrowser.refresh();
    const g = ui.delivery!.state.guidanceLast!.guidance!;
    assert(g.guided_at && g.received_at && g.disposition === "ADOPTED");
    const ended = app.store.get<Execution>("Execution", e.id),
      result = ended.result_id
        ? app.store.get<TaskResult>("TaskResult", ended.result_id)
        : null;
    assert.equal(ended.state, "SUCCEEDED");
    assert(result?.summary.includes("GUIDE106_TUI"));
    const report = {
      task: p.id,
      execution: e.id,
      guidance: g,
      result,
      observations,
      native: "NOT_TESTED: native Terminal tool access denied",
      streaming:
        "Inspect observations for precompletion transient text; real provider used",
    };
    fs.writeFileSync(
      path.join(root, "tui-rehearsal.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    return {
      task: p.title,
      state: ended.state,
      guidance: g.id,
      physical: budget.value.physical,
    };
  } finally {
    onPhysical = undefined;
    await ui.close();
    await drain();
  }
}
let controlBusy = false;
const control = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${controlToken}`) {
    res.writeHead(403).end();
    return;
  }
  const action = req.url;
  void (async () => {
    if (action === "/status") return status();
    if (req.method !== "POST" || controlBusy)
      throw Error("CONTROL_BUSY_OR_INVALID");
    controlBusy = true;
    try {
      if (action === "/master-connect") {
        budget.connect(ready);
        pumpEnabled = true;
        return status();
      }
      if (action === "/prepare") return await prepare();
      if (action === "/rehearse") return await rehearse();
      if (action === "/tui-rehearse") return await tuiRehearse();
      throw Error("UNKNOWN_CONTROL");
    } finally {
      controlBusy = false;
    }
  })()
    .then((value) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    })
    .catch((e) => {
      res
        .writeHead(409, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: (e as Error).message }));
    });
});
await new Promise<void>((resolve) => control.listen(socket, resolve));
fs.chmodSync(socket, 0o600);
fs.writeFileSync(
  path.join(root, "control.json"),
  JSON.stringify({
    socket,
    token: controlToken,
    pid: process.pid,
    instance_id: server.endpoint.instance_id,
  }),
  { mode: 0o600 },
);
fs.writeFileSync(
  path.join(root, "manifest.json"),
  JSON.stringify(status(), null, 2),
  { mode: 0o600 },
);
const migrate = await client.command("admin/world/migrate", {
  request_id: id(),
});
await until(() => app.world?.memorySearch.status().status === "ready");
record({ kind: "world-ready", request: migrate.request_id });
const timer = setInterval(() => {
  if (closing) return;
  if (budget.expire()) {
    pumpEnabled = false;
    if (inflight)
      modelLifetime(app.store).abort(Error("ACCEPTANCE_BUDGET_EXHAUSTED"));
  }
  if (pumpEnabled && budget.enabled() && !pumpJob)
    pumpJob = app
      .pump()
      .catch((e) => record({ kind: "pump-error", message: String(e) }))
      .finally(() => {
        pumpJob = undefined;
      });
}, 250);
async function shutdown() {
  if (closing) return;
  closing = true;
  pumpEnabled = false;
  clearInterval(timer);
  modelLifetime(app.store).abort(Error("CORE_STOPPING"));
  await pumpJob;
  await server.close();
  await new Promise<void>((r) => control.close(() => r()));
  if (
    fs.existsSync(endpointFile) &&
    JSON.parse(fs.readFileSync(endpointFile, "utf8")).instance_id ===
      server.endpoint.instance_id
  )
    fs.unlinkSync(endpointFile);
  await owner.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
console.log(
  JSON.stringify({
    ready: true,
    pid: process.pid,
    phase: budget.value.phase,
    endpoint: server.endpoint.url,
  }),
);
