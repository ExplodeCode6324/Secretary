import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const worker = new URL("./workers/model-crash.ts", import.meta.url);
async function run(dir: string, phase: string) {
  const c = spawn(
    process.execPath,
    ["--import", "tsx", worker.pathname, dir, phase],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let errors = "";
  c.stderr.on("data", (b) => (errors += b));
  return await new Promise<{
    code: number | null;
    signal: string | null;
    errors: string;
  }>((resolve, reject) => {
    c.on("error", reject);
    c.on("exit", (code, signal) => resolve({ code, signal, errors }));
  });
}
for (const phase of ["in-flight", "response-saved", "tool-saved"])
  test(`TASK ${phase} SIGKILL resumes frozen request without duplicating successful sends`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-model-crash-"));
    try {
      const first = await run(dir, phase);
      assert.equal(first.signal, "SIGKILL", first.errors);
      const second = await run(dir, phase);
      assert.equal(second.code, 0, second.errors);
      const states = JSON.parse(
        fs.readFileSync(path.join(dir, "states"), "utf8"),
      );
      if (phase === "tool-saved")
        assert.equal(
          fs.readFileSync(path.join(dir, "tool-count"), "utf8"),
          "1",
        );
      assert.equal(states.length, 1);
      assert.equal(states[0].state, "SUCCEEDED");
      assert.equal(
        fs.readFileSync(path.join(dir, "sends"), "utf8").length,
        phase === "response-saved" ? 1 : 2,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
