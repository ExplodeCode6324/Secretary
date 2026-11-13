#!/usr/bin/env node
/** macOS operator tool. No module-level runtime imports or implicit instance discovery. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import {
  args,
  fail,
  rootPath,
  safePath,
  inside,
  readJSON,
  readFile,
  privateJSON,
  sha,
  stamp,
} from "./io.mjs";
import {
  tree,
  digestFile,
  copyTree,
  verifyFiles,
  verifyMetadata,
  assertSourceLinks,
} from "./capture-files.mjs";
import { captureFlow } from "./capture-state.mjs";
import {
  assertIdle,
  classify,
  requireFresh,
  sameIdentity,
  startupCanMutate,
  assertNoFrozenWriters,
} from "./capture-guards.mjs";
import {
  command,
  environment,
  holdLocks,
  processes,
  descendants,
  wait,
} from "./process.mjs";
import { journalPrefix } from "./journal-prefix.mjs";
import { restoreUndeliveredStop } from "./recovery.mjs";
import { publishCapture } from "./publish.mjs";
import { readSnapshot } from "./snapshot-reader.mjs";
const toolRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const NODE = "/opt/homebrew/opt/node@22/bin/node",
  PYTHON = "/usr/bin/python3";
const iso = () => new Date().toISOString();
const privateStat = (f) => {
  const s = fs.lstatSync(f);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid() ||
    s.mode & 0o077
  )
    fail("UNSAFE_PRIVATE_FILE");
  return s;
};
function endpoint(root) {
  const f = safePath(root, "data/core/core-endpoint.json");
  privateStat(f);
  const e = readJSON(f);
  if (
    e.api_version !== "1" ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(e.url) ||
    !/^[a-f0-9]{64}$/.test(e.token)
  )
    fail("INVALID_ENDPOINT");
  return e;
}
async function query(e, route) {
  const r = await fetch(e.url + "/api/v1/" + route, {
    headers: {
      Authorization: "Bearer " + e.token,
      "X-Secretary-API-Version": "1",
    },
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!r.ok) fail("QUIESCENCE_QUERY_FAILED");
  let size = 0,
    chunks = [];
  for await (const b of r.body) {
    size += b.length;
    if (size > 1024 ** 2) fail("QUIESCENCE_RESPONSE_LIMIT");
    chunks.push(b);
  }
  const result = JSON.parse(Buffer.concat(chunks));
  if (!Object.hasOwn(result, "data")) fail("INVALID_API_RESPONSE");
  return result.data;
}
async function gate(root) {
  const e = endpoint(root),
    g = { at: iso() };
  const end = Date.now() + 30000;
  for (const r of ["core", "session", "settings", "memory"])
    g[r] = await query(e, r);
  if (
    g.core.instance_id !== e.instance_id ||
    g.core.data_domain_id !== e.data_domain_id
  )
    fail("ENDPOINT_IDENTITY_MISMATCH");
  for (const r of ["tasks", "wakeups", "push-dispatches", "scopes"]) {
    g[r] = [];
    let cursor = null,
      version = null;
    const seen = new Set();
    for (let page = 0; page < 10; page++) {
      if (Date.now() > end) fail("QUIESCENCE_TIME_LIMIT");
      const v = await query(
        e,
        r +
          "?limit=100" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      if (
        !Array.isArray(v.items) ||
        !Object.hasOwn(v, "next_cursor") ||
        (version !== null && v.version !== version)
      )
        fail("INCOMPLETE_QUIESCENCE");
      version = v.version;
      g[r].push(...v.items);
      cursor = v.next_cursor;
      if (cursor === null) break;
      if (typeof cursor !== "string" || seen.has(cursor))
        fail("INCOMPLETE_QUIESCENCE");
      seen.add(cursor);
    }
    if (cursor !== null) fail("QUIESCENCE_PAGE_LIMIT");
  }
  assertIdle(g);
  return g;
}
async function coreProcesses(root) {
  const e = endpoint(root),
    port = new URL(e.url).port;
  const ids = (
    await command("/usr/sbin/lsof", [
      "-t",
      "-nP",
      "-iTCP:" + port,
      "-sTCP:LISTEN",
    ])
  )
    .trim()
    .split(/\s+/)
    .map(Number);
  const rows = await processes();
  if (ids.length !== 1) fail("UNKNOWN_CORE_LISTENER");
  const core = rows.find((p) => p.pid === ids[0]);
  if (
    !core?.command.includes(path.join(root, "src/pi_secretary/src/backend.ts"))
  )
    fail("UNKNOWN_CORE_PROCESS");
  return descendants(rows, core.pid);
}
function inventory(root, file) {
  const v = readJSON(file),
    entries = {};
  for (const r of ["data", ".local"])
    entries[r] = fs.readdirSync(safePath(root, r)).sort();
  const expected = structuredClone(v);
  if (entries[".local"].includes("maintenance.json"))
    expected[".local"]["maintenance.json"] = "frozen";
  classify(entries, expected);
  return expected;
}
async function checkProcesses(root, markerTime) {
  const rows = await processes();
  for (const p of rows) {
    if (p.pid === process.pid || p.command.includes("capture.mjs")) continue;
    if (
      p.command.includes(root) &&
      /agile\.mjs tui|tui-cli|TerminalApp/.test(p.command)
    )
      fail("TUI_STILL_OPEN");
    const startup =
      p.command.includes(root) &&
      startupCanMutate(p.command, p.started, markerTime);
    if (startup) fail("STARTUP_IN_FLIGHT");
  }
  // Relative command lines require cwd evidence, rather than substring guesses.
  for (const p of rows.filter(
    (p) =>
      p.pid !== process.pid &&
      /node|tsx|npm/.test(p.command) &&
      /agile\.mjs|start-live\.ts|core-cli\.ts|backend\.ts|tui-cli|npm (?:run )?start/.test(
        p.command,
      ),
  )) {
    let cwd;
    try {
      cwd = await command("/usr/sbin/lsof", [
        "-a",
        "-p",
        String(p.pid),
        "-d",
        "cwd",
        "-Fn",
      ]);
    } catch {
      continue;
    }
    if (!cwd.split("\n").includes("n" + root)) continue;
    if (/agile\.mjs tui|tui-cli/.test(p.command)) fail("TUI_STILL_OPEN");
    if (startupCanMutate(p.command, p.started, markerTime))
      fail("STARTUP_IN_FLIGHT");
  }
}

export function pgEnvironment(dsn) {
  const u = new URL(dsn);
  if (!["postgresql:", "postgres:"].includes(u.protocol))
    fail("INVALID_PG_DSN");
  const allowed = new Set(["host", "port", "user", "password", "dbname"]);
  if ([...u.searchParams.keys()].some((k) => !allowed.has(k)))
    fail("UNSUPPORTED_PG_DSN_OPTIONS");
  return Object.fromEntries(
    [
      ["PGHOST", u.searchParams.get("host") ?? u.hostname],
      ["PGPORT", u.searchParams.get("port") ?? u.port],
      ["PGUSER", u.searchParams.get("user") ?? decodeURIComponent(u.username)],
      [
        "PGPASSWORD",
        u.searchParams.get("password") ?? decodeURIComponent(u.password),
      ],
      [
        "PGDATABASE",
        u.searchParams.get("dbname") ?? decodeURIComponent(u.pathname.slice(1)),
      ],
    ].filter(([, v]) => v),
  );
}

async function stopCommandsRunning(root) {
  for (const p of await processes())
    if (
      p.pid !== process.pid &&
      /agile\.mjs stop|core-cli\.ts(?:\s+\S+)*\s+stop(?:\s|$)/.test(p.command)
    ) {
      if (p.command.includes(root)) return true;
      try {
        if (
          (
            await command("/usr/sbin/lsof", [
              "-a",
              "-p",
              String(p.pid),
              "-d",
              "cwd",
              "-Fn",
            ])
          )
            .split("\n")
            .includes("n" + root)
        )
          return true;
      } catch {
        if (
          (await processes()).some(
            (x) => x.pid === p.pid && x.started === p.started,
          )
        )
          fail("STOP_PROCESS_CWD_UNKNOWN");
      }
    }
  return false;
}
async function database(root, fn) {
  const runtimeFile = safePath(root, ".local/runtime.json");
  privateStat(runtimeFile);
  const runtime = readJSON(runtimeFile);
  if (
    rootPath(runtime.local_postgres_data) !== path.join(root, "data/postgres")
  )
    fail("WRONG_PG_ROOT");
  const { Client } = await import("pg");
  const db = new Client({
    connectionString: runtime.database_url,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    application_name: "secretary-agile005-readonly",
  });
  await db.connect();
  try {
    await db.query("BEGIN READ ONLY");
    return await fn(db, runtime);
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    await db.end();
  }
}
async function pgInfo(root) {
  return database(root, async (db) => {
    const row = (
      await db.query(
        "SELECT current_setting('data_directory') AS data_directory,current_setting('server_version_num') AS version_num,current_setting('config_file') AS config_file,current_setting('hba_file') AS hba_file,current_setting('ident_file') AS ident_file",
      )
    ).rows[0];
    if (rootPath(row.data_directory) !== path.join(root, "data/postgres"))
      fail("WRONG_PG_ROOT");
    const pid = Number(
      readFile(path.join(row.data_directory, "postmaster.pid"))
        .toString()
        .split("\n")[0],
    );
    const p = (await processes()).find((p) => p.pid === pid);
    if (!p || !p.command.includes("postgres")) fail("PG_PROCESS_MISSING");
    const lsof = await command("/usr/sbin/lsof", [
      "-a",
      "-p",
      String(pid),
      "-d",
      "txt",
      "-Fn",
    ]);
    const binary = lsof
      .split("\n")
      .filter((l) => l.startsWith("n") && l.endsWith("/postgres"))
      .map((l) => l.slice(1))[0];
    if (!binary || !binary.startsWith("/opt/homebrew/Cellar/postgresql@"))
      fail("UNSUPPORTED_PG_BINARY");
    const bin = path.dirname(binary),
      dumpVersion = await command(path.join(bin, "pg_dump"), ["--version"]);
    if (
      Number(dumpVersion.match(/(\d+)\./)?.[1]) !==
      Math.floor(Number(row.version_num) / 10000)
    )
      fail("PG_VERSION_MISMATCH");
    return { ...row, pid, process: p, bin, dump_version: dumpVersion.trim() };
  });
}
function outside(root, value) {
  const p = path.resolve(value);
  if (inside(p, root) || inside(root, p)) fail("CAPTURE_PATH_OVERLAP");
  return p;
}
function markerIdentity(file) {
  return { stat: stamp(privateStat(file)), sha256: sha(readFile(file)) };
}
function sameMarker(s) {
  return (
    s.marker &&
    fs.existsSync(s.marker_path) &&
    JSON.stringify(markerIdentity(s.marker_path)) === JSON.stringify(s.marker)
  );
}
function journalInfo(file) {
  const b = readFile(file),
    lines = b.toString().split("\n");
  if (lines.pop() !== "") fail("TRUNCATED_JOURNAL");
  const last = JSON.parse(lines.at(-1)),
    tx = JSON.parse(Buffer.from(last.payload_b64, "base64"));
  return {
    sha256: sha(b),
    bytes: b.length,
    sequence: tx.sequence,
    digest: last.sha256,
  };
}
export function lockPaths(root, domain) {
  const result = [safePath(root, "data/core/owner.lock")],
    tui = safePath(root, "data/tui");
  for (const d of fs.readdirSync(tui)) {
    if (d === ".DS_Store" && fs.lstatSync(safePath(tui, d)).isFile()) continue;
    if (d !== domain || !fs.lstatSync(safePath(tui, d)).isDirectory())
      fail("UNKNOWN_TUI_DOMAIN");
    for (const mode of fs.readdirSync(safePath(tui, d))) {
      if (
        mode === ".DS_Store" &&
        fs.lstatSync(safePath(tui, path.join(d, mode))).isFile()
      )
        continue;
      if (mode !== "live") fail("UNKNOWN_TUI_DOMAIN");
      result.push(safePath(tui, path.join(d, mode, "state.lock")));
    }
  }
  result.forEach(privateStat);
  return result;
}
async function preflight(root, inventoryFile, destination, expectedToolSha) {
  if (process.platform !== "darwin") fail("MACOS_ONLY");
  root = rootPath(root);
  outside(root, destination);
  if (fs.existsSync(path.join(root, ".local/maintenance.json")))
    fail("EXISTING_MAINTENANCE");
  await reviewedTool(expectedToolSha);
  const inv = inventory(root, inventoryFile);
  for (const [r, names] of Object.entries(inv)) {
    for (const [name, kind] of Object.entries(names)) {
      const f = safePath(root, path.join(r, name));
      if (kind === "operational") {
        const st = fs.statSync(f);
        if (!st.isFile() || st.size > 64 * 1024 ** 2)
          fail("OPERATIONAL_FILE_LIMIT");
      }
    }
    const frozen = tree(
      path.join(root, r),
      Object.entries(names)
        .filter(([, k]) => k !== "frozen")
        .map(([n]) => n),
    );
    if (Object.values(frozen).some((v) => v.kind === "symlink"))
      fail("UNMAPPED_SYMLINK");
  }
  await checkProcesses(root);
  const g = await gate(root),
    pg = await pgInfo(root),
    owners = await coreProcesses(root);
  lockPaths(root, g.core.data_domain_id);
  await command("/usr/sbin/lsof", ["-nP", "-F", "pfan"], {
    max: 32 * 1024 ** 2,
  });
  await database(root, async (db) => {
    for (const table of [
      "pg_file_settings",
      "pg_hba_file_rules",
      "pg_ident_file_mappings",
    ])
      await db.query("SELECT * FROM " + table + " LIMIT 1");
    await db.query("SELECT rolname, rolpassword FROM pg_authid LIMIT 1");
  });
  const probe = fs.mkdtempSync(
    path.join(path.dirname(destination), ".preflight-probe-"),
  );
  const seal = path.join(probe, "seal");
  try {
    fs.writeFileSync(seal, "synthetic", { mode: 0o600 });
    await command("/usr/bin/chflags", ["uchg", seal]);
    if (!(await command("/usr/bin/stat", ["-f", "%Sf", seal])).includes("uchg"))
      fail("BACKUP_SEAL_FAILED");
    fs.mkdirSync(path.join(probe, "objects"));
    await command(
      NODE,
      [
        "--import",
        "tsx",
        path.join(toolRoot, "src/pi_secretary/scripts/verify-cas.ts"),
        probe,
      ],
      { cwd: toolRoot },
    );
  } finally {
    await command("/usr/bin/chflags", ["nouchg", seal]);
    fs.rmSync(probe, { recursive: true });
  }
  const source = await command(
    "/usr/bin/git",
    ["--no-optional-locks", "rev-parse", "HEAD"],
    { cwd: root },
  );
  const s = {
    format: "secretary-agile-preflight-v1",
    capture_id: randomUUID(),
    at: iso(),
    root,
    inventory: readJSON(inventoryFile),
    inventory_sha: sha(readFile(inventoryFile)),
    gate: g,
    pg,
    owners,
    source_sha: source.trim(),
    tool_sha: expectedToolSha,
    node: fs.realpathSync(NODE),
  };
  privateJSON(destination, s);
  return s;
}
async function adapter(s, save) {
  const root = s.root,
    backup = s.backup,
    control = path.dirname(s.state_path);
  let locks;
  const check = () => {
    if (s.signal) fail("CAPTURE_SIGNAL");
    if (s.deadline && Date.now() > s.deadline) fail("CAPTURE_DEADLINE");
  };
  const marker = path.join(root, ".local/maintenance.json");
  const markerCheck = () => {
    if (!sameMarker(s)) fail("FOREIGN_MAINTENANCE_MARKER");
  };
  const savePrivate = (name, value) =>
    privateJSON(path.join(control, name), value, { max: 64 * 1024 ** 2 });
  const aliveOwners = async () => {
    const rows = await processes();
    return s.owners.some((old) =>
      rows.some((p) => p.pid === old.pid && p.started === old.started),
    );
  };
  const noWriters = async () => {
    const inv = inventory(root, s.inventory_path);
    const roots = Object.entries(inv).flatMap(([r, names]) =>
      Object.entries(names)
        .filter(([, k]) => k === "frozen")
        .map(([n]) => path.join(root, r, n)),
    );
    assertNoFrozenWriters(
      await command("/usr/sbin/lsof", ["-nP", "-F", "pfan"], {
        max: 32 * 1024 ** 2,
      }),
      roots,
    );
  };
  const noClients = async () =>
    database(root, async (db) => {
      if (
        (
          await db.query(
            "SELECT pid FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()",
          )
        ).rows.length
      )
        fail("UNEXPECTED_PG_CLIENT");
    });
  return {
    async prepare() {
      requireFresh(s.preflight);
      if (fs.realpathSync(NODE) !== s.preflight.node)
        fail("NODE_BINARY_CHANGED");
      if (fs.existsSync(marker)) fail("EXISTING_MAINTENANCE");
      if (
        (
          await command(
            "/usr/bin/git",
            ["--no-optional-locks", "rev-parse", "HEAD"],
            { cwd: root },
          )
        ).trim() !== s.preflight.source_sha
      )
        fail("SOURCE_CHANGED");
      inventory(root, s.inventory_path);
      await checkProcesses(root);
      sameIdentity(s.preflight.gate.core, await query(endpoint(root), "core"));
      s.owners = await coreProcesses(root);
      s.pg = await pgInfo(root);
      if (s.pg.pid !== s.preflight.pg.pid || s.pg.bin !== s.preflight.pg.bin)
        fail("PG_CHANGED");
      if (!fs.lstatSync(path.join(root, ".git")).isDirectory())
        fail("LINKED_INSTANCE_GIT_UNSUPPORTED");
      const t = tree(root, ["data", ".local"]);
      assertSourceLinks(root, t);
      const hashes = {};
      for (const [rel, v] of Object.entries(t)) {
        check();
        if (v.kind === "file")
          hashes[rel] = {
            sha256: await digestFile(path.join(root, rel)),
            bytes: v.stat[3],
            mode: v.stat[2] & 0o777,
          };
      }
      privateJSON(
        path.join(backup, "source-files.json"),
        { tree: t, files: hashes },
        { max: 64 * 1024 ** 2 },
      );
      await command(
        "/usr/bin/tar",
        [
          "--exclude=./data",
          "--exclude=./.local",
          "-cf",
          path.join(backup, "source.tar"),
          "-C",
          root,
          ".",
        ],
        { timeout: 120000, env: { ...environment(), COPYFILE_DISABLE: "1" } },
      );
      if (JSON.stringify(t) !== JSON.stringify(tree(root, ["data", ".local"])))
        fail("SOURCE_CHANGED");
      s.source_tree = t;
      s.source_archive_sha = await digestFile(path.join(backup, "source.tar"));
      const schema = readFile(
        safePath(root, "src/contracts/contracts.schema.json"),
      );
      fs.writeFileSync(path.join(backup, "contracts.schema.json"), schema, {
        flag: "wx",
        mode: 0o600,
      });
      s.schema_sha = sha(schema);
      const policy = readFile(
        safePath(root, "src/pi_secretary/src/memory-search.ts"),
      )
        .toString()
        .match(/export const SEARCH_POLICY = (\d+);/);
      if (!policy) fail("UNKNOWN_SEARCH_POLICY");
      s.search_policy = Number(policy[1]);
      requireFresh(s.preflight);
      check();
    },
    async holdMaintenance() {
      s.marker_path = marker;
      s.marker_payload = {
        capture_id: s.capture_id,
        since: iso(),
        reason: "agile005 coordinated capture",
      };
      s.marker_intent_sha = sha(
        JSON.stringify(s.marker_payload, null, 2) + "\n",
      );
      await save();
      privateJSON(marker, s.marker_payload);
      s.marker = markerIdentity(marker);
      s.marker_created_ms = Date.now();
    },
    async settle() {
      let quietSince = Date.now();
      const end = Date.now() + 90000;
      while (Date.now() - quietSince < 35000) {
        check();
        markerCheck();
        if (Date.now() > end) fail("STARTUP_SETTLE_TIMEOUT");
        try {
          await checkProcesses(root, s.marker_created_ms);
        } catch (e) {
          if (e.message === "STARTUP_IN_FLIGHT") quietSince = Date.now();
          else throw e;
        }
        await wait(1000);
      }
    },
    async quiescence() {
      check();
      markerCheck();
      const g = await gate(root);
      sameIdentity(s.preflight.gate.core, g.core);
      savePrivate("final-quiescence.json", g);
      inventory(root, s.inventory_path);
      await checkProcesses(root, s.marker_created_ms);
      if (
        JSON.stringify(s.source_tree) !==
        JSON.stringify(tree(root, ["data", ".local"]))
      )
        fail("SOURCE_CHANGED");
      s.final_gate_at = g.at;
      s.pre_stop_journal = journalInfo(
        path.join(root, "data/core/journal.jsonl"),
      );
      s.owners = await coreProcesses(root);
      await save();
    },
    async stopAndLock() {
      markerCheck();
      check();
      s.deadline = Date.now() + 180000;
      s.stop_invoked = true;
      s.stop_command_outcome = "IN_PROGRESS";
      s.stop_marker_inode = fs.statSync(marker).ino;
      await save();
      // The existing stop command rewrites the same marker inode. Persist intent before invoking it.
      let stopError;
      try {
        await command(NODE, ["--import", "tsx", "scripts/agile.mjs", "stop"], {
          cwd: root,
          timeout: 30000,
          output: path.join(control, "stop.log"),
        });
      } catch (e) {
        stopError = e;
      }
      s.stop_command_outcome = stopError ? "FAILED" : "SUCCEEDED";
      await save();
      if (sameMarker(s) && sha(readFile(marker)) === s.marker_intent_sha) {
        if (stopError) throw stopError;
        fail("STOP_DID_NOT_REWRITE_MARKER");
      }
      const m = readJSON(marker);
      if (
        fs.statSync(marker).ino !== s.stop_marker_inode ||
        m.reason !== "agile maintenance" ||
        !Number.isFinite(Date.parse(m.since)) ||
        Date.parse(m.since) < Date.parse(s.stop_requested_at)
      )
        fail("FOREIGN_STOP_MARKER");
      s.marker = markerIdentity(marker);
      s.stop_marker_adopted = true;
      await save();
      if (stopError) throw stopError;
      while (await aliveOwners()) {
        check();
        markerCheck();
        await wait(200);
      }
      if (fs.existsSync(path.join(root, "data/core/core-endpoint.json")))
        fail("ENDPOINT_REMAINS");
      if (stopError) throw stopError;
      locks = await holdLocks(
        PYTHON,
        lockPaths(root, s.preflight.gate.core.data_domain_id),
      );
      locks.assertHeld();
      s.lock_identities = locks.identities;
      s.writer_locks = true;
      s.stopped_at = iso();
      await save();
      await noClients();
      await noWriters();
    },
    async exportDatabase() {
      check();
      markerCheck();
      if (!locks?.alive()) fail("WRITER_LOCK_LOST");
      locks.assertHeld();
      await noClients();
      const p = await pgInfo(root);
      if (p.pid !== s.pg.pid || p.bin !== s.pg.bin) fail("PG_CHANGED");
      await database(root, async (db, runtime) => {
        const cp = await db.query(
          "SELECT to_regclass('mem.checkpoint') AS name",
        );
        const rows = cp.rows[0].name
          ? (await db.query("SELECT * FROM mem.checkpoint LIMIT 2")).rows
          : [];
        if (rows.length > 1) fail("AMBIGUOUS_CHECKPOINT");
        s.search_checkpoint = {
          availability: rows.length ? "captured" : "absent",
          observed_at: iso(),
          row: rows[0] ?? null,
        };
        const configs = new Set([
          p.config_file,
          p.hba_file,
          p.ident_file,
          ...(
            await db.query(
              "SELECT DISTINCT sourcefile FROM pg_file_settings WHERE sourcefile IS NOT NULL",
            )
          ).rows.map((r) => r.sourcefile),
        ]);
        configs.add(path.join(p.data_directory, "postgresql.auto.conf"));
        configs.add(path.join(p.data_directory, "PG_VERSION"));
        for (const table of ["pg_hba_file_rules", "pg_ident_file_mappings"])
          for (const row of (
            await db.query("SELECT DISTINCT file_name FROM " + table)
          ).rows)
            if (row.file_name) configs.add(row.file_name);
        s.pg_configs = [];
        fs.mkdirSync(path.join(backup, "postgres"), { mode: 0o700 });
        for (const [i, f] of [...configs].entries()) {
          const b = readFile(rootPath(f));
          fs.writeFileSync(path.join(backup, "postgres", `config-${i}`), b, {
            flag: "wx",
            mode: 0o600,
          });
          s.pg_configs.push({
            source: f,
            file: `postgres/config-${i}`,
            sha256: sha(b),
            bytes: b.length,
          });
        }
        const env = {
          ...environment(),
          ...pgEnvironment(runtime.database_url),
          PGCONNECT_TIMEOUT: "5",
          PGAPPNAME: "secretary-agile005-export",
        };
        await command(
          path.join(p.bin, "pg_dump"),
          [
            "--format=custom",
            "--file=" + path.join(backup, "postgres/database.dump"),
          ],
          { env, timeout: Math.max(1000, s.deadline - Date.now()) },
        );
        check();
        await command(path.join(p.bin, "pg_dumpall"), ["--globals-only"], {
          env,
          output: path.join(backup, "postgres/globals.sql"),
          timeout: Math.max(1000, s.deadline - Date.now()),
        });
      });
      await noClients();
      s.exported_at = iso();
    },
    async copyAndSeal() {
      check();
      markerCheck();
      if (!locks?.alive()) fail("WRITER_LOCK_LOST");
      locks.assertHeld();
      await checkProcesses(root, s.marker_created_ms);
      await noClients();
      const inv = inventory(root, s.inventory_path),
        copies = {},
        operations = [];
      fs.mkdirSync(path.join(backup, "instance"), { mode: 0o700 });
      fs.mkdirSync(path.join(backup, "operational"), { mode: 0o700 });
      for (const r of ["data", ".local"]) {
        const exclude = Object.entries(inv[r])
          .filter(([, kind]) => kind !== "frozen")
          .map(([name]) => name);
        copies[r] = await copyTree(
          path.join(root, r),
          path.join(backup, "instance", r),
          { exclude, deadline: s.deadline },
        );
        for (const [name, kind] of Object.entries(inv[r]))
          if (kind === "operational") {
            const f = safePath(root, path.join(r, name)),
              st = fs.statSync(f);
            if (!st.isFile() || st.size > 64 * 1024 ** 2)
              fail("OPERATIONAL_FILE_LIMIT");
            const target = `${r === "data" ? "data" : "local"}-${name}`,
              before = iso();
            fs.copyFileSync(
              f,
              path.join(backup, "operational", target),
              fs.constants.COPYFILE_EXCL,
            );
            operations.push({
              source: path.join(r, name),
              file: target,
              before,
              after: iso(),
              atomic: false,
            });
          }
      }
      check();
      const sealed = path.join(backup, "instance/.local/maintenance.json");
      await command("/usr/bin/chflags", ["uchg", sealed]);
      const flags = await command("/usr/bin/stat", ["-f", "%Sf", sealed]);
      if (!flags.includes("uchg")) fail("BACKUP_SEAL_FAILED");
      s.seal = {
        file: "instance/.local/maintenance.json",
        flags: flags.trim(),
        sha256: await digestFile(sealed),
      };
      s.journal = journalInfo(
        path.join(backup, "instance/data/core/journal.jsonl"),
      );
      s.as_of = iso();
      if (
        JSON.stringify(s.source_tree) !==
        JSON.stringify(tree(root, ["data", ".local"]))
      )
        fail("SOURCE_CHANGED");
      privateJSON(path.join(backup, "captured-files.json"), copies, {
        max: 64 * 1024 ** 2,
      });
      const represented = [];
      for (const [r, entries] of Object.entries(inv))
        for (const [name, kind] of Object.entries(entries))
          if (kind === "socket_metadata") {
            const p = safePath(root, path.join(r, name));
            represented.push({
              source: path.join(r, name),
              kind,
              observed_at: iso(),
              root_stat: stamp(fs.lstatSync(p, { bigint: true })),
              entries: tree(p),
              atomic: false,
            });
          }
      const runtime = readJSON(path.join(root, ".local/runtime.json")),
        livePaths = [];
      function paths(v, key) {
        if (typeof v === "string" && path.isAbsolute(v))
          livePaths.push({ field: key, path: v });
        else if (v && typeof v === "object")
          for (const [k, x] of Object.entries(v)) paths(x, key + "." + k);
      }
      paths(runtime, "runtime");
      const pgEnv = pgEnvironment(runtime.database_url);
      if (pgEnv.PGHOST?.startsWith("/"))
        livePaths.push({
          field: "runtime.database_url.host",
          path: pgEnv.PGHOST,
        });
      privateJSON(path.join(backup, "representation-metadata.json"), {
        socket_metadata: represented,
        live_directed_paths: livePaths,
        scope:
          "active runtime configuration and separately listed PG config sources; historical evidence unchanged",
      });
      s.operational = operations;
      s.inventory = inv;
      await noClients();
      await noWriters();
      markerCheck();
      locks.assertHeld();
      check();
    },
    async recover() {
      if (locks) {
        await locks.release();
        locks = undefined;
      }
      s.writer_locks = false;
      if (!s.marker_path) return; // Preparation failed before maintenance intent.
      if (
        !s.marker &&
        fs.existsSync(marker) &&
        sha(readFile(marker)) === s.marker_intent_sha
      )
        s.marker = markerIdentity(marker);
      if (!s.marker && !fs.existsSync(marker)) return;
      // Recover the narrow stop-command rewrite window only with the recorded inode and timestamp.
      if (
        !sameMarker(s) &&
        s.stop_invoked &&
        !s.stop_marker_adopted &&
        fs.existsSync(marker)
      ) {
        const v = readJSON(marker),
          st = privateStat(marker);
        if (
          st.ino === s.stop_marker_inode &&
          v.reason === "agile maintenance" &&
          Date.parse(v.since) >= Date.parse(s.stop_requested_at)
        ) {
          s.marker = markerIdentity(marker);
          s.stop_marker_adopted = true;
          await save();
        }
      }
      if (s.recovered) {
        sameIdentity(
          s.preflight.gate.core,
          await query(endpoint(root), "core"),
          !!s.stop_invoked && s.stop_delivery !== "STOP_NOT_DELIVERED",
        );
        return;
      }
      if (!s.stop_invoked) {
        if (fs.existsSync(marker)) {
          markerCheck();
          fs.unlinkSync(marker);
        }
        sameIdentity(
          s.preflight.gate.core,
          await query(endpoint(root), "core"),
        );
        return;
      }
      if (
        await restoreUndeliveredStop(s, {
          stopCommandsRunning: () => stopCommandsRunning(root),
          originalCoreAlive: async () => {
            const original = s.owners.find((p) =>
              p.command.includes(
                path.join(root, "src/pi_secretary/src/backend.ts"),
              ),
            );
            if (!original) fail("ORIGINAL_CORE_UNKNOWN");
            return (await processes()).some(
              (p) => p.pid === original.pid && p.started === original.started,
            );
          },
          originalEndpointAnswers: async () => {
            try {
              const current = await query(endpoint(root), "core");
              return (
                current.instance_id === s.preflight.gate.core.instance_id &&
                current.data_domain_id === s.preflight.gate.core.data_domain_id
              );
            } catch {
              return false;
            }
          },
          marker: () => ({
            owned: sameMarker(s),
            original:
              fs.existsSync(marker) &&
              sha(readFile(marker)) === s.marker_intent_sha,
          }),
          removeOwnedMarker: () => {
            markerCheck();
            fs.unlinkSync(marker);
            const fd = fs.openSync(path.dirname(marker), "r");
            try {
              fs.fsyncSync(fd);
            } finally {
              fs.closeSync(fd);
            }
          },
        })
      )
        return;
      const end = Date.now() + 90000;
      while (await aliveOwners()) {
        if (Date.now() > end) fail("STOP_INCOMPLETE_NO_COMPETING_START");
        await wait(500);
      }
      if (fs.existsSync(marker)) markerCheck();
      else if (!s.start_invoked) fail("MAINTENANCE_DISAPPEARED");
      const pg = await pgInfo(root);
      if (pg.pid !== s.pg.pid || pg.bin !== s.pg.bin)
        fail("PG_CHANGED_NO_START");
      // A crashed start may already have completed; do not launch another candidate blindly.
      let current;
      try {
        current = await query(endpoint(root), "core");
      } catch {}
      if (!current) {
        if (s.start_invoked) {
          await checkProcesses(root);
        }
        s.start_invoked = true;
        await save();
        await command(NODE, ["--import", "tsx", "scripts/agile.mjs", "start"], {
          cwd: root,
          timeout: Math.max(1000, end - Date.now()),
          output: path.join(control, "restart-" + Date.now() + ".log"),
        });
        current = await query(endpoint(root), "core");
      }
      sameIdentity(s.preflight.gate.core, current, true);
      if (fs.existsSync(marker)) fail("MAINTENANCE_REMAINS");
      const old = s.journal ?? journalInfoFromStop(s),
        file = path.join(root, "data/core/journal.jsonl");
      if (old) {
        const fd = fs.openSync(file, "r"),
          b = Buffer.alloc(old.bytes);
        try {
          if (
            fs.readSync(fd, b, 0, b.length, 0) !== b.length ||
            sha(b) !== old.sha256
          )
            fail("JOURNAL_PREFIX_CHANGED");
        } finally {
          fs.closeSync(fd);
        }
      }
      s.restarted_at = iso();
      s.restart_identity = current;
      savePrivate("restart-identity-" + randomUUID() + ".json", current);
    },
    async verify() {
      const file = path.join(root, "data/core/journal.jsonl");
      const changes = [];
      let transitionEvidence;
      try {
        const data = journalPrefix(file);
        let previous = s.pre_stop_journal.digest;
        for (const line of data
          .subarray(s.pre_stop_journal.bytes)
          .toString()
          .split("\n")
          .filter(Boolean)) {
          const frame = JSON.parse(line),
            payload = Buffer.from(frame.payload_b64, "base64"),
            tx = JSON.parse(payload);
          if (sha(payload) !== frame.sha256 || tx.previous_digest !== previous)
            fail("POST_RESTART_CHAIN_CHANGED");
          previous = frame.sha256;
          for (const m of tx.mutations)
            if (
              [
                "ModelCall",
                "Execution",
                "CompactionJob",
                "MemoryExtractionJob",
                "SettingsApplication",
              ].includes(m.object_type)
            ) {
              const bytes = readFile(
                safePath(root, path.join("data/core", m.snapshot.path)),
              );
              if (sha(bytes) !== m.snapshot.sha256)
                fail("POST_RESTART_CAS_CHANGED");
              const record = JSON.parse(bytes);
              if (["INTERRUPTED", "CANCELLED", "FAILED"].includes(record.state))
                changes.push({
                  type: record.record_type,
                  id: record.id,
                  state: record.state,
                  sequence: tx.sequence,
                  committed_at: tx.committed_at,
                });
            }
        }
        transitionEvidence = {
          status: "COMPLETE",
          from: s.final_gate_at,
          to: iso(),
          changes,
          causation:
            "Temporal association only; restart may resume retries; not a causality claim",
        };
      } catch (e) {
        transitionEvidence = {
          status: "INCOMPLETE",
          code: /^[A-Z_]+$/.test(e.message)
            ? e.message
            : "EVIDENCE_READ_FAILED",
          changes: [],
          service_recovered: s.recovered === true,
        };
      }
      savePrivate(
        "maintenance-transitions-" + randomUUID() + ".json",
        transitionEvidence,
      );
      for (const [r, v] of Object.entries(
        readJSON(path.join(backup, "captured-files.json"), 64 * 1024 ** 2),
      )) {
        await verifyFiles(path.join(backup, "instance", r), v.files);
        verifyMetadata(path.join(backup, "instance", r), v.before);
      }
      if (
        (await digestFile(path.join(backup, "source.tar"))) !==
        s.source_archive_sha
      )
        fail("SOURCE_ARCHIVE_CHANGED");
      await command(
        PYTHON,
        [
          path.join(toolRoot, "scripts/agile-diagnostics/verify-archive.py"),
          path.join(backup, "source.tar"),
          path.join(backup, "source-files.json"),
        ],
        { timeout: 120000 },
      );
      const list = await command(path.join(s.pg.bin, "pg_restore"), [
        "--list",
        path.join(backup, "postgres/database.dump"),
      ]);
      fs.writeFileSync(
        path.join(control, "restore-list-" + randomUUID() + ".txt"),
        list,
        {
          flag: "wx",
          mode: 0o600,
        },
      );
      await command(
        NODE,
        [
          "--import",
          "tsx",
          path.join(toolRoot, "src/pi_secretary/scripts/verify-cas.ts"),
          path.join(backup, "instance/data/core"),
        ],
        {
          cwd: toolRoot,
          timeout: 60000,
          output: path.join(control, "verify-cas-" + randomUUID() + ".log"),
        },
      );
      const artifacts = {};
      for (const rel of [
        "source.tar",
        "contracts.schema.json",
        "captured-files.json",
        "source-files.json",
        "representation-metadata.json",
        "postgres/database.dump",
        "postgres/globals.sql",
        ...s.pg_configs.map((c) => c.file),
      ])
        artifacts[rel] = {
          sha256: await digestFile(path.join(backup, rel)),
          bytes: fs.statSync(path.join(backup, rel)).size,
        };
      const manifest = {
        format: "secretary-agile-capture-v1",
        status: "CAPTURED",
        capture_id: s.capture_id,
        as_of: s.as_of,
        source_root: root,
        source_sha: s.preflight.source_sha,
        tool_sha: s.tool_sha,
        session_id: s.preflight.gate.core.session_id,
        data_domain_id: s.preflight.gate.core.data_domain_id,
        schema_sha256: s.schema_sha,
        journal: s.journal,
        search_policy: s.search_policy,
        search_checkpoint: s.search_checkpoint,
        postgres: s.pg,
        pg_configs: s.pg_configs,
        seal: s.seal,
        inventory: s.inventory,
        operational: s.operational,
        artifacts,
        stopped_at: s.stopped_at,
        restarted_at: s.restarted_at,
        restore: "NOT_TESTED",
        representation:
          "logical PostgreSQL; frozen Core/TUI/config; source archive; timestamped operational logs; sockets metadata only",
      };
      await publishCapture(backup, manifest, async () => {
        const snap = await readSnapshot(backup, {}, { allowValidating: true });
        savePrivate("static-reader-" + randomUUID() + ".json", snap.metrics());
      });
    },
  };
}
function journalInfoFromStop(s) {
  return s.pre_stop_journal ?? null;
}
async function reviewedTool(expected) {
  if (!/^[a-f0-9]{40}$/.test(expected ?? ""))
    fail("EXPECTED_TOOL_SHA_REQUIRED");
  const head = (
    await command(
      "/usr/bin/git",
      ["--no-optional-locks", "rev-parse", "HEAD"],
      { cwd: toolRoot },
    )
  ).trim();
  const dirty = (
    await command(
      "/usr/bin/git",
      ["--no-optional-locks", "status", "--porcelain"],
      { cwd: toolRoot },
    )
  ).trim();
  if (head !== expected || dirty) fail("UNREVIEWED_TOOL_TREE");
}
export async function main(argv) {
  process.umask(0o077);
  const o = args(argv, [
    "root",
    "inventory",
    "output",
    "preflight",
    "capture-id",
    "backup",
    "state",
    "expected-tool-sha",
  ]);
  if (o.command === "preflight") {
    if (!o.root || !o.inventory || !o.output) fail("PREFLIGHT_ARGUMENTS");
    const s = await preflight(
      o.root,
      o.inventory,
      o.output,
      o["expected-tool-sha"],
    );
    console.log(
      JSON.stringify({ status: "READY", capture_id: s.capture_id, at: s.at }),
    );
    return;
  }
  if (["recover", "verify"].includes(o.command)) {
    if (!o.state) fail("RECOVER_REQUIRES_STATE");
    const file = path.resolve(o.state);
    privateStat(file);
    const s = readJSON(file, 64 * 1024 ** 2);
    if (s.state_path !== file || !s.root || !s.preflight)
      fail("INVALID_RECOVERY_STATE");
    const guard = await holdLocks(PYTHON, [
      path.join(s.root, ".local/agile005/capture.lock"),
    ]);
    const save = () =>
      privateJSON(file, s, { replace: true, max: 64 * 1024 ** 2 });
    try {
      const a = await adapter(s, save);
      if (o.command === "verify") {
        await reviewedTool(s.tool_sha);
        if (!s.copied || !s.recovered) fail("VERIFY_REQUIRES_COPIED_RECOVERED");
        await a.verify();
        s.phase = "COMPLETE";
      } else {
        await a.recover();
        s.recovered = true;
        s.phase = "RECOVERED";
      }
      await save();
      console.log(JSON.stringify({ status: s.phase }));
    } finally {
      await guard.release();
    }
    return;
  }
  if (
    o.command !== "capture" ||
    !o.preflight ||
    !o["capture-id"] ||
    !o.backup ||
    !o.state ||
    !o.inventory
  )
    fail("CAPTURE_ARGUMENTS");
  const pre = readJSON(o.preflight),
    root = rootPath(pre.root);
  requireFresh(pre);
  await reviewedTool(o["expected-tool-sha"]);
  if (
    pre.tool_sha !== o["expected-tool-sha"] ||
    pre.capture_id !== o["capture-id"] ||
    pre.inventory_sha !== sha(readFile(o.inventory))
  )
    fail("PREFLIGHT_INTERLOCK");
  const backup = outside(root, o.backup),
    statePath = outside(root, o.state);
  if (inside(statePath, backup) || inside(backup, path.dirname(statePath)))
    fail("STATE_BACKUP_OVERLAP");
  const lockFile = path.join(root, ".local/agile005/capture.lock");
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(lockFile)) {
    const f = fs.openSync(lockFile, "wx", 0o600);
    fs.closeSync(f);
  }
  const guard = await holdLocks(PYTHON, [lockFile]);
  try {
    fs.mkdirSync(backup, { mode: 0o700 });
    if (fs.realpathSync(backup) !== backup) fail("SYMLINK_BACKUP");
    const s = {
      capture_id: pre.capture_id,
      preflight: pre,
      root,
      backup,
      state_path: statePath,
      inventory_path: path.resolve(o.inventory),
      tool_sha: (
        await command("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: toolRoot })
      ).trim(),
      phase: "CREATED",
    };
    privateJSON(statePath, s, { max: 64 * 1024 ** 2 });
    const save = () =>
      privateJSON(statePath, s, { replace: true, max: 64 * 1024 ** 2 });
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    const onSignal = () => {
      s.signal = true;
    };
    signals.forEach((k) => process.on(k, onSignal));
    try {
      await captureFlow(await adapter(s, save), s, save);
      console.log(
        JSON.stringify({
          status: "COMPLETE",
          capture_id: s.capture_id,
          backup,
          restarted_at: s.restarted_at,
        }),
      );
    } finally {
      signals.forEach((k) => process.off(k, onSignal));
    }
  } finally {
    await guard.release();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((e) => {
    console.error(
      JSON.stringify({
        status: "FAILED",
        code: /^[A-Z_]+$/.test(e.message) ? e.message : "CAPTURE_FAILED",
        action:
          process.argv[2] === "preflight"
            ? "Resolve preflight reason; no maintenance action was attempted"
            : "Inspect private phase.json; run recover with the same state before any manual start",
      }),
    );
    process.exitCode = 1;
  });
