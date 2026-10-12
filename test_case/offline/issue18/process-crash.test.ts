import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { inspectProcess } from "../../../src/pi_secretary/src/process-control.ts";
import type {
  Operation,
  Execution,
} from "../../../src/pi_secretary/src/contracts.ts";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await pause(50);
  }
  throw Error("WORKER_TIMEOUT");
}
for (const kind of ["shell", "program"])
  for (const phase of [
    "before-identity",
    "after-identity",
    "running",
    "frozen-wrapper",
  ])
    test(`${kind}: actual Core SIGKILL ${phase} never releases a live managed process`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "process-crash-"));
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          new URL("./workers/process-crash.ts", import.meta.url).pathname,
          dir,
          kind,
          phase,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let err = "";
      child.stderr.on("data", (b) => (err += b));
      const exit = new Promise<string | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (_code, signal) => resolve(signal));
      });
      let app: App | undefined,
        original: NonNullable<Operation["process"]> | undefined;
      try {
        if (["running", "frozen-wrapper"].includes(phase)) {
          await until(() => fs.existsSync(path.join(dir, "ready")));
          const info = JSON.parse(
            fs.readFileSync(path.join(dir, "ready"), "utf8"),
          );
          original = info.process;
          await until(() => fs.existsSync(path.join(info.cwd, "proof")));
          assert.equal(inspectProcess(original!), "RUNNING");
          if (phase === "frozen-wrapper")
            process.kill(original!.pid!, "SIGSTOP");
          child.kill("SIGKILL");
        }
        assert.equal(await exit, "SIGKILL", err);
        app = await App.open(dir, {
          model: fixtureModel,
          stream: fixtureStream,
        });
        const op = app.store.all<Operation>("Operation")[0];
        assert.equal(op.process?.state, "STOPPED", JSON.stringify(op.process));
        const e = app.store.all<Execution>("Execution")[0];
        assert.equal(app.scheduler.processStopped(e.id), true);
        const proof = path.join(dir, "workspaces", e.task_id, "work", "proof");
        if (phase.includes("identity"))
          assert.equal(fs.existsSync(proof), false);
        else {
          const before = fs.readFileSync(proof, "utf8");
          await pause(150);
          assert.equal(fs.readFileSync(proof, "utf8"), before);
        }
        assert.equal(op.state, "RESULT_UNKNOWN");
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        if (original && inspectProcess(original) === "RUNNING")
          process.kill(-original.pgid!, "SIGKILL");
        await app?.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
