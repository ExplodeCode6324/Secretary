import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
process.umask(0o077);
const action = process.argv[2] ?? "status";
if (!["start", "stop", "status", "attach", "tui"].includes(action)) throw Error("Use start|stop|status|attach|tui");
// The deployment has one stable domain; inherited settings cannot redirect it.
for (const key of Object.keys(process.env)) if (key.startsWith("SECRETARY_")) delete process.env[key];
Object.assign(process.env, {
  SECRETARY_DATA: path.join(root, "data/core"),
  SECRETARY_MODE: "live",
  SECRETARY_CREDENTIALS_FILE: path.join(root, ".local/deepseek-credentials.json"),
  SECRETARY_RUNTIME_FILE: path.join(root, ".local/runtime.json"),
});
const { attachCore } = await import("../src/pi_secretary/src/core-client.ts");
if (action === "start") {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/pi_secretary/scripts/start-live.ts"], { env: process.env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const client = await attachCore(process.env.SECRETARY_DATA);
  if (!client) throw Error("AGILE_CORE_UNAVAILABLE");
  const receipt = await client.command("admin/world/migrate", { request_id: randomUUID() });
  console.log(JSON.stringify({ world_migration: receipt }));
} else if (action === "tui") {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error("TUI_REQUIRES_TERMINAL");
  if (!await attachCore(process.env.SECRETARY_DATA)) throw Error("Start the agile Core first");
  const { TerminalApp } = await import("../src/pi_secretary/src/tui/app.ts");
  const app = new TerminalApp(process.env.SECRETARY_DATA, undefined, path.join(root, "data/tui"));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => void app.close());
  app.start();
} else {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/pi_secretary/src/core-cli.ts", action], { env: process.env, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
