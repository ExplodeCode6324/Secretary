import assert from "node:assert/strict";
import { testPostgres } from "../helpers/postgres.ts";
import { scenario, shortStream, turn, memory, apply } from "./helpers.ts";
import { fixtureModel } from "../../../src/pi_secretary/src/model.ts";
import type {
  Context,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";
testPostgres(
  "E6: real SQL projection failure freezes exits through new summary, Settings and restart; repair resumes indexing",
  (dsn) =>
    scenario(
      dsn,
      async (app, reopen) => {
        await app.world!.migrate();
        for (let n = 0; n < 20; n++)
          await turn(app, `Before-outage-${n} ` + "x".repeat(3000));
        await app.host.compact();
        const frozen = memory(app).input_projection_ref!;
        assert(frozen);
        await app.world!.pool.query(
          "CREATE FUNCTION mem.inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic outage'; END $$; CREATE TRIGGER fail_projector BEFORE INSERT ON mem.document FOR EACH ROW EXECUTE FUNCTION mem.inject_failure()",
        );
        await turn(app, "During-outage source must survive.");
        await app.host.compact();
        assert.equal(app.world!.memorySearch.state, "unavailable");
        assert.equal(memory(app).input_projection_ref!.sha256, frozen.sha256);
        await apply(app);
        assert.equal(memory(app).input_projection_ref!.sha256, frozen.sha256);
        app = await reopen();
        await app.world!.memorySearch.catchUp();
        assert.equal(app.world!.memorySearch.state, "unavailable");
        const context = app.store.get<Context>(
          "Context",
          app.host.session.last_context_id!,
        );
        const raw = JSON.stringify(app.store.read(context.raw_context));
        assert(!raw.includes("Before-outage-0"));
        assert(raw.includes("During-outage"));
        await app.world!.pool.query(
          "DROP TRIGGER fail_projector ON mem.document; DROP FUNCTION mem.inject_failure()",
        );
        await app.world!.memorySearch.catchUp();
        assert.equal(app.world!.memorySearch.state, "ready");
        const search = await app.world!.memorySearch.search({
          query: "During-outage",
        });
        assert.equal(search.status, "ready");
        assert(search.hits.length > 0);
        const input = app.store
          .all<Input>("Input")
          .find((i) =>
            app.store.bytes(i.payload).toString().startsWith("During-outage"),
          )!;
        assert(input);
      },
      shortStream,
      { ...fixtureModel, contextWindow: 65536 },
    ),
);

testPostgres(
  "E6: terminating a real idle PG connection reports unavailable and reconnects without crashing the Host",
  (dsn) =>
    scenario(
      dsn,
      async (app) => {
        await app.world!.migrate();
        await turn(app, "Synthetic evidence before disconnect.");
        await app.world!.memorySearch.catchUp();
        const lease = await app.world!.pool.connect();
        const pid = (await lease.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid;
        lease.release();
        const { Client } = await import("pg");
        const admin = new Client({ connectionString: dsn });
        await admin.connect();
        try {
          assert.equal(
            (
              await admin.query(
                "SELECT pg_terminate_backend($1) AS terminated",
                [pid],
              )
            ).rows[0].terminated,
            true,
          );
          for (
            let n = 0;
            n < 100 && app.world!.memorySearch.state !== "unavailable";
            n++
          )
            await new Promise((resolve) => setTimeout(resolve, 10));
          assert.equal(app.world!.memorySearch.state, "unavailable");
          assert.equal(app.host.session.state, "IDLE");
          await app.world!.memorySearch.catchUp();
          assert.equal(app.world!.memorySearch.state, "ready");
          const found = await app.world!.memorySearch.search({
            query: "Synthetic evidence",
          });
          assert.equal(found.status, "ready");
          assert(found.hits.length > 0);
        } finally {
          await admin.end();
        }
      },
      shortStream,
      { ...fixtureModel, contextWindow: 65536 },
    ),
);
