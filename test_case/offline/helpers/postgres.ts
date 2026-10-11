import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { Client } from "pg";

const prefix = "secretary_test_";
const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';

function connectionURL(dsn: string): URL {
  try {
    const url = new URL(dsn);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    return url;
  } catch {
    // URL parser errors otherwise include the supplied URL, possibly with credentials.
    throw new Error("Invalid SECRETARY_TEST_DATABASE_URL");
  }
}

export function testDatabaseURL(): string | undefined {
  const dsn = process.env.SECRETARY_TEST_DATABASE_URL;
  if (!dsn && process.env.CI && !["false", "0"].includes(process.env.CI)) {
    throw new Error(
      "CI requires SECRETARY_TEST_DATABASE_URL for PostgreSQL tests",
    );
  }
  return dsn;
}

export async function withTestDatabase<T>(
  dsn: string,
  run: (databaseURL: string) => Promise<T>,
): Promise<T> {
  const name = prefix + randomUUID().replaceAll("-", "");
  const url = connectionURL(dsn);
  url.pathname = "/" + name;
  // The per-scenario database must also override a pg connection query option.
  url.searchParams.delete("database");
  const admin = new Client({
    connectionString: dsn,
    connectionTimeoutMillis: 5000,
  });
  const lease = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  let created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${identifier(name)} TEMPLATE template0`);
    created = true;
    // Keep the scenario visibly active even between App.close() and reopen.
    await lease.connect();
    return await run(url.toString());
  } finally {
    try {
      await lease.end();
      // Only this invocation's newly created database; never the supplied DSN.
      if (created)
        await admin.query(`DROP DATABASE ${identifier(name)} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}

export function testPostgres(
  name: string,
  run: (databaseURL: string, context: TestContext) => Promise<void>,
): void {
  const dsn = testDatabaseURL();
  test(
    name,
    { skip: dsn ? false : "requires SECRETARY_TEST_DATABASE_URL" },
    async (t) => {
      await withTestDatabase(dsn!, (databaseURL) => run(databaseURL, t));
    },
  );
}

export async function cleanTestDatabases(
  dsn: string,
  apply = false,
): Promise<{ name: string; status: "candidate" | "deleted" | "busy" }[]> {
  connectionURL(dsn);
  const admin = new Client({
    connectionString: dsn,
    connectionTimeoutMillis: 5000,
  });
  try {
    await admin.connect();
    const { rows } = await admin.query<{ name: string; busy: boolean }>(
      `SELECT d.datname AS name,
              EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datid = d.oid) AS busy
         FROM pg_database d
        WHERE left(d.datname, length($1)) = $1
          AND d.datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user)
          AND NOT d.datistemplate AND d.datname <> current_database()
        ORDER BY d.datname`,
      [prefix],
    );
    const result: { name: string; status: "candidate" | "deleted" | "busy" }[] =
      [];
    for (const row of rows) {
      if (row.busy || !apply) {
        result.push({
          name: row.name,
          status: row.busy ? "busy" : "candidate",
        });
        continue;
      }
      try {
        // No FORCE: a connection that arrived after the query also prevents deletion.
        await admin.query(`DROP DATABASE ${identifier(row.name)}`);
        result.push({ name: row.name, status: "deleted" });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "55006") result.push({ name: row.name, status: "busy" });
        else if (code !== "3D000") throw error;
      }
    }
    return result;
  } finally {
    await admin.end();
  }
}
