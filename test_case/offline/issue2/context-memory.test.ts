import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText, normalizeContext, Type } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { saveContext } from "../../../src/pi_secretary/src/context.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import {
  fixtureModel,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Consciousness,
  CompactionJob,
  Context,
  Input,
  ModelCall,
} from "../../../src/pi_secretary/src/contracts.ts";

const largeModel = {
  ...fixtureModel,
  contextWindow: 1_000_000,
  maxTokens: 65_536,
};
const summary = {
  items: [
    {
      tier: "ACTIVE",
      summary: "Synthetic review remains pending.",
      goals: [],
      constraints: [],
      decisions: [],
      open_questions: [],
      unfulfilled_commitments: [],
      task_refs: [],
      pending_owner: "MAIN",
    },
  ],
};
type Request = Parameters<StreamFn>[1];
function kind(c: Request) {
  const system = c.messages
    .filter((m) => m.role === "system")
    .map((m) => contentText(m.content))
    .join("\n");
  return system.includes("COMMITMENT_EXTRACTION:")
    ? "extraction"
    : system.includes("CONSCIOUSNESS:")
      ? "summary"
      : "main";
}
const synthetic: StreamFn = (m, c) =>
  replyStream(
    [
      {
        type: "text",
        text:
          kind(c) === "summary"
            ? JSON.stringify(summary)
            : kind(c) === "extraction"
              ? '{"quotes":[]}'
              : "SYNTHETIC_ASSISTANT_HISTORY: review acknowledged.",
      },
    ],
    m,
  );
