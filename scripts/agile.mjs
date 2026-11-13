import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { visualEnvironment, visualOptions } from "../src/pi_secretary/src/tui/options.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
process.umask(0o077);
const action = process.argv[2] ?? "status";
if (!["start", "stop", "status", "attach", "tui", "ensure"].includes(action)) throw Error("Use start|stop|status|attach|tui|ensure");
const maintenance = path.join(root, ".local/maintenance.json");
fs.mkdirSync(path.dirname(maintenance), { recursive: true, mode: 0o700 });
if (action === "stop") fs.writeFileSync(maintenance, JSON.stringify({ since: new Date().toISOString(), reason: "agile maintenance" }), { mode: 0o600 });
if (action === "start") fs.rmSync(maintenance, { force: true });
if (action === "ensure" && fs.existsSync(maintenance)) process.exit(0);
const visual = visualEnvironment(process.env);
// The deployment has one stable domain; inherited settings cannot redirect it.
for (const key of Object.keys(process.env)) if (key.startsWith("SECRETARY_")) delete process.env[key];
Object.assign(process.env, visual, {
  SECRETARY_DATA: path.join(root, "data/core"),
  SECRETARY_MODE: "live",
  SECRETARY_CREDENTIALS_FILE: path.join(root, ".local/deepseek-credentials.json"),
  SECRETARY_RUNTIME_FILE: path.join(root, ".local/runtime.json"),
});
const { attachCore } = await import("../src/pi_secretary/src/core-client.ts");
if (action === "ensure") {
  const runtime = JSON.parse(fs.readFileSync(process.env.SECRETARY_RUNTIME_FILE, "utf8"));
  const postgres = spawnSync("pg_ctl", ["-D", runtime.local_postgres_data, "status"], { stdio: "ignore" });
  if (postgres.status === 0 && await attachCore(process.env.SECRETARY_DATA)) process.exit(0);
}
if (action === "start" || action === "ensure") {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/pi_secretary/scripts/start-live.ts"], { env: process.env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const client = await attachCore(process.env.SECRETARY_DATA);
  if (!client) throw Error("AGILE_CORE_UNAVAILABLE");
  // A maintenance request racing an automatic start must still leave Core stopped.
  if (fs.existsSync(maintenance)) {
    await client.command("core/stop", { request_id: randomUUID() });
    process.exit(0);
  }
  // World genesis/import and memory schema initialization belong to Core startup.
  // Do not replay the retired legacy migration command on every watchdog start.
} else if (action === "tui") {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error("TUI_REQUIRES_TERMINAL");
  if (!await attachCore(process.env.SECRETARY_DATA)) throw Error("Start the agile Core first");
  const { TerminalApp } = await import("../src/pi_secretary/src/tui/app.ts");
  const app = new TerminalApp(process.env.SECRETARY_DATA, undefined, path.join(root, "data/tui"), undefined, undefined, visualOptions());
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => void app.close());
  app.start();
} else {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/pi_secretary/src/core-cli.ts", action], { env: process.env, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
