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
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type { Input } from "../../../src/pi_secretary/src/contracts.ts";

for (const condition of ["CLAIMED", "ACTIVE_LOOP"] as const) {
  test(`changed-runtime startup refuses ${condition} before queuing settings rebuild`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-upgrade-"));
    let app: App | undefined = await App.open(dir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    try {
      const input = app.host.accept("Preserve this unfinished input.");
      if (condition !== "ACTIVE_LOOP") {
        app.store.commit([
          revise(input, {
            state: "CLAIMED",
            loop_id: id(),
          }),
        ]);
      } else {
        app.store.commit([revise(app.host.session, { active_loop_id: id() })]);
      }
      const before = structuredClone(app.store.get<Input>("Input", input.id));
      await app.close();
      app = undefined;
      await assert.rejects(async () => {
        app = await App.open(dir, {
          model: { ...fixtureModel, id: "new-runtime" },
          stream: fixtureStream,
        });
      }, /SETTINGS_UPGRADE_REQUIRES_IDLE_MAIN/);
      app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
      assert.deepEqual(app.store.get<Input>("Input", input.id), before);
      assert.equal(app.settings.applications().length, 0);
      assert.equal(app.settings.blocked, false);
    } finally {
      await app?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("changed runtime rebuilds idle history and then handles merely accepted input", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-upgrade-idle-"));
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  try {
    app.host.accept("Remember the unchanged conditional constraint.");
    await app.host.drain();
    const queued = app.host.accept(
      "Accepted work may wait for settings rebuilding.",
    );
    await app.close();
    app = await App.open(dir, {
      model: { ...fixtureModel, id: "new-idle-runtime" },
      stream: fixtureStream,
    });
    assert.equal(app.settings.blocked, true);
    await app.settings.tick();
    assert.equal(app.settings.applications().at(-1)?.state, "APPLIED");
    assert.equal(app.settings.blocked, false);
    await app.host.drain();
    assert.equal(app.store.get<Input>("Input", queued.id).state, "HANDLED");
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("same-runtime reopen permits explicit recovery of a genuinely paused Main", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-upgrade-resume-"));
  let app = await App.open(dir, {
    model: fixtureModel,
    stream: () => {
      throw Error("CONTROLLED_LOCAL_PAUSE");
    },
  });
  try {
    const input = app.host.accept("Acknowledge without tool use.");
    await app.host.drain();
    assert.equal(app.host.session.state, "RECOVERY_BLOCKED");
    await app.close();
    app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
    assert.equal(app.settings.blocked, false);
    assert.equal((await app.host.resume()).applied, true);
    await app.host.drain();
    assert.equal(app.store.get<Input>("Input", input.id).state, "HANDLED");
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
