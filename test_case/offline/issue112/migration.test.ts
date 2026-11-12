import { App } from "../../../src/pi_secretary/src/app.ts";
import { Host } from "../../../src/pi_secretary/src/host.ts";
import { Scheduler } from "../../../src/pi_secretary/src/scheduler.ts";
import { Settings } from "../../../src/pi_secretary/src/settings.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { revise } from "../../../src/pi_secretary/src/store.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { testPostgres } from "../helpers/postgres.ts";
import {
  Store,
  id,
  base,
  now,
  root,
} from "../../../src/pi_secretary/src/store.ts";
import { World } from "../../../src/pi_secretary/src/world.ts";
import { Authorization } from "../../../src/pi_secretary/src/authorization.ts";
import {
  coreIdentity,
  assistantProfile,
} from "../../../src/pi_secretary/src/core-identity.ts";
testPostgres(
  "nonempty legacy read-only import preserves IDs, original manifest, retired predicates, and replay",
  (dsn) => legacy(dsn, false),
);
testPostgres(
  "unexported outbox blocks genesis without mutating old tables",
  (dsn) => legacy(dsn, true),
);
testPostgres(
  "R1/R2: interrupted pending genesis retries after PostgreSQL becomes available",
  async (dsn) => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "issue112-upgrade-retry-"),
    );
    let app: App | undefined;
    try {
      const store = await Store.open(dir);
      store.commit([], [store.event("synthetic.old_without_world", {})]);
      await store.close();
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(new URL("./workers/upgrade-crash.ts", import.meta.url)),
          dir,
          "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
        ],
        { encoding: "utf8", timeout: 20000 },
      );
      assert.equal(child.signal, "SIGKILL", child.stderr);
      app = await App.open(
        dir,
        { model: fixtureModel, stream: fixtureStream },
        dsn,
      );
      assert(app.world!.ready, app.world!.error ?? "");
      assert.equal(app.store.all<any>("WorldGenesis")[0].mode, "FRESH");
      await app.host.drain();
      assert.equal(app.host.session.state, "IDLE");
      const count = app.store.events("world.upgrade_preflight_passed").length;
      assert.equal(count, 1);
    } finally {
      await app?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
async function legacy(dsn: string, pending: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue112-import-"));
  let store = await Store.open(dir);
  const identity = coreIdentity(store);
  assistantProfile(store);
  let world: World | undefined;
  const db = new Client({ connectionString: dsn });
  await db.connect();
  try {
    for (const file of [
      "001_world_model.sql",
      "002_predicates.sql",
      "003_settings.sql",
      "004_memory_search.sql",
    ])
      await db.query(
        fs.readFileSync(path.join(root, "src/schema", file), "utf8"),
      );
    const subject = id(),
      source = id(),
      slot = id(),
      fact = id(),
      change = id(),
      ev = store.event(
        "legacy.synthetic_source",
        { text: "Synthetic original statement" },
        undefined,
        "MASTER_UI",
      ),
      evidence = id(),
      out = id();
    store.commit([], [ev]);
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO wm.entity(entity_id,kind,display_name) VALUES($1,'PERSON','Legacy Person')",
      [subject],
    );
    await db.query(
      "INSERT INTO wm.source(source_id,kind,source_key,description) VALUES($1,'MASTER','fixture','synthetic')",
      [source],
    );
    await db.query(
      "INSERT INTO wm.fact_slot(slot_id,subject_id,predicate_key,revision) VALUES($1,$2,'person.display_name',1)",
      [slot, subject],
    );
    await db.query(
      "INSERT INTO wm.change_receipt(change_id,request_id,request_hash,outcome,result) VALUES($1,$2,$3,'APPLIED','{}')",
      [change, id(), "a".repeat(64)],
    );
    await db.query(
      "INSERT INTO wm.assertion(assertion_id,slot_id,slot_revision,source_id,change_id,value,epistemic,received_at,valid_from,scope_description) VALUES($1,$2,1,$3,$4,'\"Legacy Person\"','REPORTED',now(),now(),'original')",
      [fact, slot, source, change],
    );
    await db.query(
      "INSERT INTO wm.assertion_state(assertion_id,slot_id,status,changed_by) VALUES($1,$2,'ACTIVE',$3)",
      [fact, slot, change],
    );
    await db.query(
      "INSERT INTO wm.evidence(evidence_id,log_event_id,object_path,sha256,media_type,byte_count) VALUES($1,$2,$3,$4,$5,$6)",
      [
        evidence,
        ev.event_id,
        ev.payload.path,
        ev.payload.sha256,
        ev.payload.media_type,
        ev.payload.bytes,
      ],
    );
    await db.query(
      "INSERT INTO wm.assertion_evidence(assertion_id,evidence_id) VALUES($1,$2)",
      [fact, evidence],
    );
    if (pending)
      await db.query(
        "INSERT INTO wm.audit_outbox(event_id,change_id,payload) VALUES($1,$2,'{}')",
        [out, change],
      );
    await db.query("COMMIT");
    const auth = new Authorization(store),
      scheduler = new Scheduler(store, auth, fixtureModel, fixtureStream),
      host = new Host(store, scheduler, fixtureModel, fixtureStream);
    const settings = new Settings(store, host);
    host.accept("Synthetic legacy conversation");
    await host.drain();
    store.commit([
      revise(host.session, { runtime_settings_hash: "a".repeat(64) }),
    ]);
    await settings.close();
    await host.close();
    await scheduler.close();
    world = new World(store, new Authorization(store), dsn);
    await world.initialize(false);
    if (pending) {
      assert(!world.ready);
      assert.match(world.error!, /OUTBOX/);
      assert.equal(store.all("WorldEntity").length, 0);
      const exportEvent = {
        ...store.event("world.change_applied", {}),
        event_id: out,
      };
      store.commit([], [exportEvent]);
      await db.query(
        "UPDATE wm.audit_outbox SET exported_at=now(),exported_journal_txn=$2 WHERE event_id=$1",
        [out, store.transactionForEvent(out)],
      );
      await world.initialize(false);
      assert.equal(world.ready, true, world.error ?? "");
    }
    assert.equal(world.ready, true, world.error ?? "");
    assert.equal(world.entities().length, 3);
    assert.equal(world.assertions()[0].id, fact);
    assert.equal(world.assertions()[0].status, "LIVE");
    assert.equal((await world.browse({})).rows.length, 0);
    assert.equal((await world.browse({ history: true })).rows.length, 1);
    const genesis = store.all<any>("WorldGenesis")[0];
    assert.equal(
      store.read<any>(genesis.manifest_ref).legacy.assertion[0].epistemic,
      "REPORTED",
    );
    const seq = store.sequence;
    await world.initialize(false);
    assert.equal(store.sequence, seq);
    await world.initializeMemorySearchSchema();
    assert.equal(
      (await db.query("SELECT count(*) FROM wm.assertion")).rows[0].count,
      "1",
    );
    await world.close();
    await store.close();
    store = await Store.open(dir);
    world = new World(store, new Authorization(store));
    assert.equal(world.assertions()[0].id, fact);
    await world.close();
    await store.close();
    const app = await App.open(
      dir,
      { model: fixtureModel, stream: fixtureStream },
      dsn,
    );
    try {
      assert(app.world!.ready);
      assert.equal(
        app.settings.applications().filter((a) => a.state === "QUEUED").length,
        1,
      );
      await app.settings.tick();
      assert.equal(app.settings.blocked, false);
      assert.equal(app.settings.applications().at(-1)!.state, "APPLIED");
      app.host.accept("Synthetic upgraded continuation");
      await app.host.drain();
      assert.equal(app.host.session.state, "IDLE");
    } finally {
      await app.close();
    }
    store = await Store.open(dir);
    world = new World(store, new Authorization(store));
  } finally {
    await world?.close();
    await store.close();
    await db.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("unreachable PostgreSQL is not an empty World", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue112-unreachable-"));
  const store = await Store.open(dir);
  coreIdentity(store);
  assistantProfile(store);
  const world = new World(
    store,
    new Authorization(store),
    "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
  );
  try {
    await world.initialize(true);
    assert.equal(world.ready, false);
    assert.equal(store.all("WorldGenesis").length, 0);
    assert.throws(() => world.entities(), /IMPORT_PENDING/);
  } finally {
    await world.close();
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
