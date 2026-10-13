import { contentText } from "@earendil-works/pi-ai";
import type { Pool, PoolClient } from "pg";
import type { AgentMessage } from "./model.ts";
import type {
  Execution,
  Feedback,
  Input,
  Notification,
  OperationLogRecord,
  TaskResult,
} from "./contracts.ts";
import { hash, type Store } from "./store.ts";

export const SEARCH_POLICY = 1;
export type SearchKind = "input" | "reply" | "task" | "notification";
export type SearchOptions = {
  query: string;
  from?: string | null;
  to?: string | null;
  kinds?: SearchKind[] | null;
  scope_id?: string | null;
  task_id?: string | null;
  limit?: number;
};
export type SearchDocument = {
  event_id: string;
  log_sequence: number;
  occurred_at: string;
  kind: SearchKind;
  session_id: string | null;
  scope_id: string | null;
  task_id: string | null;
  body: string;
};

/** Frozen events, rather than mutable record revisions, define searchable text. */
export function searchDocument(
  store: Store,
  event: OperationLogRecord,
): SearchDocument | null {
  let body: string,
    kind: SearchKind,
    scopeID: string | null = null;
  let taskID = event.scope.task_id;
  if (event.event_type === "input.accepted") {
    const input = store.read<Input>(event.payload);
    if (input.producer !== "MASTER") return null;
    body = store.bytes(input.payload).toString();
    kind = "input";
  } else if (event.event_type === "main.message") {
    const message = store.read<AgentMessage>(event.payload);
    if (message.role !== "assistant" || message.stopReason !== "stop")
      return null;
    body = contentText(message.content.filter((p) => p.type === "text"));
    kind = "reply";
  } else if (
    event.event_type === "execution.finished" ||
    event.event_type === "feedback.delivered"
  ) {
    const value = store.read<TaskResult | Feedback>(event.payload);
    body = value.summary;
    kind = "task";
    scopeID =
      value.scope_id ??
      store.find<Execution>("Execution", value.execution_id)?.scope_id ??
      null;
    taskID = value.task_id;
  } else if (event.event_type === "notification.queued") {
    const value = store.read<Notification>(event.payload);
    body = store.bytes(value.message).toString();
    kind = "notification";
  } else return null;
  if (!body) return null;
  return {
    event_id: event.event_id,
    log_sequence: event.sequence,
    occurred_at: event.occurred_at,
    kind,
    session_id: event.scope.session_id,
    scope_id: scopeID,
    task_id: taskID,
    body,
  };
}

export function bodyChunks(body: string) {
  const chars = Array.from(body),
    chunks: { body: string; offset: number }[] = [];
  for (let start = 0; start < chars.length;) {
    let end = start,
      bytes = 0;
    while (end < chars.length && (bytes < 2048 || end - start < 257))
      bytes += Buffer.byteLength(chars[end++]);
    chunks.push({ body: chars.slice(start, end).join(""), offset: start });
    if (end === chars.length) break;
    start = end - 256;
  }
  return chunks;
}

export function readLog(
  store: Store,
  eventID?: string | null,
  offset = 0,
  length = 2000,
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > 4000
  )
    throw Error("INVALID_LOG_SLICE");
  if (!eventID)
    return {
      events: store.logs.slice(-20).map((e) => ({
        event_id: e.event_id,
        event_type: e.event_type,
        occurred_at: e.occurred_at,
        scope: e.scope,
      })),
      truncated: store.logs.length > 20,
    };
  const event = store.logs.find((e) => e.event_id === eventID);
  if (!event) throw Error("LOG_EVENT_NOT_FOUND");
  const doc = searchDocument(store, event);
  const body = doc?.body ?? store.bytes(event.payload).toString();
  const chars = Array.from(body);
  if (offset > chars.length) throw Error("INVALID_LOG_OFFSET");
  const end = Math.min(chars.length, offset + length);
  return {
    event_id: eventID,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    scope: event.scope,
    kind: doc?.kind ?? null,
    body: chars.slice(offset, end).join(""),
    offset,
    total_length: chars.length,
    body_hash: hash(body),
    next_offset: end < chars.length ? end : null,
    truncated: end < chars.length,
  };
}

