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
import type { Operation } from "../../../src/pi_secretary/src/contracts.ts";
import { approve, executions } from "./helpers.ts";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
test("actual Core SIGKILL with a frozen wrapper cannot start the next DIRECTORY program before group cleanup", async () => {
  const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "scope-crash-")),
    ),
    project = path.join(root, "project");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      new URL("./workers/scope-crash.ts", import.meta.url).pathname,
      root,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let error = "";
  child.stderr.on("data", (b) => (error += b));
  const exit = new Promise((r) => child.on("exit", (_c, s) => r(s)));
  let app: App | undefined,
    processRecord: NonNullable<Operation["process"]> | undefined;
  try {
    for (
      let i = 0;
      i < 200 && !fs.existsSync(path.join(project, "first-proof"));
      i++
    )
      await pause(50);
    assert(fs.existsSync(path.join(project, "first-proof")), error);
    processRecord = JSON.parse(
      fs.readFileSync(path.join(root, "ready"), "utf8"),
    );
    assert.equal(inspectProcess(processRecord!), "RUNNING");
    process.kill(processRecord!.pid!, "SIGSTOP");
    child.kill("SIGKILL");
    assert.equal(await exit, "SIGKILL");
    assert.equal(fs.existsSync(path.join(project, "second-proof")), false);
    app = await App.open(path.join(root, "data"), {
      model: fixtureModel,
      stream: fixtureStream,
    });
    assert.equal(app.scheduler.processStopped(executions(app)[0].id), true);
    const before = fs.readFileSync(path.join(project, "first-proof"), "utf8");
    app.scheduler.tick();
    await app.scheduler.idle();
    approve(app);
    app.scheduler.tick();
    await app.scheduler.idle();
    assert.equal(executions(app)[1].state, "SUCCEEDED");
    assert.equal(fs.existsSync(path.join(project, "second-proof")), true);
    assert.equal(
      fs.readFileSync(path.join(project, "first-proof"), "utf8"),
      before,
    );
    assert.equal(executions(app)[0].workspace_binding!.root_path, project);
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    if (processRecord && inspectProcess(processRecord) === "RUNNING")
      process.kill(-processRecord.pgid!, "SIGKILL");
    await app?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
