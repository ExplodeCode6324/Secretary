import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  saveContext,
  contextStatus,
} from "../../../src/pi_secretary/src/context.ts";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeContext, Type } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  assertFinalPayload,
  assertRequestBudget,
  budgetConfig,
  effectiveTools,
  requestBudget,
  summaryOutputBudget,
} from "../../../src/pi_secretary/src/budget.ts";
import {
  fixtureModel,
  replyStream,
  roleModel,
  type AgentMessage,
} from "../../../src/pi_secretary/src/model.ts";
import { Store } from "../../../src/pi_secretary/src/store.ts";
import { durableStream } from "../../../src/pi_secretary/src/transport.ts";
import type {
  Context,
  Session,
  ModelCall,
} from "../../../src/pi_secretary/src/contracts.ts";
const model = { ...fixtureModel, contextWindow: 1_000_000, maxTokens: 65536 };
const user: AgentMessage[] = [
  { role: "user", content: "Synthetic amber condition 中文", timestamp: 1 },
];
function env(values: Record<string, string>, fn: () => void) {
  const old = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, values);
    fn();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
test("BUDGET config rejects nonfinite, zero capacity, invalid order and independently bounds roles", () => {
  for (const value of ["NaN", "-1", "0", "1.5", "Infinity", ""])
    env({ SECRETARY_MAIN_CONTEXT_WINDOW: value }, () =>
      assert.throws(() => requestBudget(model, user), /BUDGET_CONFIG/),
    );
  env({ SECRETARY_COMPACTION_THRESHOLD: "0.9" }, () =>
    assert.throws(() => budgetConfig(), /BUDGET_CONFIG/),
  );
  env(
    {
      SECRETARY_MAIN_CONTEXT_WINDOW: "20000",
      SECRETARY_TASK_CONTEXT_WINDOW: "40000",
      SECRETARY_MAIN_INPUT_TOKENS: "8000",
      SECRETARY_MAIN_OUTPUT_TOKENS: "1024",
    },
    () => {
      const main = requestBudget(model, user);
      assert.equal(main.effective_context_window, 20000);
      assert.equal(main.effective_output_tokens, 1024);
      assert.equal(main.usable_input_tokens, 8000 - 2048);
      assert.equal(
        requestBudget(model, user, { role: "task" }).effective_context_window,
        40000,
      );
    },
  );
});
test("BUDGET counts full UTF8 request, replays removals and reserves only effective tools", () => {
  const tool = {
    name: "lookup",
    description: "schema".repeat(100),
    parameters: Type.Object({ query: Type.String() }),
  };
  const context = normalizeContext({ messages: user as never, tools: [tool] });
  const withTool = requestBudget(model, context.messages);
  assert.equal(withTool.tool_reserve_tokens, 4096);
  assert.equal(
    requestBudget(model, context.messages, { tools: [tool] }).estimated_tokens,
    withTool.estimated_tokens,
    "already-declared effective tools must not be counted twice",
  );
  assert(
    withTool.estimated_tokens >
      requestBudget(model, user).estimated_tokens + 600,
  );
  context.messages.push({
    role: "system",
    content: "",
    toolsRemoved: [tool],
    timestamp: 2,
  });
  assert.equal(effectiveTools(context.messages).length, 0);
  assert.equal(requestBudget(model, context.messages).tool_reserve_tokens, 0);
  assert(
    requestBudget(model, user).estimated_tokens >=
      Buffer.byteLength(JSON.stringify(user)),
  );
  assert.throws(
    () =>
      requestBudget(model, [
        {
          role: "user",
          content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
          timestamp: 1,
        },
      ]),
    /UNCOUNTABLE_NON_TEXT/,
  );
});
test("BUDGET hard gate covers exhausted output, output cap, missing model metadata and final mutations", () => {
  const clamped = assertRequestBudget(
    { ...model, contextWindow: 32768 },
    user,
    { maxTokens: 32768 },
  );
  assert(
    clamped.effective_output_tokens +
      clamped.safety_margin_tokens +
      clamped.estimated_tokens <=
      32768,
  );
  assert.equal(summaryOutputBudget(model, 1), 16384);
  assert.equal(summaryOutputBudget(model, 2), 32768);
  assert.equal(summaryOutputBudget({ ...model, maxTokens: 4096 }, 2), 4096);
  assert.throws(
    () => requestBudget({ ...model, contextWindow: 0 }, user),
    /BUDGET_CONFIG/,
  );
  const budget = assertRequestBudget(model, user);
  assert.throws(() => assertFinalPayload(model, {}, budget), /OUTPUT_LIMIT/);
  assert.throws(
    () =>
      assertFinalPayload(model, { model: model.id, max_tokens: 5000 }, budget),
    /OUTPUT_LIMIT_CHANGED/,
  );
  assert.throws(
    () =>
      assertFinalPayload(
        model,
        { model: model.id, max_tokens: 4096, messages: "x".repeat(1_000_000) },
        budget,
      ),
    /CAPACITY_BLOCKED/,
  );
});
test("BUDGET exact usable boundary passes and one extra byte blocks", () => {
  env(
    {
      SECRETARY_CONTEXT_SAFETY_TOKENS: "0",
      SECRETARY_TOOL_GROWTH_RESERVE: "0",
    },
    () => {
      const small = { ...fixtureModel, contextWindow: 32768 };
      const empty: AgentMessage[] = [
        { role: "user", content: "", timestamp: 1 },
      ];
      const initial = requestBudget(small, empty);
      const text = "x".repeat(
        initial.usable_input_tokens - initial.estimated_tokens,
      );
      const atLimit: AgentMessage[] = [
        { role: "user", content: text, timestamp: 1 },
      ];
      const result = assertRequestBudget(small, atLimit);
      assert.equal(result.estimated_tokens, result.usable_input_tokens);
      assert.throws(
        () =>
          assertRequestBudget(small, [
            { role: "user", content: text + "x", timestamp: 1 },
          ]),
        /CAPACITY_BLOCKED/,
      );
    },
  );
  env({ SECRETARY_MAIN_CONTEXT_WINDOW: "2048" }, () => {
    const diagnostic = requestBudget(model, user);
    assert(diagnostic.usable_input_tokens <= 0);
    assert(Number.isFinite(diagnostic.occupancy));
    assert.throws(() => assertRequestBudget(model, user), /CAPACITY_BLOCKED/);
  });
});

