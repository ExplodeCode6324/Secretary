import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture, directory, executions, approve } from "../issue16/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import {
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type { Operation } from "../../../src/pi_secretary/src/contracts.ts";

test("cancellation during authorized write resume preserves its receipt and finishes after CANCEL_REQUESTED -> READY", () => {
  const stream: StreamFn = (model, context, options) =>
    JSON.stringify(
      context.messages.filter((m) => m.role === "system"),
    ).includes("TASK_EXECUTOR")
      ? replyStream(
          [
            {
              type: "toolCall",
              id: "write-once",
              name: "write",
              arguments: { path: "proof.txt", content: "durable" },
            },
          ],
          model,
        )
      : fixtureStream(model, context, options);
  return fixture(async (app, _api, root) => {
    const dir = directory(root);
    const scope = app.scheduler.scopes.save({
      name: "Cancel resume",
      kind: "DIRECTORY",
      root_path: dir,
      default_write: "ask",
    });
    app.scheduler.propose("Write once", id(), app.host.sessionID, {
      scopeID: scope.id,
    });
    app.scheduler.tick();
    await app.scheduler.idle();
    const execution = executions(app)[0];
    assert.equal(execution.state, "WAIT_AUTH");
    approve(app);
    const scheduler = app.scheduler as unknown as {
      applyWrite(op: Operation): Promise<Operation>;
    };
    const write = scheduler.applyWrite.bind(app.scheduler);
    scheduler.applyWrite = async (op) => {
      const result = await write(op);
      // Deterministically deliver cancellation in the awaited effect's completion window.
      app.scheduler.cancel(execution.id);
      assert.equal(executions(app)[0].state, "CANCEL_REQUESTED");
      return result;
    };
    await app.scheduler.run(execution.id);
    assert.equal(executions(app)[0].state, "CANCELLED");
    assert.equal(executions(app)[0].cancel_requested, true);
    assert.equal(app.store.all<Operation>("Operation")[0].state, "SUCCEEDED");
    assert.equal(
      fs.readFileSync(path.join(dir, "proof.txt"), "utf8"),
      "durable",
    );
  }, stream);
});
