import { spawnSync } from "node:child_process";
import { parseConfig } from "./config.ts";
import { TuiApp } from "./app.ts";
import { TerminalView } from "./terminal-view.ts";

async function main() {
  const config = parseConfig(process.argv.slice(2));
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw Error(
      "TTY_REQUIRED: npm run tui enters the current terminal; stdin/stdout must be a TTY",
    );
  if (!["darwin", "linux"].includes(process.platform))
    throw Error("UNSUPPORTED_TERMINAL_PLATFORM");
  // Detect a background process group before any writer, raw mode or alternate screen.
  // tcgetpgrp is an ioctl, not a terminal read; the fixed Python check loads no addon.
  const foreground = spawnSync(
    "/usr/bin/python3",
    [
      "-c",
      "import os,sys; sys.exit(0 if os.tcgetpgrp(0) == os.getpgrp() else 2)",
    ],
    {
      stdio: ["inherit", "ignore", "pipe"],
      timeout: 1000,
      env: { PATH: "/usr/bin:/bin", PYTHONUTF8: "1" },
    },
  );
  if (foreground.status !== 0)
    throw Error(
      "FOREGROUND_TTY_REQUIRED: launch tui in the foreground (without &)",
    );
  const app = new TuiApp(config);
  const view = new TerminalView(app);
  app.presentation = view;
  let started = false,
    failed = false;
  app.onExit = (saved) => {
    if (view.input.exitRefusedBytes || view.input.exitUnconfirmedDecision)
      console.error(
        `${view.input.exitRefusedBytes} queued input bytes were refused during exit; unconfirmed decisions were not applied.`,
      );
    console.error(
      started
        ? saved
          ? "TUI closed; durable state saved. Core remains independent."
          : "TUI closed with unconfirmed writes; reopen durable state for recovery."
        : "TUI startup did not complete; retained state was not replaced.",
    );
    process.exit(saved && started && !failed ? 0 : 1);
  };
  const close = () => {
    void app.close();
  };
  for (const signal of [
    "SIGINT",
    "SIGHUP",
    "SIGTERM",
    "SIGQUIT",
    "SIGTSTP",
    "SIGCONT",
    "SIGTTOU",
  ] as const)
    process.on(signal, close);
  const failure = (error: unknown) => {
    failed = true;
    view.close(); // restore first, including when startup failed part way through
    console.error(error instanceof Error ? error.message : String(error));
    close();
  };
  process.on("uncaughtException", failure);
  process.on("unhandledRejection", failure);
  try {
    await app.start();
    view.start();
    started = true;
  } catch (error) {
    failure(error);
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
