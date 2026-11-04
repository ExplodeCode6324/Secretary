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
} from "../../../src/pi_secretary/src/model.ts";
import {
  createSummaryPlan,
  runSummary,
  type SummaryCandidate,
} from "../../../src/pi_secretary/src/summary.ts";
import { requestBudget } from "../../../src/pi_secretary/src/budget.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";

const rawItem = () => ({
  tier: "ACTIVE",
  summary: "保留条件🙂",
  goals: [] as string[],
  constraints: [] as string[],
  decisions: [],
  open_questions: [],
  unfulfilled_commitments: [],
  task_refs: [],
  pending_owner: "MAIN",
});
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
function fill(items: ReturnType<typeof rawItem>[], target: number) {
  let i = 0;
  while (bytes(items) < target) {
    const item = items[i % items.length];
    if (!item.goals.length || item.goals.at(-1)!.length >= 1100)
      item.goals.push("");
    item.goals[item.goals.length - 1] += "x";
    i++;
  }
  return items;
}
for (const output of [8192, 65536]) {
  test(`legal near-limit raw items survive host enrichment and later fragments (output ${output})`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-budget-"));
    const model = { ...fixtureModel, contextWindow: 120000, maxTokens: output };
    const app = await App.open(dir, { model, stream: fixtureStream });
    try {
      const refs = [
        app.store.put("first source"),
        app.store.put("second source"),
      ];
      const options = {
        model,
        refs,
        items: [],
        commitments: [],
        sources: [{ id: "unicode", text: '中🙂\\"\n'.repeat(7000) }],
      };
      const plan = createSummaryPlan(options);
      assert(plan.chunks.length > 1);
      const items = fill([rawItem()], plan.max_candidate_bytes - 10);
      let checkpoint: SummaryCandidate = { items: [], completed: 0 };
      let calls = 0;
      const args = {
        store: app.store,
        model,
        sessionID: app.host.sessionID,
        loopID: id(),
        consciousnessRevision: 1,
        refs,
        plan,
        commitments: [],
        checkpoint: (c: SummaryCandidate) => {
          checkpoint = c;
        },
        stream: (m: typeof model, c: any, o: any) => {
          calls++;
          const body = JSON.parse(contentText(c.messages.at(-1).content));
          assert(bytes(items) <= body.candidate_byte_limit);
          const budget = requestBudget(m, c.messages, {
            maxTokens: o?.maxTokens,
            tools: [],
          });
          assert(budget.estimated_tokens <= budget.usable_input_tokens);
          return replyStream(
            [{ type: "text", text: JSON.stringify({ items }) }],
            m,
          );
        },
      };
      const result = await runSummary({ ...args, candidate: checkpoint });
      assert.equal(result.completed, plan.chunks.length);
      assert(bytes(result.items) <= plan.prior_bytes);
      assert.deepEqual(result.items[0].source_refs, refs);
      assert.equal(result.items[0].summary, items[0].summary);
      await runSummary({ ...args, candidate: result });
      assert.equal(
        calls,
        plan.chunks.length,
        "completed checkpoints must never resend",
      );
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("metadata reservation covers all twelve items and long escaped refs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-twelve-"));
  const model = { ...fixtureModel, contextWindow: 250000, maxTokens: 65536 };
  const app = await App.open(dir, { model, stream: fixtureStream });
  try {
    // Synthetic ObjectRefs exercise serialization; no file content is retrieved.
    const refs = [
      { ...app.store.put("source"), path: 'long/中🙂/\\"'.repeat(80) },
    ];
    const options = {
      model,
      refs,
      items: [],
      commitments: [],
      sources: [{ id: "topics", text: "Twelve independent synthetic topics" }],
    };
    const plan = createSummaryPlan(options);
    const items = fill(
      Array.from({ length: 12 }, rawItem),
      plan.max_candidate_bytes - 10,
    );
    const result = await runSummary({
      store: app.store,
      model,
      sessionID: app.host.sessionID,
      loopID: id(),
      consciousnessRevision: 1,
      refs,
      plan,
      commitments: [],
      candidate: { items: [], completed: 0 },
      checkpoint: () => {},
      stream: (m) =>
        replyStream([{ type: "text", text: JSON.stringify({ items }) }], m),
    });
    assert.equal(result.items.length, 12);
    assert(bytes(result.items) <= plan.prior_bytes);
    for (const item of result.items) assert.deepEqual(item.source_refs, refs);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("genuine raw overflow preserves previous memory and retry receives numeric budget", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-overflow-"));
  const model = { ...fixtureModel, contextWindow: 120000, maxTokens: 8192 };
  const app = await App.open(dir, { model, stream: fixtureStream });
  try {
    const refs = [app.store.put("evidence")];
    const previous = [
      {
        ...rawItem(),
        item_id: id(),
        source_refs: refs,
        last_activity_at: new Date().toISOString(),
      },
    ] as any;
    const options = {
      model,
      refs,
      items: previous,
      commitments: [],
      sources: [{ id: "next", text: "Retain the original condition" }],
    };
    const plan = createSummaryPlan(options);
    let current: SummaryCandidate = { items: previous, completed: 0 };
    const bodies: any[] = [];
    const args = {
      store: app.store,
      model,
      sessionID: app.host.sessionID,
      loopID: id(),
      consciousnessRevision: 1,
      refs,
      plan,
      commitments: [],
      checkpoint: (c: SummaryCandidate) => {
        current = c;
      },
      stream: (m: typeof model, c: any) => {
        const body = JSON.parse(contentText(c.messages.at(-1).content));
        bodies.push(body);
        const items =
          bodies.length === 1
            ? fill([rawItem()], body.candidate_byte_limit + 1)
            : [rawItem()];
        return replyStream(
          [{ type: "text", text: JSON.stringify({ items }) }],
          m,
        );
      },
    };
    await assert.rejects(
      runSummary({ ...args, candidate: current }),
      /SUMMARY_AGGREGATE_LIMIT/,
    );
    assert.deepEqual(current.items, previous);
    assert.equal(current.completed, 0);
    const result = await runSummary({ ...args, candidate: current, round: 1 });
    assert.equal(result.completed, 1);
    assert.equal(
      bodies[1].candidate_byte_limit,
      Math.floor(bodies[0].candidate_byte_limit * 0.8),
    );
    assert.match(bodies[1].previous_error, /SUMMARY_AGGREGATE_LIMIT/);
    assert.deepEqual(bodies[0].source_chunk, bodies[1].source_chunk);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("partial summary survives Store reopen without resending a completed fragment", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-reopen-"));
  const model = { ...fixtureModel, contextWindow: 120000, maxTokens: 8192 };
  let app = await App.open(dir, { model, stream: fixtureStream });
  let calls = 0;
  const packets: any[] = [];
  try {
    const refs = [app.store.put("persistent evidence")];
    const options = {
      model,
      refs,
      items: [],
      commitments: [],
      sources: [{ id: "long", text: "continuous source 汉🙂".repeat(2000) }],
    };
    const plan = createSummaryPlan(options);
    assert(plan.chunks.length >= 2);
    const planRef = app.store.put(plan);
    const loopID = id();
    let checkpointRef = app.store.put({ items: [], completed: 0 });
    const stream = (m: typeof model, c: any) => {
      calls++;
      packets.push(JSON.parse(contentText(c.messages.at(-1).content)));
      return replyStream(
        [
          {
            type: "text",
            text:
              calls === 2
                ? "invalid JSON"
                : JSON.stringify({ items: [rawItem()] }),
          },
        ],
        m,
      );
    };
    const args = () => ({
      store: app.store,
      model,
      sessionID: app.host.sessionID,
      loopID,
      consciousnessRevision: 1,
      refs,
      plan: app.store.read<any>(planRef),
      commitments: [],
      stream,
      candidate: app.store.read<SummaryCandidate>(checkpointRef),
      checkpoint: (c: SummaryCandidate) => {
        checkpointRef = app.store.put(c);
      },
    });
    await assert.rejects(runSummary(args()));
    assert.equal(app.store.read<SummaryCandidate>(checkpointRef).completed, 1);
    await app.close();
    app = await App.open(dir, { model, stream: fixtureStream });
    const result = await runSummary({ ...args(), round: 1 });
    assert.equal(result.completed, plan.chunks.length);
    assert.equal(calls, plan.chunks.length + 1);
    assert.equal(packets.filter((p) => p.chunk === 1).length, 1);
    assert.equal(packets[1].source_chunk, packets[2].source_chunk);
    await runSummary({ ...args(), round: 1 });
    assert.equal(calls, plan.chunks.length + 1);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("old frozen summary policy fails closed without a new model send", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-old-policy-"));
  const model = { ...fixtureModel, contextWindow: 120000, maxTokens: 8192 };
  const app = await App.open(dir, { model, stream: fixtureStream });
  try {
    const refs = [app.store.put("legacy evidence")];
    const options = {
      model,
      refs,
      items: [],
      commitments: [],
      sources: [{ id: "old", text: "old source" }],
    };
    const plan = {
      ...createSummaryPlan(options),
      version: "bounded-summary-v2" as any,
    };
    let calls = 0,
      checkpoints = 0;
    await assert.rejects(
      runSummary({
        store: app.store,
        model,
        sessionID: app.host.sessionID,
        loopID: id(),
        consciousnessRevision: 1,
        refs,
        plan,
        commitments: [],
        candidate: { items: [], completed: 0 },
        checkpoint: () => {
          checkpoints++;
        },
        stream: (m, c, o) => {
          calls++;
          return fixtureStream(m, c, o);
        },
      }),
      /SUMMARY_POLICY_RECOVERY_MISMATCH/,
    );
    assert.equal(calls, 0);
    assert.equal(checkpoints, 0);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("frozen provenance identity cannot change even when metadata has the same size", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-ref-identity-"));
  const model = { ...fixtureModel, contextWindow: 120000, maxTokens: 8192 };
  const app = await App.open(dir, { model, stream: fixtureStream });
  try {
    const refs = [app.store.put("aa")];
    const changed = [app.store.put("bb")];
    assert.equal(bytes(refs), bytes(changed));
    const plan = createSummaryPlan({
      model,
      refs,
      items: [],
      commitments: [],
      sources: [{ id: "source", text: "Keep the original source identity" }],
    });
    let calls = 0;
    await assert.rejects(
      runSummary({
        store: app.store,
        model,
        sessionID: app.host.sessionID,
        loopID: id(),
        consciousnessRevision: 1,
        refs: changed,
        plan,
        commitments: [],
        candidate: { items: [], completed: 0 },
        checkpoint: () => assert.fail("must reject before checkpoint"),
        stream: (m, c, o) => {
          calls++;
          return fixtureStream(m, c, o);
        },
      }),
      /SUMMARY_REFS_BOUND_CHANGED/,
    );
    assert.equal(calls, 0);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("packed requests admit control-character errors and escaping-heavy later candidates", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-escaping-"));
  const model = { ...fixtureModel, contextWindow: 60000, maxTokens: 8192 };
  const app = await App.open(dir, { model, stream: fixtureStream });
  try {
    const refs = [app.store.put("source"), app.store.put("full evidence")];
    const source = "汉🙂" + '\\"'.repeat(6000);
    const options = {
      model,
      refs,
      items: [],
      commitments: [],
      sources: [{ id: "escaped", text: source }],
    };
    const plan = createSummaryPlan(options);
    assert.equal(
      plan.chunks
        .flatMap((c) => JSON.parse(c))
        .map((f) => f.fragment)
        .join(""),
      source,
    );
    const item = rawItem();
    item.goals = ['\\"'.repeat(450), '\\"'.repeat(450)];
    assert(bytes([item]) < plan.max_candidate_bytes);
    let calls = 0;
    const result = await runSummary({
      store: app.store,
      model,
      sessionID: app.host.sessionID,
      loopID: id(),
      consciousnessRevision: 1,
      refs,
      plan,
      commitments: [],
      candidate: {
        items: [],
        completed: 0,
        previous_error: "\u0001".repeat(512),
      },
      checkpoint: () => {},
      stream: (m, c, o) => {
        calls++;
        const body = JSON.parse(contentText(c.messages.at(-1)!.content));
        if (calls === 1)
          assert.equal(body.previous_error, "\u0001".repeat(512));
        else assert.deepEqual(body.previous_items[0].source_refs, refs);
        const budget = requestBudget(m, c.messages, {
          maxTokens: o?.maxTokens,
          tools: [],
        });
        assert(budget.estimated_tokens <= budget.usable_input_tokens);
        return replyStream(
          [{ type: "text", text: JSON.stringify({ items: [item] }) }],
          m,
        );
      },
    });
    assert.equal(result.completed, plan.chunks.length);
    assert.equal(calls, plan.chunks.length);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
