import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  ProbeFramer,
  PASTE_START as S,
  PASTE_END as E,
} from "../../../src/pi_secretary/scripts/issue82-g0/input.ts";
import {
  ProbeWriter,
  helperPath,
  pythonPrerequisite,
} from "../../../src/pi_secretary/scripts/issue82-g0/writer.ts";
import { clipboardCapability } from "../../../src/pi_secretary/scripts/issue82-g0/clipboard.ts";
import { filterRendererOutput } from "../../../src/pi_secretary/scripts/issue82-g0/terminal.ts";

const evidence = resolve(".demo-data/issue82-tui/g0");
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const run = mkdtempSync(join(evidence, "checks-"));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const root = () => {
  const dir = mkdtempSync(join(run, "state-"));
  return dir;
};
function launch(dir: string) {
  const child = spawn("/usr/bin/python3", [helperPath, dir], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin", PYTHONUNBUFFERED: "1" },
  });
  const lines: unknown[] = [];
  createInterface({ input: child.stdout }).on("line", (line) =>
    lines.push(JSON.parse(line)),
  );
  child.stdin.on("error", () => {});
  const exit = once(child, "exit");
  return { child, lines, exit };
}
async function ready(item: ReturnType<typeof launch>) {
  for (let i = 0; i < 100 && !item.lines.length; i++) await pause(10);
  assert.equal((item.lines[0] as { ready: boolean })?.ready, true);
}

test(
  "G0 pinned public exports, Python prerequisite and no native renderer load",
  { skip: !["darwin", "linux"].includes(process.platform) },
  async () => {
    assert.match(pythonPrerequisite(), /^3\./);
    const original = process.dlopen;
    process.dlopen = (() => {
      throw new Error("Unexpected native addon");
    }) as typeof process.dlopen;
    try {
      const p = await import("@earendil-works/pi-tui");
      for (const key of [
        "TuiAltScreen",
        "TuiMainScreen",
        "VStack",
        "ScrollView",
        "StdinBuffer",
      ])
        assert.ok(key in p);
      const output: string[] = [];
      let input: (value: string) => void = () => {};
      const terminal = {
        columns: 40,
        rows: 12,
        kittyProtocolActive: false,
        start(fn: typeof input) {
          input = fn;
        },
        stop() {},
        async drainInput() {},
        write(value: string) {
          output.push(value);
        },
        moveBy() {},
        hideCursor() {},
        showCursor() {},
        clearLine() {},
        clearFromCursor() {},
        clearScreen() {},
        setTitle() {},
        setProgress() {},
      };
      const disabled = Object.fromEntries(
        Object.keys(p.TUI_KEYBINDINGS).map((id) => [id, []]),
      );
      p.setKeybindings(new p.KeybindingsManager(p.TUI_KEYBINDINGS, disabled));
      const ui = new p.TuiAltScreen(terminal, true, undefined, {
        mouse: true,
        copyOnSelect: false,
        copySelection: async () => {
          throw new Error("No-selection must not copy");
        },
      });
      const received: string[] = [];
      const edit = {
        focused: true,
        render: () => ["DRAFT " + p.CURSOR_MARKER],
        invalidate() {},
        handleInput: (data: string) => received.push(data),
      };
      ui.setLayoutRoot(
        new p.VStack([
          {
            component: { render: () => ["HEADER"], invalidate() {} },
            basis: 1,
          },
          {
            component: new p.ScrollView({
              render: () => ["中文 😀 e\u0301"],
              invalidate() {},
            }),
            grow: 1,
            basis: 0,
          },
          { component: edit, basis: 6 },
        ]),
      );
      ui.setFocus(edit);
      ui.start();
      for (const data of ["\x07", "\x1b[H", "\x1b[F", "\r"]) input(data);
      await pause(60);
      assert.deepEqual(received, ["\x07", "\x1b[H", "\x1b[F", "\r"]);
      assert.equal(await ui.copyActiveSelectionToClipboard(), false);
      ui.stop({ preserveScreen: true });
      assert.ok(output.join("").includes("HEADER"));
      assert.doesNotMatch(
        filterRendererOutput(output.join("")),
        /\x1b\](?:52|8);/,
      );
      assert.throws(() =>
        filterRendererOutput("\x1b]8;;https://example.com\x07"),
      );
      assert.throws(() => filterRendererOutput("\x1b]52;c;eA==\x07"));
      writeFileSync(join(run, "renderer-output.json"), JSON.stringify(output), {
        mode: 0o600,
      });
    } finally {
      process.dlopen = original;
    }
  },
);

test("G0 split delimiters preserve ordered paste, tabs and LF canonicalization", () => {
  const stream = S + "中\t文\r\nline\rfinal 😀" + E + S + "/send literal" + E;
  for (let split = 1; split < stream.length; split++) {
    const events: { kind: string; text: string }[] = [];
    const parser = new ProbeFramer((event) => events.push(event));
    parser.feed(stream.slice(0, split));
    parser.feed(stream.slice(split));
    assert.deepEqual(events, [
      { kind: "paste", text: "中\t文\nline\nfinal 😀" },
      { kind: "paste", text: "/send literal" },
    ]);
  }
});

