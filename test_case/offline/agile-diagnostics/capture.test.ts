// @ts-nocheck -- standalone JavaScript tools with pure adapters, never a Core or PostgreSQL instance.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { captureFlow } from "../../../scripts/agile-diagnostics/capture-state.mjs";
import {
  assertIdle,
  classify,
  requireFresh,
  sameIdentity,
  startupCanMutate,
  assertNoFrozenWriters,
} from "../../../scripts/agile-diagnostics/capture-guards.mjs";
import { pgEnvironment } from "../../../scripts/agile-diagnostics/capture.mjs";
import {
  holdLocks,
  command,
} from "../../../scripts/agile-diagnostics/process.mjs";
import { fixture, at } from "./fixtures.mjs";
const actions = [
  "prepare",
  "holdMaintenance",
  "settle",
  "quiescence",
  "stopAndLock",
  "exportDatabase",
  "copyAndSeal",
  "recover",
  "verify",
];
for (const failed of ["none", ...actions])
  test("capture failure path: " + failed, async () => {
    const calls = [],
      saved = [],
      s = {};
    const a = Object.fromEntries(
      actions.map((k) => [
        k,
        async () => {
          calls.push(k);
          if (k === failed) throw Error("INJECTED_FAILURE");
        },
      ]),
    );
    const run = captureFlow(a, s, async () => {
      saved.push(structuredClone(s));
    });
    if (failed === "none") await run;
    else await assert.rejects(run, /INJECTED_FAILURE/);
    assert.equal(calls.filter((x) => x === "recover").length, 1);
    if (failed === "none") assert.equal(s.phase, "COMPLETE");
    else if (failed === "recover") assert.equal(s.phase, "RECOVERY_FAILED");
    else if (failed === "verify") assert.equal(s.phase, "FAILED_VERIFICATION");
    else {
      assert.equal(s.phase, "FAILED");
      assert.equal(s.recovered, true);
      assert(!calls.includes("verify"));
    }
    if (["prepare", "holdMaintenance", "settle", "quiescence"].includes(failed))
      assert(!calls.includes("stopAndLock"));
    assert(saved.some((x) => x.phase === "P4"));
  });
const idle = () => ({
  core: { mode: "live", state: "IDLE", session_id: "s" },
  session: { id: "s", state: "IDLE", recovery_error: null },
  tasks: [],
  wakeups: [],
  "push-dispatches": [],
  scopes: [],
  settings: { blocked: false, applications: [{ state: "APPLIED" }] },
  memory: {
    state: "NOT_NEEDED",
    extraction_pending_count: 0,
    next_attempt_at: null,
  },
});
test("idle gate allows only fully evidenced quiescence", () => {
  assertIdle(idle());
  for (const [field, value] of [
    ["tasks", [{ active_execution_ids: ["e"], active_executions: [{}] }]],
    ["scopes", [{}]],
    ["wakeups", [{ state: "PENDING", at: new Date().toISOString() }]],
    ["push-dispatches", [{ state: "SENDING" }]],
    ["settings", { blocked: true }],
    ["memory", { state: "SUMMARIZING" }],
    ["tasks", undefined],
  ]) {
    const v = idle();
    v[field] = value;
    assert.throws(() => assertIdle(v));
  }
});
test("quiescence gate catches imminent work appearing after preflight", () => {
  const a = idle();
  assertIdle(a);
  const b = idle();
  b.wakeups = [
    { state: "PENDING", at: new Date(Date.now() + 120000).toISOString() },
  ];
  assert.throws(() => assertIdle(b), /IMMINENT_WAKEUP/);
});
test("fresh capture ID gate rejects stale, future, absent timestamps", () => {
  assert.doesNotThrow(() =>
    requireFresh({ capture_id: "id", at: new Date().toISOString() }),
  );
  for (const at of [
    "invalid",
    new Date(Date.now() - 300001).toISOString(),
    new Date(Date.now() + 1000).toISOString(),
  ])
    assert.throws(
      () => requireFresh({ capture_id: "id", at }),
      /STALE_PREFLIGHT/,
    );
});
test("classification covers every immediate root entry, raw PG and operational log exceptions", () => {
  const entries = {
    data: ["core", "tui", "postgres", "pgsocket", "world-postgres.log"],
    ".local": ["runtime.json"],
  };
  const i = {
    data: {
      core: "frozen",
      tui: "frozen",
      postgres: "logical_postgres",
      pgsocket: "socket_metadata",
      "world-postgres.log": "operational",
    },
    ".local": { "runtime.json": "frozen" },
  };
  classify(entries, i);
  assert.throws(
    () => classify({ ...entries, data: [...entries.data, "unknown"] }, i),
    /UNCLASSIFIED_ENTRY/,
  );
  assert.throws(
    () => classify(entries, { ...i, data: { ...i.data, postgres: "frozen" } }),
    /UNSAFE_CLASSIFICATION/,
  );
});
test("restart requires same domain, session, world capability and different instance", () => {
  const a = {
    data_domain_id: "d",
    session_id: "s",
    mode: "live",
    instance_id: "i",
    capabilities: { world: { state: "supported" } },
  };
  sameIdentity(a, { ...a, instance_id: "j" }, true);
  assert.throws(() => sameIdentity(a, a, true));
  assert.throws(() => sameIdentity(a, { ...a, session_id: "wrong" }));
});
test("PG connection secrets are exported only as environment fields, no arbitrary options", () => {
  const e = pgEnvironment(
    "postgresql://synthetic:secret@localhost:55488/db?host=%2Fsynthetic%2Fsocket",
  );
  assert.equal(e.PGPASSWORD, "secret");
  assert.equal(e.PGHOST, "/synthetic/socket");
  assert.equal(e.PGDATABASE, "db");
  assert.throws(
    () => pgEnvironment("postgresql://localhost/db?options=-cwhatever"),
    /UNSUPPORTED/,
  );
});
test("existing lock holder excludes competing capture without altering file bytes", async () => {
  const f = fixture(),
    file = path.join(f.root, "state.lock");
  fs.writeFileSync(file, "synthetic", { mode: 0o600 });
  let a;
  try {
    a = await holdLocks("/usr/bin/python3", [file]);
    await assert.rejects(holdLocks("/usr/bin/python3", [file]), /LOCK_FAILED/);
    assert.equal(fs.readFileSync(file, "utf8"), "synthetic");
    await a.release();
    a = undefined;
    const b = await holdLocks("/usr/bin/python3", [file]);
    await b.release();
    await assert.rejects(
      holdLocks("/usr/bin/python3", [path.join(f.root, "missing")]),
    );
    assert(!fs.existsSync(path.join(f.root, "missing")));
  } finally {
    await a?.release();
    f.cleanup();
  }
});

