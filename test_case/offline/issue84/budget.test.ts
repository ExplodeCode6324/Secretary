import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Issue84Budget, wireBound } from "../../online/issue84-budget.ts";

const sample = (content = "isolated synthetic prompt") =>
  JSON.stringify({
    model: "deepseek-flash",
    stream: true,
    max_tokens: 8192,
    messages: [{ role: "user", content }],
  });

test("abandoned provider attempts retain the full reservation after reopen", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-budget-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "ledger.json");
  const wire = wireBound(sample());
  const budget = new Issue84Budget(file, false);
  assert.throws(() => budget.admit("task", wire, []), /PATH_TIME_OR_CALLS/);
  budget.admit("main", wire, ["synthetic-input"]);
  const resumed = new Issue84Budget(file, true);
  assert.equal(resumed.state.attempts[0].ms, 120_000);
  assert.throws(() => resumed.admit("main", wire, []), /PATH_TIME_OR_CALLS/);
  assert.throws(() => resumed.advance("redo"), /PHASE_ORDER/);
  resumed.releaseReserve();
  const attempt = resumed.admit("main", wire, []);
  assert.equal(attempt.phase, "reserve");
  assert.throws(
    () => resumed.tools("task", ["bash"], attempt),
    /TOOLS_OR_PROPOSALS/,
  );
  assert.equal(resumed.state.batches[0].admitted, false);
  assert.throws(
    () =>
      resumed.finish(
        attempt,
        attempt.started + 1,
        "synthetic-response",
        wire.input + 1,
        1,
      ),
    /UNVERIFIED_PROVIDER_USAGE/,
  );
  assert.throws(
    () => new Issue84Budget(file, true).admit("main", wire, []),
    /HALTED/,
  );
});

test("wire accounting refuses unsupported destinations embedded as image URLs and oversize payloads", () => {
  const text = JSON.parse(sample());
  text.messages[0].content = [
    { type: "image_url", image_url: { url: "https://example.test/photo.png" } },
  ];
  assert.throws(() => wireBound(JSON.stringify(text)), /INVALID_IMAGE_BLOCK/);
  assert.throws(() => wireBound(sample("中".repeat(34_000))), /WIRE_INPUT/);
  assert.throws(
    () => wireBound(sample().replace("8192", "8193")),
    /WIRE_SHAPE/,
  );
});
