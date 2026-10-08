import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { activityHistoryFor } from "../../../src/pi_secretary/src/activity-history.ts";
import {
  Activities,
  activitiesFor,
  safeActivityReason,
} from "../../../src/pi_secretary/src/activity.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { serve } from "../../../src/pi_secretary/src/backend.ts";
import { api } from "../../../src/pi_secretary/src/ui-client.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import type {
  Consciousness,
  SettingsApplication,
  Input,
  ModelCall,
} from "../../../src/pi_secretary/src/contracts.ts";
import { delayedStream } from "./helpers/streaming.ts";
const temp = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "secretary-activity-"));
const scope = (session: string) => ({
  session_id: session,
  task_id: null,
  execution_id: null,
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("activity condition timeout");
}

test("independent activities, stable snapshot, short history and session isolation", async () => {
  const dir = temp(),
    app = await App.open(dir);
  try {
    const a = activitiesFor(app.store),
      s = scope(app.host.sessionID);
    a.start("A", s, "tool", "正在查看 World Model");
    a.start("B", s, "model", "正在思考");
    a.start("OTHER", scope(id()), "tool", "OTHER_SESSION_SECRET");
    const first = app.activitySnapshot();
    assert.equal(first.activities.length, 2);
    assert.equal(
      app.activitySnapshot().activity_revision,
      first.activity_revision,
    );
    a.end("A");
    a.end("A");
    assert.deepEqual(
      app.activitySnapshot().activities.map((x) => x.id),
      ["B"],
    );
    assert(
      app.activitySnapshot().recent.some((x) => x.id === "A" && x.ended_at),
    );
    assert(
      !JSON.stringify(app.activitySnapshot()).includes("OTHER_SESSION_SECRET"),
    );
    for (let i = 0; i < 90; i++) {
      a.start("short" + i, s, "tool", "查询");
      a.end("short" + i);
    }
    assert(app.activitySnapshot().recent.length <= 50);
    assert.equal(app.activitySnapshot().activities.length, 1);
    a.end("B");
    assert.equal(app.activitySnapshot().activities.length, 0);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("model lifetime visible before response; activity SSE works without preview and authenticates", async () => {
  const dir = temp(),
    app = await App.open(dir, {
      model: fixtureModel,
      stream: delayedStream(70),
    }),
    server = await serve(app),
    controller = new AbortController();
  try {
    const client = (await api(server.endpoint, "/api/client", {})).client;
    assert.equal(
      (await fetch(server.endpoint.url + "/api/activity?client=" + client))
        .status,
      401,
    );
    const response = await fetch(
      server.endpoint.url + `/api/stream?client=${client}&activity=1&preview=0`,
      {
        headers: { Authorization: `Bearer ${server.endpoint.token}` },
        signal: controller.signal,
      },
    );
    let output = "";
    const consume = (async () => {
      try {
        for await (const chunk of response.body!)
          output += new TextDecoder().decode(chunk);
      } catch {}
    })();
    app.host.accept("PRIVATE_INPUT");
    const work = app.host.drain();
    await until(() =>
      app.activitySnapshot().activities.some((a) => a.kind === "model"),
    );
    const snapshot = await api(
      server.endpoint,
      "/api/activity?client=" + client,
    );
    assert(snapshot.activities.some((a: any) => a.phase === "正在思考"));
    assert(!JSON.stringify(snapshot).includes("PRIVATE_INPUT"));
    const same = await api(
      server.endpoint,
      `/api/activity?client=${client}&instance=${snapshot.server_instance_id}&since=${snapshot.activity_revision}`,
    );
    assert.equal(same.unchanged, true);
    await work;
    await until(() => output.includes("正在思考"));
    assert(!output.includes("event: preview"));
    assert(!output.includes("PRIVATE_SIGNATURE"));
    assert(!app.activitySnapshot().activities.some((a) => a.kind === "model"));
    controller.abort();
    await consume;
  } finally {
    controller.abort();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("settings real chunks, retry, extraction and persisted queue; no duplicate acceptance", async () => {
  const dir = temp(),
    summary = gate(),
    extract = gate();
  let entered = 0,
    extraction = false,
    fail = true;
  const stream: StreamFn = async (m, c, o) => {
    const sys = c.messages
      .filter((x) => x.role === "system")
      .map((x) => contentText(x.content))
      .join();
    if (sys.includes("CONSCIOUSNESS")) {
      entered++;
      if (fail) {
        fail = false;
        return replyStream([
          { type: "text", text: "invalid JSON PRIVATE_ERROR" },
        ]);
      }
      await summary.promise;
    }
    if (sys.includes("COMMITMENT_EXTRACTION")) {
      extraction = true;
      await extract.promise;
    }
    return fixtureStream(m, c, o);
  };
  const app = await App.open(dir, { model: fixtureModel, stream });
  try {
    app.host.accept("synthetic old input");
    await app.host.drain();
    const cs = app.store.get<Consciousness>(
      "Consciousness",
      app.host.session.consciousness_id,
    );
    app.store.commit([
      revise(cs, {
        pending_raw_refs: [
          ...cs.pending_raw_refs,
          app.store.put([
            // Issue #2 extracts whole messages after all summaries. Keep the
            // same 27k source volume in complete messages that individually fit.
            ...Array.from({ length: 3 }, (_, index) => ({
              role: "user",
              content: "synthetic ".repeat(900),
              timestamp: index + 1,
            })),
          ]),
        ],
      }),
    ]);
    app.settings.save(
      {
        ...emptySettings(),
        instructions: {
          content: "中文",
          expected_revision: getInstructions(app.store).revision,
        },
      },
      app.settings.draft().revision,
    );
    const application = app.settings.request(
      app.settings.draft().revision,
      id(),
    ) as SettingsApplication;
    await until(() => entered >= 2);
    const request = id(),
      input = app.host.accept("queued", request);
    assert.equal(app.host.accept("queued", request).id, input.id);
    let snap = app.activitySnapshot(),
      setting = snap.activities.find((a) => a.kind === "settings")!;
    assert.equal(snap.queue.accepted, 1);
    assert.equal(snap.queue.blocked, true);
    assert(setting.progress!.total! >= 3);
    assert.equal(setting.progress!.completed, 0);
    assert.equal(setting.progress!.attempt, 2);
    summary.release();
    await until(() => extraction);
    setting = app
      .activitySnapshot()
      .activities.find((a) => a.kind === "settings")!;
    assert.equal(setting.phase, "正在提取承诺");
    assert.equal(setting.progress!.completed, setting.progress!.total);
    extract.release();
    await app.settings.tick();
    assert.equal(
      app.store.get<SettingsApplication>("SettingsApplication", application.id)
        .state,
      "APPLIED",
    );
    assert(
      !app.activitySnapshot().activities.some((a) => a.kind === "settings"),
    );
    await app.host.drain();
    assert.equal(app.store.get<Input>("Input", input.id).state, "HANDLED");
    assert.equal(app.activitySnapshot().queue.accepted, 0);
    assert(!JSON.stringify(app.activitySnapshot()).includes("PRIVATE_ERROR"));
  } finally {
    summary.release();
    extract.release();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("background tasks coexist with main; end of one never removes the others", async () => {
  const dir = temp(),
    one = gate(),
    two = gate(),
    main = gate();
  let taskCalls = 0;
  const taskStream: StreamFn = async (m, c, o) => {
    const n = ++taskCalls;
    await (n === 1 ? one.promise : two.promise);
    return fixtureStream(m, c, o);
  };
  const app = await App.open(dir, {
    main: {
      model: fixtureModel,
      stream: async (m, c, o) => {
        await main.promise;
        return fixtureStream(m, c, o);
      },
    },
    task: { model: fixtureModel, stream: taskStream },
  });
  try {
    // Use real task proposal, scheduler dispatch and task model lifetimes.
    app.scheduler.propose("A", id(), app.host.sessionID);
    app.scheduler.propose("B", id(), app.host.sessionID);
    app.scheduler.tick();
    await until(() => taskCalls === 2);
    app.host.accept("main");
    const work = app.host.drain();
    await until(() =>
      app.activitySnapshot().activities.some((a) => a.scope === "main"),
    );
    let s = app.activitySnapshot();
    assert.equal(s.background_counts.running, 2);
    assert.equal(
      s.activities.filter((a) => a.scope === "background").length,
      2,
    );
    one.release();
    await until(() => app.activitySnapshot().background_counts.running === 1);
    s = app.activitySnapshot();
    assert(s.activities.some((a) => a.scope === "main"));
    assert.equal(
      s.activities.filter((a) => a.scope === "background").length,
      1,
    );
    two.release();
    main.release();
    await work;
    await app.scheduler.idle();
  } finally {
    one.release();
    two.release();
    main.release();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("restart never projects old IN_FLIGHT as thinking; safe errors and failing observers", async () => {
  const dir = temp();
  let app = await App.open(dir);
  try {
    app.host.accept("baseline");
    await app.host.drain();
    const c = app.store.all<ModelCall>("ModelCall")[0];
    app.store.commit([revise(c, { state: "IN_FLIGHT", completed_at: null })]);
    const previous = app.activitySnapshot().server_instance_id;
    await app.close();
    app = await App.open(dir);
    assert.notEqual(app.activitySnapshot().server_instance_id, previous);
    assert(
      !app.activitySnapshot().activities.some((a) => a.phase === "正在思考"),
    );
    assert.equal(
      safeActivityReason("sk-PRIVATE postgres://PRIVATE"),
      "处理失败，请查看相关状态",
    );
    const registry = activitiesFor(app.store);
    registry.start = () => {
      throw Error("observer");
    };
    registry.end = () => {
      throw Error("observer");
    };
    app.host.accept("still executes");
    await app.host.drain();
    assert.equal(app.host.session.state, "IDLE");
    assert.equal(
      await registry.tool(
        "probe",
        scope(app.host.sessionID),
        "read",
        {},
        async () => 42,
      ),
      42,
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("actual SIGKILL in model/settings restores honest activity without replaying input", async () => {
  const { spawn } = await import("node:child_process");
  for (const mode of ["model", "settings"]) {
    const dir = temp(),
      child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "test_case/offline/runtime/helpers/activity-crash.ts",
          dir,
          mode,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    let output = "";
    child.stdout.on("data", (b) => (output += b));
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b));
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    let app: App | undefined;
    try {
      await until(() => output.includes("IN_FLIGHT"));
      child.kill("SIGKILL");
      await exited;
      app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
      const before = app.activitySnapshot();
      assert(!before.activities.some((a) => a.phase === "正在思考"));
      if (mode === "settings")
        assert(
          before.activities.some(
            (a) => a.kind === "settings" && a.status === "waiting",
          ),
        );
      await app.settings.tick();
      await app.host.drain();
      assert(
        !app.activitySnapshot().activities.some((a) => a.status === "running"),
      );
      assert.equal(
        app.store.all<Input>("Input").filter((i) => i.producer === "MASTER")
          .length,
        1,
      );
      assert.equal(app.store.all<Input>("Input")[0].state, "HANDLED");
      assert.equal(stderr, "");
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited;
      await app?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("activity endpoint remains responsive while same client's command is running", async () => {
  const dir = temp(),
    app = await App.open(dir, {
      model: fixtureModel,
      stream: delayedStream(120),
    }),
    entered = gate(),
    release = gate();
  Object.defineProperty(app, "world", {
    value: {
      read: async () => {
        entered.release();
        await release.promise;
        return {};
      },
      drain: async () => {},
      close: async () => {},
    },
  });
  const server = await serve(app);
  try {
    const client = (await api(server.endpoint, "/api/client", {})).client;
    let done = false;
    const work = api(server.endpoint, "/api/command", {
      client,
      line: "/world-read",
    }).then(() => {
      done = true;
    });
    await entered.promise;
    app.host.accept("synthetic model input");
    const modelWork = app.host.drain();
    await until(() =>
      app.activitySnapshot().activities.some((a) => a.kind === "model"),
    );
    const snapshot = await api(
      server.endpoint,
      "/api/activity?client=" + client,
    );
    assert(!done);
    assert(snapshot.activities.some((a: any) => a.kind === "model"));
    release.release();
    await work;
    await modelWork;
  } finally {
    release.release();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("real decision/auth waits and cancellation remain separate from execution", async () => {
  const dir = temp();
  const taskStream: StreamFn = (m, c) => {
    const system = c.messages
      .filter((x) => x.role === "system")
      .map((x) => contentText(x.content))
      .join();
    if (system.includes("TASK_EXECUTOR"))
      return replyStream([
        {
          type: "toolCall",
          id: id(),
          name: "request_decision",
          arguments: { question: "synthetic choice" },
        },
      ]);
    return fixtureStream(m, c);
  };
  const app = await App.open(dir, {
    main: { model: fixtureModel, stream: fixtureStream },
    task: { model: fixtureModel, stream: taskStream },
  });
  try {
    app.scheduler.propose("decision", id(), app.host.sessionID);
    app.scheduler.tick();
    await app.scheduler.idle();
    let snapshot = app.activitySnapshot();
    assert(
      snapshot.activities.some(
        (a) =>
          a.phase === "等待 Master 决定" && a.actions.includes("decisions"),
      ),
    );
    assert.equal(snapshot.background_counts.running, 0);
    const execution =
      app.store.all<
        import("../../../src/pi_secretary/src/contracts.ts").Execution
      >("Execution")[0];
    app.scheduler.cancel(execution.id);
    snapshot = app.activitySnapshot();
    assert(!snapshot.activities.some((a) => a.execution_id === execution.id));
    assert(
      snapshot.recent.some(
        (a) => a.execution_id === execution.id && a.status === "cancelled",
      ),
    );
    const program = app.scheduler.registerProgram(
      "src/pi_secretary/examples/report.mjs",
      "synthetic report",
    );
    app.scheduler.propose("authorization", id(), app.host.sessionID, {
      programID: program.id,
    });
    app.scheduler.tick();
    await app.scheduler.idle();
    snapshot = app.activitySnapshot();
    assert(
      snapshot.activities.some(
        (a) =>
          a.phase === "等待 Master 授权" && a.actions.includes("authorization"),
      ),
    );
    assert.equal(snapshot.background_counts.running, 0);
    const history = activityHistoryFor(app.store).page(app.host.sessionID);
    assert(
      history.items.some(
        (a) =>
          a.kind === "operation" &&
          a.status === "waiting" &&
          a.actions.includes("authorization"),
      ),
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("real Host tool boundary maps World/history/task tools without leaking arguments or results", async () => {
  const dir = temp(),
    entered = gate(),
    release = gate();
  const stream: StreamFn = (m, c) =>
    c.messages.at(-1)?.role === "toolResult"
      ? replyStream([{ type: "text", text: "done" }])
      : replyStream([
          {
            type: "toolCall",
            id: id(),
            name: "memory_read",
            arguments: { source: "world" },
          },
          {
            type: "toolCall",
            id: id(),
            name: "memory_read",
            arguments: { source: "log" },
          },
          {
            type: "toolCall",
            id: id(),
            name: "task_propose",
            arguments: { goal: "PRIVATE_SYNTHETIC_GOAL" },
          },
          { type: "toolCall", id: id(), name: "task_query", arguments: {} },
        ]);
  const app = await App.open(dir, { model: fixtureModel, stream });
  Object.defineProperty(app, "world", {
    value: {
      read: async () => {
        entered.release();
        await release.promise;
        return { text: "PRIVATE_SYNTHETIC_RESULT" };
      },
      close: async () => {},
    },
  });
  Object.defineProperty(app.host, "world", { value: app.world });
  try {
    app.host.accept("PRIVATE_SYNTHETIC_INPUT");
    const work = app.host.drain();
    await entered.promise;
    const s = app.activitySnapshot();
    assert(s.activities.some((a) => a.phase === "正在查看 World Model"));
    assert(!s.activities.some((a) => a.kind === "model"));
    const liveTool = s.activities.find((a) => a.kind === "tool")!;
    const historical = activityHistoryFor(app.store).page(app.host.sessionID);
    assert.equal(
      historical.items.filter((a) => a.id === liveTool.id).length,
      1,
    );
    assert.equal(
      historical.items.find((a) => a.id === liveTool.id)!.status,
      "interrupted",
    );
    release.release();
    await work;
    const finished = app.activitySnapshot();
    for (const phase of [
      "正在查看 World Model",
      "正在查询历史记录",
      "正在分发 task",
      "正在查询 task 状态",
    ])
      assert(finished.recent.some((a) => a.phase === phase));
    assert(!JSON.stringify(finished).includes("PRIVATE_SYNTHETIC"));
    const saved = activityHistoryFor(app.store).page(app.host.sessionID).items;
    assert.equal(saved.filter((a) => a.id === liveTool.id).length, 1);
    assert.equal(saved.find((a) => a.id === liveTool.id)!.status, "succeeded");
  } finally {
    release.release();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
