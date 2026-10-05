import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { activityLine } from "../../../src/pi_secretary/src/activity-terminal.ts";
import type { Activity } from "../../../src/pi_secretary/src/activity.ts";
import type { Execution } from "../../../src/pi_secretary/src/contracts.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";

const source = fs.readFileSync(
  new URL("../../../src/pi_secretary/web/activity.js", import.meta.url),
  "utf8",
);
const { ActivityView } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const renderers = [
  activityLine,
  (a: Activity, at: number) => ActivityView.prototype.text(a, at),
];
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
      for (const render of renderers) {
        const before = render(a, Date.parse(ended) + 1000);
        assert.match(before, /已用 42 秒/);
        assert.equal(render(a, Date.parse(ended) + 86400000), before);
      }
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

test("Web and TUI freeze terminal records without ended_at but keep live clocks running", () => {
  const a: Activity = {
    id: "task:synthetic",
    parent_id: null,
    session_id: "synthetic",
    execution_id: "synthetic",
    scope: "background",
    kind: "task",
    phase: "任务处理失败",
    status: "failed",
    version: 1,
    started_at: started,
    last_progress_at: ended,
    ended_at: null,
    actions: ["tasks"],
  };
  for (const render of renderers) {
    for (const status of [
      "failed",
      "succeeded",
      "interrupted",
      "cancelled",
    ] as const) {
      const terminal = { ...a, status };
      assert.match(render(terminal, Date.parse(ended) + 1000), /已用 42 秒/);
      assert.equal(
        render(terminal, Date.parse(ended) + 1000),
        render(terminal, Date.parse(ended) + 86400000),
      );
    }
    for (const status of ["running", "waiting"] as const) {
      assert.match(
        render({ ...a, status }, Date.parse(ended) + 1000),
        /已用 43 秒/,
      );
      assert.match(
        render({ ...a, status }, Date.parse(ended) + 2000),
        /已用 44 秒/,
      );
    }
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
    for (const render of renderers)
      assert.match(
        render(completed, Date.parse(ended) + 86400000),
        /已用 42 秒/,
      );
  } finally {
    release();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
