// Isolated FE-02 acceptance launcher. This is not a production Core entrypoint.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { App } from "../../pi_secretary/src/app.ts";
import { serveCore } from "../../pi_secretary/src/api-v1.ts";
import { modelConfig, type StreamFn } from "../../pi_secretary/src/model.ts";
import { Scopes } from "../../pi_secretary/src/scopes.ts";
import { LiveBudget } from "./live-budget.ts";
import pg from "pg";
const root = path.resolve(process.env.ISSUE60_RUN ?? "");
assert(root.includes("/.demo-data/issue60/"), "isolated run root required");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
fs.chmodSync(root, 0o700);
const data = path.join(root, "core");
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
process.env.SECRETARY_DATA = data;
process.env.SECRETARY_MODE = "live";
process.env.SECRETARY_MAX_OUTPUT_TOKENS = "4096";
const credentials = process.env.SECRETARY_CREDENTIALS_FILE!;
assert(credentials);
const st = fs.lstatSync(credentials);
assert(st.isFile() && !st.isSymbolicLink() && (st.mode & 0o077) === 0);
const keys = JSON.parse(fs.readFileSync(credentials, "utf8"));
for (const role of ["main", "task"]) {
  assert(typeof keys[role] === "string");
  process.env[`SECRETARY_${role.toUpperCase()}_API_KEY`] = keys[role];
}
const dsn = process.env.SECRETARY_DATABASE_URL!;
assert(dsn);
const db = new pg.Client({ connectionString: dsn });
await db.connect();
const identity = (await db.query("select current_database() as name")).rows[0]
  .name;
assert(identity.startsWith("secretary_issue60_"));
await db.end();
const calls: Record<string, unknown>[] = fs.existsSync(
  path.join(root, "calls.json"),
)
  ? JSON.parse(fs.readFileSync(path.join(root, "calls.json"), "utf8"))
  : [];
const originPath = path.join(root, "budget-origin.json");
const savedOrigin = fs.existsSync(originPath)
  ? JSON.parse(fs.readFileSync(originPath, "utf8"))
  : undefined;
if (savedOrigin !== undefined)
  assert(typeof savedOrigin === "number" && Number.isFinite(savedOrigin));
const limiter = new LiveBudget(undefined, calls as any, savedOrigin);
if (savedOrigin === undefined)
  fs.writeFileSync(originPath, JSON.stringify(limiter.started), {
    mode: 0o600,
    flag: "wx",
  });
let halt = false,
  stopping = false;
let app: App;
let server: Awaited<ReturnType<typeof serveCore>>;
const globalAbort = new AbortController();
const write = (name: string, value: unknown) => {
  const dest = path.join(root, name);
  fs.writeFileSync(dest + ".tmp", JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(dest + ".tmp", dest);
};
const scenario = () => {
  const name = JSON.parse(
    fs.readFileSync(path.join(root, "scenario.json"), "utf8"),
  ).name;
  assert(
    [
      "conversation",
      "allow",
      "approve",
      "reject",
      "stale",
      "recovery",
    ].includes(name),
  );
  return name as string;
};
function config(role: "main" | "task") {
  const real = modelConfig(role);
  assert(["openai-completions", "openai-responses"].includes(real.model.api));
  const stream: StreamFn = async (m, context, options) => {
    assert(!halt, "LIVE_STOPPED");
    const current = scenario();
    const ticket = await limiter.enter(current, options?.signal);
    const start = Date.now();
    const record: Record<string, unknown> = {
      ...ticket,
      release: undefined,
      scenario: current,
      role,
      provider: m.provider,
      model: m.id,
      started_at: new Date(start).toISOString(),
    };
    calls.push(record);
    write("calls.json", calls);
    const signal = AbortSignal.any([
      globalAbort.signal,
      AbortSignal.timeout(Math.max(1, ticket.deadline - Date.now())),
      ...(options?.signal ? [options.signal] : []),
    ]);
    try {
      const source = await real.stream(m, context, {
        ...options,
        maxTokens: Math.min(options?.maxTokens ?? 4096, 4096),
        signal,
      });
      // Observe completion independently: background consumers may only call result().
      void source
        .result()
        .then(
          (result) => {
            record.usage = result.usage;
            record.stopReason = result.stopReason;
          },
          () => {
            record.error = "STREAM_FAILED";
          },
        )
        .finally(() => {
          record.elapsed_ms = Date.now() - start;
          write("calls.json", calls);
          ticket.release();
        });
      return source;
    } catch (e) {
      record.error = "PROVIDER_START_FAILED";
      ticket.release();
      write("calls.json", calls);
      throw e;
    }
  };
  return { model: real.model, stream };
}
const main = config("main"),
  task = config("task");
app = await App.open(data, { main, task }, dsn);
await app.world!.migrate();
const scratch = path.join(root, "scratch");
fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
const scopes = new Scopes(app.store);
const scope =
  app.store.all<any>("Scope").find((s) => s.name === "FE02 scratch") ??
  scopes.save({
    name: "FE02 scratch",
    kind: "DIRECTORY",
    root_path: scratch,
    default_write: "allow",
  });
async function stop() {
  if (stopping) return;
  stopping = true;
  halt = true;
  globalAbort.abort();
  clearInterval(recorder);
  clearTimeout(watchdog);
  try {
    fs.unlinkSync(path.join(data, "core-endpoint.json"));
  } catch {}
  await server.close();
}
server = await serveCore(app, 0, () => void stop());
write("core/core-endpoint.json", server.endpoint);
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const profile = {
  id: "issue60-live",
  data_dir: data,
  expected_mode: "live",
  node_abs: process.execPath,
  core_root: repo,
  backend_entry: path.join(repo, "src/pi_secretary/src/backend.ts"),
};
write("profiles.json", [profile]);
write("setup.json", {
  scope_id: scope.id,
  scratch,
  pid: process.pid,
  mode: "live",
  database: identity,
  models: { main: main.model.id, task: task.model.id },
});
const recorder = setInterval(() => {
  write("state.json", {
    sequence: String(app.store.sequence),
    tasks: app.store.all("Task"),
    executions: app.store.all("Execution"),
    authorizations: app.store.all("AuthorizationRequest"),
    results: app.store.all("TaskResult"),
    artifacts: app.store.all("Artifact"),
    modelCalls: app.store
      .all("ModelCall")
      .map((c: any) => ({ id: c.id, state: c.state, scope: c.scope })),
    plans: app.store.all("TaskPlan"),
  });
}, 500);
const watchdog = setTimeout(
  () => void stop(),
  Math.max(1, limiter.started + 40 * 60 * 1000 - Date.now()),
);
// Harness-only fault: interrupt SSE connections without pausing Core work.
process.on("SIGUSR1", () => {
  server.streams.close();
  write("sse-interruption.json", {
    at: new Date().toISOString(),
    pid: process.pid,
  });
});
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
console.log("ISSUE60_CORE_READY");