test("same-second ensure is pre-marker; later mutation-capable child remains blocked", () => {
  const at = 1000500;
  assert(startupCanMutate("node agile.mjs ensure", 1000000, at));
  assert(!startupCanMutate("node agile.mjs ensure", 1001000, at));
  assert(startupCanMutate("node start-live.ts", 1002000, at));
  assert(startupCanMutate("node core-cli.ts start", 1002000, at));
  assert(startupCanMutate("npm start", 1002000, at));
});
test("open frozen writer blocks capture; read locks and operational log writers do not", () => {
  const roots = ["/synthetic/data/core"];
  assert.throws(
    () =>
      assertNoFrozenWriters(
        "p1\nf4\nau\nn/synthetic/data/core/journal.jsonl",
        roots,
      ),
    /FROZEN_WRITER/,
  );
  assertNoFrozenWriters(
    "p1\nf4\nar\nn/synthetic/data/core/owner.lock\nf5\naw\nn/synthetic/.local/supervisor.log",
    roots,
  );
});

test("a disposable hung child cannot trap the recovery coordinator after its command deadline", async () => {
  const at = Date.now();
  await assert.rejects(
    command(
      process.execPath,
      ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      { timeout: 300, killGrace: 200 },
    ),
    /COMMAND_FAILED/,
  );
  assert(Date.now() - at < 3000);
});

test("inert archive verification supports retained symbolic and hard links", async () => {
  const f = fixture();
  try {
    const { tree, digestFile } =
      await import("../../../scripts/agile-diagnostics/capture-files.mjs");
    const dir = path.join(f.root, "source");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a"), "synthetic", { mode: 0o600 });
    fs.linkSync(path.join(dir, "a"), path.join(dir, "b"));
    fs.symlinkSync("a", path.join(dir, "c"));
    const files = {};
    for (const name of ["a", "b"])
      files[name] = {
        sha256: await digestFile(path.join(dir, name)),
        bytes: 9,
        mode: 0o600,
      };
    const manifest = path.join(f.root, "source.json"),
      archive = path.join(f.root, "source.tar");
    fs.writeFileSync(manifest, JSON.stringify({ tree: tree(dir), files }));
    await command("/usr/bin/tar", ["-cf", archive, "-C", dir, "."], {
      env: { PATH: "/usr/bin:/bin", COPYFILE_DISABLE: "1" },
    });
    const script = new URL(
      "../../../scripts/agile-diagnostics/verify-archive.py",
      import.meta.url,
    ).pathname;
    assert.match(
      await command("/usr/bin/python3", [script, archive, manifest]),
      /ARCHIVE_VERIFIED/,
    );
  } finally {
    f.cleanup();
  }
});
