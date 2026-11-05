import test from "node:test";
import assert from "node:assert/strict";
import { fixtureModel, modelConfig } from "../../../src/pi_secretary/src/model.ts";

test("live provider retirement precedes credential lookup and leaves fixture mode available", () => {
  const env = { ...process.env, SECRETARY_MODE: "live", SECRETARY_MAIN_MODEL: "deepseek-flash" };
  const original = process.env;
  try {
    process.env = env;
    delete process.env.SECRETARY_MAIN_API_KEY;
    for (const retired of ["opencode", "opencode-go"]) {
      process.env.SECRETARY_MAIN_PROVIDER = retired;
      assert.throws(() => modelConfig("main"), /RETIRED_LIVE_PROVIDER/);
    }
    process.env.SECRETARY_MODE = "fixture";
    assert.equal(modelConfig("main").model, fixtureModel);
    process.env.SECRETARY_MODE = "live";
    process.env.SECRETARY_MAIN_PROVIDER = "deepseek";
    process.env.SECRETARY_MAIN_API_KEY = "offline-placeholder";
    const { model } = modelConfig("main");
    assert.equal(model.id, "deepseek-flash");
    assert.equal(model.baseUrl, "https://api.deepseek.com");
    assert(model.input.includes("image"));
  } finally {
    process.env = original;
  }
});
