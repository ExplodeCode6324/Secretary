import assert from "node:assert/strict";
import { fixture } from "./helpers.ts";
import { testPostgres } from "../helpers/postgres.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";

testPostgres(
  "WORLD: actual PostgreSQL outbox export/restart/dedup drives persisted invalidation; GET never drains",
  (dsn) =>
    fixture(async (f) => {
      const world = f.app.world!;
      await world.migrate();
      const initial: any = await f.client.query("settings"),
        entity = id();
      await f.client.command("settings/draft", {
        request_id: id(),
        expected_revision: initial.draft.revision,
        payload: {
          instructions: null,
          edits: [
            {
              kind: "ENTITY",
              entity_id: entity,
              entity_kind: "PERSON",
              display_name: "Synthetic sync entity",
              expected_revision: "0",
            },
          ],
          command_ids: [],
        },
      });
      const draft: any = await f.client.query("settings");
      const after = f.cursor();
      await f.client.command("settings/apply", {
        request_id: id(),
        expected_revision: draft.draft.revision,
      });
      await f.app.settings.tick();
      const rows = (
        await world.pool.query("SELECT event_id,change_id FROM wm.audit_outbox")
      ).rows;
      assert(rows.length);
      const events = f.app.store.logs.filter((e) =>
        e.event_type.startsWith("world.change_"),
      );
      assert(events.length);
      assert(
        f.server.service.changes
          .changes(after)
          .transactions.some((t) =>
            t.changes.some((c) => c.resource_type === "world"),
          ),
      );
      await world.pool.query(
        "UPDATE wm.audit_outbox SET exported_journal_txn=NULL,exported_at=NULL",
      );
      const sequence = f.app.store.sequence;
      await f.client.query("sync/cursor");
      await f.client.query("sync/changes?after=" + after);
      await f.client.query("world/catalog?kind=entities");
      assert.equal(f.app.store.sequence, sequence);
      assert.equal(
        (
          await world.pool.query(
            "SELECT count(*) FROM wm.audit_outbox WHERE exported_at IS NULL",
          )
        ).rows[0].count,
        String(rows.length),
      );
      await f.restart();
      await f.app.world!.export();
      assert.equal(
        f.app.store.logs.filter((e) => e.event_type.startsWith("world.change_"))
          .length,
        events.length,
      );
      assert.equal(
        (
          await f.app.world!.pool.query(
            "SELECT count(*) FROM wm.audit_outbox WHERE exported_at IS NULL",
          )
        ).rows[0].count,
        "0",
      );
      assert(
        f.server.service.changes
          .changes(after)
          .transactions.some((t) =>
            t.changes.some((c) => c.resource_type === "world"),
          ),
      );
    }, dsn),
);
