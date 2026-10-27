// Product ANSI -> headless cells. Does not claim native Terminal or IME acceptance.
import fs from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import type { Terminal as Headless } from "@xterm/headless";
const { Terminal } = createRequire(import.meta.url)("@xterm/headless") as {
  Terminal: typeof Headless;
};
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const terminal = new Terminal({
  cols: 100,
  rows: 24,
  allowProposedApi: true,
  scrollback: 0,
});
await new Promise<void>((resolve) =>
  terminal.write(fs.readFileSync(report.paste_frame), resolve),
);
const lines = Array.from(
  { length: 24 },
  (_, y) => terminal.buffer.active.getLine(y)?.translateToString(true) ?? "",
);
assert.match(lines[0], /Secretary \| Main \| fixture/);
assert.match(lines[23], /Candidate keys:.*\^T Actions.*\^C Exit/);
assert.ok(
  lines.slice(16, 20).some((line) => line.includes("[pasted ")),
  "paste-origin chip absent from fixed editor",
);
assert.ok(
  lines.slice(16, 20).some((line) => line.includes("typed 中文😀")),
  "Unicode draft absent",
);
assert.ok(
  terminal.buffer.active.cursorY >= 17 && terminal.buffer.active.cursorY <= 19,
  "caret outside fixed editor",
);
const result = {
  status: "PASS",
  evidenceClass: "HEADLESS_EMULATION",
  nativeIME: "NOT_TESTED",
  lines,
  cursor: {
    row: terminal.buffer.active.cursorY,
    column: terminal.buffer.active.cursorX,
  },
};
fs.writeFileSync(
  process.argv[2].replace(/\.json$/, "-cells.json"),
  JSON.stringify(result, null, 2),
  { flag: "wx", mode: 0o600 },
);
console.log(JSON.stringify(result));
terminal.dispose();
