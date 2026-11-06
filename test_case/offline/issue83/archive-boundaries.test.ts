import test from "node:test";
import assert from "node:assert/strict";
import { fixture, executions } from "../issue16/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import {
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  DecisionRequest,
  TaskPlan,
} from "../../../src/pi_secretary/src/contracts.ts";

// Actual Core transitions with a scripted provider, not seeded successful states.
const askThenComplete: StreamFn = (model, context) =>
  replyStream(
    [
      context.messages.some((m) => m.role === "toolResult")
        ? {
            type: "toolCall",
            id: "done",
            name: "submit_result",
            arguments: {
              outcome: "SUCCEEDED",
              summary: "Answered after Scope archival",
              criteria: [
                {
                  id: "C1",
                  met: true,
                  evidence: "Synthetic decision answered",
                },
              ],
              artifacts: [],
              limitations: [],
            },
          }
        : {
            type: "toolCall",
            id: "ask",
            name: "request_decision",
            arguments: {
              question: "Synthetic archive boundary question",
              options: ["continue"],
            },
          },
    ],
    model,
  );

test("archiving a Scope preserves its started decision and answering resumes that execution while browsing stays excluded", () =>
  fixture(async (app, api) => {
    try {
      const scope = app.scheduler.scopes.save({
        name: "archive while waiting",
        kind: "NONE",
      });
      const plan = app.scheduler.propose(
        "decision boundary",
        id(),
        app.host.sessionID,
        { scopeID: scope.id },
      );
      app.scheduler.tick();
      await app.scheduler.idle();
      const original = executions(app)[0];
      assert.equal(original.state, "WAIT_DECISION");
      assert(original.started_at);
      const question = app.store.all<DecisionRequest>("DecisionRequest")[0];
      api.command(api.principal, `scopes/${scope.id}/archive`, {
        request_id: id(),
        expected_revision: String(scope.revision),
      });
      assert.equal(
        app.store.get<DecisionRequest>("DecisionRequest", question.id).state,
        "OPEN",
      );
      const sequence = app.store.sequence;
      const attention = (await api.query(
        api.principal,
        "attention",
        new URLSearchParams({ view: "master" }),
      )) as { items: { id: string }[] };
      assert(attention.items.some((row) => row.id === question.id));
      await assert.rejects(
        api.query(api.principal, `task-browser/${plan.id}`),
        /TASK_NOT_BROWSABLE/,
      );
      assert.equal(app.store.sequence, sequence);
      api.command(api.principal, `decisions/${question.id}/answer`, {
        request_id: id(),
        answer: "continue",
      });
      app.scheduler.tick();
      await app.scheduler.idle();
      assert.equal(executions(app).length, 1);
      assert.equal(executions(app)[0].id, original.id);
      assert.equal(executions(app)[0].state, "SUCCEEDED");
      assert.equal(
        app.store.get<DecisionRequest>("DecisionRequest", question.id)
          .answered_by,
        "MASTER",
      );
      assert.equal(app.scheduler.scopes.get(scope.id).state, "ARCHIVED");
      assert.equal(
        app.store.get<TaskPlan>("TaskPlan", plan.id).state,
        "ACTIVE",
      );
    } finally {
      await api.close();
    }
  }, askThenComplete));

test("archived periodic plans retain future occurrences without dispatching new work or clearing queued occurrences", () =>
  fixture(async (app, api) => {
    try {
      const scope = app.scheduler.scopes.save({
        name: "archived periodic",
        kind: "NONE",
      });
      const plan = app.scheduler.propose(
        "periodic boundary",
        id(),
        app.host.sessionID,
        { scopeID: scope.id, interval: 3600 },
      );
      const firstDue = plan.next_due_at!;
      api.command(api.principal, `scopes/${scope.id}/archive`, {
        request_id: id(),
        expected_revision: String(scope.revision),
      });
      assert.deepEqual(app.store.get<TaskPlan>("TaskPlan", plan.id), plan);
      app.scheduler.tick(Date.parse(firstDue) + 1);
      await app.scheduler.idle();
      const first = executions(app)[0];
      assert.equal(first.state, "WAIT_PRECONDITION");
      assert.equal(first.started_at, null);
      assert.equal(first.condition_results.at(-1)?.reason, "SCOPE_ARCHIVED");
      const expectedQueue: string[] = [];
      for (let n = 0; n < 3; n++) {
        const before = app.store.get<TaskPlan>("TaskPlan", plan.id);
        expectedQueue.push(before.next_due_at!);
        app.scheduler.tick(Date.parse(before.next_due_at!) + 1);
        await app.scheduler.idle();
        const after = app.store.get<TaskPlan>("TaskPlan", plan.id);
        assert.equal(after.state, "ACTIVE");
        assert.deepEqual(after.trigger, plan.trigger);
        assert.deepEqual(after.pending_occurrences, expectedQueue);
        assert.equal(
          Date.parse(after.next_due_at!) - Date.parse(before.next_due_at!),
          3600000,
        );
        assert.equal(executions(app).length, 1);
        assert.equal(executions(app)[0].started_at, null);
      }
      assert.equal(app.store.all("ModelCall").length, 0);
      assert.equal(app.scheduler.scopes.get(scope.id).state, "ARCHIVED");
    } finally {
      await api.close();
    }
  }));