test("BUDGET Responses minimum output and disabled output cap are explicit", () => {
  const responses = { ...model, api: "openai-responses" as const };
  assert.equal(
    requestBudget(responses, user, { maxTokens: 1 }).effective_output_tokens,
    16,
  );
  assert.throws(
    () => requestBudget({ ...responses, maxTokens: 8 }, user),
    /OUTPUT_LIMIT/,
  );
  assert.throws(
    () =>
      requestBudget(
        { ...responses, compat: { supportsMaxOutputTokens: false } },
        user,
      ),
    /OUTPUT_LIMIT/,
  );
});
async function capture(
  fn: (url: string, bodies: Record<string, unknown>[]) => Promise<void>,
) {
  const bodies: Record<string, unknown>[] = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    bodies.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (req.url?.endsWith("/responses")) {
      const response = {
        id: "resp_synthetic",
        status: "completed",
        model: "synthetic",
        output: [],
        usage: {
          input_tokens: 10,
          output_tokens: 0,
          total_tokens: 10,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };
      res.end(
        `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\n`,
      );
    } else {
      res.end(
        `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", created: 1, model: "synthetic", choices: [{ index: 0, delta: { content: "synthetic" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\ndata: [DONE]\n\n`,
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${address.port}/v1`, bodies);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
for (const id of ["deepseek-v4.1-flash", "gpt-5.6-luna"]) {
  test(`BUDGET actual registered ${id} adapter HTTP payload matches durable ceiling`, async () =>
    capture(async (url, bodies) => {
      const registered = getModel("opencode-go", id as never)!;
      const live = { ...registered, baseUrl: url };
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-budget-"));
      const store = await Store.open(dir);
      try {
        const raw = roleModel(
          live,
          "synthetic-local-key",
          id.includes("luna") ? "task" : "main",
        );
        const stream = durableStream(
          store,
          raw.stream,
          { session_id: null, execution_id: null, task_id: null },
          "00000000-0000-4000-8000-000000000001",
          id.includes("luna") ? "TASK" : "MAIN",
          { maxTokens: 16384 },
        );
        const response = await (
          await stream(
            live,
            normalizeContext({
              messages: user as never,
              tools: [
                {
                  name: "lookup",
                  description: "Synthetic",
                  parameters: Type.Object({ text: Type.String() }),
                },
              ],
            }),
          )
        ).result();
        assert.notEqual(response.stopReason, "error", response.errorMessage);
        assert.equal(bodies.length, 1);
        assert.equal(
          bodies[0][id.includes("luna") ? "max_output_tokens" : "max_tokens"],
          16384,
        );
        assert(Array.isArray(bodies[0].tools));
        const context = store.all<Context>("Context")[0];
        assert.equal(context.request_budget?.effective_output_tokens, 16384);
        assert.equal(
          store.all<ModelCall>("ModelCall")[0].state,
          "RESPONSE_SAVED",
        );
        const changed = await raw.stream(
          live,
          normalizeContext({ messages: user as never }),
          {
            maxTokens: 4096,
            onPayload: (payload) => ({
              ...(payload as object),
              ...(id.includes("luna")
                ? { max_output_tokens: 5000 }
                : { max_tokens: 5000 }),
            }),
          },
        );
        assert.match(
          (await changed.result()).errorMessage ?? "",
          /CAPACITY_OUTPUT_LIMIT_CHANGED/,
        );
        assert.equal(
          bodies.length,
          1,
          "mutated final ceiling must not reach HTTP",
        );
      } finally {
        await store.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }));
}

test("BUDGET rejection persists unsent facts; UI request stays distinct from oversize checkpoint", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-budget-view-"));
  const app = await App.open(dir, {
    model,
    stream: (m) => replyStream([{ type: "text", text: "synthetic" }], m),
  });
  const store = app.store;
  const sessionID = app.host.sessionID;
  const scope = { session_id: sessionID, task_id: null, execution_id: null };
  try {
    let sent = 0;
    const stream = durableStream(
      store,
      (m) => {
        sent++;
        return replyStream([{ type: "text", text: "synthetic" }], m);
      },
      scope,
      "00000000-0000-4000-8000-000000000003",
      "MAIN",
    );
    await assert.rejects(
      async () =>
        stream(
          { ...model, contextWindow: 2048 },
          normalizeContext({ messages: user as never }),
        ),
      /CAPACITY_BLOCKED/,
    );
    assert.equal(sent, 0);
    assert.equal(store.all("ModelCall").length, 0);
    const rejected = store.logs.find(
      (event) => event.event_type === "model.capacity_blocked",
    )!;
    const evidence = store.read<{
      sent: boolean;
      request_budget: { usable_input_tokens: number };
    }>(rejected.payload);
    assert.equal(evidence.sent, false);
    assert(evidence.request_budget.usable_input_tokens <= 0);
    await (
      await stream(model, normalizeContext({ messages: user as never }))
    ).result();
    const checkpoint = saveContext(
      store,
      [{ role: "user", content: "x".repeat(50000), timestamp: 1 }],
      scope,
      "MAIN",
      model.id,
      "00000000-0000-4000-8000-000000000003",
      32768,
      { captureKind: "CHECKPOINT", protectedFromIndex: 1 },
    );
    const view = contextStatus(
      store,
      { id: sessionID, last_context_id: checkpoint.id } as Session,
      model,
    );
    assert.equal(view.capture_kind, "MODEL_REQUEST");
    assert(view.used! < 50000);
    assert.equal(view.checkpoint?.id, checkpoint.id);
    assert.equal(checkpoint.protected_from_index, 1);
    assert.equal(view.next_request_budget, null);
    assert.equal(view.observed_usage?.input, 0);
    const read = store.read.bind(store);
    let repeatedBodyReads = 0;
    store.read = ((...args: Parameters<typeof store.read>) => {
      repeatedBodyReads++;
      return read(...args);
    }) as typeof store.read;
    for (let i = 0; i < 10; i++)
      contextStatus(
        store,
        { id: sessionID, last_context_id: checkpoint.id } as Session,
        model,
      );
    assert.equal(
      repeatedBodyReads,
      0,
      "unchanged capacity UI must not reread prior request/response bodies",
    );
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("BUDGET normalized request lands precisely below and at 60/80 percent boundaries", () => {
  env(
    {
      SECRETARY_CONTEXT_SAFETY_TOKENS: "0",
      SECRETARY_TOOL_GROWTH_RESERVE: "0",
    },
    () => {
      const bounded = {
        ...fixtureModel,
        contextWindow: 50000,
        maxTokens: 4000,
      };
      const empty: AgentMessage[] = [
        { role: "user", content: "", timestamp: 1 },
      ];
      const base = requestBudget(bounded, empty),
        policy = budgetConfig();
      assert.equal(base.usable_input_tokens, 46000);
      for (const [input, normal, forced] of [
        [27599, false, false],
        [27600, true, false],
        [36799, true, false],
        [36800, true, true],
      ] as const) {
        const b = requestBudget(bounded, [
          {
            role: "user",
            content: "x".repeat(input - base.estimated_tokens),
            timestamp: 1,
          },
        ]);
        assert.equal(b.estimated_tokens, input);
        assert.equal(b.occupancy >= policy.normal, normal);
        assert.equal(b.occupancy >= policy.forced, forced);
        assert(
          b.estimated_tokens <= b.usable_input_tokens,
          "maintenance thresholds are below hard send limit",
        );
      }
    },
  );
});

test("HOST settings candidate capacity preflight precedes snapshot and Context commits", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-settings-preflight-"),
  );
  const app = await App.open(dir, {
    model: { ...fixtureModel, contextWindow: 32768 },
    stream: (m) => replyStream([{ type: "text", text: "synthetic" }], m),
  });
  try {
    const before = {
      contexts: app.store.all("Context").length,
      prompts: app.store.all("MainPromptSnapshot").length,
      sequence: app.store.sequence,
      revision: app.host.session.revision,
    };
    assert.throws(
      () =>
        app.host.prepareSettingsContext(
          "00000000-0000-4000-8000-000000000004",
          "Synthetic candidate settings",
          2,
          [
            {
              role: "user",
              content:
                "Synthetic retained Master constraints:" + "x".repeat(50000),
              timestamp: 1,
            },
          ],
          2,
        ),
      /CAPACITY_BLOCKED/,
    );
    assert.equal(app.store.all("Context").length, before.contexts);
    assert.equal(app.store.all("MainPromptSnapshot").length, before.prompts);
    assert.equal(
      app.store.sequence,
      before.sequence,
      "no journal commit may precede failing candidate budget",
    );
    assert.equal(app.host.session.revision, before.revision);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
