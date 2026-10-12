import assert from "node:assert/strict";
import { testPostgres } from "../helpers/postgres.ts";
import { scenario } from "./helpers.ts";
import { Client } from "pg";

testPostgres(
  "S3/S4: incremental watermark, restart, cleared rows and source/digest rebuild",
  (dsn) =>
    scenario(dsn, async (app, reopen) => {
      await app.world!.migrate();
      app.host.accept("杭州 first durable source");
      await app.world!.memorySearch.catchUp();
      const first = (
        await app.world!.memorySearch.search({ query: "杭州" })
      ).hits.map((h) => h.event_id);
      assert.equal(first.length, 1);
      await app.world!.pool.query("TRUNCATE mem.chunk,mem.document");
      app = await reopen();
      await app.world!.memorySearch.catchUp();
      assert.deepEqual(
        (await app.world!.memorySearch.search({ query: "杭州" })).hits.map(
          (h) => h.event_id,
        ),
        first,
      );
      for (const expression of [
        "source_id='another-source'",
        "journal_digest='bad'",
        "policy_version=999",
      ]) {
        await app.world!.pool.query("UPDATE mem.checkpoint SET " + expression);
        app = await reopen();
        await app.world!.memorySearch.catchUp();
        assert.deepEqual(
          (await app.world!.memorySearch.search({ query: "杭州" })).hits.map(
            (h) => h.event_id,
          ),
          first,
        );
      }
      const started = Date.now();
      app.host.accept("杭州 second durable source");
      await app.world!.memorySearch.catchUp();
      assert.equal(
        (await app.world!.memorySearch.search({ query: "杭州" })).hits.length,
        2,
      );
      assert(Date.now() - started <= 5000);
    }),
);

testPostgres(
  "S5: actual SQL lock timeout returns search_timeout rather than no matches",
  (dsn) =>
    scenario(dsn, async (app) => {
      await app.world!.migrate();
      app.host.accept("杭州 locked source");
      await app.world!.memorySearch.catchUp();
      const lock = new Client({ connectionString: dsn });
      await lock.connect();
      try {
        await lock.query(
          "BEGIN; LOCK TABLE mem.chunk IN ACCESS EXCLUSIVE MODE",
        );
        const result = await app.world!.memorySearch.search({ query: "杭州" });
        assert.equal(result.status, "search_timeout");
        assert.equal(result.hits.length, 0);
      } finally {
        await lock.query("ROLLBACK");
        await lock.end();
      }
      assert.equal(
        (await app.world!.memorySearch.search({ query: "杭州" })).hits.length,
        1,
      );
    }),
);

testPostgres(
  "S4/S5: failed batch rolls back both data and watermark; missing migration is explicit",
  (dsn) =>
    scenario(dsn, async (app) => {
      await app.world!.memorySearch.idle();
      assert.equal(
        (await app.world!.memorySearch.search({ query: "杭州" })).status,
        "not_migrated",
      );
      await app.world!.migrate();
      const before = app.world!.memorySearch.indexedSequence;
      await app.world!.pool.query(
        "CREATE FUNCTION mem.reject_chunk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic chunk failure'; END $$; CREATE TRIGGER reject_chunk BEFORE INSERT ON mem.chunk FOR EACH ROW EXECUTE FUNCTION mem.reject_chunk()",
      );
      app.host.accept("杭州 atomic source");
      await app.world!.memorySearch.advance();
      assert.equal(app.world!.memorySearch.indexedSequence, before);
      assert.equal(
        (await app.world!.pool.query("SELECT count(*) FROM mem.document"))
          .rows[0].count,
        "0",
      );
      assert.equal(
        (await app.world!.memorySearch.search({ query: "杭州" })).status,
        "unavailable",
      );
      await app.world!.memorySearch.idle();
      await app.world!.pool.query(
        "DROP TRIGGER reject_chunk ON mem.chunk; DROP FUNCTION mem.reject_chunk()",
      );
      await app.world!.memorySearch.catchUp();
      assert.equal(
        (await app.world!.memorySearch.search({ query: "杭州" })).hits.length,
        1,
      );
    }),
);
