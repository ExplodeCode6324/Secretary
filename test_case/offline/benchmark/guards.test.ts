import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  copyTree,
  deploymentGuard,
  inventory,
  lease,
  mkdir,
  readJSON,
  repository,
  writeJSON,
} from "../../online/benchmark/io.ts";
import {
  Domains,
  validateConfiguration,
  configuration,
  workerPermit,
} from "../../online/benchmark/domain.ts";
import {
  query,
  stopDatabase,
  verifyDatabase,
} from "../../online/benchmark/postgres.ts";
import { selfCheck } from "../../online/benchmark/self-check.ts";
import {
  machine,
  markdown,
  totals,
  validateReport,
  type Report,
} from "../../benchmarks/common/report.ts";

const temp = () =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "benchmark-guard-")));
test("pre-write deployment refusal covers markers, alias paths and root traversal", () => {
  const root = temp();
  try {
    for (const marker of [
      "data/core/journal.jsonl",
      ".local/runtime.json",
      ".local/maintenance.json",
      ".local/com.secretary.agile.plist",
    ]) {
      const file = path.join(root, marker);
      mkdir(path.dirname(file));
      fs.writeFileSync(file, "com.secretary.agile");
      assert.throws(() => deploymentGuard(root), /PERSISTENT_DEPLOYMENT/);
      assert(!fs.existsSync(path.join(root, ".local/benchmark")));
      fs.unlinkSync(file);
    }
    fs.symlinkSync(root, path.join(root, "alias"));
    assert.throws(
      () => deploymentGuard(path.join(root, "alias")),
      /SYMLINK_PATH/,
    );
    assert.throws(
      () => deploymentGuard(root, path.dirname(root)),
      /OUTSIDE_BENCHMARK_ROOT/,
    );
    assert.throws(
      () => deploymentGuard("/Users/muy/Desktop/secretary-agile"),
      /PROTECTED_AGILE_CHECKOUT/,
    );
    assert.throws(
      () => validateConfiguration({ ...configuration, mode: "live" as any }),
      /ISSUE121/,
    );
    assert.throws(
      () =>
        validateConfiguration({ ...configuration, extra: "inherited" } as any),
      /ISSUE121/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("checkpoint inventory preserves empty directories and refuses symlink/hardlink escapes", () => {
  const root = temp(),
    source = path.join(root, "source"),
    dest = path.join(root, "copy");
  mkdir(path.join(source, "executions"));
  fs.writeFileSync(path.join(source, "state"), "original", { mode: 0o600 });
  try {
    const manifest = inventory(source);
    copyTree(source, dest, manifest);
    assert.deepEqual(inventory(dest), manifest);
    assert(fs.statSync(path.join(dest, "executions")).isDirectory());
    fs.symlinkSync(path.dirname(root), path.join(source, "escape"));
    assert.throws(() => inventory(source), /SYMLINK_TREE/);
    fs.unlinkSync(path.join(source, "escape"));
    fs.linkSync(path.join(source, "state"), path.join(source, "hardlink"));
    assert.throws(() => inventory(source), /UNSAFE_TREE_ENTRY/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("controller lease excludes concurrent mutation and releases after EOF", async () => {
  const root = temp();
  try {
    await lease(root, async () => {
      await assert.rejects(
        () => lease(root, async () => {}),
        /CONTROLLER_BUSY/,
      );
    });
    await lease(root, async () => {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("report keeps full denominators and cannot label scripted memory or incomplete runs PASS", () => {
  const r: Report = {
    schema: "secretary-test-report-v1",
    run_id: "fixture",
    track: "correctness",
    source: {},
    configuration: {},
    started_at: "2026-11-14T00:00:00Z",
    finished_at: "2026-11-14T00:00:01Z",
    cases: [
      { id: "first", status: "FAIL", reason: "first failure", evidence: [] },
      { id: "retry", status: "PASS", evidence: ["new run"] },
      {
        id: "budget",
        status: "INCOMPLETE",
        reason: "budget exhausted",
        evidence: [],
      },
      {
        id: "later",
        status: "NOT_TESTED",
        reason: "not reached",
        evidence: [],
      },
    ],
    metrics: { usage: null },
    limitations: [],
    first_failure: "first failure",
    machine: machine(),
    evidence_classes: ["SCRIPTED_PROTOCOL"],
  };
  assert.equal(totals(r).FAIL, 1);
  assert.match(markdown(r), /Planned: 4/);
  assert.match(markdown(r), /First failure: first failure/);
  assert.throws(
    () => validateReport({ ...r, first_failure: null }),
    /MISSING_FIRST_FAILURE/,
  );
  assert.throws(
    () => validateReport({ ...r, track: "memory" }),
    /SCRIPTED_MEMORY_CLAIM/,
  );
  assert.throws(
    () =>
      validateReport({
        ...r,
        cases: [{ id: "skip", status: "NOT_TESTED", evidence: [] }],
      }),
    /INVALID_CASE_RESULT/,
  );
});
test(
  "owned PG/marker/process refusals preserve domains and evidence",
  { timeout: 90000 },
  async () => {
    const root = path.join(repository, ".local/benchmark/tests", randomUUID());
    await Domains.use(root, async (d) => {
      let r = await d.create();
      const permit = workerPermit(r);
      assert.equal(
        JSON.stringify(permit).includes(r.database.adminPassword),
        false,
      );
      assert.equal("database" in permit, false);
      assert.equal(new URL(permit.core_dsn).username, "benchmark_core");
      try {
        const markerFile = path.join(r.active, "marker.json"),
          original = readJSON(markerFile);
        writeJSON(markerFile, { ...original, nonce: randomUUID() });
        assert.throws(() => d.load(r.id), /OWNERSHIP/);
        writeJSON(markerFile, original);
        fs.renameSync(markerFile, markerFile + ".saved");
        assert.throws(() => d.load(r.id), /ENOENT/);
        fs.renameSync(markerFile + ".saved", markerFile);
        const outside = temp();
        fs.symlinkSync(outside, path.join(r.active, "escape"));
        assert.throws(() => inventory(r.active), /SYMLINK/);
        fs.unlinkSync(path.join(r.active, "escape"));
        fs.rmSync(outside, { recursive: true });
        const lineage = r.lineage;
        r.lineage = "../../foreign";
        d.save(r);
        assert.throws(() => d.raw(r.id), /INVALID_RUN_ID/);
        r.lineage = lineage;
        d.save(r);
        const evidence = r.evidence;
        r.evidence = path.dirname(root);
        d.save(r);
        await assert.rejects(() => d.recover(r.id), /REGISTRY_PATH/);
        r.evidence = evidence;
        d.save(r);
        const savedDirectory = r.database.directory;
        r.database.directory = path.dirname(savedDirectory);
        d.save(r);
        assert.throws(() => d.load(r.id), /REGISTRY_PATH/);
        r.database.directory = savedDirectory;
        d.save(r);
        const savedID = r.database.systemID;
        r.database.systemID = "0";
        await assert.rejects(() => verifyDatabase(r.database), /PG_OWNERSHIP/);
        r.database.systemID = savedID;
        await query(r.database, "CREATE DATABASE foreign_database");
        await assert.rejects(
          () => verifyDatabase(r.database),
          /SHARED_CLUSTER/,
        );
        await query(r.database, "DROP DATABASE foreign_database");
        r = await d.start(r.id);
        assert.deepEqual(
          readJSON(path.join(r.evidence, "database-role.json")),
          { name: "benchmark_core", rolsuper: false },
        );
        const savedProcess = r.process;
        r.process = { ...savedProcess, token: randomUUID() };
        d.save(r);
        await assert.rejects(() => d.stop(r.id), /WORKER_IDENTITY_UNCONFIRMED/);
        r.process = savedProcess;
        d.save(r);
        await d.stop(r.id);
        await stopDatabase(r.database);
        await assert.rejects(() => d.clean(r.id), /ENOENT/);
        await d.seal(r.id);
        fs.writeFileSync(path.join(r.evidence, "late-evidence"), "preserve");
        await assert.rejects(() => d.clean(r.id), /EVIDENCE_NOT_SEALED/);
        assert(fs.existsSync(r.active));
        await d.seal(r.id);
        await d.clean(r.id);
        assert.equal(d.load(r.id).state, "CLEANED");
      } finally {
        const current = d.load(r.id);
        if (!["CLEANED", "RETIRED"].includes(current.state)) {
          await d.stop(r.id);
          await stopDatabase(r.database);
        }
      }
    });
  },
);
test(
  "actual Core/PG isolation, OS restart, backup/import and original Shared task continuation",
  { timeout: 120000 },
  async () => {
    const { report, directory } = await selfCheck(
      path.join(repository, ".local/benchmark/tests", randomUUID()),
    );
    assert.equal(
      report.first_failure,
      null,
      JSON.stringify({ directory, cases: report.cases }),
    );
    assert.equal(report.cases.filter((c) => c.status === "PASS").length, 6);
    assert.equal(
      report.cases.some((c) => ["FAIL", "INCOMPLETE"].includes(c.status)),
      false,
    );
  },
);
