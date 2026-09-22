import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { App } from "../src/app.ts";
import { id, hash, revise } from "../src/store.ts";
import { fixtureModel, fixtureStream } from "../src/model.ts";
import type {
  WorldCatalogChange,
  WorldChange,
  AuthorizationRequest,
  WorldCommand,
  Operation,
} from "../src/contracts.ts";
const dsn = process.env.SECRETARY_TEST_DATABASE_URL;
test(
  "PostgreSQL implementation: authorized catalog/facts, conflict/CAS, receipt and outbox replay",
  { skip: !dsn },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-world-"));
    const app = await App.open(
      dir,
      { model: fixtureModel, stream: fixtureStream },
      dsn,
    );
    try {
      const world = app.world!;
      await world.migrate();
      const original = app.store.event(
        "input.accepted",
        { text: "Synthetic Master facts" },
        undefined,
        "MASTER_UI",
      );
      app.store.commit([], [original]);
      const evidence = [
        { log_event_id: original.event_id, content: original.payload },
      ];
      const entity = id(),
        source = id();
      async function submit(change: WorldCatalogChange | WorldChange) {
        const c = world.propose(change, {
          session_id: app.host.sessionID,
          task_id: null,
          execution_id: null,
        });
        const op = app.store.get<Operation>("Operation", c.operation_id);
        const a = app.store.get<AuthorizationRequest>(
          "AuthorizationRequest",
          op.authorization_id!,
        );
        app.authorization.decide({
          record_type: "ApprovalCommand",
          schema_version: 1,
          request_id: id(),
          authorization_id: a.id,
          expected_revision: a.revision,
          display_hash: a.display_hash,
          decision: "APPROVE",
        });
        await world.drain();
        return app.store.get<WorldCommand>("WorldCommand", c.id);
      }
      const catalog = (
        kind: WorldCatalogChange["kind"],
      ): WorldCatalogChange => ({
        schema_version: 1,
        record_type: "WorldCatalogChange",
        request_id: id(),
        change_id: id(),
        request_hash: hash(id()),
        kind,
        entity_id: kind === "UPSERT_ENTITY" ? entity : null,
        entity_kind: kind === "UPSERT_ENTITY" ? "PERSON" : null,
        display_name: kind === "UPSERT_ENTITY" ? "Synthetic Master" : null,
        external_key: null,
        source_id: kind === "REGISTER_SOURCE" ? source : null,
        source_kind: kind === "REGISTER_SOURCE" ? "MASTER" : null,
        source_key: kind === "REGISTER_SOURCE" ? "synthetic-master" : null,
        description: kind === "REGISTER_SOURCE" ? "test source" : null,
        expected_revision: 0,
        evidence,
      });
      assert.equal((await submit(catalog("UPSERT_ENTITY"))).state, "COMMITTED");
      assert.equal(
        (await submit(catalog("REGISTER_SOURCE"))).state,
        "COMMITTED",
      );
      const fact = (value: string, revision: number): WorldChange => ({
        schema_version: 1,
        record_type: "WorldChange",
        request_id: id(),
        change_id: id(),
        request_hash: hash(id()),
        source_id: source,
        subject_id: entity,
        predicate_key: "person.display_name",
        scope_key: "",
        expected_revision: revision,
        mode: "ASSERT",
        value,
        object_entity_id: null,
        assertion_id: id(),
        replaces_assertion_id: null,
        resolve_conflict_id: null,
        resolution_note: null,
        provenance: {
          source_kind: "MASTER",
          source_id: source,
          evidence,
          observed_at: null,
          received_at: new Date().toISOString(),
          scope: "synthetic",
          epistemic: "REPORTED",
        },
        valid_from: "2026-01-01T00:00:00Z",
        valid_to: null,
        fresh_until: null,
      });
      const first = fact("Alpha", 0);
      assert.equal((await submit(first)).state, "COMMITTED");
      const conflict = fact("Beta", 1);
      assert.equal((await submit(conflict)).state, "COMMITTED");
      const rows = await world.read(entity);
      assert.equal(rows.length, 2);
      assert(rows.every((r) => r.status === "CONTESTED"));
      assert.equal(
        (await submit(fact("stale overwrite", 0))).state,
        "CONFLICT",
      );
      const count = app.store.logs.filter((l) =>
        l.event_type.startsWith("world.change_"),
      ).length;
      await world.pool.query(
        "UPDATE wm.audit_outbox SET exported_journal_txn=NULL,exported_at=NULL",
      );
      await world.export();
      assert.equal(
        app.store.logs.filter((l) => l.event_type.startsWith("world.change_"))
          .length,
        count,
      );
      const before = (
        await world.pool.query("SELECT count(*) FROM wm.assertion")
      ).rows[0].count;
      await world.apply(first);
      assert.equal(
        (await world.pool.query("SELECT count(*) FROM wm.assertion")).rows[0]
          .count,
        before,
      );
      const bad = fact("Gamma", 2);
      bad.provenance.source_kind = "OBSERVATION";
      assert.equal((await submit(bad)).state, "REJECTED");
      const committedCommand = app.store
        .all<WorldCommand>("WorldCommand")
        .find((c) => c.change.change_id === first.change_id)!;
      assert(committedCommand.receipt_ref);
      const tx = (
        await world.pool.query(
          "SELECT exported_journal_txn FROM wm.audit_outbox WHERE change_id=$1",
          [first.change_id],
        )
      ).rows[0].exported_journal_txn;
      assert(
        app.store.logs.some(
          (l) => app.store.transactionForEvent(l.event_id) === tx,
        ),
      );
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
