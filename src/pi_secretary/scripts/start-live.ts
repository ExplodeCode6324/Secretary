import * as fs from "node:fs";
import { spawn } from "node:child_process";
const file =
  process.env.SECRETARY_CREDENTIALS_FILE ?? ".demo-data/live-credentials.json";
const keys = JSON.parse(fs.readFileSync(file, "utf8")) as {
  main: string;
  task: string;
};
if (!keys.main || !keys.task)
  throw Error("Separate main/task keys are required");
const env = {
  ...process.env,
  SECRETARY_MODE: "live",
  SECRETARY_MAIN_PROVIDER: "opencode-go",
  SECRETARY_TASK_PROVIDER: "opencode-go",
  SECRETARY_MAIN_MODEL:
    process.env.SECRETARY_MAIN_MODEL ?? "deepseek-v4.1-flash",
  SECRETARY_TASK_MODEL: process.env.SECRETARY_TASK_MODEL ?? "gpt-5.6-luna",
  SECRETARY_MAIN_API_KEY: keys.main,
  SECRETARY_TASK_API_KEY: keys.task,
  SECRETARY_DATA: process.env.SECRETARY_DATA ?? ".demo-data/interactive-live",
};
const child = spawn(
  process.execPath,
  [
    "--import",
    "tsx",
    process.argv.includes("--web")
      ? "src/pi_secretary/src/web.ts"
      : "src/pi_secretary/src/client-tui.ts",
    ...process.argv.slice(2).filter((arg) => arg !== "--web"),
  ],
  { env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
