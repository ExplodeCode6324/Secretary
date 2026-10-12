import test from "node:test";
import assert from "node:assert/strict";
import { scenario, shortStream, memory } from "./helpers.ts";
import { fixtureModel } from "../../../src/pi_secretary/src/model.ts";
import type { Input } from "../../../src/pi_secretary/src/contracts.ts";
test("E7: explicitly unconfigured PG retains raw Inputs until a descriptive capacity block", () =>
  scenario(
    undefined,
    async (app) => {
      for (let n = 0; n < 50 && app.host.session.state === "IDLE"; n++) {
        app.host.accept(`No-PG-${n} ` + "x".repeat(3500));
        await app.host.drain();
      }
      assert.equal(app.world, undefined);
      assert.equal(app.host.session.state, "CAPACITY_BLOCKED");
      assert.match(app.host.session.recovery_error!, /INPUT_EXIT_DISABLED/);
      assert.equal(memory(app).input_projection_ref, undefined);
      for (const input of app.store.all<Input>("Input"))
        assert(app.store.bytes(input.payload).toString().startsWith("No-PG-"));
    },
    shortStream,
    { ...fixtureModel, contextWindow: 65536 },
  ));
