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
for (const kind of ["message", "task", "approval", "settings"])
  for (const phase of ["before", "after"])
    test(`SIGKILL ${phase} journal fsync: ${kind} admission and mutation are inseparable`, async () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "secretary-api-crash-"),
      );
      const worker = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "test_case/offline/issue8/workers/crash.ts",
          directory,
          phase,
          kind,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let errors = "";
      worker.stderr.on("data", (b) => (errors += b));
      const [code, signal] = await once(worker, "exit");
      assert.equal(signal, "SIGKILL", errors);
      const request = JSON.parse(
        fs.readFileSync(path.join(directory, "test-request.json"), "utf8"),
      );
      const app = await App.open(directory, {
          model: fixtureModel,
          stream: fixtureStream,
        }),
        service = new ApplicationService(app);
      try {
        const prior = app.store.find("ApiCommand", request.body.request_id);
        assert.equal(!!prior, phase === "after");
        if (prior) {
          const frame = app.store.projectionFrames.find((f) =>
            f.mutations.some(
              (m) => m.object_type === "ApiCommand" && m.object_id === prior.id,
            ),
          )!;
          assert(frame.mutations.some((m) => m.object_type !== "ApiCommand"));
          const seq = app.store.sequence;
          service.command(service.principal, request.route, request.body);
          assert.equal(app.store.sequence, seq);
        } else service.command(service.principal, request.route, request.body);
        assert.equal(app.store.all("ApiCommand").length, 1);
        assert.throws(
          () =>
            service.command(service.principal, "clients", {
              request_id: request.body.request_id,
              name: "conflicting type",
            }),
          /REQUEST_CONFLICT/,
        );
      } finally {
        await service.close();
        await app.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
for (const phase of ["queued", "running"])
  test(`SIGKILL long command ${phase}: replay only undispatched intent`, async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "secretary-api-long-crash-"),
    );
    const worker = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "test_case/offline/issue8/workers/long-crash.ts",
        directory,
        phase,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let errors = "";
    worker.stderr.on("data", (b) => (errors += b));
    const [, signal] = await once(worker, "exit");
    assert.equal(signal, "SIGKILL", errors);
    const request = JSON.parse(
      fs.readFileSync(path.join(directory, "test-request.json"), "utf8"),
    );
    const app = await App.open(directory, {
        model: fixtureModel,
        stream: fixtureStream,
      }),
      service = new ApplicationService(app);
    try {
      for (
        let i = 0;
        i < 100 &&
        ["QUEUED", "RUNNING"].includes(
          service.receipt(request.request_id).state,
        );
        i++
      )
        await new Promise((r) => setTimeout(r, 10));
      assert.equal(
        service.receipt(request.request_id).state,
        phase === "queued" ? "COMPLETED" : "UNKNOWN",
      );
      const calls = app.store.all("ModelCall").length,
        seq = app.store.sequence;
      service.command(service.principal, "session/compact", request);
      assert.equal(app.store.sequence, seq);
      assert.equal(app.store.all("ModelCall").length, calls);
    } finally {
      await service.close();
      await app.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
