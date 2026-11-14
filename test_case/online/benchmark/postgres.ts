import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import {
  binary,
  cleanEnvironment,
  mkdir,
  noLinks,
  read,
  requireThat,
} from "./io.ts";

export type Database = {
  directory: string;
  port: number;
  adminPassword: string;
  password: string;
  systemID?: string;
  databaseOID?: string;
  ownerOID?: string;
};
export function pgBinary(name: string) {
  const dir =
    process.platform === "linux" &&
    fs.existsSync("/usr/lib/postgresql/18/bin/postgres")
      ? "/usr/lib/postgresql/18/bin"
      : execFileSync(binary("pg_config"), ["--bindir"], {
          encoding: "utf8",
          env: cleanEnvironment("/tmp"),
        }).trim();
  const p = fs.realpathSync(path.join(dir, name));
  const version = execFileSync(p, ["--version"], {
    encoding: "utf8",
    env: cleanEnvironment("/tmp"),
  });
  requireThat(/PostgreSQL\) 18\./.test(version), "POSTGRES_18_REQUIRED");
  return p;
}
export async function newDatabase(directory: string): Promise<Database> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  return {
    directory,
    port,
    adminPassword: randomBytes(32).toString("hex"),
    password: randomBytes(32).toString("hex"),
  };
}
function env(db: Database) {
  return {
    ...cleanEnvironment(path.dirname(db.directory)),
    PGPASSFILE: path.join(path.dirname(db.directory), "no-pgpass"),
    PGSERVICEFILE: path.join(path.dirname(db.directory), "no-service"),
    PGSYSCONFDIR: path.dirname(db.directory),
    PGPASSWORD: db.adminPassword,
  };
}
function args(db: Database) {
  return [
    "--host=127.0.0.1",
    "--port=" + db.port,
    "--username=benchmark_admin",
    "--dbname=benchmark",
    "--no-password",
  ];
}
function execute(db: Database, name: string, argv: string[]) {
  try {
    return execFileSync(pgBinary(name), argv, {
      encoding: "utf8",
      env: env(db),
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fs.appendFileSync(
      path.join(path.dirname(db.directory), "pg-errors.log"),
      String((error as any).stderr ?? "PG command failed") + "\n",
      { mode: 0o600 },
    );
    throw Error("PG_COMMAND_FAILED_" + name);
  }
}
export function initializeDatabase(db: Database) {
  noLinks(db.directory);
  requireThat(!fs.existsSync(db.directory), "PGDATA_EXISTS");
  mkdir(path.dirname(db.directory));
  const passwordFile = path.join(path.dirname(db.directory), "init-password");
  fs.writeFileSync(passwordFile, db.adminPassword, { mode: 0o600, flag: "wx" });
  try {
    execute(db, "initdb", [
      "-D",
      db.directory,
      "-U",
      "benchmark_admin",
      "--auth=scram-sha-256",
      "--pwfile=" + passwordFile,
      "--locale=C",
      "--encoding=UTF8",
    ]);
  } finally {
    fs.unlinkSync(passwordFile);
  }
  fs.appendFileSync(
    path.join(db.directory, "postgresql.conf"),
    `\nlisten_addresses='127.0.0.1'\nport=${db.port}\nunix_socket_directories=''\nmax_connections=20\nshared_buffers='16MB'\n`,
  );
  db.systemID = controlID(db);
}
export function controlID(db: Database) {
  noLinks(db.directory);
  const output = execute(db, "pg_controldata", [db.directory]);
  const id = output.match(/Database system identifier:\s+(\d+)/)?.[1];
  requireThat(id, "NO_PG_SYSTEM_ID");
  return id;
}
export function pgRunning(db: Database) {
  return fs.existsSync(path.join(db.directory, "postmaster.pid"));
}
export function startDatabase(db: Database) {
  requireThat(controlID(db) === db.systemID, "PG_OWNERSHIP_MISMATCH");
  requireThat(!pgRunning(db), "PG_ALREADY_RUNNING");
  execute(db, "pg_ctl", [
    "-D",
    db.directory,
    "-l",
    path.join(path.dirname(db.directory), "postgres.log"),
    "-w",
    "start",
  ]);
}
export function connection(
  db: Database,
  admin = false,
  database = "benchmark",
) {
  return {
    host: "127.0.0.1",
    port: db.port,
    user: admin ? "benchmark_admin" : "benchmark_core",
    password: admin ? db.adminPassword : db.password,
    database,
    connectionTimeoutMillis: 5000,
  };
}
export function coreDSN(db: Database) {
  return `postgresql://benchmark_core:${db.password}@127.0.0.1:${db.port}/benchmark`;
}
export async function query(
  db: Database,
  sql: string,
  params: unknown[] = [],
  database = "benchmark",
) {
  const client = new Client(connection(db, true, database));
  try {
    await client.connect();
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}
export async function createDatabase(db: Database) {
  // Password is generated hex, never supplied SQL; parameters cannot be used in DDL passwords.
  requireThat(/^[a-f0-9]{64}$/.test(db.password), "INVALID_GENERATED_PASSWORD");
  await query(
    db,
    `CREATE ROLE benchmark_core LOGIN PASSWORD '${db.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    [],
    "postgres",
  );
  await query(
    db,
    "CREATE DATABASE benchmark OWNER benchmark_core TEMPLATE template0",
    [],
    "postgres",
  );
  const row = (
    await query(
      db,
      "SELECT oid::text,datdba::text FROM pg_database WHERE datname='benchmark'",
    )
  )[0];
  db.databaseOID = row.oid;
  db.ownerOID = row.datdba;
}
async function verifyCluster(db: Database) {
  requireThat(controlID(db) === db.systemID, "PG_OWNERSHIP_MISMATCH");
  const row = (
    await query(
      db,
      "SELECT system_identifier::text, current_setting('data_directory') AS directory FROM pg_control_system()",
      [],
      "postgres",
    )
  )[0];
  requireThat(
    row.system_identifier === db.systemID && row.directory === db.directory,
    "PG_ENDPOINT_MISMATCH",
  );
  const databases = await query(
    db,
    "SELECT datname,oid::text,datdba::text,pg_get_userbyid(datdba) AS owner FROM pg_database",
    [],
    "postgres",
  );
  requireThat(
    databases.every((d) =>
      ["postgres", "template0", "template1", "benchmark"].includes(d.datname),
    ),
    "SHARED_CLUSTER",
  );
  return databases;
}
export async function verifyDatabase(db: Database) {
  const databases = await verifyCluster(db);
  const database = databases.find((d) => d.datname === "benchmark");
  requireThat(
    database?.oid === db.databaseOID &&
      database?.datdba === db.ownerOID &&
      database.owner === "benchmark_core",
    "DATABASE_OWNERSHIP_MISMATCH",
  );
}
export async function stopDatabase(db: Database) {
  if (!pgRunning(db)) {
    requireThat(controlID(db) === db.systemID, "PG_OWNERSHIP_MISMATCH");
    return;
  }
  if (db.databaseOID) await verifyDatabase(db);
  else await verifyCluster(db);
  execute(db, "pg_ctl", ["-D", db.directory, "-m", "fast", "-w", "stop"]);
  requireThat(!pgRunning(db), "PG_STOP_UNCONFIRMED");
}
export async function dumpDatabase(db: Database, file: string) {
  await verifyDatabase(db);
  requireThat(!fs.existsSync(file), "DUMP_EXISTS");
  execute(db, "pg_dump", [
    ...args(db),
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file=" + file,
  ]);
  execute(db, "pg_restore", ["--list", file]);
  fs.chmodSync(file, 0o600);
  read(file);
}
export async function restoreDatabase(db: Database, file: string) {
  await verifyDatabase(db);
  read(file);
  execute(db, "pg_restore", [
    ...args(db),
    "--no-owner",
    "--no-privileges",
    "--role=benchmark_core",
    "--exit-on-error",
    file,
  ]);
}
export async function indexEvidence(db: Database) {
  return {
    checkpoint: await query(
      db,
      "SELECT * FROM mem.checkpoint ORDER BY source_id",
    ),
    documents: await query(
      db,
      "SELECT source_id,event_id::text,log_sequence::text,xmin::text FROM mem.document ORDER BY source_id,event_id",
    ),
    chunks: await query(
      db,
      "SELECT source_id,event_id::text,chunk_index,xmin::text FROM mem.chunk ORDER BY source_id,event_id,chunk_index",
    ),
  };
}
