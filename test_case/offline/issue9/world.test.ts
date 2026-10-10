import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../src/pi_secretary/src/api-v1.ts";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
const dsn = process.env.SECRETARY_TEST_DATABASE_URL;
async function database(run: (dsn: string) => Promise<void>) {
  const admin = new Pool({ connectionString: dsn });
  const name = "issue9_" + id().replaceAll("-", "");
  const url = new URL(dsn!);
  url.pathname = "/" + name;
  await admin.query("CREATE DATABASE " + name);
  try {
    await run(url.toString());
  } finally {
    await admin.query("DROP DATABASE " + name + " WITH (FORCE)");
    await admin.end();
  }
}
for (const phase of ["before", "after"])
  test(
    `W01: SIGKILL ${phase} journal export, recover SQL commit without duplicate effects`,
    { skip: !dsn },
    () =>
      database(async (connection) => {
        const dir = fs.mkdtempSync(
          path.join(os.tmpdir(), "issue9-world-kill-"),
        );
        const worker = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "test_case/offline/issue9/workers/world-crash.ts",
            dir,
            connection,
            phase,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        worker.stderr.on("data", (b) => (stderr += b));
        const [, signal] = await once(worker, "exit");
        assert.equal(signal, "SIGKILL", stderr);
        const saved = JSON.parse(
          fs.readFileSync(path.join(dir, "fixture.json"), "utf8"),
        );
        const app = await App.open(
          dir,
          { model: fixtureModel, stream: fixtureStream },
          connection,
        );
        const server = await serveCore(app, 0, undefined, { pump: false });
        const c = new CoreClient(server.endpoint);
        try {
          const status = await app.world!.syncStatus();
          assert.equal(status.availability, "available");
          assert.equal(status.pending_exports, "2"); // source registration plus entity, both atomic SQL changes
          const expectedIDs = (
            await app.world!.pool.query(
              "SELECT event_id FROM wm.audit_outbox ORDER BY event_id",
            )
          ).rows.map((r) => r.event_id);
          const entities: any = await c.query("world/catalog");
          assert(entities.items.some((v: any) => v.entity_id === saved.entity));
          const initial = app.store.logs.filter(
            (e) => e.event_type === "world.change_applied",
          ).length;
          assert.equal(initial, phase === "after" ? 1 : 0);
          await Promise.all([app.world!.export(), app.world!.export()]);
          assert.equal((await app.world!.syncStatus()).pending_exports, "0");
          assert.equal(
            app.store.logs.filter(
              (e) => e.event_type === "world.change_applied",
            ).length,
            2,
          );
          await app.world!.export();
          assert.equal(
            app.store.logs.filter(
              (e) => e.event_type === "world.change_applied",
            ).length,
            2,
          );
          assert.deepEqual(
            app.store.logs
              .filter((e) => e.event_type === "world.change_applied")
              .map((e) => e.event_id)
              .sort(),
            expectedIDs,
          );
          const changes = await c.changes(saved.snapshot.cursor);
          assert(
            changes.batches
              .flatMap((b) => b.changes)
              .some((v) => v.resource_type === "world"),
          );
          assert.equal(
            (
              await app.world!.pool.query(
                "SELECT count(*)::text AS n FROM wm.entity",
              )
            ).rows[0].n,
            "1",
          );
        } finally {
          await server.close();
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }),
  );
test(
  "W02/W03: repeatable versioned reads, catalog writes, rollback, domain reset and failure visibility",
  { skip: !dsn },
  () =>
    database(async (connection) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue9-world-"));
      const app = await App.open(
        dir,
        { model: fixtureModel, stream: fixtureStream },
        connection,
      );
      await app.world!.migrate();
      const server = await serveCore(app, 0, undefined, { pump: false });
      const c = new CoreClient(server.endpoint);
      try {
        await c.command("sync/initialize", { request_id: id() });
        const before = await app.world!.syncStatus();
        const db = await app.world!.pool.connect();
        await db.query("BEGIN");
        await db.query(
          "INSERT INTO wm.entity(entity_id,kind,display_name) VALUES($1,'PERSON','Synthetic A'),($2,'PERSON','Synthetic B')",
          [id(), id()],
        );
        const during = await app.world!.syncStatus();
        assert.equal(during.world_version, before.world_version);
        await db.query("COMMIT");
        db.release();
        const page: any = await c.query("world/catalog?limit=1");
        assert(page.next_cursor);
        assert(BigInt(page.world_version) > BigInt(before.world_version!));
        const version = page.world_version;
        const tx = await app.world!.pool.connect();
        await tx.query("BEGIN");
        await tx.query("UPDATE wm.entity SET display_name='rolled back'");
        await tx.query("ROLLBACK");
        tx.release();
        assert.equal((await app.world!.syncStatus()).world_version, version);
        await app.world!.pool.query(
          "UPDATE wm.predicate SET description=description || ' synthetic' WHERE predicate_key='person.display_name'",
        );
        await assert.rejects(
          c.query(
            "world/catalog?limit=1&cursor=" +
              encodeURIComponent(page.next_cursor),
          ),
          /WORLD_PAGE_STALE/,
        );
        const snap = await c.bootstrap();
        assert.equal(snap.world.availability, "available");
        assert.equal(snap.world.pending_exports, "0");
        const oldHistory = snap.world.world_history_id;
        await app.world!.resetHistory();
        assert.notEqual(
          (await c.bootstrap()).world.world_history_id,
          oldHistory,
        );
        const raw = app.world!.pool.query.bind(app.world!.pool);
        (app.world!.pool as any).query = async () => {
          throw Error("synthetic export fault");
        };
        await assert.rejects(app.world!.export());
        assert.equal((await app.world!.syncStatus()).export_state, "failed");
        (app.world!.pool as any).query = raw;
        await app.world!.export();
        assert.equal(
          (await app.world!.syncStatus()).export_state,
          "reconciled",
        );
        const connect = app.world!.pool.connect.bind(app.world!.pool);
        (app.world!.pool as any).connect = async () => {
          throw Error("synthetic unavailable");
        };
        const unavailable = await c.bootstrap();
        assert.equal(unavailable.world.availability, "unavailable");
        assert.equal(unavailable.world.world_version, null);
        assert(unavailable.journal.session.id);
        (app.world!.pool as any).connect = connect;
      } finally {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }),
);
import net from "node:net";
test("W03: actual refused database connection preserves journal bootstrap and reports unavailable", async () => {
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue9-world-refused-"));
  const app = await App.open(
    dir,
    { model: fixtureModel, stream: fixtureStream },
    `postgresql://127.0.0.1:${port}/synthetic_unreachable`,
  );
  const server = await serveCore(app, 0, undefined, { pump: false });
  const c = new CoreClient(server.endpoint);
  try {
    await c.command("sync/initialize", { request_id: id() });
    const snap = await c.bootstrap();
    assert.equal(snap.world.availability, "unavailable");
    assert.equal(snap.world.world_version, null);
    assert(snap.journal.session.id);
    assert.equal(snap.world.error_code, "WORLD_UNAVAILABLE");
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
