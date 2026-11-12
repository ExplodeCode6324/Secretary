import assert from "node:assert/strict";
import { testPostgres } from "../helpers/postgres.ts";
import { fixture } from "../issue9/helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
testPostgres(
  "D1/W1: public World batch carries aliases and owner commit makes them queryable without Settings",
  (dsn) =>
    fixture(async (f) => {
      await f.app.world!.migrate();
      await f.client.command("world/changes", {
        request_id: id(),
        changes: [
          {
            intent: "CREATE_ENTITY",
            entity_kind: "PERSON",
            display_name: "Synthetic API entity",
            aliases: { add: ["接口别名"] },
          },
        ],
      });
      assert.equal(f.app.store.all("SettingsApplication").length, 0);
      const catalog: any = await f.client.query("world/catalog?kind=entities");
      const serialized = JSON.stringify(catalog);
      assert(serialized.includes("接口别名"));
    }, dsn),
);
