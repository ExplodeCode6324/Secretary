import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id, hash } from "../../../src/pi_secretary/src/store.ts";
import { drain } from "./helpers.ts";
for (const kind of ["message", "ack"])
  for (const phase of ["before", "after"])
    test(`S04/C01/N02: SIGKILL ${phase} fsync before install/publish/HTTP response: ${kind}`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue9-kill-"));
      const worker = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "test_case/offline/issue9/workers/crash.ts",
          dir,
          phase,
          kind,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      worker.stderr.on("data", (v) => (stderr += v));
      const [, signal] = await once(worker, "exit");
      assert.equal(signal, "SIGKILL", stderr);
      const saved = JSON.parse(
        fs.readFileSync(path.join(dir, "fixture.json"), "utf8"),
      );
      const app = await App.open(dir, {
        model: fixtureModel,
        stream: fixtureStream,
      });
      const server = await serveCore(app, 0, undefined, { pump: false });
      const c = new CoreClient(server.endpoint, saved.binding);
      try {
        const snap = await c.bootstrap();
        assert.equal(snap.history_id, saved.snapshot.history_id);
        assert.notEqual(snap.instance_id, saved.snapshot.instance_id);
        const receipt = app.store.find("ApiCommand", saved.body.request_id);
        assert.equal(!!receipt, phase === "after");
        if (phase === "after")
          assert(
            (await drain(c, saved.snapshot.cursor)).batches.some((b) =>
              b.changes.some(
                (v: any) => v.request_id === saved.body.request_id,
              ),
            ),
          );
        const accepted = await c.command(saved.route, saved.body);
        assert.equal(accepted.acceptance, "ACCEPTED");
        const sequence = app.store.sequence;
        assert.deepEqual(await c.command(saved.route, saved.body), accepted);
        assert.equal(app.store.sequence, sequence);
        await assert.rejects(
          c.command(saved.route, {
            ...saved.body,
            ...(kind === "message" ? { text: "different" } : { kind: "read" }),
          }),
          /REQUEST_CONFLICT/,
        );
        if (kind === "message") assert.equal(app.store.all("Input").length, 1);
        else {
          const d: any = app.store.all("NotificationDelivery")[0];
          assert(d.received_at);
          assert.equal(d.presented_at, null);
        }
        const out = await drain(c, saved.snapshot.cursor);
        // Durable client cache and cursor are replaced together, using only complete transaction batches.
        const seen = new Set<string>();
        let applied = saved.snapshot.cursor;
        for (const b of out.batches) {
          seen.add(b.transaction_id + ":" + b.index);
          if (b.final) applied = b.cursor;
        }
        const file = path.join(dir, "replica.json");
        fs.writeFileSync(
          file + ".tmp",
          JSON.stringify({ seen: [...seen], cursor: applied }),
        );
        fs.renameSync(file + ".tmp", file);
        const restored = JSON.parse(fs.readFileSync(file, "utf8"));
        assert.equal((await c.changes(restored.cursor)).batches.length, 0);
      } finally {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

for (const phase of ["before", "after"])
  test(`N04: explicit initialization SIGKILL ${phase} fsync preserves legacy evidence`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue9-init-kill-"));
    const worker = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "test_case/offline/issue9/workers/crash.ts",
        dir,
        phase,
        "initialize",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    worker.stderr.on("data", (v) => (stderr += v));
    const [, signal] = await once(worker, "exit");
    assert.equal(signal, "SIGKILL", stderr);
    const saved = JSON.parse(
      fs.readFileSync(path.join(dir, "fixture.json"), "utf8"),
    );
    const app = await App.open(dir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    const server = await serveCore(app, 0, undefined, { pump: false });
    const c = new CoreClient(server.endpoint);
    try {
      assert.equal(
        app.store.all("SyncMetadata").length,
        phase === "after" ? 1 : 0,
      );
      assert.equal(
        !!app.store.find("ApiCommand", saved.body.request_id),
        phase === "after",
      );
      if (phase === "before")
        await assert.rejects(c.bootstrap(), /SYNC_NOT_INITIALIZED/);
      assert.equal(
        hash(JSON.stringify(app.store.all("Notification"))),
        saved.legacyHash,
      );
      const accepted = await c.command(saved.route, saved.body);
      const cursor = (await c.bootstrap()).cursor;
      assert.deepEqual(await c.command(saved.route, saved.body), accepted);
      assert.equal((await c.bootstrap()).cursor, cursor);
      assert.equal(app.store.all("SyncMetadata").length, 1);
      assert.equal(app.store.all("NotificationDelivery").length, 0);
      assert.equal(
        hash(JSON.stringify(app.store.all("Notification"))),
        saved.legacyHash,
      );
      for (const n of app.store.all<any>("Notification")) {
        assert.equal(
          app.store.bytes(n.message).toString("utf8"),
          "Synthetic historical " + n.state,
        );
        if (n.state === "SENT")
          assert.equal(app.store.read<any>(n.receipt).presented, true);
      }
    } finally {
      await server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
