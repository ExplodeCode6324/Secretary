import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { Store, id } from "../../../src/pi_secretary/src/store.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import {
  createSummaryPlan,
  runSummary,
  type SummaryCandidate,
} from "../../../src/pi_secretary/src/summary.ts";
import { extractNewCommitments } from "../../../src/pi_secretary/src/memory-extraction.ts";
import { requestBudget } from "../../../src/pi_secretary/src/budget.ts";
const model = { ...fixtureModel, contextWindow: 100000, maxTokens: 65536 };
async function fixture(body: (store: Store) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue2-summary-"));
  const app = await App.open(dir, { model, stream: fixtureStream });
  const store = app.store;
  try {
    await body(store);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("shared summary freezes complete Unicode sources and both output budgets", async () => {
  const text = '汉字🙂\\"\n'.repeat(4000);
  const plan = createSummaryPlan({
    model,
    items: [],
    commitments: [],
    sources: [{ id: "source-one", text }],
  });
  assert.deepEqual(plan.outputs, [16384, 32768]);
  const fragments = plan.chunks.flatMap((chunk) => JSON.parse(chunk));
  let offset = 0;
  for (const fragment of fragments) {
    assert.equal(fragment.offset, offset);
    assert.equal(fragment.source_id, "source-one");
    assert(!fragment.fragment.includes("\ufffd"));
    offset += Array.from(fragment.fragment).length;
  }
  assert.equal(fragments.map((v) => v.fragment).join(""), text);
  assert.equal(offset, Array.from(text).length);
});
test("summary retry retains source and checkpoints prevent a third attempt on resume", async () =>
  fixture(async (store) => {
    const plan = createSummaryPlan({
      model,
      items: [],
      commitments: [],
      sources: [{ id: "fixed", text: "Complete original material" }],
    });
    const packets: any[] = [],
      budgets: number[] = [];
    const stream: StreamFn = (m, c, o) => {
      packets.push(JSON.parse(contentText(c.messages.at(-1)!.content)));
      budgets.push(Number(o?.maxTokens));
      const budget = requestBudget(m, c.messages, {
        maxTokens: o?.maxTokens,
        tools: [],
      });
      assert(budget.estimated_tokens <= budget.usable_input_tokens);
      return replyStream([{ type: "text", text: "bad JSON" }], m);
    };
    let candidate: SummaryCandidate = { items: [], completed: 0 };
    const args = {
      store,
      model,
      stream,
      sessionID: store.all("Session")[0].id,
      loopID: id(),
      consciousnessRevision: 1,
      refs: [store.put([{ role: "user", content: "synthetic evidence" }])],
      plan,
      commitments: [],
      checkpoint: (c: SummaryCandidate) => {
        candidate = c;
      },
    };
    await assert.rejects(runSummary({ ...args, candidate }));
    assert.equal(packets.length, 2);
    assert.equal(packets[0].source_chunk, packets[1].source_chunk);
    assert.deepEqual(budgets, [16384, 32768]);
    assert(packets[1].candidate_byte_limit < packets[0].candidate_byte_limit);
    await assert.rejects(runSummary({ ...args, candidate }));
    assert.equal(packets.length, 2);
  }));
test("successful summary checkpoint resumes without repeating model work", async () =>
  fixture(async (store) => {
    const plan = createSummaryPlan({
      model,
      items: [],
      commitments: [],
      sources: [{ id: "source", text: "one material" }],
    });
    let calls = 0;
    const stream: StreamFn = (m, c, o) => {
      calls++;
      return fixtureStream(m, c, o);
    };
    const args = {
      store,
      model,
      stream,
      sessionID: store.all("Session")[0].id,
      loopID: id(),
      consciousnessRevision: 1,
      refs: [store.put([{ role: "user", content: "synthetic evidence" }])],
      plan,
      commitments: [],
      checkpoint: () => {},
    };
    const candidate = await runSummary({
      ...args,
      candidate: { items: [], completed: 0 },
    });
    assert.equal(candidate.completed, plan.chunks.length);
    assert.equal((await runSummary({ ...args, candidate })).completed, 1);
    assert.equal(calls, 1);
  }));
test("aggregate oversized candidate and tool continuations never become successful memory", async () =>
  fixture(async (store) => {
    const plan = createSummaryPlan({
      model,
      items: [],
      commitments: [],
      sources: [{ id: "source", text: "source" }],
    });
    const stream: StreamFn = (m) =>
      replyStream(
        [
          {
            type: "text",
            text: JSON.stringify({
              items: [{ summary: "x".repeat(plan.max_candidate_bytes + 1) }],
            }),
          },
        ],
        m,
      );
    const args = {
      store,
      model,
      stream,
      sessionID: store.all("Session")[0].id,
      loopID: id(),
      consciousnessRevision: 1,
      refs: [store.put([{ role: "user", content: "synthetic evidence" }])],
      plan,
      commitments: [],
      candidate: { items: [], completed: 0 },
      checkpoint: () => {},
    };
    await assert.rejects(runSummary(args), /SUMMARY_AGGREGATE_LIMIT/);
    let calls = 0;
    await assert.rejects(
      runSummary({
        ...args,
        loopID: id(),
        stream: (m) => {
          calls++;
          return replyStream(
            [
              {
                type: "toolCall",
                id: "forbidden",
                name: "anything",
                arguments: {},
              },
            ],
            m,
          );
        },
      }),
      /SUMMARY_INCOMPLETE|SUMMARY_TOOL_CALL/,
    );
    assert.equal(calls, 2);
  }));
test("commitment extraction failure is durable and success is reused by source identity", async () =>
  fixture(async (store) => {
    let calls = 0;
    const options = {
      store,
      model,
      stream: ((m) => {
        calls++;
        return replyStream([{ type: "text", text: "not json" }], m);
      }) as StreamFn,
      sessionID: store.all("Session")[0].id,
      loopID: id(),
      consciousnessRevision: 1,
      source: { complete: "If approved, I will review it." },
      existing: [],
      extractionKey: "fixed-source",
    };
    await assert.rejects(extractNewCommitments(options));
    await assert.rejects(
      extractNewCommitments({ ...options, loopID: id() }),
      /REPLAY_BLOCKED/,
    );
    assert.equal(calls, 1);
    const success = {
      ...options,
      extractionKey: "new-source",
      source: {
        event_id: "different-event",
        complete: "If approved, I will review it.",
      },
      stream: ((m) => {
        calls++;
        return replyStream(
          [
            {
              type: "text",
              text: '{"quotes":["If approved, I will review it."]}',
            },
          ],
          m,
        );
      }) as StreamFn,
    };
    assert.deepEqual(await extractNewCommitments(success), [
      "If approved, I will review it.",
    ]);
    assert.deepEqual(
      await extractNewCommitments({ ...success, loopID: id() }),
      ["If approved, I will review it."],
    );
    assert.equal(calls, 2);
  }));
test("oversized complete commitment source blocks before any partial extraction", async () =>
  fixture(async (store) => {
    let calls = 0;
    await assert.rejects(
      extractNewCommitments({
        store,
        model: fixtureModel,
        stream: (m) => {
          calls++;
          return replyStream([{ type: "text", text: '{"quotes":[]}' }], m);
        },
        sessionID: store.all("Session")[0].id,
        loopID: id(),
        consciousnessRevision: 1,
        source: null,
        existing: [],
        completeMessages: [{ id: "huge", text: "x".repeat(100000) }],
      }),
      /COMPLETE_SOURCE_CAPACITY_BLOCKED/,
    );
    assert.equal(calls, 0);
  }));
test("fixed previous memory and ledger cannot be dropped to fit a fragment", () => {
  assert.throws(
    () =>
      createSummaryPlan({
        model: fixtureModel,
        items: [],
        commitments: [{ text: "x".repeat(40000) } as any],
        sources: [{ id: "source", text: "must survive" }],
      }),
    /SUMMARY_FIXED_INPUT_CAPACITY_BLOCKED/,
  );
});

test("new messages and ledger changes cannot retry a failed extraction prefix", async () =>
  fixture(async (store) => {
    let calls = 0;
    const options = {
      store,
      model,
      sessionID: store.all("Session")[0].id,
      loopID: id(),
      consciousnessRevision: 1,
      existing: [],
      source: null,
      completeMessages: [
        { id: "event-one", text: "If approved, I will review." },
      ],
      stream: ((m) => {
        calls++;
        return replyStream([{ type: "text", text: "bad" }], m);
      }) as StreamFn,
    };
    await assert.rejects(extractNewCommitments(options));
    await assert.rejects(
      extractNewCommitments({
        ...options,
        loopID: id(),
        existing: [{ text: "unrelated ledger growth" } as any],
        completeMessages: [
          ...options.completeMessages,
          { id: "event-two", text: "A newly arrived event" },
        ],
      }),
      /REPLAY_BLOCKED/,
    );
    assert.equal(calls, 1);
  }));
test("settings source keeps equal-text distinct events and complete evidence", async () => {
  const { settingsSource } =
    await import("../../../src/pi_secretary/src/settings-memory.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue2-setting-source-"));
  const app = await App.open(dir, { model, stream: fixtureStream });
  try {
    const scope = {
      session_id: app.host.sessionID,
      task_id: null,
      execution_id: null,
    };
    const message = {
      role: "user",
      content: "Identical body but distinct events",
      timestamp: 1,
    };
    const first = app.store.event("main.message", message, scope);
    app.store.commit([], [first]);
    const second = app.store.event("main.message", message, scope);
    app.store.commit([], [second]);
    const source = settingsSource(app.host, { world: [], instructions: null });
    const fragments = source.chunks.flatMap((chunk) => JSON.parse(chunk));
    assert(fragments.some((value) => value.source_id === first.event_id));
    assert(fragments.some((value) => value.source_id === second.event_id));
    assert.equal(source.extraction_messages.length, 2);
    assert.deepEqual(app.store.read(source.refs.at(-1)!), [message, message]);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("commitment proof reads decoded text, excludes serialization and tool output", async () =>
  fixture(async (store) => {
    const { reconcileCommitments } =
      await import("../../../src/pi_secretary/src/memory.ts");
    const memory =
      store.all<
        import("../../../src/pi_secretary/src/contracts.ts").Consciousness
      >("Consciousness")[0];
    const quote = 'If "approved",\nI will review.';
    const original = store.put([
      { role: "assistant", content: [{ type: "text", text: quote }] },
    ]);
    const candidate: any = {
      item_id: id(),
      tier: "ACTIVE",
      summary: "Review",
      goals: [],
      constraints: [],
      decisions: [],
      open_questions: [],
      unfulfilled_commitments: [quote, "content"],
      task_refs: [],
      pending_owner: "MAIN",
      source_refs: [original],
      last_activity_at: new Date().toISOString(),
    };
    assert.deepEqual(
      reconcileCommitments(store, memory, [candidate], original).map(
        (entry) => entry.text,
      ),
      [quote],
    );
    const tool = store.put([
      { role: "toolResult", content: [{ type: "text", text: quote }] },
    ]);
    assert.deepEqual(
      reconcileCommitments(store, memory, [candidate], tool),
      [],
    );
  }));

test("retry reason is reset after each successful fragment", async () =>
  fixture(async (store) => {
    const plan = createSummaryPlan({
      model,
      items: [],
      commitments: [],
      sources: [{ id: "long-source", text: "x".repeat(24000) }],
    });
    assert(plan.chunks.length >= 2);
    const packets: any[] = [];
    const stream: StreamFn = (m, c, o) => {
      packets.push(JSON.parse(contentText(c.messages.at(-1)!.content)));
      return packets.length === 1
        ? replyStream([{ type: "text", text: "bad json" }], m)
        : fixtureStream(m, c, o);
    };
    await runSummary({
      store,
      model,
      stream,
      sessionID: store.all("Session")[0].id,
      loopID: id(),
      consciousnessRevision: 1,
      refs: [store.put("original evidence")],
      plan,
      commitments: [],
      candidate: { items: [], completed: 0 },
      checkpoint: () => {},
    });
    assert(packets[1].previous_error);
    assert.equal(packets[2].previous_error, null);
  }));

test("successful source is not re-extracted when another event changes packing", async () =>
  fixture(async (store) => {
    const packets: any[] = [];
    const options = {
      store,
      model,
      sessionID: store.all("Session")[0].id,
      loopID: id(),
      consciousnessRevision: 1,
      existing: [],
      source: null,
      completeMessages: [
        { id: "event-one", text: "First complete original source" },
      ],
      stream: ((m, c) => {
        packets.push(JSON.parse(contentText(c.messages.at(-1)!.content)));
        return replyStream([{ type: "text", text: '{"quotes":[]}' }], m);
      }) as StreamFn,
    };
    await extractNewCommitments(options);
    await extractNewCommitments({
      ...options,
      loopID: id(),
      existing: [{ text: "Changed ledger" } as any],
      completeMessages: [
        ...options.completeMessages,
        { id: "event-two", text: "Second complete original source" },
      ],
    });
    assert.equal(packets.length, 2);
    assert.deepEqual(
      packets[1].source.map((entry: any) => entry.id),
      ["event-two"],
    );
  }));

test(
  "a real Consciousness revision conflict remains stale and reuses successful extraction",
  { timeout: 10000 },
  async () => {
    const { revise } = await import("../../../src/pi_secretary/src/store.ts");
    type Memory =
      import("../../../src/pi_secretary/src/contracts.ts").Consciousness;
    type Job =
      import("../../../src/pi_secretary/src/contracts.ts").CompactionJob;
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "issue2-memory-conflict-"),
    );
    let entered!: () => void,
      release!: () => void,
      calls = 0;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream: StreamFn = async (m, c, o) => {
      if (JSON.stringify(c).includes("COMMITMENT_EXTRACTION:")) {
        calls++;
        entered();
        await gate;
      }
      return fixtureStream(m, c, o);
    };
    const app = await App.open(dir, { model, stream });
    try {
      app.host.accept("A synthetic completed source.");
      await app.host.drain();
      const key = app.host.session.consciousness_id;
      const pending = app.host.compact();
      await Promise.race([
        ready,
        pending.then(() => {
          throw Error("missing extraction phase");
        }),
      ]);
      const newer = revise(app.store.get<Memory>("Consciousness", key), {});
      app.store.commit([newer]);
      release();
      await pending;
      assert.equal(
        app.store
          .all<Job>("CompactionJob")
          .findLast((job) => job.mode === "WORKING_MEMORY")!.state,
        "STALE",
      );
      assert.equal(
        app.store.get<Memory>("Consciousness", key).revision,
        newer.revision,
      );
      await app.host.compact();
      assert.equal(
        app.store
          .all<Job>("CompactionJob")
          .findLast((job) => job.mode === "WORKING_MEMORY")!.state,
        "COMMITTED",
      );
      assert.equal(calls, 1);
    } finally {
      release();
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
