import { isDeepStrictEqual } from "node:util";
import { Pool, type PoolClient } from "pg";
import * as fs from "node:fs";
import * as path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Store, base, id, now, hash, revise, shape, root } from "./store.ts";
import { Authorization } from "./authorization.ts";
import type {
  WorldChange,
  WorldCatalogChange,
  WorldCommand,
  Operation,
  Scope,
} from "./contracts.ts";
export class World {
  readonly pool: Pool;
  readonly configurationHash: string;
  coordinate?: (command: WorldCommand) => void;
  constructor(
    readonly store: Store,
    readonly auth: Authorization,
    dsn: string,
  ) {
    this.configurationHash = hash(dsn);
    this.pool = new Pool({ connectionString: dsn, max: 2 });
  }
  async migrate() {
    const db = await this.pool.connect();
    try {
      await db.query("SELECT pg_advisory_lock(784316092)");
      const exists = await db.query(
        "SELECT to_regclass('wm.schema_version') AS name",
      );
      if (!exists.rows[0].name)
        await db.query(
          fs.readFileSync(
            path.join(root, "src/schema/001_world_model.sql"),
            "utf8",
          ),
        );
      const seeded = await db.query(
        "SELECT version FROM wm.schema_version WHERE version=2",
      );
      if (!seeded.rowCount) {
        const seed = fs
          .readFileSync(
            path.join(root, "src/schema/002_predicates.sql"),
            "utf8",
          )
          .replace(
            /;\s*COMMIT;\s*$/,
            " ON CONFLICT (predicate_key) DO NOTHING;\nINSERT INTO wm.schema_version(version) VALUES (2);\nCOMMIT;",
          );
        await db.query(seed);
      }
      await db.query(
        fs.readFileSync(path.join(root, "src/schema/003_settings.sql"), "utf8"),
      );
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      await db.query("SELECT pg_advisory_unlock(784316092)").catch(() => {});
      db.release();
    }
  }

