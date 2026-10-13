import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import type { Execution } from "../../../src/pi_secretary/src/contracts.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";

const started = "2026-10-05T00:00:00.000Z";
const ended = "2026-10-05T00:00:42.000Z";

test("failed task elapsed uses durable timestamps before and after restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-elapsed-"));
  const options = {
    main: { model: fixtureModel, stream: fixtureStream },
    task: {
      model: fixtureModel,
      stream: () =>
        replyStream([{ type: "text" as const, text: "No structured result" }]),
    },
  };
  let app = await App.open(dir, options);
  try {
    app.scheduler.propose("synthetic failed task", id(), app.host.sessionID);
    app.scheduler.tick();
    await app.scheduler.idle();
    const e = app.store.all<Execution>("Execution")[0];
    assert.equal(e.state, "FAILED");
    // Simulate a historical task whose metadata was updated after termination.
    app.store.commit([revise(e, { started_at: started, ended_at: ended })]);
    for (let iteration = 0; iteration < 2; iteration++) {
      const a = app
        .activitySnapshot()
        .activities.find((a) => a.execution_id === e.id)!;
      assert.equal(a.status, "failed");
      assert.equal(a.started_at, started);
      assert.equal(a.ended_at, ended);
      assert.deepEqual(
        app.activitySnapshot().activities.find((item) => item.id === a.id),
        a,
      );
      if (!iteration) {
        await app.close();
        app = await App.open(dir, options);
      }
    }
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("completed task history uses execution end time even when observed later", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-elapsed-"));
  let release!: () => void;
  let enter!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const app = await App.open(dir, {
    main: { model: fixtureModel, stream: fixtureStream },
    task: {
      model: fixtureModel,
      stream: async (m, c, o) => {
        enter();
        await blocked;
        return fixtureStream(m, c, o);
      },
    },
  });
  try {
    app.scheduler.propose("synthetic completed task", id(), app.host.sessionID);
    app.scheduler.tick();
    await entered;
    const running = app
      .activitySnapshot()
      .activities.find((a) => a.kind === "task")!;
    assert.equal(running.status, "running");
    release();
    await app.scheduler.idle();
    const e = app.store.get<Execution>("Execution", running.execution_id!);
    assert.equal(e.state, "SUCCEEDED");
    app.store.commit([revise(e, { started_at: started, ended_at: ended })]);
    const snapshot = app.activitySnapshot();
    assert(!snapshot.activities.some((a) => a.id === running.id));
    const completed = snapshot.recent
      .filter((a) => a.id === running.id)
      .at(-1)!;
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.started_at, started);
    assert.equal(completed.ended_at, ended);
  } finally {
    release();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
