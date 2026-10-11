import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Execution,
  Feedback,
} from "../../../src/pi_secretary/src/contracts.ts";
for (const phase of ["resolved", "finished"])
  test(`resolve SIGKILL after ${phase} converges once and preserves command admission`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-crash-"));
    let app: App | undefined;
    try {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          new URL("./workers/resolve-crash.ts", import.meta.url).pathname,
          dir,
          phase,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let errors = "";
      child.stderr.on("data", (b) => (errors += b));
      const signal = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (_c, s) => resolve(s));
      });
      assert.equal(signal, "SIGKILL", errors);
      const { e, op, body } = JSON.parse(
        fs.readFileSync(path.join(dir, "request"), "utf8"),
      );
      for (let i = 0; i < 2; i++) {
        app = await App.open(dir, {
          model: fixtureModel,
          stream: fixtureStream,
        });
        const api = new ApplicationService(app);
        assert.equal(
          api.command(api.principal, `operations/${op}/resolve`, body)
            .acceptance,
          "ACCEPTED",
        );
        assert.equal(app.store.get<Execution>("Execution", e).state, "FAILED");
        assert.equal(app.store.all("TaskResult").length, 1);
        assert.equal(
          app.store.all<Feedback>("Feedback").filter((f) => f.kind === "RESULT")
            .length,
          1,
        );
        await app.close();
        app = undefined;
      }
    } finally {
      await app?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
