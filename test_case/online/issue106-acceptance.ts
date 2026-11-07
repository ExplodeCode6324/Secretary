/** Owner-local commands for a disposable real-model instance; never production defaults. */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { CoreClient } from "../../src/pi_secretary/src/core-client.ts";
import { TerminalApp } from "../../src/pi_secretary/src/tui/app.ts";
const repo = path.resolve(import.meta.dirname, "../..");
const root = path.join(repo, ".demo-data/issue106/acceptance");
const action = process.argv[2] ?? "status";
const configFile = path.join(root, "config.json");
const pg = "/opt/homebrew/opt/postgresql@18/bin";
const node = process.execPath,
  tsx = path.join(repo, "node_modules/tsx/dist/cli.mjs");
const env = Object.fromEntries(
  [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TERM",
    "COLORTERM",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
  ].flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])),
);
for (const key of Object.keys(process.env))
  if (key.startsWith("SECRETARY_")) delete process.env[key];
process.env.SECRETARY_MODE = "live";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
function safe(file: string) {
  const s = fs.lstatSync(file);
  assert(
    !s.isSymbolicLink() && s.uid === process.getuid?.() && !(s.mode & 0o077),
    "UNSAFE_ACCEPTANCE_PATH",
  );
}
const config = () => {
  safe(configFile);
  const c = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert(
    c.root === root &&
      c.cluster === path.join(root, "postgres") &&
      c.dsn === `postgresql://127.0.0.1:${c.port}/issue106_acceptance`,
    "ISOLATED_CONFIG_MISMATCH",
  );
  return c;
};
async function control(route: string) {
  const file = path.join(root, "control.json");
  safe(file);
  const c = JSON.parse(fs.readFileSync(file, "utf8"));
  assert(c.socket === path.join(root, "control.sock"));
  return await new Promise<any>((resolve, reject) => {
    const req = http.request(
      {
        socketPath: c.socket,
        path: "/" + route,
        method: route === "status" ? "GET" : "POST",
        headers: { Authorization: `Bearer ${c.token}` },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const v = JSON.parse(data);
            if (res.statusCode !== 200) reject(Error(v.error));
            else resolve(v);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(route === "status" ? 10000 : 1200000, () =>
      req.destroy(Error("CONTROL_TIMEOUT")),
    );
    req.end();
  });
}
async function status() {
  const s = await control("status");
  const endpoint = JSON.parse(
    fs.readFileSync(path.join(root, "core/core-endpoint.json"), "utf8"),
  );
  const core = await new CoreClient(endpoint).core();
  assert(
    core.instance_id === s.instance_id &&
      core.data_domain_id === s.data_domain_id &&
      endpoint.pid === s.pid,
    "INSTANCE_IDENTITY_MISMATCH",
  );
  return s;
}
async function initialize() {
  assert(!fs.existsSync(configFile), "ALREADY_INITIALIZED");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  safe(root);
  const port = await new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
  const cluster = path.join(root, "postgres"),
    socket = path.join("/tmp", "secretary106pg-" + randomUUID().slice(0, 8));
  fs.mkdirSync(socket, { mode: 0o700 });
  execFileSync(
    path.join(pg, "initdb"),
    ["-D", cluster, "-A", "trust", "--no-locale", "-E", "UTF8"],
    { env, stdio: "ignore" },
  );
  const c = {
    root,
    cluster,
    socket,
    port,
    dsn: `postgresql://127.0.0.1:${port}/issue106_acceptance`,
    sha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim(),
  };
  fs.writeFileSync(configFile, JSON.stringify(c, null, 2), { mode: 0o600 });
  startPG();
  const admin = new Client({
    connectionString: `postgresql://127.0.0.1:${port}/postgres`,
  });
  await admin.connect();
  try {
    await admin.query("CREATE DATABASE issue106_acceptance");
  } finally {
    await admin.end();
  }
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  for (const [name, verb] of Object.entries({
    start: "start",
    status: "status",
    connect: "connect",
    restart: "restart",
    "prepare-task": "prepare",
    stop: "stop",
  })) {
    const file = path.join(root, name + ".command");
    fs.writeFileSync(
      file,
      `#!/bin/zsh\ncd ${quote(repo)}\nexec ${quote(node)} ${quote(tsx)} ${quote(path.join(repo, "test_case/online/issue106-acceptance.ts"))} ${verb}\n`,
      { mode: 0o700 },
    );
  }
  fs.mkdirSync(path.join(root, "master-state"), { mode: 0o700 });
  fs.mkdirSync(path.join(root, "rehearsal-state"), { mode: 0o700 });
  console.log(JSON.stringify({ initialized: true, root, port }));
}
function startPG() {
  const c = config();
  safe(c.cluster);
  safe(c.socket);
  try {
    execFileSync(path.join(pg, "pg_ctl"), ["-D", c.cluster, "status"], {
      env,
      stdio: "ignore",
    });
  } catch {
    execFileSync(
      path.join(pg, "pg_ctl"),
      [
        "-D",
        c.cluster,
        "-l",
        path.join(root, "postgres.log"),
        "-o",
        `-p ${c.port} -h 127.0.0.1 -k ${c.socket}`,
        "-w",
        "start",
      ],
      { env, stdio: "ignore" },
    );
  }
}
async function start() {
  startPG();
  try {
    return await status();
  } catch {}
  const c = config();
  c.sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  fs.writeFileSync(configFile, JSON.stringify(c, null, 2), { mode: 0o600 });
  const log = fs.openSync(path.join(root, "server.log"), "a", 0o600);
  const child = spawn(
    node,
    [tsx, path.join(repo, "test_case/online/issue106-server.ts"), root],
    { cwd: repo, env, detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  fs.closeSync(log);
  for (let n = 0; n < 150; n++) {
    await pause(200);
    try {
      const s = await status();
      if (s.world?.status === "ready") return s;
    } catch {}
  }
  throw Error("START_FAILED_INSPECT_PRIVATE_SERVER_LOG");
}
async function stop(stopPG: boolean) {
  const s = await status();
  const endpoint = JSON.parse(
    fs.readFileSync(path.join(root, "core/core-endpoint.json"), "utf8"),
  );
  assert(
    endpoint.pid === s.pid && endpoint.instance_id === s.instance_id,
    "STOP_IDENTITY_MISMATCH",
  );
  try {
    await new CoreClient(endpoint).command("core/stop", {
      request_id: randomUUID(),
    });
  } catch (e) {
    if (fs.existsSync(path.join(root, "core/core-endpoint.json"))) throw e;
  }
  for (
    let n = 0;
    n < 150 && fs.existsSync(path.join(root, "core/core-endpoint.json"));
    n++
  )
    await pause(200);
  assert(
    !fs.existsSync(path.join(root, "core/core-endpoint.json")),
    "CORE_STOP_NOT_CONFIRMED",
  );
  if (stopPG) {
    const c = config();
    execFileSync(
      path.join(pg, "pg_ctl"),
      ["-D", c.cluster, "-m", "fast", "-w", "stop"],
      { env, stdio: "ignore" },
    );
  }
  return { stopped: true, root };
}
if (action === "init") await initialize();
else if (action === "start")
  console.log(JSON.stringify(await start(), null, 2));
else if (action === "restart") {
  await stop(false);
  console.log(JSON.stringify(await start(), null, 2));
} else if (action === "stop") console.log(JSON.stringify(await stop(true)));
else if (action === "status")
  console.log(JSON.stringify(await status(), null, 2));
else if (
  action === "rehearse" ||
  action === "prepare" ||
  action === "tui-rehearse"
)
  console.log(JSON.stringify(await control(action), null, 2));
else if (action === "connect" || action === "rehearsal-connect") {
  assert(process.stdin.isTTY && process.stdout.isTTY, "NATIVE_TTY_REQUIRED");
  const s =
    action === "connect" ? await control("master-connect") : await status();
  if (action === "rehearsal-connect")
    assert(s.phase === "PREPARING", "REHEARSAL_PHASE_REQUIRED");
  const ui = new TerminalApp(
    path.join(root, "core"),
    undefined,
    path.join(root, action === "connect" ? "master-state" : "rehearsal-state"),
  );
  ui.start();
} else throw Error("UNKNOWN_ACTION");
