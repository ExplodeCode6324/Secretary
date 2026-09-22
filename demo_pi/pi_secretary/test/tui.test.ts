import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { App } from "../src/app.ts";
import { TerminalController, terminalText } from "../src/tui.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../src/model.ts";
import { id, revise } from "../src/store.ts";
import type {
  AuthorizationRequest,
  Execution,
  DecisionRequest,
  Operation,
} from "../src/contracts.ts";
async function setup(
  run: (app: App, ui: TerminalController, output: string[]) => Promise<void>,
  stream: StreamFn = fixtureStream,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-tui-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream,
  });
  const output: string[] = [];
  const ui = new TerminalController(app, (text) => output.push(text));
  try {
    await run(app, ui, output);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("TUI accepts chat, completes agent task and shows details without a network server", () =>
  setup(async (app, ui, output) => {
    await ui.command("task: terminal task");
    await app.settle();
    ui.refresh();
    await ui.command("/tasks");
    const e = app.store.all("Execution")[0];
    assert(e && "state" in e && e.state === "SUCCEEDED");
    await ui.command("/show " + e.id);
    assert(output.join("\n").includes("terminal task"));
    assert(output.join("\n").includes("SUCCEEDED"));
    assert.equal(await ui.command("/quit"), false);
  }));
test("TUI requires explicit viewed approval and rejects stale displays; chat cannot approve", () =>
  setup(async (app, ui, output) => {
    const op = app.authorization.prepare(
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      "file.write",
      "/synthetic-test",
      { content: "exact", thinking: "literal authorization parameter" },
      id(),
    );
    const a = app.store.get<AuthorizationRequest>(
      "AuthorizationRequest",
      op.authorization_id!,
    );
    await ui.command("approve everything");
    await app.host.drain();
    assert.equal(
      app.store.get<AuthorizationRequest>("AuthorizationRequest", a.id).state,
      "PENDING",
    );
    await assert.rejects(ui.command("/approve " + a.id), /先使用/);
    await ui.command("/approval " + a.id);
    assert(output.join("\n").includes("literal authorization parameter"));
    app.store.commit([revise(a, { expires_at: null })]);
    await assert.rejects(ui.command("/approve " + a.id), /CONFLICT/);
    await ui.command("/approval " + a.id);
    await ui.command("/approve " + a.id);
    assert.equal(
      app.store.get<AuthorizationRequest>("AuthorizationRequest", a.id).state,
      "APPROVED",
    );
    await ui.command("/approval " + a.id);
    await ui.command("/revoke " + a.id);
    assert.equal(
      app.store.get<AuthorizationRequest>("AuthorizationRequest", a.id).state,
      "REVOKED",
    );
  }));
test("TUI strips terminal escape/control sequences from model output", () => {
  assert.equal(terminalText("\x1b[2Jhello\x1b]52;c;YQ==\x07\u202e"), "hello");
});
test("actual TUI process accepts input, quits cleanly and releases its store", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-tui-process-"));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "pi_secretary/src/tui.ts"],
    {
      env: { ...process.env, SECRETARY_MODE: "fixture", SECRETARY_DATA: dir },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let output = "",
    errors = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (errors += b));
  const done = new Promise<number | null>((resolve) =>
    child.on("close", resolve),
  );
  async function until(predicate: () => boolean) {
    for (let n = 0; n < 150; n++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error("TUI timeout: " + errors);
  }
  try {
    await until(() => output.includes("Master ›"));
    child.stdin.write("task: process test\n");
    await until(() => output.includes("Offline fixture task finished"));
    child.stdin.write("/register-example\n");
    await until(() => output.includes("Demo report generator"));
    child.stdin.write("/programs\n");
    await until(() => output.includes("/program P1"));
    child.stdin.write("/program P1 terminal program test\n");
    await until(() => output.includes("批准此次操作 → /approve A1"));
    assert.match(output, /完整请求与参数/);
    child.stdin.write("/approve A1\n");
    await until(() => output.includes("SUCCEEDED: task"));
    child.stdin.write("/quit\n");
    assert.equal(await done, 0);
    assert.match(output, /Secretary 已停止/);
    const app = await App.open(dir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    assert.equal(app.store.all<Operation>("Operation")[0].state, "SUCCEEDED");
    await app.close();
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("visible authorization cards enable approval and rejection without copying IDs", () =>
  setup(async (app, ui, output) => {
    ui.menu();
    assert(output.join("\n").includes("授权 → /auth"));
    await ui.command("/register-example");
    await ui.command("/programs");
    await ui.command("/program P1 first");
    app.scheduler.tick();
    await app.scheduler.idle();
    const first = app.store.all<Execution>("Execution")[0];
    assert.equal(first.state, "WAIT_AUTH");
    ui.refresh();
    assert(output.join("\n").includes("批准此次操作 → /approve A1"));
    assert.match(ui.prompt(), /待授权 1/);
    assert(
      !fs.existsSync(
        path.join(
          app.store.dir,
          "workspaces",
          first.task_id,
          "work",
          "report.json",
        ),
      ),
    );
    await ui.command("/approve A1");
    app.scheduler.tick();
    await app.scheduler.idle();
    assert.equal(
      app.store.get<Execution>("Execution", first.id).state,
      "SUCCEEDED",
    );
    await ui.command("/program P1 second");
    app.scheduler.tick();
    await app.scheduler.idle();
    ui.refresh();
    await ui.command("/reject A2");
    app.scheduler.tick();
    await app.scheduler.idle();
    const second = app.store
      .all<Execution>("Execution")
      .find((e) => e.id !== first.id)!;
    assert.equal(second.state, "FAILED");
    assert(
      !fs.existsSync(
        path.join(
          app.store.dir,
          "workspaces",
          second.task_id,
          "work",
          "report.json",
        ),
      ),
    );
  }));

test("visible work decisions accept a short handle and retain Master provenance", () =>
  setup(
    async (app, ui, output) => {
      await ui.command("/task Choose work input");
      app.scheduler.tick();
      await app.scheduler.idle();
      ui.refresh();
      assert(output.join("\n").includes("/answer D1"));
      await ui.command("/answer D1 use synthetic data");
      assert.equal(
        app.store.all<DecisionRequest>("DecisionRequest")[0].answered_by,
        "MASTER",
      );
      app.scheduler.tick();
      await app.scheduler.idle();
      assert.equal(app.store.all<Execution>("Execution")[0].state, "SUCCEEDED");
    },
    (m, c, o) => {
      if (
        JSON.stringify(c.messages.filter((x) => x.role === "system")).includes(
          "TASK_EXECUTOR",
        ) &&
        !c.messages.some((x) => x.role === "toolResult")
      )
        return replyStream(
          [
            {
              type: "toolCall",
              name: "request_decision",
              id: "choose",
              arguments: { question: "Which input should be used?" },
            },
          ],
          m,
        );
      return fixtureStream(m, c, o);
    },
  ));

test("TUI exposes program, rule, operation and advanced task entry points", () =>
  setup(async (app, ui, output) => {
    for (const command of [
      "/menu",
      "/help",
      "/programs",
      "/rules",
      "/operations",
      "/status",
      "/auth",
    ])
      await ui.command(command);
    await ui.command(
      "/task-json " +
        JSON.stringify({
          goal: "scheduled test",
          at: "2099-01-01T00:00:00Z",
          constraints: ["read only"],
          materials: ["original data"],
        }),
    );
    await ui.command("/tasks");
    assert(output.join("\n").includes("scheduled test"));
    await assert.rejects(ui.command("/world-read anything"), /未配置/);
  }));
