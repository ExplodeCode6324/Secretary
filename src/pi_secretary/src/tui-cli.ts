#!/usr/bin/env node
import path from "node:path";
import { TerminalApp } from "./tui/app.ts";
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw Error("TUI_REQUIRES_TERMINAL");
const app = new TerminalApp(
  path.resolve(process.env.SECRETARY_DATA ?? ".demo-data"),
);
process.on("SIGINT", () => void app.close());
process.on("SIGTERM", () => void app.close());
app.start();
