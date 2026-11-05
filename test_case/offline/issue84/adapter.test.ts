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
