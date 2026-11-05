import { normalizeContext } from "@earendil-works/pi-ai";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acceptanceAdapter,
  acceptanceModel,
} from "../../online/issue84-model.ts";
import { Issue84Budget } from "../../online/issue84-budget.ts";
import { fixtureResponse } from "../../online/issue84-fixture.ts";

test("SDK cannot hide local admission refusal as a retryable connection error", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-adapter-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const budget = new Issue84Budget(path.join(dir, "usage.json"), false);
  let physical = 0;
  const adapter = acceptanceAdapter("main", {
    key: "synthetic",
    budget,
    enabled: () => true,
    guard: () => assert.fail(),
    active: () => {},
    approvalScope: () => undefined,
    inputIds: () => [],
    observe: () => {},
    violation: () => assert.fail(),
    scripted: () => {
      physical++;
      return fixtureResponse("synthetic");
    },
  });
  for (let i = 0; i < 6; i++) {
    const events = await adapter.stream(
      acceptanceModel,
      normalizeContext({
        messages: [{ role: "user", content: "test", timestamp: Date.now() }],
      }),
      { maxTokens: 8192 },
    );
    assert.equal((await events.result()).stopReason, "stop");
  }
  const events = await adapter.stream(
    acceptanceModel,
    normalizeContext({
      messages: [{ role: "user", content: "test", timestamp: Date.now() }],
    }),
    { maxTokens: 8192 },
  );
  const result = await events.result();
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage!, /BUDGET_ISSUE84_MAINTENANCE_HEADROOM/);
  assert.equal(physical, 6);
});

test("observe adapter admits text materials, rejects invalid material shape, and keeps Task attribution", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-materials-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const budget = new Issue84Budget(
    path.join(dir, "usage.json"),
    false,
    "observe",
  );
  let materials: unknown = ["synthetic report bytes"];
  const adapter = acceptanceAdapter("main", {
    key: "synthetic",
    budget,
    enabled: () => true,
    guard: () => assert.fail(),
    active: () => {},
    approvalScope: () => undefined,
    inputIds: () => ["main-input"],
    observe: () => {},
    violation: () => assert.fail(),
    scripted: () =>
      fixtureResponse("", [
        { name: "task_propose", args: { goal: "synthetic", materials } },
      ]),
  });
  const ctx = normalizeContext({
    messages: [{ role: "user", content: "test", timestamp: Date.now() }],
  });
  const good = await (
    await adapter.stream(acceptanceModel, ctx, {
      maxTokens: 8192,
      sessionId: "session-1",
    })
  ).result();
  assert.equal(good.stopReason, "toolUse");
  assert.equal(budget.state.batches[0].admitted, true);
  assert.equal(budget.state.attempts[0].sessionId, "session-1");
  materials = [{ path: "not plain text" }];
  const bad = await (
    await adapter.stream(acceptanceModel, ctx, { maxTokens: 8192 })
  ).result();
  assert.equal(bad.stopReason, "error");
  assert.match(bad.errorMessage!, /TOOLS_OR_PROPOSALS/);
  assert.equal(budget.state.batches[1].admitted, false);
  const task = acceptanceAdapter("task", {
    key: "synthetic",
    budget,
    enabled: () => true,
    guard: () => assert.fail(),
    active: () => {},
    approvalScope: () => undefined,
    inputIds: () => ["unrelated-main-input"],
    observe: () => {},
    violation: () => assert.fail(),
    scripted: () => fixtureResponse("task"),
  });
  await (
    await task.stream(acceptanceModel, ctx, {
      maxTokens: 8192,
      sessionId: "execution-1",
    })
  ).result();
  assert.deepEqual(budget.state.attempts.at(-1)!.inputIds, []);
  assert.equal(budget.state.attempts.at(-1)!.sessionId, "execution-1");
});

test("observe adapter restores a wrong-destination refusal without a physical send", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-destination-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const budget = new Issue84Budget(
    path.join(dir, "usage.json"),
    false,
    "observe",
  );
  let physical = 0;
  const violations: string[] = [];
  const adapter = acceptanceAdapter("main", {
    key: "synthetic",
    budget,
    enabled: () => true,
    guard: () => assert.fail(),
    active: () => {},
    approvalScope: () => undefined,
    inputIds: () => [],
    observe: () => {},
    violation: (r) => violations.push(r),
    scripted: () => {
      physical++;
      return fixtureResponse("unexpected");
    },
  });
  const result = await (
    await adapter.stream(
      { ...acceptanceModel, baseUrl: "https://example.invalid" },
      normalizeContext({
        messages: [{ role: "user", content: "test", timestamp: Date.now() }],
      }),
      { maxTokens: 8192 },
    )
  ).result();
  assert.equal(physical, 0);
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage!, /BUDGET_ISSUE84_DESTINATION/);
  assert.equal(violations.length, 1);
});