  propose(change: WorldChange | WorldCatalogChange, scope: Scope) {
    shape(change);
    change.request_hash = hash(
      JSON.stringify({ ...change, request_hash: undefined }),
    );
    const ev =
      change.record_type === "WorldChange"
        ? change.provenance.evidence
        : change.evidence;
    for (const e of ev) {
      this.store.bytes(e.content);
      const event = this.store.logs.find((l) => l.event_id === e.log_event_id);
      if (!event) throw Error("EVIDENCE_EVENT_MISSING");
      if (
        event.payload.sha256 !== e.content.sha256 ||
        event.payload.path !== e.content.path ||
        event.payload.bytes !== e.content.bytes
      )
        throw Error("EVIDENCE_CONTENT_MISMATCH");
    }
    const prior = this.store
      .all<WorldCommand>("WorldCommand")
      .find((c) => c.change.change_id === change.change_id);
    if (prior) {
      if (JSON.stringify(prior.change) !== JSON.stringify(change))
        throw Error("CHANGE_CONFLICT");
      return prior;
    }
    const op = this.auth.prepare(
      scope,
      "world.change",
      "world/" +
        (change.record_type === "WorldChange"
          ? change.subject_id
          : (change.entity_id ?? change.source_id)),
      change,
      change.change_id,
    );
    const c: WorldCommand = {
      schema_version: 1,
      record_type: "WorldCommand",
      ...base(),
      state: op.state === "AUTHORIZED" ? "READY" : "WAIT_AUTH",
      change,
      operation_id: op.id,
      receipt_ref: null,
      error: null,
    };
    this.store.commit([c]);
    return c;
  }
  async drain() {
    for (const c of this.store.all<WorldCommand>("WorldCommand")) {
      if (["COMMITTED", "CONFLICT", "REJECTED"].includes(c.state)) continue;
      const o = this.store.get<Operation>("Operation", c.operation_id);
      if (o.state === "CANCELLED") {
        this.store.commit([
          revise(c, { state: "REJECTED", error: "Authorization rejected" }),
        ]);
        continue;
      }
      if (o.state === "WAIT_AUTH") continue;
      if (this.coordinate) {
        this.coordinate(c);
        continue;
      }
      try {
        if (o.state === "AUTHORIZED")
          this.auth.dispatch(o.id, [revise(c, { state: "APPLYING" })]);
        await this.apply(c.change);
        await this.export();
      } catch (error) {
        const current = this.store.get<WorldCommand>("WorldCommand", c.id);
        if (!["COMMITTED", "CONFLICT", "REJECTED"].includes(current.state))
          this.store.commit([
            revise(current, { state: "RETRYABLE_ERROR", error: String(error) }),
          ]);
      }
    }
    await this.export();
  }
  async apply(
    change: WorldChange | WorldCatalogChange,
    transaction?: PoolClient,
    applicationID?: string,
  ) {
    const db = transaction ?? (await this.pool.connect());
    try {
      if (!transaction) await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(784316093)");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        change.change_id,
      ]);
      const old = await db.query(
        "SELECT * FROM wm.change_receipt WHERE change_id=$1",
        [change.change_id],
      );
      if (old.rowCount) {
        if (old.rows[0].request_hash !== change.request_hash)
          throw Error("CHANGE_HASH_CONFLICT");
        if (!transaction) await db.query("COMMIT");
        return old.rows[0];
      }
      let result: Record<string, unknown>;
      let outcome = "APPLIED";
      await db.query("SAVEPOINT mutation");
      try {
        result =
          change.record_type === "WorldCatalogChange"
            ? await this.catalog(db, change)
            : await this.fact(db, change);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (transaction || (code && /^(08|40|53|57|58)/.test(code)))
          throw error;
        await db.query("ROLLBACK TO SAVEPOINT mutation");
        outcome = String(error).includes("REVISION_CONFLICT")
          ? "CONFLICT"
          : "REJECTED";
        result = { error: String(error) };
      }
      await db.query(
        "INSERT INTO wm.change_receipt(change_id,request_id,request_hash,outcome,result) VALUES($1,$2,$3,$4,$5)",
        [
          change.change_id,
          change.request_id,
          change.request_hash,
          outcome,
          result,
        ],
      );
      await db.query(
        "INSERT INTO wm.audit_outbox(event_id,change_id,payload) VALUES($1,$2,$3)",
        [
          id(),
          change.change_id,
          {
            change,
            result,
            outcome,
            ...(applicationID ? { application_id: applicationID } : {}),
          },
        ],
      );
      if (!transaction) await db.query("COMMIT");
      return { outcome, result };
    } catch (error) {
      if (!transaction) await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      if (!transaction) db.release();
    }
  }
  private async catalog(db: PoolClient, c: WorldCatalogChange) {
    if (!c.evidence.length) throw Error("NO_EVIDENCE");
    if (c.kind === "REGISTER_SOURCE") {
      if (
        !c.source_id ||
        !c.source_kind ||
        !c.source_key ||
        !c.description ||
        c.expected_revision !== 0
      )
        throw Error("INVALID_SOURCE");
      await db.query(
        "INSERT INTO wm.source(source_id,kind,source_key,description) VALUES($1,$2,$3,$4)",
        [c.source_id, c.source_kind, c.source_key, c.description],
      );
      return { source_id: c.source_id };
    }
    if (c.kind === "RETIRE_ENTITY") {
      const entity = (
        await db.query(
          "SELECT * FROM wm.entity WHERE entity_id=$1 FOR UPDATE",
          [c.entity_id],
        )
      ).rows[0];
      if (!entity || Number(entity.revision) !== c.expected_revision)
        throw Error("REVISION_CONFLICT");
      const refs = await db.query(
        "SELECT a.assertion_id FROM wm.assertion a JOIN wm.assertion_state st USING(assertion_id,slot_id) JOIN wm.fact_slot s USING(slot_id) WHERE (s.subject_id=$1 OR a.object_entity_id=$1) AND st.status IN ('ACTIVE','SUPPORTING','CONTESTED') LIMIT 20",
        [c.entity_id],
      );
      if (refs.rowCount)
        throw Error("ENTITY_REFERENCED: " + JSON.stringify(refs.rows));
      await db.query(
        "UPDATE wm.entity SET retired_at=now(), revision=revision+1,updated_at=now() WHERE entity_id=$1",
        [c.entity_id],
      );
      return { entity_id: c.entity_id, retired: true };
    }
    if (!c.entity_id || !c.entity_kind || !c.display_name)
      throw Error("INVALID_ENTITY");
    const old = await db.query(
      "SELECT * FROM wm.entity WHERE entity_id=$1 FOR UPDATE",
      [c.entity_id],
    );
    if (
      (old.rows[0]?.revision ? Number(old.rows[0].revision) : 0) !==
      c.expected_revision
    )
      throw Error("REVISION_CONFLICT");
    if (!old.rowCount)
      await db.query(
        "INSERT INTO wm.entity(entity_id,kind,display_name,external_key) VALUES($1,$2,$3,$4)",
        [c.entity_id, c.entity_kind, c.display_name, c.external_key],
      );
    else {
      if (old.rows[0].retired_at) throw Error("ENTITY_RETIRED");
      if (old.rows[0].kind !== c.entity_kind)
        throw Error("ENTITY_KIND_IMMUTABLE");
      await db.query(
        "UPDATE wm.entity SET display_name=$2,external_key=$3,revision=revision+1,updated_at=now() WHERE entity_id=$1",
        [c.entity_id, c.display_name, c.external_key],
      );
    }
    return { entity_id: c.entity_id, revision: c.expected_revision + 1 };
  }
  private async fact(db: PoolClient, c: WorldChange) {
    if (c.mode !== "RETRACT") {
      for (const entity of [c.subject_id, c.object_entity_id].filter(Boolean)) {
        const row = (
          await db.query(
            "SELECT retired_at FROM wm.entity WHERE entity_id=$1",
            [entity],
          )
        ).rows[0];
        if (!row || row.retired_at) throw Error("ENTITY_UNAVAILABLE");
      }
    }
    const pred = (
      await db.query("SELECT * FROM wm.predicate WHERE predicate_key=$1", [
        c.predicate_key,
      ])
    ).rows[0];
    if (!pred) throw Error("UNKNOWN_PREDICATE");
    const source = (
      await db.query("SELECT * FROM wm.source WHERE source_id=$1", [
        c.source_id,
      ])
    ).rows[0];
    if (
      !source ||
      source.kind !== c.provenance.source_kind ||
      c.source_id !== c.provenance.source_id
    )
      throw Error("SOURCE_MISMATCH");
    if (
      c.provenance.source_kind === "MASTER" &&
      !c.provenance.evidence.some((e) =>
        this.store.logs.some(
          (l) => l.event_id === e.log_event_id && l.actor === "MASTER_UI",
        ),
      )
    )
      throw Error("MASTER_SOURCE_NOT_PROVEN");
    if (
      c.mode !== "RETRACT" &&
      pred.value_type !== "ENTITY" &&
      !new Ajv2020({ strict: false }).validate(pred.value_schema, c.value)
    )
      throw Error("INVALID_FACT_VALUE");
    await db.query(
      "INSERT INTO wm.fact_slot(slot_id,subject_id,predicate_key,scope_key) VALUES($1,$2,$3,$4) ON CONFLICT(subject_id,predicate_key,scope_key) DO NOTHING",
      [id(), c.subject_id, c.predicate_key, c.scope_key],
    );
    const slot = (
      await db.query(
        "SELECT * FROM wm.fact_slot WHERE subject_id=$1 AND predicate_key=$2 AND scope_key=$3 FOR UPDATE",
        [c.subject_id, c.predicate_key, c.scope_key],
      )
    ).rows[0];
    if (Number(slot.revision) !== c.expected_revision)
      throw Error("REVISION_CONFLICT");
    const current = (
      await db.query(
        "SELECT a.*,s.status FROM wm.assertion a JOIN wm.assertion_state s USING(assertion_id,slot_id) WHERE a.slot_id=$1 AND s.status IN ('ACTIVE','SUPPORTING','CONTESTED')",
        [slot.slot_id],
      )
    ).rows;
    if (
      c.mode !== "ASSERT" &&
      !current.some((r) => r.assertion_id === c.replaces_assertion_id)
    )
      throw Error("REPLACEMENT_NOT_CURRENT");
    await db.query(
      "UPDATE wm.fact_slot SET revision=revision+1 WHERE slot_id=$1",
      [slot.slot_id],
    );
    if (c.mode === "RETRACT") {
      if (
        c.assertion_id !== c.replaces_assertion_id ||
        c.value !== null ||
        c.object_entity_id !== null
      )
        throw Error("INVALID_RETRACTION");
      await db.query(
        "UPDATE wm.assertion_state SET status='RETRACTED',revision=revision+1,changed_by=$2 WHERE assertion_id=$1",
        [c.assertion_id, c.change_id],
      );
      return {
        assertion_id: c.assertion_id,
        slot_revision: c.expected_revision + 1,
      };
    }
    let remaining = current;
    if (c.mode === "CORRECT") {
      if (c.resolve_conflict_id) {
        if (!c.resolution_note) throw Error("RESOLUTION_NOTE_REQUIRED");
        const conflict = (
          await db.query(
            "SELECT * FROM wm.conflict WHERE conflict_id=$1 AND slot_id=$2 AND status='OPEN' FOR UPDATE",
            [c.resolve_conflict_id, slot.slot_id],
          )
        ).rows[0];
        if (!conflict) throw Error("CONFLICT_NOT_OPEN");
        await db.query(
          "UPDATE wm.assertion_state SET status='SUPERSEDED',revision=revision+1,changed_by=$2 WHERE slot_id=$1 AND status IN ('ACTIVE','SUPPORTING','CONTESTED')",
          [slot.slot_id, c.change_id],
        );
        await db.query(
          "UPDATE wm.conflict SET status='RESOLVED',resolved_by=$2,resolution_note=$3 WHERE conflict_id=$1",
          [c.resolve_conflict_id, c.change_id, c.resolution_note],
        );
        remaining = [];
      } else {
        await db.query(
          "UPDATE wm.assertion_state SET status='SUPERSEDED',revision=revision+1,changed_by=$2 WHERE assertion_id=$1",
          [c.replaces_assertion_id, c.change_id],
        );
        remaining = current.filter(
          (r) => r.assertion_id !== c.replaces_assertion_id,
        );
      }
    }
    const equal = (r: Record<string, unknown>) =>
      isDeepStrictEqual(r.value, c.value) &&
      r.object_entity_id === c.object_entity_id;
    let status =
      remaining.length === 0
        ? "ACTIVE"
        : remaining.every(equal) &&
            !remaining.some((r) => r.status === "CONTESTED")
          ? "SUPPORTING"
          : "CONTESTED";
    await db.query(
      "INSERT INTO wm.assertion(assertion_id,slot_id,slot_revision,source_id,change_id,value,object_entity_id,epistemic,observed_at,received_at,valid_from,valid_to,fresh_until,scope_description,replaces_assertion_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [
        c.assertion_id,
        slot.slot_id,
        c.expected_revision + 1,
        c.source_id,
        c.change_id,
        c.value === null ? null : JSON.stringify(c.value),
        c.object_entity_id,
        c.provenance.epistemic,
        c.provenance.observed_at,
        c.provenance.received_at,
        c.valid_from,
        c.valid_to,
        c.fresh_until,
        c.provenance.scope,
        c.replaces_assertion_id,
      ],
    );
    for (const e of c.provenance.evidence) {
      const eid = id();
      const existing = await db.query(
        "INSERT INTO wm.evidence(evidence_id,log_event_id,object_path,sha256,media_type,byte_count) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(log_event_id,sha256) DO NOTHING RETURNING evidence_id",
        [
          eid,
          e.log_event_id,
          e.content.path,
          e.content.sha256,
          e.content.media_type,
          e.content.bytes,
        ],
      );
      const actual =
        existing.rows[0]?.evidence_id ??
        (
          await db.query(
            "SELECT evidence_id FROM wm.evidence WHERE log_event_id=$1 AND sha256=$2",
            [e.log_event_id, e.content.sha256],
          )
        ).rows[0].evidence_id;
      await db.query("INSERT INTO wm.assertion_evidence VALUES($1,$2)", [
        c.assertion_id,
        actual,
      ]);
    }
    await db.query(
      "INSERT INTO wm.assertion_state(assertion_id,slot_id,status,changed_by) VALUES($1,$2,$3,$4)",
      [c.assertion_id, slot.slot_id, status, c.change_id],
    );
    if (status === "CONTESTED") {
      await db.query(
        "UPDATE wm.assertion_state SET status='CONTESTED',revision=revision+1,changed_by=$2 WHERE slot_id=$1 AND status IN ('ACTIVE','SUPPORTING')",
        [slot.slot_id, c.change_id],
      );
      await db.query(
        "INSERT INTO wm.conflict(conflict_id,slot_id,status,opened_by) VALUES($1,$2,'OPEN',$3) ON CONFLICT(slot_id) WHERE status='OPEN' DO NOTHING",
        [id(), slot.slot_id, c.change_id],
      );
      const conflict = (
        await db.query(
          "SELECT conflict_id FROM wm.conflict WHERE slot_id=$1 AND status='OPEN'",
          [slot.slot_id],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO wm.conflict_member SELECT $1,slot_id,assertion_id FROM wm.assertion_state WHERE slot_id=$2 AND status='CONTESTED' ON CONFLICT DO NOTHING",
        [conflict.conflict_id, slot.slot_id],
      );
    }
    return {
      assertion_id: c.assertion_id,
      status,
      slot_revision: c.expected_revision + 1,
    };
  }
  async export() {
    const rows = (
      await this.pool.query(
        "SELECT * FROM wm.audit_outbox WHERE exported_at IS NULL ORDER BY created_at,event_id",
      )
    ).rows;
    for (const row of rows) {
      if (!this.store.logs.some((e) => e.event_id === row.event_id)) {
        const command = this.store
          .all<WorldCommand>("WorldCommand")
          .find((c) => c.change.change_id === row.change_id);
        if (!command && row.payload.application_id) {
          const application = this.store.find(
            "SettingsApplication",
            row.payload.application_id,
          );
          if (!application) throw Error("MISSING_SETTINGS_APPLICATION");
          const event = this.store.event("world.change_applied", row.payload);
          event.event_id = row.event_id;
          this.store.commit([], [event]);
          await this.pool.query(
            "UPDATE wm.audit_outbox SET exported_journal_txn=$2,exported_at=now() WHERE event_id=$1",
            [row.event_id, this.store.transactionForEvent(row.event_id)],
          );
          continue;
        }
        if (!command) throw Error("MISSING_WORLD_COMMAND");
        const op = this.store.get<Operation>("Operation", command.operation_id);
        const receipt = this.store.put(row.payload);
        const event = this.store.event(
          "world.change_" + row.payload.outcome.toLowerCase(),
          row.payload,
          op.scope,
        );
        event.event_id = row.event_id;
        this.store.commit(
          [
            revise(command, {
              state:
                row.payload.outcome === "APPLIED"
                  ? "COMMITTED"
                  : row.payload.outcome === "CONFLICT"
                    ? "CONFLICT"
                    : "REJECTED",
              receipt_ref: receipt,
              error: null,
            }),
            revise(op, {
              state: row.payload.outcome === "APPLIED" ? "SUCCEEDED" : "FAILED",
              effect:
                row.payload.outcome === "APPLIED" ? "APPLIED" : "NOT_APPLIED",
              receipt,
            }),
          ],
          [event],
        );
      }
      await this.pool.query(
        "UPDATE wm.audit_outbox SET exported_journal_txn=$2,exported_at=now() WHERE event_id=$1",
        [row.event_id, this.store.transactionForEvent(row.event_id)],
      );
    }
  }
  async applyBatch(
    applicationID: string,
    digest: string,
    changes: (WorldChange | WorldCatalogChange)[],
  ) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(784316093)");
      const old = (
        await db.query(
          "SELECT * FROM wm.settings_batch_receipt WHERE application_id=$1",
          [applicationID],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== digest) throw Error("BATCH_HASH_CONFLICT");
        await db.query("COMMIT");
        return old.result;
      }
      const results = [];
      for (const change of changes) {
        shape(change);
        for (const evidence of change.record_type === "WorldChange"
          ? change.provenance.evidence
          : change.evidence) {
          this.store.bytes(evidence.content);
          const event = this.store.logs.find(
            (e) => e.event_id === evidence.log_event_id,
          );
          if (!event || !isDeepStrictEqual(event.payload, evidence.content))
            throw Error("EVIDENCE_CONTENT_MISMATCH");
        }
        const result = await this.apply(change, db, applicationID);
        if (result.outcome !== "APPLIED") throw Error("BATCH_CHANGE_REJECTED");
        results.push(result);
      }
      await db.query(
        "INSERT INTO wm.settings_batch_receipt(application_id,request_hash,result) VALUES($1,$2,$3)",
        [applicationID, digest, JSON.stringify(results)],
      );
      await db.query("COMMIT");
      return results;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
  async batchReceipt(applicationID: string) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      // Wait for any in-flight commit before certifying that its receipt is absent.
      await db.query("SELECT pg_advisory_xact_lock(784316093)");
      const receipt =
        (
          await db.query(
            "SELECT * FROM wm.settings_batch_receipt WHERE application_id=$1",
            [applicationID],
          )
        ).rows[0] ?? null;
      await db.query("COMMIT");
      return receipt;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
  async slot(subject: string, predicate: string, scope: string) {
    if (!/^[0-9a-f-]{36}$/i.test(subject) || !predicate)
      throw Error("INVALID_SLOT");
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const worldVersion = (
        await db.query(
          "SELECT count(*)::text AS version FROM wm.change_receipt",
        )
      ).rows[0].version;
      const row = (
        await db.query(
          "SELECT slot_id,subject_id,predicate_key,scope_key,revision::text FROM wm.fact_slot WHERE subject_id=$1 AND predicate_key=$2 AND scope_key=$3",
          [subject, predicate, scope],
        )
      ).rows[0];
      await db.query("COMMIT");
      return { slot: row ?? null, world_version: worldVersion };
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      db.release();
    }
  }
  async catalogPage(kind: string, cursor?: string, limit = 30) {
    const tables: Record<string, [string, string]> = {
      entities: ["entity", "entity_id"],
      predicates: ["predicate", "predicate_key"],
      sources: ["source", "source_key"],
    };
    if (!tables[kind] || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw Error("INVALID_CATALOG_QUERY");
    const [table, key] = tables[kind];
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const version = (
        await db.query(
          "SELECT count(*)::text AS version FROM wm.change_receipt",
        )
      ).rows[0].version;
      const saved = cursor
        ? JSON.parse(Buffer.from(cursor, "base64url").toString())
        : null;
      if (
        saved &&
        (saved.kind !== kind ||
          saved.version !== version ||
          typeof saved.key !== "string")
      )
        throw Error("WORLD_PAGE_STALE");
      const rows = (
        await db.query(
          `SELECT * FROM wm.${table} WHERE ($1::text IS NULL OR ${key}::text>$1) ORDER BY ${key}::text LIMIT $2`,
          [saved?.key ?? null, limit + 1],
        )
      ).rows;
      await db.query("COMMIT");
      return {
        items: rows.slice(0, limit),
        world_version: version,
        next_cursor:
          rows.length > limit
            ? Buffer.from(
                JSON.stringify({ kind, version, key: rows[limit - 1][key] }),
              ).toString("base64url")
            : null,
      };
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      db.release();
    }
  }
  async catalogList() {
    const [entities, predicates, sources] = await Promise.all([
      this.pool.query(
        "SELECT * FROM wm.entity ORDER BY display_name,entity_id",
      ),
      this.pool.query("SELECT * FROM wm.predicate ORDER BY predicate_key"),
      this.pool.query("SELECT * FROM wm.source ORDER BY source_key"),
    ]);
    return {
      entities: entities.rows,
      predicates: predicates.rows,
      sources: sources.rows,
    };
  }
  async browse(options: {
    subject?: string;
    predicate?: string;
    history?: boolean;
    cursor?: string;
    limit?: number;
  }) {
    const limit = options.limit ?? 30;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw Error("INVALID_PAGE_LIMIT");
    const signature = hash(
      JSON.stringify([
        options.subject ?? null,
        options.predicate ?? null,
        !!options.history,
      ]),
    );
    const cursor = options.cursor
      ? JSON.parse(Buffer.from(options.cursor, "base64url").toString())
      : null;
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const version = (
        await db.query(
          "SELECT count(*)::text AS version FROM wm.change_receipt",
        )
      ).rows[0].version;
      if (
        cursor &&
        (cursor.version !== version || cursor.signature !== signature)
      )
        throw Error("WORLD_PAGE_STALE: reload first page");
      const at = cursor?.at ?? now();
      const rows = (
        await db.query(
          `SELECT s.*, a.*, st.status, src.kind AS source_kind, src.description AS source_description,
        e.display_name AS subject_name, obj.display_name AS object_name,
        (SELECT jsonb_agg(jsonb_build_object('log_event_id',ev.log_event_id,'content',jsonb_build_object('path',ev.object_path,'sha256',ev.sha256,'bytes',ev.byte_count,'media_type',ev.media_type))) FROM wm.assertion_evidence ae JOIN wm.evidence ev USING(evidence_id) WHERE ae.assertion_id=a.assertion_id) AS evidence,
        (SELECT jsonb_agg(c) FROM wm.conflict c WHERE c.slot_id=s.slot_id) AS conflicts,
        (SELECT jsonb_agg(r ORDER BY r.committed_at) FROM wm.change_receipt r WHERE r.change_id IN (a.change_id,st.changed_by)) AS receipts,
        s.revision AS current_revision
        FROM wm.assertion a JOIN wm.fact_slot s USING(slot_id) JOIN wm.assertion_state st USING(assertion_id,slot_id)
        JOIN wm.source src USING(source_id) JOIN wm.entity e ON e.entity_id=s.subject_id LEFT JOIN wm.entity obj ON obj.entity_id=a.object_entity_id
        WHERE ($1::uuid IS NULL OR s.subject_id=$1) AND ($2::text IS NULL OR s.predicate_key=$2)
        AND ($3::boolean OR (st.status IN ('ACTIVE','SUPPORTING','CONTESTED') AND a.valid_from<=$4::timestamptz AND (a.valid_to IS NULL OR a.valid_to>$4::timestamptz)))
        AND ($5::uuid IS NULL OR (s.slot_id,a.assertion_id)>($5::uuid,$6::uuid)) ORDER BY s.slot_id,a.assertion_id LIMIT $7`,
          [
            options.subject ?? null,
            options.predicate ?? null,
            !!options.history,
            at,
            cursor?.slot ?? null,
            cursor?.assertion ?? null,
            limit + 1,
          ],
        )
      ).rows;
      const more = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      await db.query("COMMIT");
      return {
        rows: page,
        version,
        next_cursor: more
          ? Buffer.from(
              JSON.stringify({
                signature,
                version,
                at,
                slot: last.slot_id,
                assertion: last.assertion_id,
              }),
            ).toString("base64url")
          : null,
      };
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
  async read(subject: string | null = null, predicate: string | null = null) {
    const query = fs
      .readFileSync(path.join(root, "src/schema/queries.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("--"))
      .join("\n")
      .split(";")[0];
    return (
      await this.pool.query(query, [
        subject,
        predicate,
        now(),
        now(),
        false,
        100,
        null,
        null,
      ])
    ).rows;
  }
  async close() {
    await this.pool.end();
  }
}
