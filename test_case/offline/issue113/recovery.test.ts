import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Input,
  Operation,
} from "../../../src/pi_secretary/src/contracts.ts";
for (const phase of ["approved", "committed", "reject"])
  test(`SIGKILL ${phase}: startup retains result and exactly one notification`, async () => {
    const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "secretary-113-crash-")),
      ),
      dir = path.join(root, "core");
    const child = fork(
      fileURLToPath(new URL("./crash-worker.ts", import.meta.url)),
      [dir, phase],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let errors = "";
    child.stderr!.on("data", (b) => (errors += b));
    try {
      const msg = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("worker timeout " + errors)),
          20000,
        );
        child.once("message", (m) => {
          clearTimeout(timer);
          resolve(m);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(Error("worker exit " + code + " " + errors));
        });
      });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
      const app = await App.open(dir, {
        model: fixtureModel,
        stream: fixtureStream,
      });
      try {
        app.scopeImports.drain();
        const op = app.store.get<Operation>("Operation", msg.operation_id);
        assert.equal(op.state, phase === "reject" ? "CANCELLED" : "SUCCEEDED");
        assert.equal(app.store.all("Scope").length, phase === "reject" ? 0 : 1);
        assert.equal(
          app.store
            .all<Input>("Input")
            .filter((i) => i.producer === "ENVIRONMENT").length,
          1,
        );
        assert.equal(app.store.all("ModelCall").length, 0);
      } finally {
        await app.close();
      }
      const again = await App.open(dir, {
        model: fixtureModel,
        stream: fixtureStream,
      });
      try {
        assert.equal(
          again.store
            .all<Input>("Input")
            .filter((i) => i.producer === "ENVIRONMENT").length,
          1,
        );
      } finally {
        await again.close();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
