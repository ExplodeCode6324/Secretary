#!/usr/bin/env node
import path from "node:path";
import { visualOptions } from "./tui/options.ts";
import { TerminalApp } from "./tui/app.ts";
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw Error("TUI_REQUIRES_TERMINAL");
const app = new TerminalApp(
  path.resolve(process.env.SECRETARY_DATA ?? ".demo-data"),
  undefined,
  undefined,
  undefined,
  undefined,
  visualOptions(),
);
process.on("SIGINT", () => void app.close());
process.on("SIGTERM", () => void app.close());
process.on("SIGHUP", () => void app.close());
app.start();