export function searchQuery(sourceID: string, options: SearchOptions) {
  const limit = options.limit ?? 10;
  if (
    !options.query?.trim() ||
    Array.from(options.query).length > 256 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 20
  )
    throw Error("INVALID_MEMORY_SEARCH");
  for (const date of [options.from, options.to])
    if (
      date &&
      (!/(Z|[+-]\d\d:\d\d)$/.test(date) || !Number.isFinite(Date.parse(date)))
    )
      throw Error("INVALID_SEARCH_TIME");
  if (
    options.from &&
    options.to &&
    Date.parse(options.from) >= Date.parse(options.to)
  )
    throw Error("INVALID_SEARCH_TIME");
  if (
    options.kinds?.some(
      (k) => !["input", "reply", "task", "notification"].includes(k),
    )
  )
    throw Error("INVALID_SEARCH_KIND");
  for (const key of [options.scope_id, options.task_id])
    if (
      key &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      throw Error("INVALID_SEARCH_FILTER");
  const pattern = "%" + options.query.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  return {
    text: `WITH matches AS (
    SELECT DISTINCT d.* FROM mem.document d JOIN mem.chunk c USING(source_id,event_id)
    WHERE d.source_id=$1 AND c.body ILIKE $2 ESCAPE '\\'
      AND ($3::timestamptz IS NULL OR d.occurred_at >= $3) AND ($4::timestamptz IS NULL OR d.occurred_at < $4)
      AND ($5::text[] IS NULL OR d.kind=ANY($5)) AND ($6::uuid IS NULL OR d.scope_id=$6) AND ($7::uuid IS NULL OR d.task_id=$7)
    ORDER BY d.occurred_at DESC,d.event_id DESC LIMIT $8
  ) SELECT m.*, hit.body,hit.body_offset FROM matches m CROSS JOIN LATERAL (
    SELECT body,body_offset FROM mem.chunk WHERE source_id=m.source_id AND event_id=m.event_id
      AND body ILIKE $2 ESCAPE '\\' ORDER BY chunk_index LIMIT 1
  ) hit ORDER BY m.occurred_at DESC,m.event_id DESC`,
    values: [
      sourceID,
      pattern,
      options.from ?? null,
      options.to ?? null,
      options.kinds ?? null,
      options.scope_id ?? null,
      options.task_id ?? null,
      limit,
    ],
  };
}

/** Disposable SQL projection. The journal and CAS remain the only history authority. */
export class MemorySearch {
  state: "not_migrated" | "rebuilding" | "ready" | "unavailable" =
    "not_migrated";
  indexedSequence = 0;
  private initialized = false;
  private work?: Promise<void>;
  private error?: string;
  constructor(
    readonly store: Store,
    readonly pool: Pool,
  ) {}
  get sourceID() {
    return this.store.projectionFrames[0]?.digest ?? hash("empty-journal");
  }
  status() {
    return {
      status: this.state,
      indexed_journal_sequence: this.indexedSequence,
      partial: this.indexedSequence < this.store.sequence,
      ...(this.error ? { error: this.error } : {}),
    };
  }
  async advance() {
    if (this.work) return this.work;
    this.work = this.project()
      .catch((error) => {
        this.state =
          (error as { code?: string }).code === "42P01"
            ? "not_migrated"
            : "unavailable";
        this.error = String((error as Error).message);
        this.initialized = false;
      })
      .finally(() => {
        this.work = undefined;
      });
    return this.work;
  }
  private async project() {
    const db = await this.pool.connect();
    try {
      if (!this.initialized) {
        const { rows } = await db.query(
          `SELECT p.*,(SELECT count(*) FROM mem.document) AS actual_documents,(SELECT count(*) FROM mem.chunk) AS actual_chunks FROM mem.checkpoint p`,
        );
        const p = rows[0],
          frame = this.store.projectionFrames.find(
            (f) => f.sequence === Number(p?.journal_sequence),
          );
        if (
          !p ||
          p.source_id !== this.sourceID ||
          p.policy_version !== SEARCH_POLICY ||
          !frame ||
          frame.digest !== p.journal_digest ||
          p.actual_documents !== p.document_count ||
          p.actual_chunks !== p.chunk_count
        ) {
          this.state = "rebuilding";
          await db.query("BEGIN");
          await db.query("TRUNCATE mem.chunk,mem.document,mem.checkpoint");
          await db.query("COMMIT");
          this.indexedSequence = 0;
        } else this.indexedSequence = Number(p.journal_sequence);
        this.initialized = true;
      }
      const frames = this.store.projectionFrames
        .filter((f) => f.sequence > this.indexedSequence)
        .slice(0, 100);
      if (frames.length) {
        await db.query("BEGIN");
        for (const frame of frames)
          for (const event of frame.log_records) {
            const doc = searchDocument(this.store, event);
            if (!doc) continue;
            await db.query(
              `INSERT INTO mem.document VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
              [
                this.sourceID,
                doc.event_id,
                doc.log_sequence,
                doc.occurred_at,
                doc.kind,
                doc.session_id,
                doc.scope_id,
                doc.task_id,
                hash(doc.body),
              ],
            );
            const chunks = bodyChunks(doc.body);
            for (let n = 0; n < chunks.length; n++)
              await db.query(
                "INSERT INTO mem.chunk VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
                [
                  this.sourceID,
                  doc.event_id,
                  n,
                  chunks[n].offset,
                  chunks[n].body,
                ],
              );
          }
        const last = frames.at(-1)!;
        await db.query(
          `INSERT INTO mem.checkpoint SELECT true,$1,$2,$3,$4,(SELECT count(*) FROM mem.document),(SELECT count(*) FROM mem.chunk)
          ON CONFLICT(singleton) DO UPDATE SET source_id=EXCLUDED.source_id,policy_version=EXCLUDED.policy_version,journal_sequence=EXCLUDED.journal_sequence,journal_digest=EXCLUDED.journal_digest,document_count=EXCLUDED.document_count,chunk_count=EXCLUDED.chunk_count`,
          [this.sourceID, SEARCH_POLICY, last.sequence, last.digest],
        );
        await db.query("COMMIT");
        this.indexedSequence = last.sequence;
      }
      this.state =
        this.indexedSequence >= this.store.sequence ? "ready" : "rebuilding";
      this.error = undefined;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
  async catchUp() {
    // Finite snapshot: new business commits cannot create an unbounded settle loop.
    const target = this.store.sequence;
    do {
      await this.advance();
    } while (this.initialized && this.indexedSequence < target);
  }
  async idle() {
    await this.work;
  }
  invalidate() {
    this.initialized = false;
    this.state = "rebuilding";
  }
  unavailable(error: unknown) {
    this.initialized = false;
    this.state = "unavailable";
    this.error = String(error);
  }
  async search(options: SearchOptions) {
    const query = searchQuery(this.sourceID, options);
    // Bulk reconstruction never blocks a model/tool request. Expose the watermark.
    void this.advance();
    if (!this.initialized || !this.indexedSequence)
      return { ...this.status(), hits: [] };
    let db: PoolClient | undefined;
    try {
      db = await this.pool.connect();
      await db.query("BEGIN READ ONLY");
      await db.query("SET LOCAL statement_timeout=5000");
      const { rows } = await db.query(query);
      await db.query("COMMIT");
      const hits = rows.map((row) => {
        const chars = Array.from(row.body as string),
          at = (row.body as string)
            .toLocaleLowerCase()
            .indexOf(options.query.toLocaleLowerCase());
        const start = Math.max(
          0,
          at < 0
            ? 0
            : Array.from((row.body as string).slice(0, at)).length - 50,
        );
        return {
          event_id: row.event_id,
          occurred_at: new Date(row.occurred_at).toISOString(),
          kind: row.kind,
          session_id: row.session_id,
          scope_id: row.scope_id,
          task_id: row.task_id,
          snippet: chars.slice(start, start + 200).join(""),
          offset: row.body_offset + start,
        };
      });
      return { ...this.status(), hits };
    } catch (error) {
      await db?.query("ROLLBACK").catch(() => {});
      return {
        ...this.status(),
        status:
          (error as { code?: string }).code === "57014"
            ? "search_timeout"
            : "unavailable",
        hits: [],
      };
    } finally {
      db?.release();
    }
  }
}
