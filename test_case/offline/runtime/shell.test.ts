import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Execution,
  Operation,
  AuthorizationRequest,
} from "../../../src/pi_secretary/src/contracts.ts";

async function scenario(
  command: string,
  timeout: number,
  decision: "APPROVE" | "REJECT",
  check: (app: App, cwd: string, eid: string) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-shell-"));
  const stream: StreamFn = (model, context) => {
    if (!context.messages.some((m) => m.role === "toolResult"))
      return replyStream(
        [
          {
            type: "toolCall",
            id: "shell-test",
            name: "bash",
            arguments: { command, timeout },
          },
        ],
        model,
      );
    return fixtureStream(model, context);
  };
  const app = await App.open(dir, { model: fixtureModel, stream });
  try {
    const plan = app.scheduler.propose(
      "Run real shell test",
      id(),
      app.host.sessionID,
    );
    const cwd = path.join(dir, "workspaces", plan.id, "work");
    app.scheduler.tick();
    await app.scheduler.idle();
    const e = app.store.all<Execution>("Execution")[0];
    assert.equal(e.state, "WAIT_AUTH");
    assert.equal(fs.existsSync(path.join(cwd, "proof.txt")), false);
    const a = app.store.all<AuthorizationRequest>("AuthorizationRequest")[0];
    assert.equal(a.action.action, "shell.run");
    app.authorization.decide({
      schema_version: 1,
      record_type: "ApprovalCommand",
      request_id: id(),
      authorization_id: a.id,
      expected_revision: a.revision,
      display_hash: a.display_hash,
      decision,
    });
    await app.scheduler.run(e.id);
    await check(app, cwd, e.id);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("approved shell performs actual IO and preserves separate output and exit status", async () => {
  await scenario(
    "printf proof > proof.txt; printf output; printf error >&2; exit 7",
    5,
    "APPROVE",
    async (app, cwd, eid) => {
      assert.equal(
        fs.readFileSync(path.join(cwd, "proof.txt"), "utf8"),
        "proof",
      );
      const op = app.store.all<Operation>("Operation")[0];
      const receipt = app.store.read<any>(op.receipt!);
      assert.equal(receipt.stdout, "output");
      assert.equal(receipt.stderr, "error");
      assert.equal(receipt.exit_code, 7);
      assert.equal(receipt.cwd, fs.realpathSync(cwd));
      assert.equal(op.state, "SUCCEEDED"); // Command completed; exit 7 remains evidence of command failure.
      await app.scheduler.run(eid);
      assert.equal(app.store.all<Operation>("Operation").length, 1);
    },
  );
});
test("rejected shell has no effect", async () => {
  await scenario(
    "printf proof > proof.txt",
    5,
    "REJECT",
    async (app, cwd, eid) => {
      assert.equal(fs.existsSync(path.join(cwd, "proof.txt")), false);
      assert.equal(app.store.get<Execution>("Execution", eid).state, "FAILED");
    },
  );
});
test("timeout preserves uncertainty and never replays partial shell effects", async () => {
  await scenario(
    "printf x >> proof.txt; sleep 10",
    0.1,
    "APPROVE",
    async (app, cwd, eid) => {
      assert.equal(
        app.store.get<Execution>("Execution", eid).state,
        "RESULT_UNKNOWN",
      );
      const op = app.store.all<Operation>("Operation")[0];
      assert.equal(app.store.read<any>(op.receipt!).timed_out, true);
      await app.scheduler.run(eid);
      assert.equal(fs.readFileSync(path.join(cwd, "proof.txt"), "utf8"), "x");
    },
  );
});

test("approved write preflight errors become visible failure instead of waiting forever", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-preflight-"));
  const stream: StreamFn = (model, context) => {
    if (!context.messages.some((m) => m.role === "toolResult"))
      return replyStream(
        [
          {
            type: "toolCall",
            id: "write-test",
            name: "write",
            arguments: { path: "proof.txt", content: "new" },
          },
        ],
        model,
      );
    return fixtureStream(model, context);
  };
  const app = await App.open(dir, { model: fixtureModel, stream });
  try {
    const plan = app.scheduler.propose("Write file", id(), app.host.sessionID);
    app.scheduler.tick();
    await app.scheduler.idle();
    const file = path.join(dir, "workspaces", plan.id, "work", "proof.txt");
    fs.writeFileSync(file, "external change");
    const a = app.store.all<AuthorizationRequest>("AuthorizationRequest")[0];
    app.authorization.decide({
      schema_version: 1,
      record_type: "ApprovalCommand",
      request_id: id(),
      authorization_id: a.id,
      expected_revision: a.revision,
      display_hash: a.display_hash,
      decision: "APPROVE",
    });
    const e = app.store.all<Execution>("Execution")[0];
    await app.scheduler.run(e.id);
    assert.equal(app.store.get<Execution>("Execution", e.id).state, "FAILED");
    assert.match(
      JSON.stringify(app.scheduler.detail(e.id)),
      /RESOURCE_REVISION_CHANGED/,
    );
    assert.equal(fs.readFileSync(file, "utf8"), "external change");
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
