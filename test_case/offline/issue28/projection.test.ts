import test from "node:test";
import assert from "node:assert/strict";
import { scenario, covered, memory } from "./helpers.ts";
import {
  fixtureModel,
  type AgentMessage,
} from "../../../src/pi_secretary/src/model.ts";
import {
  applyInputProjection,
  selectInputProjection,
  inputWindowConfig,
  type InputProjectionReceipt,
} from "../../../src/pi_secretary/src/input-projection.ts";
import {
  revise,
  shapeDefinition,
} from "../../../src/pi_secretary/src/store.ts";
import type { Input } from "../../../src/pi_secretary/src/contracts.ts";
function select(
  app: any,
  messages: AgentMessage[],
  searchReady = true,
  protectedFromIndex = messages.length,
  model = { ...fixtureModel, contextWindow: 65536 },
) {
  const result = selectInputProjection({
    store: app.store,
    consciousness: memory(app),
    messages,
    model,
    protectedFromIndex,
    searchReady,
  });
  if (result.receiptRef)
    app.store.commit([
      revise(memory(app), { input_projection_ref: result.receiptRef }),
    ]);
  return result;
}
test("E2/E3/E8: whole-input selection skips an oversized middle input; retired input never returns with a larger budget", () =>
  scenario(undefined, async (app) => {
    const messages = covered(app, ["small A", "B".repeat(30000), "small C"]);
    const selected = select(app, messages);
    assert.deepEqual(
      selected.messages.map((m) => (m.role === "user" ? m.content : undefined)),
      ["small A", "small C"],
    );
    const proof = app.store.read<InputProjectionReceipt>(selected.receiptRef!);
    assert.equal(proof.window_input_ids.length, 2);
    assert.equal(app.store.read<any>(proof.coverage_ref).version, 1);
    const enlarged = select(app, messages, true, messages.length, {
      ...fixtureModel,
      contextWindow: 1000000,
    });
    assert.deepEqual(
      enlarged.messages.map((m) => (m.role === "user" ? m.content : undefined)),
      ["small A", "small C"],
    );
    assert.deepEqual(
      applyInputProjection(app.store, memory(app), messages),
      enlarged.messages,
    );
  }));
test("E2: FAILED/STALE, uncovered and current Inputs survive; equal text in different rounds has distinct identities", () =>
  scenario(undefined, async (app) => {
    const success = covered(app, ["same", "same"]),
      failed = covered(app, ["failed"], "FAILED"),
      stale = covered(app, ["stale"], "STALE");
    const current = covered(app, ["current huge " + "x".repeat(30000)]);
    const result = select(
      app,
      [...success, ...failed, ...stale, ...current],
      true,
      4,
    );
    assert(
      result.messages.includes(failed[0]) &&
        result.messages.includes(stale[0]) &&
        result.messages.includes(current[0]),
    );
    const p = app.store.read<InputProjectionReceipt>(result.receiptRef!);
    assert.equal(new Set(p.window_input_ids).size, p.window_input_ids.length);
    assert.equal(
      p.window_input_ids.length,
      0,
      "mandatory current material consumes the target allowance",
    );
  }));
test("E6/E8: unavailable search freezes previous coverage and permits newly covered old gaps without new exits", () =>
  scenario(undefined, async (app) => {
    const first = covered(app, ["old huge " + "x".repeat(30000), "keep"]);
    const before = select(app, first),
      frozen = before.receiptRef!;
    const gap = covered(app, ["late source"]);
    const later = select(app, [...first, ...gap], false);
    assert.equal(later.receiptRef?.sha256, frozen.sha256);
    assert.deepEqual(
      later.messages.map((m) => (m.role === "user" ? m.content : undefined)),
      ["keep", "late source"],
    );
    assert.equal(
      applyInputProjection(app.store, memory(app), [...first, ...gap]).length,
      2,
    );
  }));
test("E9: 50 cumulative successful owners retain early coverage with one reference and a bounded window", () =>
  scenario(undefined, async (app) => {
    let messages: AgentMessage[] = [];
    for (let n = 0; n < 50; n++) {
      messages.push(...covered(app, ["covered " + n]));
      const result = select(app, messages);
      const proof = app.store.read<InputProjectionReceipt>(result.receiptRef!);
      assert.equal(Array.isArray(proof.coverage_ref), false);
      assert(proof.window_input_ids.length <= 12);
      assert.equal(Object.keys(proof).length, 6);
      assert.throws(
        () =>
          shapeDefinition("InputProjectionReceipt", {
            ...proof,
            coverage_ref: [proof.coverage_ref],
          }),
        /INVALID/,
      );
    }
    assert.equal(
      applyInputProjection(app.store, memory(app), messages).length,
      12,
    );
    assert(
      !applyInputProjection(app.store, memory(app), messages).includes(
        messages[0],
      ),
    );
  }));
test("E2: ambiguous legacy occurrences stay protected; host tags authenticate exact Input identity", () =>
  scenario(undefined, async (app) => {
    const messages = covered(app, ["duplicate", "duplicate"]);
    const inputs = app.store.all<Input>("Input");
    app.store.commit([
      revise(inputs[1], { received_at: inputs[0].received_at }),
    ]);
    const legacy = messages.map(
      (m) =>
        ({
          role: "user",
          content: "duplicate",
          timestamp: Date.parse(inputs[0].received_at),
        }) as AgentMessage,
    );
    assert.deepEqual(select(app, legacy).messages, legacy);
  }));
test("E3: zero window and invalid configurations are explicit", () =>
  scenario(undefined, async (app) => {
    const old = process.env.SECRETARY_RECENT_INPUT_MAX_COUNT;
    try {
      process.env.SECRETARY_RECENT_INPUT_MAX_COUNT = "0";
      assert.equal(
        select(app, covered(app, ["one", "two"])).messages.length,
        0,
      );
      process.env.SECRETARY_RECENT_INPUT_MAX_COUNT = "-1";
      assert.throws(inputWindowConfig, /INVALID/);
    } finally {
      if (old === undefined)
        delete process.env.SECRETARY_RECENT_INPUT_MAX_COUNT;
      else process.env.SECRETARY_RECENT_INPUT_MAX_COUNT = old;
    }
  }));
test("E3: complete-window cost satisfies both count and 15 percent of usable input", () =>
  scenario(undefined, async (app) => {
    const messages = covered(
      app,
      Array.from({ length: 20 }, (_, n) => `entry ${n}: ` + "x".repeat(1800)),
    );
    const model = { ...fixtureModel, contextWindow: 65536 };
    const selected = select(app, messages, true, messages.length, model);
    const proof = app.store.read<InputProjectionReceipt>(selected.receiptRef!);
    assert(proof.window_input_ids.length <= 12);
    assert(proof.window_input_ids.length > 0);
    const { requestBudget } =
      await import("../../../src/pi_secretary/src/budget.ts");
    const base = requestBudget(model, []),
      budget = requestBudget(model, selected.messages);
    assert(
      budget.estimated_tokens - base.estimated_tokens <=
        0.15 * base.usable_input_tokens,
    );
    for (const message of selected.messages)
      assert(
        message.role === "user" && messages.includes(message),
        "selected original is whole and unchanged",
      );
  }));
