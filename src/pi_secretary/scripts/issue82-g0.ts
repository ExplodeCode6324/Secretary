// Isolated Issue #82 G0 experiment. No Core imports, commands, outbox or network.
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ProbeTerminal, type Trace } from "./issue82-g0/terminal.ts";
import { safeText } from "./issue82-g0/input.ts";
import { ProbeWriter, pythonPrerequisite } from "./issue82-g0/writer.ts";

const args = new Set(process.argv.slice(2));
const allowed = new Set([
  "--help",
  "--main-screen",
  "--light",
  "--no-color",
  "--slow-save",
]);
if ([...args].some((arg) => !allowed.has(arg)))
  throw new Error("Unknown G0 argument; use --help");
if (args.has("--help")) {
  console.log(
    "G0 synthetic-only probe. Enter=newline; Ctrl+S=local submit count; Ctrl+G=command buffer; Ctrl+P=literal; Tab=completion only; Esc=dismiss; Ctrl+C=exit; Ctrl+O=visible rendered-text copy; Ctrl+U/D=half page; PgUp/Dn=page. --main-screen compares native copy; --light; --no-color; --slow-save adds a synthetic 500ms atomic-save delay. Use only synthetic text: raw bytes are logged. No Core connection.",
  );
  process.exit(0);
}
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw new Error("Launch in Terminal.app; G0 requires TTY stdin/stdout");
const python = pythonPrerequisite();
const evidence = fileURLToPath(
  new URL("../../../.demo-data/issue82-tui/g0/", import.meta.url),
);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const run = mkdtempSync(join(evidence, "run-"));
const state = join(run, "state");
mkdirSync(state, { mode: 0o700 });
let traceBytes = 0;
const trace: Trace = (kind, detail) => {
  const line =
    JSON.stringify({ at: new Date().toISOString(), kind, detail }) + "\n";
  traceBytes += Buffer.byteLength(line);
  if (traceBytes > 8 * 1024 * 1024) throw new Error("G0 trace limit reached");
  appendFileSync(join(run, "trace.jsonl"), line, { mode: 0o600 });
};
// Guard all later renderer/adapter interactions against implicit native addons.
process.dlopen = (() => {
  throw new Error("G0 forbids native addon loading");
}) as typeof process.dlopen;
const {
  TuiAltScreen,
  TuiMainScreen,
  VStack,
  ScrollView,
  CURSOR_MARKER,
  wrapTextWithAnsi,
  truncateToWidth,
  KeybindingsManager,
  TUI_KEYBINDINGS,
  setKeybindings,
} = await import("@earendil-works/pi-tui");
const bindings = Object.fromEntries(
  Object.keys(TUI_KEYBINDINGS).map((id) => [id, []]),
);
const manager = new KeybindingsManager(TUI_KEYBINDINGS, {
  ...bindings,
  "tui.altScreen.pageUp": "pageUp",
  "tui.altScreen.pageDown": "pageDown",
  "tui.altScreen.halfPageUp": "ctrl+u",
  "tui.altScreen.halfPageDown": "ctrl+d",
});
setKeybindings(manager);
writeFileSync(
  join(run, "metadata.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      python,
      node: process.version,
      os: spawnSync("/usr/bin/sw_vers", [], { encoding: "utf8", timeout: 1000 })
        .stdout,
      terminal: process.env.TERM_PROGRAM,
      terminalVersion: process.env.TERM_PROGRAM_VERSION,
      term: process.env.TERM,
      columns: process.stdout.columns,
      rows: process.stdout.rows,
      args: [...args],
      bindings: manager.getResolvedBindings(),
      profileFontInputSource:
        "RECORD MANUALLY; no genuine IME claim from metadata",
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
const writer = new ProbeWriter(state, trace);
await writer.ready;
let draft = "";
let command = "";
let commandMode = false;
let literal = false;
let cursor = 0;
let submits = 0;
let status = "Synthetic only. No Core connection.";
let tick = 0;
let closing = false;
let saveTimer: NodeJS.Timeout | undefined;
const mainScreen = args.has("--main-screen");
const terminal = new ProbeTerminal(
  trace,
  (event) => {
    if (closing) return;
    if (event.kind === "paste") insert(event.text);
    else {
      status = "QUARANTINED control input; inspect trace";
      trace("quarantine", event);
    }
    tui.requestRender();
  },
  !mainScreen,
);
const copy = async (text: string): Promise<boolean> => {
  if (Buffer.byteLength(text) > 128 * 1024) {
    status = "Copy exceeds 128 KiB";
    return false;
  }
  const result = spawnSync("/usr/bin/pbcopy", [], {
    input: text,
    encoding: "utf8",
    timeout: 2000,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      LC_CTYPE: "en_US.UTF-8",
    },
  });
  trace("visible-text-copy", {
    bytes: Buffer.byteLength(text),
    status: result.status,
    error: result.error?.message,
  });
  status =
    result.status === 0
      ? "Copied visible rendered text (soft wraps included)"
      : "Clipboard copy failed";
  return result.status === 0;
};
const tui = mainScreen
  ? new TuiMainScreen(terminal, true)
  : new TuiAltScreen(terminal, true, undefined, {
      mouse: true,
      copyOnSelect: false,
      copySelection: copy,
    });
const colors = args.has("--light")
  ? ["285ea6", "8bbde0", "b84550"]
  : ["79acd9", "b1d5ec", "ed8791"];
function color(text: string, index = 0): string {
  if (args.has("--no-color")) return text;
  const hex = colors[index]!;
  return `\x1b[38;2;${[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(";")}m${text}\x1b[0m`;
}
function snapshot(): void {
  try {
    writer.save(
      { draft, command, submits, literal },
      args.has("--slow-save") ? 500 : 0,
    );
  } catch (error) {
    status = `UNSAVED: ${String(error)}`;
    trace("save-failed", status);
  }
}
function changed(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(snapshot, 150);
}
function insert(text: string): void {
  if (Buffer.byteLength(draft + command + text) > 8192) {
    status = "Probe draft limit 8 KiB; input retained in trace only";
    return;
  }
  if (commandMode) command += text;
  else {
    draft = draft.slice(0, cursor) + text + draft.slice(cursor);
    cursor += text.length;
  }
  changed();
}
const component = (render: (width: number) => string[]) => ({
  render,
  invalidate() {},
});
const header = component((width) => [
  truncateToWidth(
    color(
      `G0 | ${mainScreen ? "MAIN COPY COMPARISON" : "ALT"} | synthetic domain | submits=${submits}`,
    ),
    width,
  ),
]);
const body = component((width) =>
  Array.from(
    { length: Math.min(tick + 30, 160) },
    (_, i) =>
      `${i + Math.max(0, tick - 130)} 合成输出 中文 😀 e\u0301 — wrap ${"0123456789 ".repeat(8)}`,
  ).flatMap((line) => wrapTextWithAnsi(line, width)),
);
const input = {
  focused: false,
  invalidate() {},
  render(width: number): string[] {
    const value = commandMode ? command : draft;
    const position = commandMode ? value.length : cursor;
    const before = safeText(value.slice(0, position));
    const lines = wrapTextWithAnsi(
      before + CURSOR_MARKER + safeText(value.slice(position)),
      Math.max(1, width),
    );
    // Keep the cursor visible; this is a small probe, not the product editor.
    const cursorLine = Math.max(
      0,
      lines.findIndex((line) => line.includes(CURSOR_MARKER)),
    );
    const start = Math.max(0, cursorLine - 2);
    const shown = lines.slice(start, start + 3);
    while (shown.length < 3) shown.push("");
    return [
      truncateToWidth(
        color(
          `${commandMode ? "COMMAND" : "DRAFT"} ${literal ? "LITERAL" : "NORMAL"} | ${terminal.columns}x${terminal.rows}`,
          1,
        ),
        width,
      ),
      ...shown,
      truncateToWidth(
        terminal.columns < 40 || terminal.rows < 12
          ? color("TOO SMALL: draft retained, submit disabled", 2)
          : status,
        width,
      ),
      truncateToWidth(
        "Enter NL | ^S count | ^G cmd | ^P literal | ^C exit | ^O copy",
        width,
      ),
    ];
  },
  handleInput(data: string): void {
    if (closing) return;
    trace("dispatch", { data, submits, commandMode });
    if (data === "\x03") {
      void shutdown("Ctrl+C");
      return;
    }
    if (data === "\x13") {
      if (terminal.columns >= 40 && terminal.rows >= 12) {
        submits++;
        status = `Local submit counter ${submits}; no network send`;
        changed();
        trace("local-submit", { submits });
      }
    } else if (data === "\x07") {
      commandMode = !commandMode;
      status = "Separate command buffer; no command execution";
    } else if (data === "\x10") literal = !literal;
    else if (data === "\x0f") {
      if (tui instanceof TuiAltScreen)
        void tui.copyActiveSelectionToClipboard().then((ok) => {
          if (!ok)
            status =
              "No selection or copy failed; clipboard unchanged on no selection";
          tui.requestRender();
        });
      else
        status = "Main-screen comparison: use Terminal native selection/copy";
    } else if (data === "\x1b") commandMode = false;
    else if (data === "\t") {
      if (commandMode) command += "[completion]";
      status = "Completion only; zero execution";
      changed();
    } else if (data === "\r" || data === "\n" || data === "\x1b[13;2u")
      insert("\n");
    else if (data === "\x7f") {
      if (commandMode) command = command.slice(0, -1);
      else if (cursor) {
        const length = [...draft.slice(0, cursor)].at(-1)!.length;
        draft = draft.slice(0, cursor - length) + draft.slice(cursor);
        cursor -= length;
      }
      changed();
    } else if (data === "\x1b[D")
      cursor = Math.max(
        0,
        cursor - ([...draft.slice(0, cursor)].at(-1)?.length ?? 0),
      );
    else if (data === "\x1b[C")
      cursor = Math.min(
        draft.length,
        cursor + ([...draft.slice(cursor)][0]?.length ?? 0),
      );
    else if (data === "\x1b[H" || data === "\x1bOH") cursor = 0;
    else if (data === "\x1b[F" || data === "\x1bOF") cursor = draft.length;
    else if (!/[\x00-\x1f\x7f-\x9f]/.test(data)) insert(data);
    tui.requestRender();
  },
};
if (tui instanceof TuiAltScreen)
  tui.setLayoutRoot(
    new VStack([
      { component: header, basis: 1, shrink: 0 },
      {
        component: new ScrollView(body, {
          follow: "end",
          primary: true,
          scrollbar: "always",
        }),
        grow: 1,
        basis: 0,
        minSize: 1,
      },
      { component: input, basis: 6, shrink: 0 },
    ]),
  );
else {
  tui.addChild(header);
  tui.addChild(body);
  tui.addChild(input);
}
tui.setFocus(input);
async function shutdown(reason: string): Promise<void> {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  clearTimeout(saveTimer);
  let saved = false;
  try {
    snapshot();
    saved = await writer.flush(2000);
    trace("shutdown", { reason, saved, submits, draft });
  } finally {
    try {
      tui.stop({ preserveScreen: true });
    } finally {
      writer.close();
    }
    process.stdout.write(
      `\nG0 ${saved ? "saved" : "UNSAVED"}; local submits=${submits}; evidence=${run}\n`,
    );
    setTimeout(() => process.exit(saved ? 0 : 1), 100).unref();
  }
}
for (const signal of ["SIGINT", "SIGHUP", "SIGTERM"] as const)
  process.on(signal, () => {
    void shutdown(signal);
  });
process.on("uncaughtException", (error) => {
  trace("exception", String(error));
  void shutdown("exception");
});
process.on("unhandledRejection", (error) => {
  trace("rejection", String(error));
  void shutdown("rejection");
});
process.stdout.on("error", () => {
  void shutdown("stdout closed");
});
const timer = setInterval(() => {
  tick++;
  terminal.modes();
  tui.requestRender();
}, 200);
tui.start();
trace("started", { run, columns: terminal.columns, rows: terminal.rows });