test("G0 same-chunk malicious end quarantines controls; split witness remains a failed safety gate", () => {
  const whole: { kind: string; text: string }[] = [];
  new ProbeFramer((event) => whole.push(event)).feed(
    S + "abc" + E + "\x13\x07\x03" + E,
  );
  assert.equal(whole.filter((event) => event.kind === "keys").length, 0);
  const split: { kind: string; text: string }[] = [];
  const parser = new ProbeFramer((event) => split.push(event));
  parser.feed(S + "abc" + E);
  parser.feed("\x13\x07\x03" + E);
  const exposedControls = split
    .filter((event) => event.kind === "keys")
    .map((event) => event.text)
    .join("");
  assert.ok(exposedControls.includes("\x13"));
  writeFileSync(
    join(run, "paste-split-first-failure.json"),
    JSON.stringify(
      {
        gate: "FAIL_PROTOCOL_PROVENANCE",
        synthetic: true,
        realTerminal: "NOT_TESTED",
        description:
          "An embedded end marker and later raw control chunk cannot be distinguished from legitimate post-paste keys. Passing this witness test is not safety approval.",
        chunks: [S + "abc" + E, "\x13\x07\x03" + E],
        events: split,
        wholeChunkEvents: whole,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
});

test("G0 nested markers remain text; duplicate markers do not synthesize submit", () => {
  const events: { kind: string; text: string }[] = [];
  const parser = new ProbeFramer((event) => events.push(event));
  parser.feed(S + "abc" + S + "def" + E + E);
  assert.equal(events[0]?.text, "abc" + S + "def");
  assert.equal(
    events.some((event) => /[\x03\x07\x13]/.test(event.text)),
    false,
  );
});

test(
  "G0 helper serial ACK, competing lock, EOF release and queued flush",
  { timeout: 8000, skip: !["darwin", "linux"].includes(process.platform) },
  async () => {
    const dir = root();
    const trace: unknown[] = [];
    const writer = new ProbeWriter(dir, (kind, detail) =>
      trace.push({ kind, detail }),
    );
    await writer.ready;
    const other = launch(dir);
    assert.equal((await other.exit)[0], 73);
    writer.save({ text: "中文 😀\t\n" }, 200);
    writer.save({ text: "queued" });
    assert.equal(await writer.flush(1800), true);
    assert.equal(
      JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")).value.text,
      "queued",
    );
    const exit = once(writer.child, "exit");
    writer.close();
    await exit;
    const reopen = launch(dir);
    await ready(reopen);
    reopen.child.stdin.end();
    assert.equal((await reopen.exit)[0], 0);
    writeFileSync(
      join(run, "helper-serial.json"),
      JSON.stringify(trace, null, 2),
      { mode: 0o600 },
    );
  },
);

test(
  "G0 helper ignores terminal signals, completes in-flight atomic save before broken ACK pipe",
  { timeout: 8000, skip: !["darwin", "linux"].includes(process.platform) },
  async () => {
    const dir = root();
    const item = launch(dir);
    await ready(item);
    item.child.stdin.write(
      JSON.stringify({ seq: 1, value: "hangup-save", delay_ms: 350 }) + "\n",
    );
    await pause(100);
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM", "SIGTSTP"] as const)
      item.child.kill(signal);
    item.child.stdout.destroy();
    item.child.stdin.end();
    assert.equal((await item.exit)[0], 0);
    assert.equal(
      JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")).value,
      "hangup-save",
    );
    const reopen = launch(dir);
    await ready(reopen);
    reopen.child.stdin.end();
    await reopen.exit;
  },
);

test(
  "G0 helper SIGKILL releases flock and retains last durable snapshot",
  { timeout: 8000, skip: !["darwin", "linux"].includes(process.platform) },
  async () => {
    const dir = root();
    const item = launch(dir);
    await ready(item);
    item.child.stdin.write(JSON.stringify({ seq: 1, value: "durable" }) + "\n");
    for (let i = 0; i < 100 && item.lines.length < 2; i++) await pause(10);
    assert.equal(item.lines.length, 2);
    item.child.stdin.write(
      JSON.stringify({ seq: 2, value: "not-acked", delay_ms: 1000 }) + "\n",
    );
    await pause(100);
    item.child.kill("SIGKILL");
    await item.exit;
    assert.equal(
      JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")).value,
      "durable",
    );
    const reopen = launch(dir);
    await ready(reopen);
    reopen.child.stdin.end();
    await reopen.exit;
  },
);

test("G0 Linux clipboard is explicit unsupported, never implicit native/OSC fallback", () => {
  assert.equal(clipboardCapability("linux"), "unsupported");
  assert.equal(clipboardCapability("darwin"), "pbcopy");
});
