import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import {
  launchProcess,
  inspectProcess,
  persistStop,
} from "../../../src/pi_secretary/src/process-control.ts";
import { revise } from "../../../src/pi_secretary/src/store.ts";
import { interrupted } from "./helpers.ts";
import type { Operation } from "../../../src/pi_secretary/src/contracts.ts";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
test("unexpected wrapper death returns an unknown result without waiting forever on descendant pipes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leader-exit-"));
  const app = await App.open(root, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  let group: number | undefined, payload: number | undefined;
  try {
    const { e, op } = interrupted(app);
    const { process: _, ...legacy } = op;
    app.store.commit([revise(legacy, {})]);
    const launched = await launchProcess(
      app.store,
      op.id,
      [
        process.execPath,
        "-e",
        "require('fs').writeFileSync('child-pid',String(process.pid));setInterval(()=>{},25)",
      ],
      root,
      { PATH: process.env.PATH },
    );
    const record = app.store.get<Operation>("Operation", op.id).process!;
    group = record.pgid;
    launched.child.stdout!.resume();
    launched.child.stderr!.resume();
    launched.child.stdin!.end();
    launched.start();
    for (
      let i = 0;
      i < 100 && !fs.existsSync(path.join(root, "child-pid"));
      i++
    )
      await pause(20);
    payload = Number(fs.readFileSync(path.join(root, "child-pid"), "utf8"));
    assert.equal(inspectProcess(record), "RUNNING");
    launched.child.kill("SIGKILL");
    const closed = await Promise.race([
      launched.closed.then(() => true),
      pause(2000).then(() => false),
    ]);
    assert.equal(closed, true);
    // The surviving member pins the PGID, but a dead leader supplies no matching identity.
    assert.equal(inspectProcess(record), "UNCONFIRMED");
    persistStop(app.store, op.id, "UNCONFIRMED");
    assert.equal(app.scheduler.processStopped(e.id), false);
  } finally {
    // This fixture owns the still-live member; never used by product recovery.
    if (payload)
      try {
        process.kill(payload, "SIGKILL");
      } catch {}
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