async function fixture(
  body: (app: App) => Promise<void>,
  stream: StreamFn = synthetic,
  model = largeModel,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-issue2-"));
  const app = await App.open(dir, { model, stream });
  try {
    await body(app);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function memory(app: App) {
  return app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
}
function scope(app: App) {
  return { session_id: app.host.sessionID, task_id: null, execution_id: null };
}
async function turn(
  app: App,
  text = "Synthetic input: preserve the amber condition.",
) {
  app.host.accept(text);
  await app.host.drain();
  assert.equal(app.host.session.state, "IDLE");
}

test("INV-01 C06 complete provider response is durable before consumer receives a tool call", async () => {
  await fixture(async (app) => {
    const stream: StreamFn = (m) =>
      replyStream(
        [
          {
            type: "toolCall",
            id: "synthetic-call",
            name: "memory_read",
            arguments: { source: "consciousness" },
          },
        ],
        m,
      );
    const send = durableStream(
      app.store,
      stream,
      scope(app),
      randomUUID(),
      "MAIN",
    );
    const response = await send(
      largeModel,
      normalizeContext({
        messages: [
          { role: "user", content: "Synthetic tool request", timestamp: 1 },
        ],
        tools: [],
      }),
    );
    const saved = app.store.all<ModelCall>("ModelCall").at(-1)!;
    assert.equal(saved.state, "RESPONSE_SAVED");
    assert(saved.response);
    assert.deepEqual(app.store.read(saved.response), await response.result());
    assert.equal((await response.result()).stopReason, "toolUse");
  });
});

test("INV-02 C06 oversized main input is not sent and original accepted payload remains retrievable", async () => {
  let calls = 0;
  await fixture(
    async (app) => {
      const text = "Synthetic oversized input:" + "x".repeat(200_000);
      const input = app.host.accept(text);
      await app.host.drain();
      assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
      assert.equal(calls, 0);
      const saved = app.store.get<Input>("Input", input.id);
      assert.notEqual(saved.state, "HANDLED");
      assert.equal(app.store.bytes(saved.payload).toString(), text);
    },
    (m, c, o) => {
      calls++;
      return synthetic(m, c, o);
    },
    { ...largeModel, contextWindow: 32_768, maxTokens: 4096 },
  );
});

test("INV-03 C08 failed summary has at most two attempts, no memory commit, immutable source", async () => {
  let summaries = 0;
  await fixture(
    async (app) => {
      await turn(
        app,
        "Synthetic failed-maintenance source:" + "b".repeat(36_000),
      );
      const before = memory(app),
        source = before.pending_raw_refs[0];
      const bytes = app.store.bytes(source);
      assert(
        source.bytes > 32_768,
        "failed-source dedupe must be tested above old automatic threshold",
      );
      await app.host.compact();
      assert.equal(app.host.memoryStatus().state, "FAILED");
      assert.equal(summaries, 2);
      assert.equal(memory(app).revision, before.revision);
      assert.deepEqual(app.store.bytes(source), bytes);
      app.host.maintainIfNeeded();
      await app.host.close();
      assert.equal(summaries, 2);
    },
    (m, c, o) =>
      kind(c) === "summary"
        ? (summaries++,
          replyStream([{ type: "text", text: "invalid JSON" }], m))
        : synthetic(m, c, o),
  );
});

test("INV-04 C08 low model output ceiling clamps both summary attempts", async () => {
  const budgets: Array<number | undefined> = [];
  await fixture(
    async (app) => {
      await turn(app);
      await app.host.compact();
      assert.deepEqual(budgets, [4096, 4096]);
      assert.equal(app.host.memoryStatus().state, "COMMITTED");
    },
    (m, c, o) => {
      if (kind(c) !== "summary") return synthetic(m, c, o);
      budgets.push(o?.maxTokens);
      return replyStream(
        [
          {
            type: "text",
            text:
              budgets.length === 1 ? "invalid JSON" : JSON.stringify(summary),
          },
        ],
        m,
      );
    },
    { ...largeModel, maxTokens: 4096 },
  );
});

test("GOAL-01 C03 one low-occupancy turn above legacy 32KiB must not trigger maintenance", async () => {
  let summaries = 0;
  await fixture(
    async (app) => {
      await turn(app, "Synthetic low-occupancy source:" + "a".repeat(36_000));
      assert(
        memory(app).pending_raw_refs[0].bytes > 32_768,
        "fixture must cross old trigger",
      );
      app.host.maintainIfNeeded();
      await app.host.close();
      assert.equal(
        summaries,
        0,
        "one fresh ordinary turn well below 60% must not invoke legacy byte-triggered maintenance",
      );
    },
    (m, c, o) => {
      if (kind(c) === "summary") summaries++;
      return synthetic(m, c, o);
    },
  );
});

test("GOAL-02 C04/C15 eight low-occupancy turns update memory without cropping assistant history", async () => {
  let summaries = 0;
  await fixture(
    async (app) => {
      const before = memory(app).revision;
      for (let n = 0; n < 8; n++) {
        await turn(app, `Synthetic ordinary turn ${n}`);
        app.host.maintainIfNeeded();
      }
      await app.host.close();
      assert.equal(
        summaries,
        1,
        "eight completed turns should produce one ordinary memory update",
      );
      assert(memory(app).revision > before);
      assert.equal(
        app.host
          .previewContext()
          .filter(
            (m) =>
              m.role === "assistant" &&
              contentText(m.content).includes("SYNTHETIC_ASSISTANT_HISTORY"),
          ).length,
        8,
        "memory freshness must not implicitly crop conversation",
      );
    },
    (m, c, o) => {
      if (kind(c) === "summary") summaries++;
      return synthetic(m, c, o);
    },
  );
});

test("GOAL-03 C08 default summary budgets are 16384 then 32768 when model has room", async () => {
  const budgets: Array<number | undefined> = [];
  await fixture(
    async (app) => {
      await turn(app);
      await app.host.compact();
      assert.equal(app.host.memoryStatus().state, "COMMITTED");
      assert.deepEqual(budgets, [16_384, 32_768]);
    },
    (m, c, o) => {
      if (kind(c) !== "summary") return synthetic(m, c, o);
      budgets.push(o?.maxTokens);
      return replyStream(
        [
          {
            type: "text",
            text:
              budgets.length === 1 ? "invalid JSON" : JSON.stringify(summary),
          },
        ],
        m,
      );
    },
  );
});

test("GOAL-04 C02/C05 output reservation resolves to a safe ceiling or blocks before send", async () => {
  let sent = 0;
  let resolvedCeiling: number | undefined;
  await fixture(async (app) => {
    const send = durableStream(
      app.store,
      (m, c, o) => {
        sent++;
        resolvedCeiling = o?.maxTokens;
        return synthetic(m, c, o);
      },
      scope(app),
      randomUUID(),
      "MAIN",
      { maxTokens: 32_768 },
    );
    let failure: unknown;
    try {
      await send(
        { ...largeModel, contextWindow: 32_768 },
        normalizeContext({
          messages: [{ role: "user", content: "nonempty input", timestamp: 1 }],
          tools: [],
        }),
      );
    } catch (error) {
      failure = error;
    }
    if (sent === 0) {
      assert.match(
        String(failure),
        /CAPACITY|BUDGET|OUTPUT.*LIMIT/i,
        "a blocked request must expose its capacity reason",
      );
    } else {
      assert.equal(sent, 1);
      assert.equal(failure, undefined);
      assert(Number.isInteger(resolvedCeiling) && resolvedCeiling! > 0);
      assert(
        resolvedCeiling! + 2048 < 32_768,
        `resolved output ${resolvedCeiling} must leave the default minimum safety margin and nonempty input room`,
      );
    }
  });
});

test("INV-05 C05 normalized request snapshot records the actual tool schemas", async () => {
  await fixture(async (app) => {
    const tools = [
      {
        name: "synthetic_probe",
        description: "SYNTHETIC_TOOL_SCHEMA_MARKER",
        parameters: Type.Object({ note: Type.String() }),
      },
    ];
    const send = durableStream(
      app.store,
      synthetic,
      scope(app),
      randomUUID(),
      "MAIN",
    );
    await send(
      largeModel,
      normalizeContext({
        messages: [
          { role: "user", content: "Synthetic schema audit", timestamp: 1 },
        ],
        tools,
      }),
    );
    const context = app.store.all<Context>("Context").at(-1)!;
    assert(
      JSON.stringify(app.store.read(context.tools_schema)).includes(
        "SYNTHETIC_TOOL_SCHEMA_MARKER",
      ),
      "tools_schema must describe sent tools, not only system messages",
    );
  });
});

test("INV-06 C05 normalized huge tool schema is counted in send gate", async () => {
  let sent = 0;
  await fixture(async (app) => {
    const send = durableStream(
      app.store,
      (m, c, o) => {
        sent++;
        return synthetic(m, c, o);
      },
      scope(app),
      randomUUID(),
      "MAIN",
    );
    let failure: unknown;
    try {
      await send(
        { ...largeModel, contextWindow: 32_768 },
        normalizeContext({
          messages: [{ role: "user", content: "small input", timestamp: 1 }],
          tools: [
            {
              name: "synthetic_probe",
              description: "schema".repeat(40_000),
              parameters: Type.Object({}),
            },
          ],
        }),
      );
    } catch (error) {
      failure = error;
    }
    assert.equal(sent, 0, "large tool description must consume capacity");
    assert.match(String(failure), /CAPACITY|BUDGET/i);
  });
});

test("GOAL-07 C06 oversized recovery checkpoint is retained independently of send eligibility", async () => {
  await fixture(async (app) => {
    const messages = [
      {
        role: "user" as const,
        content: "Synthetic oversized checkpoint:" + "x".repeat(200_000),
        timestamp: 1,
      },
    ];
    const context = saveContext(
      app.store,
      messages,
      scope(app),
      "MAIN",
      largeModel.id,
      randomUUID(),
      32_768,
      { captureKind: "CHECKPOINT" },
    );
    assert.equal(context.capture_kind, "CHECKPOINT");
    assert.deepEqual(app.store.read(context.raw_context), messages);
    assert.equal(app.store.get<Context>("Context", context.id).id, context.id);
    assert.equal(app.store.all<ModelCall>("ModelCall").length, 0);
  });
});

test("GOAL-08 C09 new ACCEPTED input does not invalidate fixed older memory source", async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  await fixture(
    async (app) => {
      await turn(app);
      const pending = app.host.compact();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ready,
          pending.then(() => {
            throw Error("Maintenance completed before summary gate");
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Summary gate not reached within 5 seconds")),
              5000,
            );
          }),
        ]);
        const newer = app.host.accept("Synthetic next queued turn");
        release();
        await pending;
        assert.equal(
          app.store.all<CompactionJob>("CompactionJob").at(-1)?.state,
          "COMMITTED",
          "new queued input alone cannot make a frozen completed range stale",
        );
        assert.equal(app.store.get<Input>("Input", newer.id).state, "ACCEPTED");
      } finally {
        if (timer) clearTimeout(timer);
        release();
      }
    },
    async (m, c, o) => {
      if (kind(c) === "summary") {
        started();
        await gate;
      }
      return synthetic(m, c, o);
    },
  );
});

test("GOAL-09 C18 extraction failure cannot cause summary and extraction to run again", async () => {
  let summaries = 0,
    extractions = 0;
  await fixture(
    async (app) => {
      await turn(app);
      const revision = memory(app).revision;
      await app.host.compact();
      assert.equal(app.host.memoryStatus().state, "FAILED");
      assert.equal(memory(app).revision, revision);
      assert.deepEqual(
        { summaries, extractions },
        { summaries: 1, extractions: 1 },
        "successful summary must be reusable; failed extraction is not automatically retried by outer summary loop",
      );
    },
    (m, c, o) => {
      if (kind(c) === "summary") summaries++;
      if (kind(c) === "extraction") {
        extractions++;
        return replyStream(
          [{ type: "text", text: "invalid extraction JSON" }],
          m,
        );
      }
      return synthetic(m, c, o);
    },
  );
});
