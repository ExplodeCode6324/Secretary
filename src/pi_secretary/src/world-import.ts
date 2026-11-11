import { isDeepStrictEqual } from "node:util";
import type { World } from "./world.ts";
import type { Store } from "./store.ts";
import { base, now } from "./store.ts";
import { stableID } from "./execution-utils.ts";
import type {
  WorldEntity,
  WorldAssertion,
  WorldGenesis,
  SettingsApplication,
  Input,
  Session,
  WorldCommand,
  Operation,
} from "./contracts.ts";
import { acceptWorldChange } from "./world-accept.ts";
export function worldStartupPreflight(store: Store) {
  if (
    store.all("WorldGenesis").length ||
    store.events("world.upgrade_preflight_passed").length
  )
    return;
  if (
    store
      .all<SettingsApplication>("SettingsApplication")
      .some((a) => !["APPLIED", "FAILED"].includes(a.state))
  )
    throw Error("WORLD_UPGRADE_PENDING_SETTINGS_USE_OLD_CODE");
  if (
    store
      .all<WorldCommand>("WorldCommand")
      .some((c) => !["COMMITTED", "CONFLICT", "REJECTED"].includes(c.state))
  )
    throw Error("WORLD_UPGRADE_PENDING_COMMAND_USE_OLD_CODE");
  if (
    store
      .all<Operation>("Operation")
      .some(
        (o) =>
          o.action.action === "world.change" &&
          !["SUCCEEDED", "FAILED", "CANCELLED"].includes(o.state),
      )
  )
    throw Error("WORLD_UPGRADE_PENDING_OPERATION_USE_OLD_CODE");
  if (
    store.all<Session>("Session").some((s) => s.active_loop_id) ||
    store.all<Input>("Input").some((i) => i.state === "CLAIMED")
  )
    throw Error("SETTINGS_UPGRADE_REQUIRES_IDLE_MAIN");
  // Commit before identities, provider configuration or any new-format loop.
  // A configured database still has to confirm absence (or import wm) later.
  const noWorldHistory =
    !store.all("WorldCommand").length &&
    !store.logs.some((e) => e.event_type.startsWith("world.")) &&
    !store
      .all<Operation>("Operation")
      .some((o) => o.action.action === "world.change");
  store.commit(
    [],
    [
      store.event("world.upgrade_preflight_passed", { version: 1 }),
      ...(noWorldHistory
        ? [
            store.event("world.bootstrap_selected", {
              fresh: true,
              version: 1,
              reason: store.sequence === 0 ? "new-domain" : "no-world-history",
            }),
          ]
        : []),
    ],
  );
}
/** One read-only repeatable snapshot; all legacy rows stay in a protected CAS manifest. */
export async function importLegacyWorld(
  world: World,
  owner: string,
  name: string,
  fresh: boolean,
) {
  const db = await world.pool.connect(),
    store = world.store;
  let manifest: Record<string, any[]> = {},
    legacy = false;
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const exists = await db.query("SELECT to_regnamespace('wm') AS schema");
    legacy = !!exists.rows[0].schema;
    if (!legacy && !fresh) throw Error("WORLD_LEGACY_SCHEMA_MISSING");
    if (legacy) {
      const tables = (
        await db.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='wm' ORDER BY tablename",
        )
      ).rows.map((r) => r.tablename as string);
      const expected = [
        "schema_version",
        "entity",
        "source",
        "predicate",
        "fact_slot",
        "change_receipt",
        "assertion",
        "assertion_state",
        "evidence",
        "assertion_evidence",
        "conflict",
        "conflict_member",
        "audit_outbox",
        "settings_batch_receipt",
      ];
      if (
        tables.some((t) => !expected.includes(t)) ||
        expected
          .filter((t) => t !== "settings_batch_receipt")
          .some((t) => !tables.includes(t))
      )
        throw Error("WORLD_LEGACY_SCHEMA_UNRECOGNIZED");
      for (const table of tables)
        manifest[table] = (
          await db.query('SELECT * FROM wm."' + table + '"')
        ).rows;
      if (
        !manifest.schema_version.length ||
        manifest.schema_version.some((r) => ![1, 2, 3, 4].includes(r.version))
      )
        throw Error("WORLD_LEGACY_SCHEMA_UNRECOGNIZED");
      if (manifest.audit_outbox.some((r) => r.exported_at === null))
        throw Error("WORLD_UPGRADE_PENDING_OUTBOX_USE_OLD_CODE");
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
  const at = now(),
    entities: WorldEntity[] = [],
    assertions: WorldAssertion[] = [];
  const iso = (x: any) => (x instanceof Date ? x.toISOString() : x);
  if (legacy) {
    for (const e of manifest.evidence) {
      const event = store.eventById(e.log_event_id);
      if (!event) throw Error("WORLD_IMPORT_FOREIGN_EVIDENCE");
      const ref = {
        path: e.object_path,
        sha256: e.sha256,
        bytes: Number(e.byte_count),
        media_type: e.media_type,
      };
      store.bytes(ref);
      if (
        event.payload.path !== ref.path ||
        event.payload.sha256 !== ref.sha256 ||
        event.payload.bytes !== ref.bytes
      )
        throw Error("WORLD_IMPORT_EVIDENCE_MISMATCH");
    }
    for (const out of manifest.audit_outbox) {
      const event = store.eventById(out.event_id);
      if (
        !event ||
        store.transactionForEvent(out.event_id) !== out.exported_journal_txn ||
        !isDeepStrictEqual(store.read(event.payload), out.payload)
      )
        throw Error("WORLD_IMPORT_EXPORT_MISSING");
    }
    for (const e of manifest.entity)
      entities.push({
        ...base(e.entity_id),
        updated_at: at,
        schema_version: 1,
        record_type: "WorldEntity",
        kind: e.kind,
        display_name: e.display_name,
        aliases: e.aliases ?? [],
        role: null,
        external_key: e.external_key,
        retired_at: iso(e.retired_at),
      });
    for (const a of manifest.assertion) {
      const slot = manifest.fact_slot.find((s) => s.slot_id === a.slot_id),
        state = manifest.assertion_state.find(
          (s) => s.assertion_id === a.assertion_id,
        ),
        source = manifest.source.find((s) => s.source_id === a.source_id);
      if (
        !slot ||
        !state ||
        !source ||
        !manifest.change_receipt.some((r) => r.change_id === a.change_id)
      )
        throw Error("WORLD_IMPORT_INCOMPLETE_ASSERTION");
      const evidence = manifest.assertion_evidence
        .filter((e) => e.assertion_id === a.assertion_id)
        .map(
          (e) =>
            manifest.evidence.find((x) => x.evidence_id === e.evidence_id)
              ?.log_event_id,
        );
      if (evidence.some((e) => !e) || !evidence.length)
        throw Error("WORLD_IMPORT_MISSING_EVIDENCE");
      const status = ["ACTIVE", "SUPPORTING", "CONTESTED"].includes(
        state.status,
      )
        ? "LIVE"
        : state.status;
      if (!["LIVE", "SUPERSEDED", "RETRACTED"].includes(status))
        throw Error("WORLD_IMPORT_UNKNOWN_STATUS");
      assertions.push({
        ...base(a.assertion_id),
        updated_at: at,
        schema_version: 1,
        record_type: "WorldAssertion",
        subject_id: slot.subject_id,
        predicate_key: slot.predicate_key,
        topic: "other",
        value: a.value,
        object_entity_id: a.object_entity_id,
        keywords: [],
        source_kind: a.epistemic === "UNRESOLVED" ? "UNRESOLVED" : source.kind,
        evidence_event_ids: evidence,
        valid_from: iso(a.valid_from),
        valid_to: iso(a.valid_to),
        observed_at: iso(a.observed_at ?? a.received_at),
        fresh_until: iso(a.fresh_until),
        note: a.scope_description,
        status,
        replaces_id: a.replaces_assertion_id,
        change_id: a.change_id,
      });
    }
  }
  const manifestRef = store.put({
    version: 1,
    mode: legacy ? "LEGACY" : "FRESH",
    legacy: manifest,
  });
  if (
    manifestRef.bytes > 32 * 1024 * 1024 ||
    entities.length + assertions.length > 100000
  )
    throw Error("WORLD_IMPORT_REQUIRES_BOUNDED_MIGRATION_REVIEW");
  const genesis: WorldGenesis = {
    ...base(stableID("world-genesis")),
    updated_at: at,
    schema_version: 1,
    record_type: "WorldGenesis",
    manifest_ref: manifestRef,
    entity_count: entities.length + 2,
    assertion_count: assertions.length,
    mode: legacy ? "LEGACY" : "FRESH",
    owner_id: owner,
  };
  const prepared = acceptWorldChange(
    store,
    { version: 1, batch_id: stableID("world-genesis"), changes: [] },
    {
      kind: "IMPORT",
      owner_id: owner,
      secretary_name: name,
      entities,
      assertions,
      genesis,
    },
    at,
  );
  store.commit(prepared.records, [store.event("world.genesis", genesis)]);
}
