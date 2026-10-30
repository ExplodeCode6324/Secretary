import test from "node:test";
import assert from "node:assert/strict";
import {
  pipeClipboard,
  copySelection,
} from "../../../src/pi_secretary/src/tui/clipboard.ts";

test("clipboard pipe preserves exact UTF-8, whitespace and shell metacharacters without a shell", async () => {
  const value = "  中文 👩‍💻\n\t$(do-not-run) `do-not-run` ' \" \\ \n";
  const expected = Buffer.from(value).toString("base64");
  const child = `let b=[];process.stdin.on('data',x=>b.push(x));process.stdin.on('end',()=>process.exit(Buffer.concat(b).toString('base64')===${JSON.stringify(expected)}?0:7))`;
  assert.equal(
    await pipeClipboard(process.execPath, ["-e", child], value),
    true,
  );
});

test("clipboard nonzero exit, unavailable executable, early stdin close and timeout never report success", async () => {
  assert.notEqual(
    await pipeClipboard(process.execPath, ["-e", "process.exit(42)"], "text"),
    true,
  );
  assert.notEqual(
    await pipeClipboard("/secretary-nonexistent-clipboard-command", [], "text"),
    true,
  );
  assert.notEqual(
    await pipeClipboard(
      process.execPath,
      ["-e", "process.exit(0)"],
      "x".repeat(4 * 1024 * 1024),
    ),
    true,
  );
  const start = Date.now();
  assert.notEqual(
    await pipeClipboard(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      "text",
      250,
    ),
    true,
  );
  assert.ok(Date.now() - start < 5000);
});

test("unsupported clipboard platform reports limitation instead of OSC52 success", async () => {
  assert.match(String(await copySelection("text", "linux")), /复制|clipboard/i);
});

test("overlapping copy jobs run in order, including after a failed copy", async () => {
  const { serialClipboardWriter } =
    await import("../../../src/pi_secretary/src/tui/clipboard.ts");
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const started: string[] = [],
    completed: string[] = [];
  const copy = serialClipboardWriter(async (text) => {
    started.push(text);
    if (text === "first") await gate;
    completed.push(text);
    if (text === "first") throw Error("synthetic clipboard failure");
    return true;
  });
  const first = copy("first");
  const rejected = assert.rejects(first, /synthetic/);
  const second = copy("second");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(started, ["first"]);
  release();
  await rejected;
  assert.equal(await second, true);
  assert.deepEqual(completed, ["first", "second"]);
});

test("SSH clipboard use is rejected without writing the host clipboard", async () => {
  const old = process.env.SSH_CONNECTION;
  process.env.SSH_CONNECTION = "synthetic-ssh";
  try {
    assert.match(String(await copySelection("text", "darwin")), /SSH/);
  } finally {
    if (old === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = old;
  }
});
