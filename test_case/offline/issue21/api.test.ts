import assert from "node:assert/strict";
import { testPostgres } from "../helpers/postgres.ts";
import { fixture } from "../issue9/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
testPostgres(
  "D1/W1: public ENTITY DTO carries aliases and owner activation makes them queryable",
  (dsn) =>
    fixture(async (f) => {
      await f.app.world!.migrate();
      const settings: any = await f.client.query("settings"),
        entity_id = id();
      await f.client.command("settings/draft", {
        request_id: id(),
        expected_revision: settings.draft.revision,
        payload: {
          instructions: null,
          edits: [
            {
              kind: "ENTITY",
              entity_id,
              entity_kind: "PERSON",
              display_name: "Synthetic API entity",
              aliases: ["接口别名"],
              expected_revision: "0",
            },
          ],
          command_ids: [],
        },
      });
      const draft: any = await f.client.query("settings");
      await f.client.command("settings/apply", {
        request_id: id(),
        expected_revision: draft.draft.revision,
      });
      await f.app.settings.tick();
      const catalog: any = await f.client.query("world/catalog?kind=entities");
      const serialized = JSON.stringify(catalog);
      assert(serialized.includes("接口别名"));
    }, dsn),
);
