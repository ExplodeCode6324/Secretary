import { worldSnapshot } from "./world-recall.ts";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import { Store, base, now, revise, hash, root } from "./store.ts";
import { Authorization } from "./authorization.ts";
import { MemorySearch } from "./memory-search.ts";
import type {
  WorldEntity,
  WorldAssertion,
  WorldGenesis,
  Operation,
  AuthorizationRequest,
  Scope,
} from "./contracts.ts";
import {
  acceptWorldChange,
  resolveWorldEntity,
  worldConflicts,
  roleID,
  type WorldBatch,
  type WorldEdit,
} from "./world-accept.ts";
import { coreIdentity, assistantProfile } from "./core-identity.ts";
import { stableID } from "./execution-utils.ts";
import { PREDICATES, predicate } from "./world-catalog.ts";
import { importLegacyWorld, worldStartupPreflight } from "./world-import.ts";
export class World {
  readonly pool: Pool;
  readonly memorySearch: MemorySearch;
  readonly configured: boolean;
  error: string | null = null;
  private retryAt = 0;
  private closed = false;
  private memoryInit?: Promise<void>;
  private initializing?: Promise<void>;
  constructor(
    readonly store: Store,
    readonly auth: Authorization,
    dsn?: string,
  ) {
    this.configured = !!dsn;
    this.pool = new Pool({
      connectionString: dsn,
      max: 2,
      connectionTimeoutMillis: 1500,
    });
    this.memorySearch = new MemorySearch(store, dsn ? this.pool : undefined);
    this.pool.on("error", (e) => this.memorySearch.unavailable(e));
  }
  get ready() {
    return this.store.all("WorldGenesis").length === 1;
  }
  requireReady() {
    if (!this.ready)
      throw Error(
        "WORLD_LEGACY_IMPORT_PENDING: " +
          (this.error ?? "initialization pending"),
      );
  }
  async initialize(fresh = false) {
    if (this.ready) return;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      worldStartupPreflight(this.store);
      fresh =
        fresh ||
        this.store
          .events("world.bootstrap_selected")
          .some((e) => this.store.read<any>(e.payload).fresh === true);
      const identity = coreIdentity(this.store),
        profile = assistantProfile(this.store);
      if (this.configured) {
        await importLegacyWorld(this, identity.owner_id, profile.name, fresh);
      } else if (fresh) {
        const at = now();
        const prepared = acceptWorldChange(
          this.store,
          { version: 1, batch_id: stableID("world-genesis"), changes: [] },
          {
            kind: "SEED",
            owner_id: identity.owner_id,
            secretary_name: profile.name,
          },
          at,
        );
        const genesis: WorldGenesis = {
          ...base(stableID("world-genesis")),
          updated_at: at,
          schema_version: 1,
          record_type: "WorldGenesis",
          owner_id: identity.owner_id,
          entity_count: 2,
          assertion_count: 0,
          mode: "FRESH",
          manifest_ref: this.store.put({
            version: 1,
            mode: "FRESH",
            verified: "new-domain-without-postgres",
          }),
        };
        this.store.commit(
          [...prepared.records, genesis],
          [this.store.event("world.genesis", genesis)],
        );
      } else
        throw Error(
          "WORLD_LEGACY_IMPORT_PENDING: legacy domain requires verified PostgreSQL snapshot",
        );
      this.error = null;
    })()
      .catch((e) => {
        this.error = String(e);
        this.retryAt = Date.now() + 30000;
      })
      .finally(() => {
        this.initializing = undefined;
      });
    return this.initializing;
  }
  async migrate() {
    await this.initialize(false);
    if (this.configured) await this.initializeMemorySearchSchema();
  }
  async initializeMemorySearchSchema() {
    if (!this.configured) return;
    if (this.memoryInit) return this.memoryInit;
    this.memoryInit = (async () => {
      const db = await this.pool.connect();
      try {
        await db.query("SELECT pg_advisory_lock(784316092)");
        await db.query(
          fs.readFileSync(
            path.join(root, "src/schema/memory_search.sql"),
            "utf8",
          ),
        );
      } catch (error) {
        await db.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        await db.query("SELECT pg_advisory_unlock(784316092)").catch(() => {});
        db.release();
      }
      this.memorySearch.invalidate();
      await this.memorySearch.catchUp();
    })().finally(() => {
      this.memoryInit = undefined;
    });
    return this.memoryInit;
  }
  entities() {
    this.requireReady();
    return this.store.all<WorldEntity>("WorldEntity");
  }
  assertions() {
    this.requireReady();
    return this.store.all<WorldAssertion>("WorldAssertion");
  }
  resolve(selector: string, history = false) {
    return resolveWorldEntity(this.entities(), selector, history);
  }
  propose(batch: WorldBatch, scope: Scope) {
    this.requireReady();
    const old = this.store
      .all<Operation>("Operation")
      .find((o) => o.action.intent_id === batch.batch_id);
    if (old) {
      if (old.action.parameters_hash !== this.store.put(batch).sha256)
        throw Error("INTENT_CONFLICT");
      return this.batch(batch.batch_id, scope.session_id);
    }
    acceptWorldChange(
      this.store,
      batch,
      { kind: "MODEL", scope, owner_epoch: this.store.epoch },
      now(),
    );
    this.auth.prepare(
      scope,
      "world.change",
      "world/batch/" + batch.batch_id,
      batch,
      batch.batch_id,
    );
    return this.batch(batch.batch_id, scope.session_id);
  }
  ownerChange(batch: WorldBatch, scope: Scope) {
    this.requireReady();
    const digest = hash(JSON.stringify(batch));
    const prior = this.store.receipt<string>(batch.batch_id, digest);
    if (prior) return { status: "COMMITTED", batch_id: batch.batch_id };
    const event = this.store.event(
      "world.owner_requested",
      batch,
      scope,
      "MASTER_UI",
    );
    const at = now();
    const prepared = acceptWorldChange(
      this.store,
      batch,
      { kind: "OWNER", scope, event, owner_epoch: this.store.epoch },
      at,
    );
    const result = {
      status: "COMMITTED",
      batch_id: batch.batch_id,
      ...prepared,
      records: undefined,
    };
    this.store.commit(
      prepared.records,
      [event, this.store.event("world.changed", result, scope)],
      { request: batch.batch_id, hash: digest, value: batch.batch_id },
    );
    return result;
  }
  preview(batch: WorldBatch, scope: Scope) {
    this.requireReady();
    const at = now();
    const prepared = acceptWorldChange(
      this.store,
      batch,
      { kind: "MODEL", scope, owner_epoch: this.store.epoch },
      at,
    );
    const subjects = new Set(
      prepared.records.flatMap((r) =>
        r.record_type === "WorldAssertion"
          ? [r.subject_id]
          : r.record_type === "WorldEntity"
            ? [r.id]
            : [],
      ),
    );
    const evidence = [
      ...new Set(batch.changes.flatMap((c) => c.source_event_ids ?? [])),
    ].map((id) => {
      const e = this.store.eventById(id)!;
      const body =
        e.event_type === "input.accepted"
          ? this.store
              .bytes(
                this.store.read<import("./contracts.ts").Input>(e.payload)
                  .payload,
              )
              .toString()
          : this.store.bytes(e.payload).toString();
      return {
        event_id: id,
        quote: Array.from(body).slice(0, 2000).join(""),
        truncated: Array.from(body).length > 2000,
      };
    });
    return {
      preview_at: at,
      ...prepared,
      entities: this.entities().filter((e) => subjects.has(e.id)),
      existing_live: this.assertions().filter(
        (f) => subjects.has(f.subject_id) && f.status === "LIVE",
      ),
      evidence,
      hint: "ASSERT preserves all existing LIVE facts. Use CORRECT with an explicit target to replace a fact.",
    };
  }
  batch(batchID: string, sessionID: string | null) {
    const op = this.store
      .all<Operation>("Operation")
      .find(
        (o) =>
          o.action.action === "world.change" &&
          o.action.intent_id === batchID &&
          o.scope.session_id === sessionID,
      );
    if (!op) throw Error("WORLD_BATCH_NOT_FOUND");
    const grant = op.authorization_id
      ? this.store.get<AuthorizationRequest>(
          "AuthorizationRequest",
          op.authorization_id,
        )
      : undefined;
    const status =
      op.state === "SUCCEEDED"
        ? "COMMITTED"
        : op.state === "WAIT_AUTH"
          ? "PENDING"
          : op.state === "AUTHORIZED"
            ? "APPROVED"
            : grant?.state === "EXPIRED"
              ? "EXPIRED"
              : op.error
                ? "FAILED"
                : "REJECTED";
    return {
      batch_id: batchID,
      operation_id: op.id,
      authorization_id: op.authorization_id,
      status,
      error: op.error,
      result: op.receipt ? this.store.read(op.receipt) : null,
    };
  }
  async drain() {
    if (!this.ready) {
      if (Date.now() >= this.retryAt) await this.initialize(false);
      return;
    }
    const order = new Map(
      this.store
        .events("authorization.decided")
        .map((e) => [
          (this.store.read<any>(e.payload).result as AuthorizationRequest).id,
          e.sequence,
        ]),
    );
    const operations = this.store
      .all<Operation>("Operation")
      .filter(
        (o) =>
          o.action.action === "world.change" &&
          ["WAIT_AUTH", "AUTHORIZED"].includes(o.state),
      )
      .sort(
        (a, b) =>
          (order.get(a.authorization_id!) ?? Infinity) -
          (order.get(b.authorization_id!) ?? Infinity),
      );
    for (const op of operations) {
      const a = this.store.get<AuthorizationRequest>(
        "AuthorizationRequest",
        op.authorization_id!,
      );
      if (a.expires_at && Date.parse(a.expires_at) <= Date.now()) {
        this.fail(op, a, "EXPIRED", "Authorization expired");
        continue;
      }
      if (op.state !== "AUTHORIZED") continue;
      try {
        if (
          a.state !== "APPROVED" ||
          JSON.stringify(a.action) !== JSON.stringify(op.action)
        )
          throw Error("GRANT_INVALID");
        const at = now(),
          batch = this.store.read<WorldBatch>(op.action.parameters_ref);
        const prepared = acceptWorldChange(
          this.store,
          batch,
          { kind: "MODEL", scope: op.scope, owner_epoch: op.owner_epoch },
          at,
        );
        const result = {
          batch_id: batch.batch_id,
          status: "COMMITTED",
          result_ids: prepared.result_ids,
          conflicts: prepared.conflicts,
          applied_at: at,
        };
        const done = revise(op, {
          state: "SUCCEEDED",
          effect: "APPLIED",
          receipt: this.store.put(result),
          updated_at: at,
        });
        this.store.commit(
          [
            ...prepared.records,
            revise(a, { state: "CONSUMED", consumed_at: at, updated_at: at }),
            done,
          ],
          [
            this.store.event("world.changed", result, op.scope),
            this.store.event("operation.journal_applied", done, op.scope),
          ],
        );
      } catch (error) {
        this.fail(op, a, "REVOKED", String(error));
      }
    }
  }
  private fail(
    op: Operation,
    a: AuthorizationRequest,
    state: "EXPIRED" | "REVOKED",
    error: string,
  ) {
    this.store.commit(
      [
        revise(op, {
          state: "CANCELLED",
          effect: "NOT_STARTED",
          error,
          receipt: this.store.put({
            status: state === "EXPIRED" ? "EXPIRED" : "FAILED",
            reason: error,
            actor: "HOST",
          }),
        }),
        revise(a, { state }),
      ],
      [
        this.store.event(
          "world.batch_failed",
          {
            batch_id: op.action.intent_id,
            error,
            reason: state,
            actor: "HOST",
          },
          op.scope,
        ),
      ],
    );
  }
  async catalogList() {
    return { entities: this.entities(), predicates: PREDICATES, sources: [] };
  }
  async catalogPage(kind: string, cursor?: string, limit = 30) {
    if (!["entities", "predicates", "roles"].includes(kind))
      throw Error("INVALID_CATALOG_KIND");
    const values =
      kind === "predicates"
        ? PREDICATES.map((p) => ({ ...p, id: p.predicate_key }))
        : this.entities().filter((e) => kind !== "roles" || e.role);
    const page = keyset<{ id: string }>(values, cursor, limit, kind);
    return { items: page.rows, next_cursor: page.next_cursor };
  }
  async browse(options: {
    subject?: string;
    predicate?: string;
    topic?: string;
    fact_id?: string;
    history?: boolean;
    cursor?: string;
    limit?: number;
  }) {
    let subject = options.subject;
    if (subject) {
      const r = this.resolve(subject, !!options.history);
      if (r.status !== "resolved")
        throw Error("ENTITY_" + r.status.toUpperCase());
      subject = r.entity.id;
    }
    const at = now();
    const facts = worldSnapshot(this.store, at)
      .facts.map((f) => ({
        ...f,
        stale: !!f.fresh_until && Date.parse(f.fresh_until) <= Date.parse(at),
      }))
      .filter(
        (f) =>
          (!subject || f.subject_id === subject) &&
          (!options.predicate || f.predicate_key === options.predicate) &&
          (!options.topic || f.topic === options.topic) &&
          (!options.fact_id || f.id === options.fact_id) &&
          (options.history ||
            options.fact_id ||
            (f.status === "LIVE" &&
              !predicate(f.predicate_key)?.retired &&
              Date.parse(f.valid_from) <= Date.parse(at) &&
              (!f.valid_to || Date.parse(at) < Date.parse(f.valid_to)))),
      );
    const page = keyset(
      facts,
      options.cursor,
      options.limit ?? 20,
      JSON.stringify([
        subject,
        options.predicate,
        options.topic,
        options.fact_id,
        options.history,
      ]),
    );
    return { ...page, conflicts: worldConflicts(facts, at) };
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.initializing;
    await this.memoryInit;
    await this.memorySearch.idle();
    await this.pool.end();
  }
}
function keyset<T extends { id: string }>(
  values: readonly T[],
  cursor: string | undefined,
  limit: number,
  scope: string,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw Error("INVALID_LIMIT");
  let after = "";
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (
        decoded.scope !== scope ||
        typeof decoded.after !== "string" ||
        Object.keys(decoded).length !== 2
      )
        throw Error();
      after = decoded.after;
    } catch {
      throw Error("INVALID_CURSOR");
    }
  }
  const ordered = [...values]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((v) => v.id > after);
  const rows = ordered.slice(0, limit);
  return {
    rows,
    next_cursor:
      ordered.length > limit
        ? Buffer.from(
            JSON.stringify({ scope, after: rows.at(-1)!.id }),
          ).toString("base64url")
        : null,
  };
}
