import { cleanTestDatabases } from "./postgres.ts";

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) {
    throw new Error("Usage: npm run test:db:clean -- [--apply]");
  }
  const dsn = process.env.SECRETARY_TEST_DATABASE_URL;
  if (!dsn)
    throw new Error(
      "Set SECRETARY_TEST_DATABASE_URL to a dedicated test PostgreSQL",
    );
  for (const row of await cleanTestDatabases(dsn, args.includes("--apply"))) {
    console.log(`${row.status}: ${row.name}`);
  }
} catch {
  // Connection errors can contain user-supplied connection details.
  console.error(
    "Test database cleanup failed. Check the dedicated test DSN, role and arguments (--apply only).",
  );
  process.exitCode = 1;
}
