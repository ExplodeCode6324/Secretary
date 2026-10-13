import assert from "node:assert/strict";
import { testPostgres } from "../helpers/postgres.ts";
import { scenario } from "./helpers.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import type { SettingsApplication } from "../../../src/pi_secretary/src/contracts.ts";

testPostgres(
  "D1: real migration failure rolls back version/DDL; retry and legacy edit preserve aliases",
  (dsn) =>
    scenario(dsn, async (app) => {
      const world = app.world!;
      await world.memorySearch.idle();
      await world.pool
        .query(`CREATE FUNCTION public.reject_mem_index() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity LIKE 'mem.%') THEN RAISE EXCEPTION 'synthetic migration failure'; END IF;
    END $$; CREATE EVENT TRIGGER reject_mem ON ddl_command_end WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION public.reject_mem_index()`);
      await assert.rejects(
        () => world.migrate(),
        /synthetic migration failure/,
      );
      assert.equal(
        (
          await world.pool.query(
            "SELECT to_regclass('mem.document') AS table_name",
          )
        ).rows[0].table_name,
        null,
      );
      assert.equal(
        (
          await world.pool.query(
            "SELECT count(*) FROM wm.schema_version WHERE version=4",
          )
        ).rows[0].count,
        "0",
      );
      await world.pool.query(
        "DROP EVENT TRIGGER reject_mem; DROP FUNCTION public.reject_mem_index()",
      );
      await world.migrate();
      await world.migrate();
      const entity_id = id();
      for (const [revision, aliases] of [
        [0, ["old alias"]],
        [1, undefined],
      ] as const) {
        app.settings.save(
          {
            ...emptySettings(),
            edits: [
              {
                kind: "ENTITY",
                entity_id,
                entity_kind: "PERSON",
                display_name: "Synthetic renamed person",
                expected_revision: revision,
                ...(aliases ? { aliases: [...aliases] } : {}),
              },
            ],
          },
          app.settings.draft().revision,
        );
        const application = app.settings.request(
          app.settings.draft().revision,
          id(),
        ) as SettingsApplication;
        await app.settings.tick();
        assert.equal(
          app.store.get<SettingsApplication>(
            "SettingsApplication",
            application.id,
          ).state,
          "APPLIED",
        );
      }
      assert.deepEqual(
        (
          await world.pool.query(
            "SELECT aliases FROM wm.entity WHERE entity_id=$1",
            [entity_id],
          )
        ).rows[0].aliases,
        ["old alias"],
      );
    }),
);
