import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  AuthorizationRequest,
  Execution,
  DecisionRequest,
  Operation,
} from "../../../src/pi_secretary/src/contracts.ts";

async function fixture(
  run: (app: App, c: CoreClient, dir: string) => Promise<void>,
  stream: StreamFn = fixtureStream,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-retirement-"));
  const app = await App.open(dir, { model: fixtureModel, stream });
  const server = await serveCore(app, 0, undefined, { pump: false });
  try {
    await run(app, new CoreClient(server.endpoint), dir);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const post = (
  c: CoreClient,
  route: string,
  body: Record<string, unknown> = {},
) => c.command(route, { request_id: id(), ...body });
async function decide(c: CoreClient, approval: string, decision: string) {
  const card: any = await c.query(`authorizations/${approval}`);
  return post(c, `authorizations/${approval}/decision`, {
    expected_revision: card.revision,
    display_hash: card.display_hash,
    decision,
  });
}
async function program(c: CoreClient) {
  const receipt = await post(c, "admin/programs", {
    entrypoint: path.resolve("src/pi_secretary/examples/report.mjs"),
    name: "Synthetic report generator",
  });
  const registered: any = await c.query("admin/programs");
  assert.equal(registered.items.length, 1);
  assert.equal(registered.items[0].name, "Synthetic report generator");
  return receipt.resource_ids.find((r) => r.type === "ProgramRegistration")!.id;
}

test("API replacement: chat completes a task and exposes result details", () =>
  fixture(async (app, c) => {
    await post(c, "messages", { text: "task: synthetic client task" });
    await app.settle();
    const execution = app.store.all<Execution>("Execution")[0];
    assert.equal(execution.state, "SUCCEEDED");
    const tasks: any = await c.query("tasks");
    assert(
      tasks.items.some((t: any) => t.goal.includes("synthetic client task")),
    );
    const detail: any = await c.query(`executions/${execution.id}`);
    assert.equal(detail.state, "SUCCEEDED");
    assert(detail.result);
  }));

test("API replacement: approval requires exact displayed revision/hash; chat cannot approve; revoke persists", () =>
  fixture(async (app, c) => {
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
    await post(c, "messages", { text: "approve everything" });
    await app.host.drain();
    assert.equal(
      app.store.get<AuthorizationRequest>("AuthorizationRequest", a.id).state,
      "PENDING",
    );
    await assert.rejects(
      post(c, `authorizations/${a.id}/decision`, { decision: "APPROVE" }),
      /INVALID_REQUEST/,
    );
    const card: any = await c.query(`authorizations/${a.id}`);
    assert(
      JSON.stringify(card.display).includes("literal authorization parameter"),
    );
    await assert.rejects(
      post(c, `authorizations/${a.id}/decision`, {
        decision: "APPROVE",
        expected_revision: card.revision,
        display_hash: "0".repeat(64),
      }),
      /CONFLICT/,
    );
    app.store.commit([revise(a, { expires_at: null })]);
    await assert.rejects(
      post(c, `authorizations/${a.id}/decision`, {
        decision: "APPROVE",
        expected_revision: card.revision,
        display_hash: card.display_hash,
      }),
      /CONFLICT/,
    );
    await decide(c, a.id, "APPROVE");
    assert.equal(
      app.store.get<AuthorizationRequest>("AuthorizationRequest", a.id).state,
      "APPROVED",
    );
    await decide(c, a.id, "REVOKE");
    assert.equal(
      app.store.get<AuthorizationRequest>("AuthorizationRequest", a.id).state,
      "REVOKED",
    );
  }));

test("API replacement: program approval creates output, rejection creates none, and completed operation survives restart", () =>
  fixture(async (app, c, dir) => {
    const programID = await program(c);
    await post(c, "task-requests", {
      goal: "first synthetic program",
      program_id: programID,
    });
    app.scheduler.tick();
    await app.scheduler.idle();
    const first = app.store.all<Execution>("Execution")[0];
    const output = (e: Execution) =>
      path.join(dir, "workspaces", e.task_id, "work", "report.json");
    assert.equal(first.state, "WAIT_AUTH");
    assert(!fs.existsSync(output(first)));
    let approvals: any = await c.query("authorizations");
    await decide(c, approvals.items[0].id, "APPROVE");
    app.scheduler.tick();
    await app.scheduler.idle();
    assert.equal(
      app.store.get<Execution>("Execution", first.id).state,
      "SUCCEEDED",
    );
    assert(fs.existsSync(output(first)));
    await post(c, "task-requests", {
      goal: "second synthetic program",
      program_id: programID,
    });
    app.scheduler.tick();
    await app.scheduler.idle();
    approvals = await c.query("authorizations");
    await decide(
      c,
      approvals.items.find((a: any) => a.state === "PENDING").id,
      "REJECT",
    );
    app.scheduler.tick();
    await app.scheduler.idle();
    const second = app.store
      .all<Execution>("Execution")
      .find((e) => e.id !== first.id)!;
    assert.equal(second.state, "FAILED");
    assert(!fs.existsSync(output(second)));
    const operations: any = await c.query("operations");
    assert(operations.items.some((o: any) => o.state === "SUCCEEDED"));
    await app.close();
    const reopened = await App.open(dir, {
      model: fixtureModel,
      stream: fixtureStream,
    });
    try {
      assert(
        reopened.store
          .all<Operation>("Operation")
          .some((o) => o.state === "SUCCEEDED"),
      );
    } finally {
      await reopened.close();
    }
  }));

test("API replacement: independent work decision retains Master provenance and completes execution", () =>
  fixture(
    async (app, c) => {
      await post(c, "task-requests", { goal: "Choose work input" });
      app.scheduler.tick();
      await app.scheduler.idle();
      const decisions: any = await c.query("decisions");
      assert.equal(decisions.items.length, 1);
      await post(c, `decisions/${decisions.items[0].id}/answer`, {
        answer: "use synthetic data",
      });
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

test("API replacement: advanced task, programs, rules, operations and unavailable World remain explicit", () =>
  fixture(async (_app, c) => {
    for (const route of [
      "admin/programs",
      "authorization-rules",
      "operations",
      "core",
      "authorizations",
    ])
      await c.query(route);
    await post(c, "task-requests", {
      goal: "scheduled synthetic",
      at: "2099-01-01T00:00:00Z",
      constraints: ["read only"],
      materials: ["original data"],
    });
    const tasks: any = await c.query("tasks");
    assert.equal(tasks.items[0].goal, "scheduled synthetic");
    const task: any = await c.query(`tasks/${tasks.items[0].id}`);
    assert.deepEqual(task.baseline.constraints, ["read only"]);
    await assert.rejects(c.query("world/subjects"), /WORLD_UNAVAILABLE/);
  }));
