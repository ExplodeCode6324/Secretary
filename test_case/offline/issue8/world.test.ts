import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
const dsn = process.env.SECRETARY_TEST_DATABASE_URL;
test(
  "isolated PostgreSQL: new schema stages World CAS edits, exact slot and versioned bounded catalogs",
  { skip: !dsn },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-api-world-"));
    const app = await App.open(
      dir,
      { model: fixtureModel, stream: fixtureStream },
      dsn,
    );
    await app.world!.migrate();
    const backend = await serveCore(app, 0, undefined, { pump: false }),
      c = new CoreClient(backend.endpoint);
    try {
      const entity = id();
      const initial: any = await c.query("settings");
      await c.command("settings/draft", {
        request_id: id(),
        expected_revision: initial.draft.revision,
        payload: {
          instructions: null,
          edits: [
            {
              kind: "ENTITY",
              entity_id: entity,
              entity_kind: "PERSON",
              display_name: "Synthetic API subject",
              expected_revision: "0",
            },
          ],
          command_ids: [],
        },
      });
      let draft: any = await c.query("settings");
      const req = { request_id: id(), expected_revision: draft.draft.revision };
      const [a, b] = await Promise.all([
        c.command("settings/apply", req),
        c.command("settings/apply", req),
      ]);
      assert.deepEqual(a, b);
      await app.settings.tick();
      const first: any = await c.query("world/catalog?kind=entities&limit=1");
      assert.equal(first.items.length, 1);
      assert.equal(typeof first.world_version, "string");
      await assert.rejects(c.query("world/catalog?limit=101"), /INVALID_LIMIT/);
      let slot: any = await c.query(
        "world/slot?subject=" +
          entity +
          "&predicate=person.display_name&scope=",
      );
      assert.equal(slot.slot, null);
      draft = await c.query("settings");
      await c.command("settings/draft", {
        request_id: id(),
        expected_revision: draft.draft.revision,
        payload: {
          instructions: null,
          edits: [
            {
              kind: "FACT",
              subject_id: entity,
              predicate_key: "person.display_name",
              scope_key: "",
              mode: "ASSERT",
              value: "Synthetic display",
              expected_revision: "0",
            },
          ],
          command_ids: [],
        },
      });
      draft = await c.query("settings");
      await c.command("settings/apply", {
        request_id: id(),
        expected_revision: draft.draft.revision,
      });
      await app.settings.tick();
      slot = await c.query(
        "world/slot?subject=" +
          entity +
          "&predicate=person.display_name&scope=",
      );
      assert.equal(slot.slot.revision, "1");
      const facts: any = await c.query("world/facts?subject=" + entity);
      assert.equal(facts.items.length, 1);
      assert.equal(facts.world_version, slot.world_version);
      const sequence = app.store.sequence;
      await c.query(
        "world/slot?subject=" +
          entity +
          "&predicate=person.display_name&scope=",
      );
      await c.query("world/facts?subject=" + entity);
      assert.equal(app.store.sequence, sequence);
      draft = await c.query("settings");
      await assert.rejects(
        c.command("settings/draft", {
          request_id: id(),
          expected_revision: "1",
          payload: { instructions: null, edits: [], command_ids: [] },
        }),
        /SETTINGS_CONFLICT/,
      );
    } finally {
      await backend.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
