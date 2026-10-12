import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { scenario, memory, covered } from "./helpers.ts";
import { fixtureModel } from "../../../src/pi_secretary/src/model.ts";
import { selectInputProjection } from "../../../src/pi_secretary/src/input-projection.ts";
import { hash, revise, shape } from "../../../src/pi_secretary/src/store.ts";
const base = new URL("./fixtures/", import.meta.url);
test("D2/E9: fixed issue21 schema rejects new receipt records; companion old snapshot and current immutable archive validate", () =>
  scenario(undefined, async (app) => {
    const bytes = fs.readFileSync(
      new URL("issue21-contracts.schema.json", base),
    );
    const snapshot = fs.readFileSync(new URL("issue21-snapshot.json", base));
    const manifest = JSON.parse(
      fs.readFileSync(new URL("issue21-manifest.json", base), "utf8"),
    );
    assert.equal(manifest.commit, "4f152a7");
    assert.equal(hash(bytes), manifest.schema_sha256);
    assert.equal(hash(snapshot), manifest.snapshot_sha256);
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    (addFormats as unknown as (a: Ajv2020) => void)(ajv);
    const oldValidate = ajv.compile(JSON.parse(bytes.toString()));
    for (const record of JSON.parse(snapshot.toString())) {
      assert(oldValidate(record), JSON.stringify(oldValidate.errors));
      shape(record);
    }
    const messages = covered(app, ["archived original"]);
    const selected = selectInputProjection({
      store: app.store,
      consciousness: memory(app),
      messages,
      model: fixtureModel,
      protectedFromIndex: messages.length,
      searchReady: true,
    });
    const next = revise(memory(app), {
      input_projection_ref: selected.receiptRef!,
    });
    app.store.commit([next]);
    assert.equal(oldValidate(next), false);
    assert(
      oldValidate.errors?.some(
        (e) =>
          e.keyword === "additionalProperties" &&
          e.params.additionalProperty === "input_projection_ref",
      ),
    );
    const currentArchive = app.store.projectionFrames.flatMap((frame) =>
      frame.mutations.map((m) => ({
        snapshot: m.snapshot,
        bytes: app.store.bytes(m.snapshot),
      })),
    );
    for (const entry of currentArchive) {
      assert.equal(hash(entry.bytes), entry.snapshot.sha256);
      shape(JSON.parse(entry.bytes.toString()));
    }
    assert(currentArchive.length > 0);
  }));
