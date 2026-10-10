import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import {
  cleanTestDatabases,
  testPostgres,
  withTestDatabase,
} from "../helpers/postgres.ts";

test("PostgreSQL registration skips locally without DSN and fails in CI", () => {
  const source = `import { testPostgres } from ${JSON.stringify(new URL("../helpers/postgres.ts", import.meta.url).href)};
    testPostgres('synthetic PG registration', async () => { throw Error('must not run without DSN'); });`;
  const env = { ...process.env };
  delete env.SECRETARY_TEST_DATABASE_URL;
  for (const ci of ["", "true"]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", source],
      {
        env: { ...env, CI: ci },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, ci ? 1 : 0, result.stderr);
    assert.match(
      result.stdout + result.stderr,
      ci
        ? /CI requires SECRETARY_TEST_DATABASE_URL/
        : /requires SECRETARY_TEST_DATABASE_URL/,
    );
    assert.doesNotMatch(result.stdout + result.stderr, /Error: must not run/);
  }
});

testPostgres(
  "PostgreSQL helper isolates concurrent scenarios and cleans success and failure",
  async (dsn) => {
    const observer = new Client({ connectionString: dsn });
    await observer.connect();
    const databases: string[] = [];
    try {
      await Promise.all(
        [0, 1].map(() =>
          withTestDatabase(dsn, async (isolated) => {
            const client = new Client({ connectionString: isolated });
            await client.connect();
            try {
              const name = (
                await client.query("SELECT current_database() AS name")
              ).rows[0].name as string;
              databases.push(name);
              assert.notEqual(
                new URL(dsn).pathname,
                new URL(isolated).pathname,
              );
              await client.query(
                "CREATE TABLE isolation_proof (value integer)",
              );
              await client.query("INSERT INTO isolation_proof VALUES (1)");
              assert.equal(
                (
                  await client.query(
                    "SELECT count(*)::int AS n FROM isolation_proof",
                  )
                ).rows[0].n,
                1,
              );
              await client.end();
              // The helper's lease protects a live scenario during an application restart gap.
              const candidates = await cleanTestDatabases(dsn);
              assert.equal(
                candidates.find((row) => row.name === name)?.status,
                "busy",
              );
            } finally {
              await client.end();
            }
          }),
        ),
      );
      assert.equal(new Set(databases).size, 2);
      await assert.rejects(
        withTestDatabase(dsn, async (isolated) => {
          databases.push(new URL(isolated).pathname.slice(1));
          throw new Error("synthetic scenario failure");
        }),
        /synthetic scenario failure/,
      );
      const remaining = await observer.query(
        "SELECT datname FROM pg_database WHERE datname = ANY($1::text[])",
        [databases],
      );
      assert.equal(remaining.rowCount, 0);
      const current = (
        await observer.query("SELECT current_database() AS name")
      ).rows[0].name;
      assert(
        !(await cleanTestDatabases(dsn)).some((row) => row.name === current),
      );
    } finally {
      await observer.end();
    }
  },
);
