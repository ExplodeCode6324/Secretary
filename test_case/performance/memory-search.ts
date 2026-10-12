// Explicit synthetic SQL benchmark; not part of the default offline suite.
import fs from "node:fs";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  withTestDatabase,
  testDatabaseURL,
} from "../offline/helpers/postgres.ts";
import { searchQuery } from "../../src/pi_secretary/src/memory-search.ts";
import { root } from "../../src/pi_secretary/src/store.ts";
import path from "node:path";

const dsn = testDatabaseURL(),
  evidence = process.env.SECRETARY_MEMORY_SEARCH_EVIDENCE;
if (!dsn || !evidence)
  throw Error(
    "PERFORMANCE_NOT_RUN: isolated test DSN and private evidence path required",
  );
const cases: unknown[] = [];
await withTestDatabase(dsn, async (url) => {
  const pool = new Pool({ connectionString: url });
  try {
    // Only the minimum World parent required by the additive migration.
    await pool.query(
      "CREATE SCHEMA wm; CREATE TABLE wm.schema_version(version integer PRIMARY KEY); CREATE TABLE wm.entity(entity_id uuid PRIMARY KEY)",
    );
    await pool.query(
      fs.readFileSync(
        path.join(root, "src/schema/004_memory_search.sql"),
        "utf8",
      ),
    );
    const metadata = (
      await pool.query(
        "SELECT current_setting('server_version') AS server_version,pg_encoding_to_char(encoding) AS encoding,datctype,datcollate,datlocprovider AS locale_provider,datlocale,datcollversion FROM pg_database WHERE datname=current_database()",
      )
    ).rows[0];
    const trigrams = (
      await pool.query(
        "SELECT show_trgm('杭州') AS two,show_trgm('杭州见') AS three,show_trgm('english') AS english",
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO mem.document SELECT 'synthetic',md5(g::text)::uuid,g,'2026-01-01T00:00:00Z'::timestamptz+g*interval '1 second','input',NULL,NULL,NULL,md5(g::text) FROM generate_series(1,100000) g`,
    );
    await pool.query(
      `INSERT INTO mem.chunk SELECT source_id,event_id,0,0,repeat('合成材料 ',30)||CASE WHEN log_sequence%3=0 THEN '杭州见 english ' ELSE '其它地点 ' END||CASE WHEN log_sequence=5 THEN '唯一杭州码' ELSE '' END FROM mem.document`,
    );
    await pool.query("ANALYZE mem.document; ANALYZE mem.chunk");
    for (const scenario of [
      { query: "杭州", label: "two_high_hit" },
      { query: "杭州见", label: "three_high_hit" },
      { query: "english", label: "english_high_hit" },
      { query: "唯一杭州码", label: "rare_old_fact" },
      { query: "无此关键词", label: "no_hit" },
      { query: "杭州", from: "2026-01-02T00:00:00Z", label: "two_filtered" },
    ]) {
      const query = searchQuery("synthetic", { ...scenario, limit: 20 });
      const timings: number[] = [];
      let plans: unknown[] = [];
      for (let n = 0; n < 6; n++) {
        await pool.query("BEGIN READ ONLY; SET LOCAL statement_timeout=5000");
        const start = performance.now();
        const { rows } = await pool.query(query);
        timings.push(performance.now() - start);
        const expected =
          scenario.label === "no_hit"
            ? 0
            : scenario.label === "rare_old_fact"
              ? 1
              : 20;
        assert.equal(rows.length, expected, scenario.label);
        for (let i = 1; i < rows.length; i++)
          assert(
            Number(rows[i - 1].log_sequence) > Number(rows[i].log_sequence),
            "event ordering",
          );
        if (n === 0 || n === 5)
          plans.push(
            (
              await pool.query(
                "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + query.text,
                query.values,
              )
            ).rows[0],
          );
        await pool.query("COMMIT");
      }
      const sorted = timings.slice(1).sort((a, b) => a - b);
      cases.push({
        label: scenario.label,
        query: scenario.query,
        first_ms: timings[0],
        warm_p50_ms: sorted[2],
        warm_p95_ms: sorted.at(-1),
        plans,
      });
    }
    const bytes = (
      await pool.query(
        "SELECT pg_indexes_size('mem.chunk')::text AS chunk_indexes,pg_indexes_size('mem.document')::text AS document_indexes",
      )
    ).rows[0];
    fs.writeFileSync(
      evidence,
      JSON.stringify(
        {
          evidence: "OFFLINE+PG",
          synthetic_event_count: 100000,
          metadata,
          trigrams,
          bytes,
          cases,
          cache_note:
            "first query follows bulk insertion; buffers are not OS-cold",
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        synthetic_event_count: 100000,
        metadata,
        bytes,
        cases: cases.map(({ label, warm_p50_ms, warm_p95_ms }: any) => ({
          label,
          warm_p50_ms,
          warm_p95_ms,
        })),
      }),
    );
  } finally {
    await pool.end();
  }
});
