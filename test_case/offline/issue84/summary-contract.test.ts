import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import {
  createSummaryPlan,
  runSummary,
  SUMMARY_POLICY,
  SUMMARY_SYSTEM,
  type SummaryCandidate,
} from "../../../src/pi_secretary/src/summary.ts";
import { hash, id } from "../../../src/pi_secretary/src/store.ts";
import { prompts } from "../../online/issue84-prompts.ts";
const model = { ...fixtureModel, contextWindow: 100000, maxTokens: 8192 };
const item = {
  tier: "MINIMAL",
  summary: "Completed turn-only greeting; standing amber condition remains.",
  goals: [],
  constraints: ["Always retain the amber condition."],
  decisions: [],
  open_questions: [],
  unfulfilled_commitments: [],
  task_refs: [],
  pending_owner: null,
};
async function fixture(run: (app: App) => Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue84-summary-"));
  const app = await App.open(root, { model, stream: fixtureStream });
  try {
    await run(app);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test("issue84 summary contract keeps new prompt provenance and rejects empty or invalid tiers", async () =>
  fixture(async (app) => {
    assert.equal(SUMMARY_POLICY, "bounded-summary-v3");
    assert(SUMMARY_SYSTEM.startsWith("CONSCIOUSNESS:"));
    assert.match(SUMMARY_SYSTEM, /1–12 items, never an empty/);
    assert.match(SUMMARY_SYSTEM, /exactly ACTIVE, QUIET or MINIMAL/);
    assert.match(
      SUMMARY_SYSTEM,
      /Turn-only instructions remain historical and fulfilled/,
    );
    assert.match(SUMMARY_SYSTEM, /preserve genuine standing instructions/);
    for (const key of ["probe", "followup", "vision"] as const)
      assert(prompts[key].includes("仅本轮"));
    const source =
      "Only this turn: say hello without tools. Always retain the amber condition.";
    const refs = [app.store.put([{ role: "user", content: source }])];
    const plan = createSummaryPlan({
      model,
      refs,
      items: [],
      commitments: [],
      sources: [{ id: "synthetic", text: source }],
    });
    assert.equal(plan.system_hash, hash(plan.system));
    let calls = 0;
    let candidate: SummaryCandidate = { items: [], completed: 0 };
    const stream: StreamFn = (m, c) => {
      calls++;
      const system = c.messages
        .filter((x) => x.role === "system")
        .map((x) => contentText(x.content))
        .join("\n");
      assert(system.includes(plan.system));
      const body = JSON.parse(contentText(c.messages.at(-1)!.content));
      assert(body.source_chunk.includes("amber"));
      const response =
        calls === 1
          ? { items: [] }
          : calls === 2
            ? { items: [{ ...item, tier: "BACKGROUND" }] }
            : { items: [item] };
      return replyStream([{ type: "text", text: JSON.stringify(response) }], m);
    };
    const args = {
      store: app.store,
      model,
      stream,
      sessionID: app.host.sessionID,
      loopID: id(),
      consciousnessRevision: 1,
      refs,
      plan,
      commitments: [],
      checkpoint: (c: SummaryCandidate) => {
        candidate = c;
      },
    };
    await assert.rejects(
      runSummary({ ...args, candidate }),
      /EMPTY_WORKING_MEMORY/,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      runSummary({ ...args, candidate, round: 1 }),
      /INVALID_WorkItem/,
    );
    assert.equal(calls, 2);
    const result = await runSummary({ ...args, candidate, round: 2 });
    assert.equal(calls, 3);
    assert.deepEqual(result.items[0].constraints, item.constraints);
    assert.deepEqual(result.items[0].goals, []);
    assert.equal(result.items[0].pending_owner, null);
    // These are deterministic contract fixtures, not an assertion about model semantics.
  }));
test("issue84 legacy frozen system resumes unchanged; a tampered new system hash sends nothing", async () =>
  fixture(async (app) => {
    const refs = [
      app.store.put([{ role: "user", content: "synthetic legacy source" }]),
    ];
    const oldSystem =
      "CONSCIOUSNESS: Frozen legacy fixture prompt; return supplied completed memory.";
    const plan = createSummaryPlan({
      model,
      refs,
      items: [],
      commitments: [],
      sources: [{ id: "legacy", text: "synthetic legacy source" }],
      system: oldSystem,
    });
    delete plan.system_hash;
    const original = JSON.stringify(plan);
    let calls = 0;
    const stream: StreamFn = (m, c) => {
      calls++;
      assert.equal(
        contentText(c.messages.find((x) => x.role === "system")!.content),
        oldSystem,
      );
      return replyStream(
        [{ type: "text", text: JSON.stringify({ items: [item] }) }],
        m,
      );
    };
    const args = {
      store: app.store,
      model,
      stream,
      sessionID: app.host.sessionID,
      loopID: id(),
      consciousnessRevision: 1,
      refs,
      plan,
      commitments: [],
      candidate: { items: [], completed: 0 },
      checkpoint: () => {},
    };
    await runSummary(args);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(plan), original);
    await assert.rejects(
      runSummary({
        ...args,
        plan: { ...plan, system_hash: hash("different text") },
      }),
      /SUMMARY_SYSTEM_HASH_MISMATCH/,
    );
    assert.equal(calls, 1);
  }));
test("issue84 over 64 fragments fails before a request or a partial plan can commit", () => {
  assert.throws(
    () =>
      createSummaryPlan({
        model,
        refs: [],
        items: [],
        commitments: [],
        sources: [{ id: "oversized", text: "x".repeat(1_100_000) }],
      }),
    /SUMMARY_SEGMENT_LIMIT/,
  );
});
