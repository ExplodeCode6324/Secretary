import test from "node:test";
import assert from "node:assert/strict";
import { fixture, directory } from "./helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import {
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { retryRuntime } from "../../../src/pi_secretary/src/model-retry.ts";
import type { App } from "../../../src/pi_secretary/src/app.ts";
import type {
  TaskPlan,
  MainPromptSnapshot,
} from "../../../src/pi_secretary/src/contracts.ts";
test("main chooses exposed scope; a transient retry preserves the original scope snapshot", async () => {
  let app: App,
    scopeID = "",
    calls = 0,
    first = "",
    second = "";
  const stream: StreamFn = (m, c, o) => {
    const system = JSON.stringify(
      c.messages.filter((x) => x.role === "system"),
    );
    if (!system.includes("Available scopes (data)"))
      return fixtureStream(m, c, o);
    if (calls++ === 0) {
      first = system;
      const s = app.scheduler.scopes.get(scopeID);
      app.scheduler.scopes.save(
        { name: "Changed after snapshot" },
        scopeID,
        s.revision,
      );
      throw Object.assign(Error("Synthetic transient"), { status: 503 });
    }
    if (calls === 2) {
      second = system;
      return replyStream(
        [
          {
            type: "toolCall",
            id: id(),
            name: "task_propose",
            arguments: { goal: "Scoped task", scope_id: scopeID },
          },
        ],
        m,
      );
    }
    return replyStream([{ type: "text", text: "Task accepted" }], m);
  };
  await fixture(async (a, _api, root) => {
    app = a;
    retryRuntime.set(a.store, { wait: async () => {} });
    scopeID = a.scheduler.scopes.save({
      name: "Original project",
      kind: "DIRECTORY",
      root_path: directory(root),
    }).id;
    a.host.accept("Please perform work in Original project");
    await a.host.drain();
    assert.equal(first, second);
    assert(first.includes("Original project"));
    assert(!first.includes("Changed after snapshot"));
    const p = a.store.all<TaskPlan>("TaskPlan")[0];
    assert.equal(p.scope_id, scopeID);
    const query = a.scheduler.query(a.host.sessionID, p.id) as any;
    assert.equal(query.scope_id, scopeID);
    assert.equal(
      a.store.all<MainPromptSnapshot>("MainPromptSnapshot").length,
      1,
    );
  }, stream);
});
