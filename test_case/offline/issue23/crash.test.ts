import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Input,
  WakeTimer,
} from "../../../src/pi_secretary/src/contracts.ts";

for (const kind of ["schedule", "coerced", "cancel", "noop", "fire", "api"])
  for (const phase of ["before", "after"])
    test(`SIGKILL ${phase} fsync: ${kind} wakeup transaction and Host reconciliation`, async () => {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "secretary-issue23-crash-"),
      );
      let app: App | undefined;
      try {
        const worker = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "test_case/offline/issue23/workers/crash.ts",
            dir,
            kind,
            phase,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let errors = "";
        worker.stderr.on("data", (b) => (errors += b));
        const [, signal] = await once(worker, "exit");
        assert.equal(signal, "SIGKILL", errors);
        const meta = JSON.parse(
          fs.readFileSync(path.join(dir, "case.json"), "utf8"),
        );
        app = await App.open(dir, {
          model: fixtureModel,
          stream: fixtureStream,
        });
        const timers = app.store.all<WakeTimer>("WakeTimer");
        if (["schedule", "coerced", "cancel", "noop"].includes(kind)) {
          await app.settle();
          if (phase === "before")
            assert.equal(app.host.session.state, "RECOVERY_BLOCKED");
          else {
            assert.notEqual(app.host.session.state, "RECOVERY_BLOCKED");
            assert.equal(timers.length, 1);
            assert.equal(app.store.all<WakeTimer>("WakeTimer").length, 1);
            const results = app.store.logs.filter(
              (e) => e.event_type === "main.tool.result",
            );
            const recovered = results
              .map((e) => app!.store.read<any>(e.payload))
              .find((v) =>
                v.key.includes(
                  ["schedule", "coerced"].includes(kind)
                    ? "schedule_wakeup"
                    : "cancel_wakeup",
                ),
              );
            assert(recovered);
            const value = JSON.parse(recovered.result.content[0].text);
            assert.equal(value.timer_id, timers[0].id);
            assert.equal(
              value.state,
              ["schedule", "coerced"].includes(kind) ? "PENDING" : "CANCELLED",
            );
          }
        } else if (kind === "fire") {
          assert.equal(
            app.store.all<Input>("Input").filter((i) => i.producer === "TIMER")
              .length,
            phase === "after" ? 1 : 0,
          );
          await app.pump();
          await app.host.drain();
          app.host.wakeups.fireDue();
          const inputs = app.store
            .all<Input>("Input")
            .filter((i) => i.producer === "TIMER");
          assert.equal(inputs.length, 1);
          assert.equal(
            app.host.wakeups.get(meta.timerID).input_id,
            inputs[0].id,
          );
          const text = app.store.bytes(inputs[0].payload).toString();
          assert(
            JSON.parse(text.slice(text.indexOf("\n") + 1)).late_by_ms >= 0,
          );
        } else {
          const service = new ApplicationService(app);
          assert.equal(
            !!app.store.find("ApiCommand", meta.requestID),
            phase === "after",
          );
          service.command(
            service.principal,
            "wakeups/" + meta.timerID + "/cancel",
            { request_id: meta.requestID },
          );
          assert.equal(app.host.wakeups.get(meta.timerID).state, "CANCELLED");
          assert.equal(app.store.all("ApiCommand").length, 1);
        }
      } finally {
        await app?.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
