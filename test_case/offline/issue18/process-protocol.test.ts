import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { launchProcess } from "../../../src/pi_secretary/src/process-control.ts";
import type {
  AuthorizationRequest,
  Execution,
  Operation,
} from "../../../src/pi_secretary/src/contracts.ts";
import { interrupted } from "./helpers.ts";

async function scenario(kind: "shell" | "program", cancel: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "process-protocol-"));
  const stream: StreamFn = (m, c, o) =>
    JSON.stringify(c.messages.filter((x) => x.role === "system")).includes(
      "TASK_EXECUTOR",
    ) && !c.messages.some((x) => x.role === "toolResult")
      ? replyStream(
          [
            {
              type: "toolCall",
              id: "synthetic-stdin",
              name: "bash",
              arguments: {
                command: cancel
                  ? "echo ran > side-effect"
                  : "cat >/dev/null; echo done",
                timeout: 2,
              },
            },
          ],
          m,
        )
      : fixtureStream(m, c, o);
  const app = await App.open(root, { model: fixtureModel, stream });
  try {
    let programID: string | undefined;
    if (kind === "program") {
      const script = path.join(root, "program.cjs");
      fs.writeFileSync(
        script,
        "let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const value=JSON.parse(input);if(!value.execution_id||!value.parameters)process.exit(2);require('fs').writeFileSync('side-effect',input);console.log(JSON.stringify({summary:'JSON input received'}));});",
      );
      programID = app.scheduler.registerProgram(script, "Synthetic stdin").id;
    }
    const task = app.scheduler.propose(
      "Synthetic protocol test",
      id(),
      app.host.sessionID,
      { programID },
    );
    app.scheduler.tick();
    await app.scheduler.idle();
    const a = app.store
      .all<AuthorizationRequest>("AuthorizationRequest")
      .find((a) => a.state === "PENDING")!;
    assert(a);
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
    const commit = app.store.commit.bind(app.store);
    let cancelled = false;
    app.store.commit = ((...args: Parameters<typeof commit>) => {
      const result = commit(...args);
      if (
        cancel &&
        !cancelled &&
        args[0]?.some(
          (r) =>
            r.record_type === "Operation" && r.process?.state === "RUNNING",
        )
      ) {
        cancelled = true;
        app.scheduler.cancel(e.id);
      }
      return result;
    }) as typeof commit;
    await app.scheduler.run(e.id);
    const op = app.store.get<Operation>("Operation", a.operation_id);
    const receipt = app.store.read<any>(op.receipt!);
    if (cancel) {
      assert(
        cancelled,
        "cancel must land after ready identity and before gate opens",
      );
      assert.equal(
        fs.existsSync(
          path.join(root, "workspaces", task.id, "work", "side-effect"),
        ),
        false,
      );
      assert.equal(op.effect, "NOT_APPLIED");
      assert.equal(receipt.not_started, true);
    } else {
      assert.equal(op.effect, "APPLIED");
      if (kind === "shell") {
        assert.equal(receipt.exit_code, 0);
        assert.equal(receipt.stdout.trim(), "done");
        assert.equal(receipt.timed_out, false);
      } else {
        const input = JSON.parse(
          fs.readFileSync(
            path.join(root, "workspaces", task.id, "work", "side-effect"),
            "utf8",
          ),
        );
        assert.equal(input.execution_id, e.id);
      }
    }
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
for (const kind of ["shell", "program"] as const) {
  test(`${kind}: cancellation after ready but before start has no effect`, () =>
    scenario(kind, true));
  test(`${kind}: stdin completes with the expected input`, () =>
    scenario(kind, false));
}
test("wrapper exit without a result frame is unknown, never a command exit code", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "protocol-exit-"));
  const app = await App.open(root, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  try {
    const { op } = interrupted(app);
    const { process: _, ...legacy } = op;
    app.store.commit([revise(legacy, {})]);
    const launched = await launchProcess(
      app.store,
      op.id,
      ["/bin/true"],
      root,
      { PATH: process.env.PATH },
    );
    launched.child.stdout!.resume();
    launched.child.stderr!.resume();
    launched.child.stdin!.end();
    (launched.child.stdio[3] as Writable).end("invalid-control-frame\n");
    const result = await launched.closed;
    assert.equal(result.exit_code, null);
    assert.notEqual((result as any).not_started, true);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
