import assert from "node:assert/strict";
import { testPostgres } from "../helpers/postgres.ts";
import { scenario, shortStream, turn, memory, apply } from "./helpers.ts";
import { fixtureModel } from "../../../src/pi_secretary/src/model.ts";
import {
  applyInputProjection,
  type InputProjectionReceipt,
} from "../../../src/pi_secretary/src/input-projection.ts";
import type {
  Context,
  SettingsApplication,
} from "../../../src/pi_secretary/src/contracts.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
for (const phase of ["before", "after"] as const)
  testPostgres(
    `E4/E6: retry after failure ${phase} World commit cannot activate a stale exit receipt during a search outage`,
    (dsn) =>
      scenario(
        dsn,
        async (app) => {
          await app.world!.migrate();
          const original = "Retry-original-0 " + "x".repeat(3000);
          for (let n = 0; n < 5; n++)
            await turn(
              app,
              n === 0 ? original : `Retry-original-${n} ` + "x".repeat(3000),
            );
          assert.equal(memory(app).input_projection_ref, undefined);
          const applyBatch = app.world!.applyBatch.bind(app.world!),
            exportWorld = app.world!.export.bind(app.world!),
            entityID = id();
          if (phase === "before")
            app.world!.applyBatch = async () => {
              throw Error("synthetic failure before World commit");
            };
          else
            app.world!.export = async () => {
              throw Error("synthetic failure after World commit");
            };
          app.settings.save(
            {
              ...emptySettings(),
              edits: [
                {
                  kind: "ENTITY",
                  entity_id: entityID,
                  entity_kind: "PERSON",
                  display_name: "Synthetic retry person",
                  expected_revision: 0,
                },
              ],
            },
            app.settings.draft().revision,
          );
          const requested = app.settings.request(
            app.settings.draft().revision,
            id(),
          ) as SettingsApplication;
          await app.settings.tick();
          const failed = app.store.get<SettingsApplication>(
            "SettingsApplication",
            requested.id,
          );
          assert.equal(
            failed.state,
            phase === "before" ? "FAILED" : "BLOCKED",
            failed.error ?? "",
          );
          assert(
            failed.input_projection_ref,
            "the failed attempt had prepared an exit candidate",
          );
          assert.equal(memory(app).input_projection_ref, undefined);
          app.world!.applyBatch = applyBatch;
          app.world!.export = exportWorld;
          await app.world!.pool.query(
            "CREATE FUNCTION mem.inject_retry_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic search outage'; END $$; CREATE TRIGGER fail_retry_projector BEFORE INSERT ON mem.checkpoint FOR EACH ROW EXECUTE FUNCTION mem.inject_retry_failure()",
          );
          await app.world!.memorySearch.catchUp();
          assert.equal(app.world!.memorySearch.state, "unavailable");
          app.settings.retry(requested.id);
          await app.settings.tick();
          const applied = app.store.get<SettingsApplication>(
            "SettingsApplication",
            requested.id,
          );
          assert.equal(applied.state, "APPLIED", applied.error ?? "");
          assert.equal(app.world!.memorySearch.state, "unavailable");
          assert.equal(applied.input_projection_ref, undefined);
          assert.equal(memory(app).input_projection_ref, undefined);
          assert(
            (await app.world!.catalogList()).entities.some(
              (entity) => entity.entity_id === entityID,
            ),
          );
          const context = app.store.get<Context>(
            "Context",
            applied.context_id!,
          );
          const raw = app.store.read<any[]>(context.raw_context);
          assert(JSON.stringify(raw).includes(original));
          assert(
            JSON.stringify(
              applyInputProjection(app.store, memory(app), raw),
            ).includes(original),
          );
        },
        shortStream,
        { ...fixtureModel, contextWindow: 65536 },
      ),
  );
testPostgres(
  "E4: repeated Settings and restart authenticate a bounded wrapper without resurrecting retired originals",
  (dsn) =>
    scenario(
      dsn,
      async (app, reopen) => {
        await app.world!.migrate();
        for (let n = 0; n < 25; n++)
          await turn(app, `Original-${n} ` + "filler ".repeat(400));
        await app.host.compact();
        const before = app.store.read<InputProjectionReceipt>(
          memory(app).input_projection_ref!,
        );
        const first = await apply(app);
        assert(first.input_projection_ref);
        const context = app.store.get<Context>("Context", first.context_id!);
        const raw = app.store.read<any[]>(context.raw_context);
        assert(!JSON.stringify(raw).includes("Original-0"));
        assert.deepEqual(
          applyInputProjection(app.store, memory(app), raw),
          raw,
        );
        app = await reopen();
        await app.world!.memorySearch.catchUp();
        await apply(app);
        await turn(app, "Continue after restart.");
        const latest = app.store.get<Context>(
          "Context",
          app.host.session.last_context_id!,
        );
        assert(
          !JSON.stringify(app.store.read(latest.raw_context)).includes(
            "Original-0",
          ),
        );
        assert(before.window_input_ids.length <= 12);
      },
      shortStream,
      { ...fixtureModel, contextWindow: 65536 },
    ),
);
