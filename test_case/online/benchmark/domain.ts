import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync, fork } from "node:child_process";
import { CoreClient } from "../../../src/pi_secretary/src/core-client.ts";
import type { CoreEndpoint } from "../../../src/pi_secretary/src/api-v1.ts";

import {
  cleanEnvironment,
  copyTree,
  deploymentGuard,
  inventory,
  lease,
  mkdir,
  noLinks,
  processIdentity,
  processStatus,
  stopOwned,
  read,
  readJSON,
  repository,
  requireThat,
  sha,
  syncDir,
  until,
  writeJSON,
  type FileEntry,
} from "./io.ts";
import {
  coreDSN,
  controlID,
  createDatabase,
  dumpDatabase,
  initializeDatabase,
  newDatabase,
  pgRunning,
  restoreDatabase,
  startDatabase,
  stopDatabase,
  verifyDatabase,
  type Database,
} from "./postgres.ts";
import { restorePreflight } from "./snapshot.ts";

export type Run = {
  version: 1;
  id: string;
  lineage: string;
  nonce: string;
  active: string;
  evidence: string;
  state:
    | "CREATING"
    | "STOPPED"
    | "STARTING"
    | "RUNNING"
    | "RESTORING"
    | "RETIRED"
    | "CLEANED"
    | "INCOMPLETE";
  created_at: string;
  config: Configuration;
  frozen: ReturnType<typeof fingerprint>;
  database: Database;
  directoryIdentity?: string;
  process?: ReturnType<typeof processIdentity>;
  endpoint?: CoreEndpoint;
  parent?: string;
  checkpoint?: string;
  staging?: string;
  retired?: string;
  failure?: string;
  checkpointHash?: string;
  restoredFrom?: {
    run_id: string;
    checkpoint_id: string;
    checkpointHash: string;
  };
};
export type Configuration = {
  version: 1;
  mode: "fixture";
  track: "correctness";
  case_id: "infrastructure";
  seed: number;
  fault_injection?: "write-after-fsync";
};
export const configuration: Configuration = {
  version: 1,
  mode: "fixture",
  track: "correctness",
  case_id: "infrastructure",
  seed: 120,
};
export function validateConfiguration(config: Configuration) {
  requireThat(
    JSON.stringify(
      Object.keys(config)
        .filter((key) => key !== "fault_injection")
        .sort(),
    ) === JSON.stringify(Object.keys(configuration).sort()) &&
      config.version === 1 &&
      config.mode === "fixture" &&
      config.track === "correctness" &&
      config.case_id === "infrastructure" &&
      Number.isSafeInteger(config.seed) &&
      (config.fault_injection === undefined ||
        config.fault_injection === "write-after-fsync"),
    "CONFIG_UNSUPPORTED_ISSUE121_OWNS_WORKLOADS",
  );
}
// The Core worker receives only its non-superuser DSN, never controller credentials.
export type WorkerPermit = Pick<
  Run,
  "id" | "nonce" | "active" | "evidence" | "config"
> & { core_dsn: string };
export function workerPermit(run: Run): WorkerPermit {
  return {
    id: run.id,
    nonce: run.nonce,
    active: run.active,
    evidence: run.evidence,
    config: run.config,
    core_dsn: coreDSN(run.database),
  };
}
export function fingerprint() {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
    }).trim();
  requireThat(
    git("-C", "src/pi_resource", "status", "--porcelain") === "",
    "SUBMODULE_MUST_BE_CLEAN",
  );
  const files = git(
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "src",
    "test_case/online/benchmark",
    "test_case/benchmarks/common",
    "package.json",
    "package-lock.json",
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  const hashes = files
    .filter(
      (p) =>
        fs.existsSync(path.join(repository, p)) &&
        fs.statSync(path.join(repository, p)).isFile(),
    )
    .map((p) => [p, sha(read(path.join(repository, p)))]);
  return {
    head: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    dirty: sha(
      git(
        "diff",
        "HEAD",
        "--",
        "src",
        "test_case",
        "package.json",
        "package-lock.json",
      ),
    ),
    source: sha(JSON.stringify(hashes)),
    lockfile: sha(read(path.join(repository, "package-lock.json"))),
    submodules: git("submodule", "status"),
    node: process.version,
  };
}
export const excluded = new Set([
  "marker.json",
  "tmp",
  "core/core-endpoint.json",
  "core/core.log",
  "core/owner.lock",
  "core/push-secrets",
]);
const validID = (id: string) =>
  requireThat(/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id), "INVALID_RUN_ID");
const identity = (p: string) => {
  const s = fs.statSync(p);
  return `${s.dev}:${s.ino}`;
};
export class Domains {
  constructor(readonly root: string) {}
  static async use<T>(root: string, fn: (d: Domains) => Promise<T>) {
    deploymentGuard(repository, root);
    return lease(root, async () => {
      const file = path.join(root, "facility.json");
      if (!fs.existsSync(file))
        writeJSON(file, { version: 1, repository, nonce: randomUUID() });
      requireThat(readJSON(file).repository === repository, "FOREIGN_FACILITY");
      return fn(new Domains(root));
    });
  }
  private record(id: string) {
    validID(id);
    return path.join(this.root, "runs", id + ".json");
  }
  save(run: Run) {
    writeJSON(this.record(run.id), run);
  }
  raw(id: string): Run {
    const run: Run = readJSON(this.record(id));
    requireThat(run.id === id, "REGISTRY_ID_MISMATCH");
    validID(run.lineage);
    requireThat(
      [
        "CREATING",
        "STOPPED",
        "STARTING",
        "RUNNING",
        "RESTORING",
        "RETIRED",
        "CLEANED",
        "INCOMPLETE",
      ].includes(run.state),
      "INVALID_RUN_STATE",
    );
    const expected =
      run.state === "RETIRED"
        ? path.join(this.root, "retired", id)
        : run.state === "CLEANED"
          ? path.join(this.root, "cleaned", id, "active")
          : path.join(this.root, "slots", run.lineage, "active");
    requireThat(
      run.active === expected &&
        run.evidence === path.join(this.root, "evidence", id) &&
        run.database.directory === path.join(this.root, "pg", id, "data"),
      "REGISTRY_PATH_MISMATCH",
    );
    noLinks(run.active);
    noLinks(run.evidence);
    noLinks(run.database.directory);
    return run;
  }
  load(id: string) {
    const run = this.raw(id);
    requireThat(run.id === id, "REGISTRY_ID_MISMATCH");
    const expected =
      run.state === "RETIRED"
        ? path.join(this.root, "retired", id)
        : run.state === "CLEANED"
          ? path.join(this.root, "cleaned", id, "active")
          : path.join(this.root, "slots", run.lineage, "active");
    requireThat(
      run.active === expected &&
        run.evidence === path.join(this.root, "evidence", id) &&
        run.database.directory === path.join(this.root, "pg", id, "data"),
      "REGISTRY_PATH_MISMATCH",
    );
    noLinks(run.active);
    const marker = readJSON(path.join(run.active, "marker.json"));
    requireThat(
      marker.id === id &&
        marker.nonce === run.nonce &&
        marker.lineage === run.lineage &&
        run.directoryIdentity === identity(run.active),
      "RUN_OWNERSHIP_MISMATCH",
    );
    const st = fs.statSync(run.active);
    requireThat(
      st.uid === process.getuid?.() && (st.mode & 0o077) === 0,
      "RUN_PERMISSIONS",
    );
    return run;
  }
  private assertLineageAvailable(run: Run, except?: string) {
    for (const name of fs
      .readdirSync(path.join(this.root, "runs"))
      .filter((name) => name.endsWith(".json"))) {
      const candidate = this.raw(name.slice(0, -5));
      requireThat(
        candidate.id === except ||
          candidate.lineage !== run.lineage ||
          candidate.state !== "RESTORING",
        "LINEAGE_RESTORE_INCOMPLETE",
      );
    }
  }
  private async allocate(
    config: Configuration,
    lineage: string = randomUUID(),
  ) {
    validateConfiguration(config);
    const id = randomUUID();
    const run: Run = {
      version: 1,
      id,
      lineage,
      nonce: randomUUID(),
      state: "CREATING",
      created_at: new Date().toISOString(),
      config,
      frozen: fingerprint(),
      active: path.join(this.root, "slots", lineage, "active"),
      evidence: path.join(this.root, "evidence", id),
      database: await newDatabase(path.join(this.root, "pg", id, "data")),
    };
    this.save(run);
    mkdir(run.evidence);
    mkdir(path.dirname(run.database.directory));
    writeJSON(path.join(run.evidence, "source.json"), run.frozen);
    return run;
  }
  private mark(run: Run, dir = run.active) {
    mkdir(dir);
    writeJSON(path.join(dir, "marker.json"), {
      version: 1,
      id: run.id,
      lineage: run.lineage,
      nonce: run.nonce,
    });
    run.directoryIdentity = identity(dir);
  }
  private async preparePG(run: Run) {
    initializeDatabase(run.database);
    this.save(run);
    startDatabase(run.database);
    await createDatabase(run.database);
    this.save(run);
    await verifyDatabase(run.database);
  }
  async create(config = configuration) {
    const run = await this.allocate(config);
    try {
      requireThat(!fs.existsSync(run.active), "SLOT_EXISTS");
      this.mark(run);
      this.save(run);
      await this.preparePG(run);
      run.state = "STOPPED";
      this.save(run);
      return run;
    } catch (e) {
      run.state = "INCOMPLETE";
      run.failure = String(e);
      this.save(run);
      if (run.database.systemID)
        await stopDatabase(run.database).catch((error) => {
          writeJSON(path.join(run.evidence, "shutdown-failure.json"), {
            error: String(error),
          });
        });
      throw e;
    }
  }
  async start(id: string) {
    const run = this.load(id);
    this.assertLineageAvailable(run);
    requireThat(run.state === "STOPPED", "RUN_NOT_STOPPED");
    requireThat(
      JSON.stringify(run.frozen) === JSON.stringify(fingerprint()),
      "FROZEN_SOURCE_CHANGED",
    );
    if (fs.existsSync(path.join(run.active, "core/journal.jsonl")))
      restorePreflight(
        path.join(run.active, "core"),
        path.join(run.active, "core"),
        this.sink(run),
      );
    if (!pgRunning(run.database)) startDatabase(run.database);
    await verifyDatabase(run.database);
    mkdir(path.join(run.active, "tmp"));
    const readyFile = path.join(run.evidence, "ready.json");
    if (fs.existsSync(readyFile))
      fs.renameSync(
        readyFile,
        path.join(run.evidence, "ready-" + randomUUID() + ".json"),
      );
    run.state = "STARTING";
    this.save(run);
    const output = fs.openSync(
      path.join(run.evidence, "worker.log"),
      "a",
      0o600,
    );
    const child = fork(
      path.join(repository, "test_case/online/benchmark/worker.ts"),
      ["--run", run.id],
      {
        execArgv: ["--import", "tsx"],
        cwd: repository,
        env: cleanEnvironment(path.join(run.active, "tmp")),
        detached: true,
        stdio: ["ignore", output, output, "ipc"],
      },
    );
    fs.closeSync(output);
    try {
      requireThat(child.pid, "WORKER_NO_PID");
      run.process = processIdentity(child.pid, run.id);
      this.save(run);
      child.send({ permit: workerPermit(run) }); // No Core opening before the durable ownership permit.
      await until(
        () =>
          fs.existsSync(readyFile) ||
          child.exitCode !== null ||
          child.signalCode !== null,
        30000,
      );
      requireThat(fs.existsSync(readyFile), "WORKER_START_FAILED");
      const ready = readJSON(readyFile);
      requireThat(
        ready.id === run.id &&
          ready.nonce === run.nonce &&
          ready.endpoint.pid === child.pid,
        "READY_IDENTITY_MISMATCH",
      );
      run.endpoint = ready.endpoint;
      run.state = "RUNNING";
      this.save(run);
      const core: any = await new CoreClient(run.endpoint!).query("core");
      requireThat(
        core.instance_id === run.endpoint!.instance_id &&
          core.data_domain_id === run.endpoint!.data_domain_id,
        "ENDPOINT_IDENTITY_MISMATCH",
      );
      if (child.connected) child.disconnect();
      child.unref();
      return run;
    } catch (e) {
      if (child.connected) child.disconnect();
      if (run.process) await stopOwned(run.process);
      run.state = "INCOMPLETE";
      run.failure = String(e);
      this.save(run);
      throw e;
    }
  }
  async stop(id: string) {
    const run = this.load(id);
    requireThat(
      !["RETIRED", "CLEANED", "RESTORING"].includes(run.state),
      "INACTIVE_INCARNATION",
    );
    if (run.process) {
      const state = processStatus(run.process);
      requireThat(state !== "UNCONFIRMED", "WORKER_IDENTITY_UNCONFIRMED");
      if (state === "RUNNING") {
        if (run.endpoint) {
          const client = new CoreClient(run.endpoint),
            core: any = await client.query("core").catch(() => null);
          if (
            core?.instance_id === run.endpoint.instance_id &&
            core?.data_domain_id === run.endpoint.data_domain_id
          )
            await client
              .command("core/stop", { request_id: randomUUID() })
              .catch(() => {});
        }
        await until(() => processStatus(run.process) === "STOPPED", 8000).catch(
          async () =>
            requireThat(
              (await stopOwned(run.process)) === "STOPPED",
              "WORKER_STOP_UNCONFIRMED",
            ),
        );
      }
      requireThat(
        processStatus(run.process) === "STOPPED",
        "WORKER_STOP_UNCONFIRMED",
      );
    }
    run.state = "STOPPED";
    this.save(run);
    return run;
  }
  sink(run: Run): any[] {
    const p = path.join(run.evidence, "sink.jsonl");
    return fs.existsSync(p)
      ? read(p)
          .toString()
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((s) => JSON.parse(s))
      : [];
  }
  async checkpoint(id: string) {
    this.assertLineageAvailable(this.load(id));
    const run = await this.stop(id);
    const state = restorePreflight(
      path.join(run.active, "core"),
      path.join(run.active, "core"),
      this.sink(run),
    );
    const cp = randomUUID(),
      dir = path.join(this.root, "checkpoints", cp);
    mkdir(dir);
    const entries = inventory(run.active, excluded);
    copyTree(run.active, path.join(dir, "state"), entries);
    await dumpDatabase(run.database, path.join(dir, "postgres.dump"));
    await stopDatabase(run.database);
    const manifest = {
      version: 1,
      id: cp,
      run: run.id,
      lineage: run.lineage,
      config: run.config,
      frozen: run.frozen,
      entries,
      dump: sha(read(path.join(dir, "postgres.dump"))),
      sink: this.sink(run),
      journal: { sequence: state.sequence, digest: state.digest },
      complete: true,
    };
    writeJSON(path.join(dir, "manifest.json"), manifest);
    run.checkpoint = cp;
    run.checkpointHash = sha(read(path.join(dir, "manifest.json")));
    this.save(run);
    return cp;
  }
  async restore(id: string, checkpoint: string) {
    const old = this.load(id);
    this.assertLineageAvailable(old);
    requireThat(
      old.state === "STOPPED" &&
        (!old.process || processStatus(old.process) === "STOPPED") &&
        !pgRunning(old.database),
      "SOURCE_NOT_STOPPED",
    );
    validID(checkpoint);
    const cpDir = path.join(this.root, "checkpoints", checkpoint);
    requireThat(old.checkpoint === checkpoint, "CHECKPOINT_MISMATCH");
    requireThat(
      old.checkpointHash === sha(read(path.join(cpDir, "manifest.json"))),
      "CHECKPOINT_SEAL_MISMATCH",
    );
    const cp = readJSON(path.join(cpDir, "manifest.json"));
    requireThat(
      cp.complete &&
        cp.run === id &&
        cp.lineage === old.lineage &&
        JSON.stringify(cp.frozen) === JSON.stringify(fingerprint()) &&
        JSON.stringify(cp.config) === JSON.stringify(old.config),
      "CHECKPOINT_MISMATCH",
    );
    requireThat(
      sha(read(path.join(cpDir, "postgres.dump"))) === cp.dump &&
        JSON.stringify(inventory(path.join(cpDir, "state"))) ===
          JSON.stringify(cp.entries),
      "CHECKPOINT_CORRUPT",
    );
    requireThat(
      JSON.stringify(this.sink(old)) === JSON.stringify(cp.sink),
      "SINK_ADVANCED_AFTER_CHECKPOINT",
    );
    restorePreflight(
      path.join(cpDir, "state/core"),
      path.join(old.active, "core"),
      cp.sink,
    );
    const run = await this.allocate(old.config, old.lineage);
    run.parent = id;
    run.restoredFrom = {
      run_id: id,
      checkpoint_id: checkpoint,
      checkpointHash: old.checkpointHash!,
    };
    run.staging = path.join(
      this.root,
      "slots",
      run.lineage,
      "staging-" + run.id,
    );
    run.retired = path.join(this.root, "retired", id);
    run.state = "RESTORING";
    this.save(run);
    try {
      copyTree(path.join(cpDir, "state"), run.staging, cp.entries);
      this.mark(run, run.staging);
      this.save(run);
      if (cp.sink.length)
        fs.writeFileSync(
          path.join(run.evidence, "sink.jsonl"),
          cp.sink.map((x: any) => JSON.stringify(x)).join("\n") + "\n",
          { mode: 0o600, flag: "wx" },
        );
      await this.preparePG(run);
      await restoreDatabase(run.database, path.join(cpDir, "postgres.dump"));
      writeJSON(path.join(run.evidence, "restore-import.json"), {
        checkpoint,
        dump: cp.dump,
      });
      return await this.finishRestore(run.id);
    } catch (e) {
      if (run.database.systemID)
        await stopDatabase(run.database).catch((error) =>
          writeJSON(path.join(run.evidence, "shutdown-failure.json"), {
            error: String(error),
          }),
        );
      throw e;
    }
  }
  async finishRestore(id: string) {
    const run = this.raw(id);
    this.assertLineageAvailable(run, id);
    requireThat(
      run.state === "RESTORING" && run.parent && run.staging && run.retired,
      "NO_HANDOFF",
    );
    requireThat(
      run.active === path.join(this.root, "slots", run.lineage, "active") &&
        run.staging ===
          path.join(this.root, "slots", run.lineage, "staging-" + id) &&
        run.retired === path.join(this.root, "retired", run.parent),
      "INVALID_HANDOFF_PATH",
    );
    requireThat(
      run.evidence === path.join(this.root, "evidence", id) &&
        run.database.directory === path.join(this.root, "pg", id, "data"),
      "REGISTRY_PATH_MISMATCH",
    );
    requireThat(
      run.restoredFrom?.run_id === run.parent,
      "RESTORE_PROVENANCE_MISMATCH",
    );
    validID(run.restoredFrom!.checkpoint_id);
    const cpDir = path.join(
      this.root,
      "checkpoints",
      run.restoredFrom!.checkpoint_id,
    );
    requireThat(
      sha(read(path.join(cpDir, "manifest.json"))) ===
        run.restoredFrom!.checkpointHash,
      "CHECKPOINT_SEAL_MISMATCH",
    );
    const cp = readJSON(path.join(cpDir, "manifest.json"));
    requireThat(
      cp.complete &&
        cp.run === run.parent &&
        cp.lineage === run.lineage &&
        JSON.stringify(run.frozen) === JSON.stringify(fingerprint()),
      "CHECKPOINT_MISMATCH",
    );
    const imported = readJSON(path.join(run.evidence, "restore-import.json"));
    requireThat(
      imported.checkpoint === run.restoredFrom!.checkpoint_id &&
        imported.dump === cp.dump &&
        sha(read(path.join(cpDir, "postgres.dump"))) === cp.dump,
      "RESTORE_IMPORT_INCOMPLETE",
    );
    const staged = fs.existsSync(run.staging) ? run.staging : run.active;
    requireThat(
      JSON.stringify(inventory(staged, excluded)) ===
        JSON.stringify(cp.entries),
      "STAGING_CHANGED",
    );
    restorePreflight(
      path.join(staged, "core"),
      path.join(run.active, "core"),
      this.sink(run),
    );
    if (!pgRunning(run.database)) startDatabase(run.database);
    await verifyDatabase(run.database);
    const old = this.raw(run.parent);
    requireThat(
      JSON.stringify(this.sink(old)) === JSON.stringify(cp.sink),
      "SINK_ADVANCED_AFTER_CHECKPOINT",
    );
    if (
      fs.existsSync(run.active) &&
      readJSON(path.join(run.active, "marker.json")).id === old.id
    ) {
      this.load(old.id);
      requireThat(
        old.state === "STOPPED" &&
          !pgRunning(old.database) &&
          (!old.process || processStatus(old.process) === "STOPPED"),
        "OLD_DOMAIN_BUSY",
      );
      requireThat(!fs.existsSync(run.retired), "RETIRED_EXISTS");
      mkdir(path.dirname(run.retired));
      fs.renameSync(run.active, run.retired);
      syncDir(path.dirname(run.active));
      syncDir(path.dirname(run.retired));
    }
    requireThat(
      readJSON(path.join(run.retired, "marker.json")).nonce === old.nonce &&
        identity(run.retired) === old.directoryIdentity,
      "RETIRED_IDENTITY_MISMATCH",
    );
    old.active = run.retired;
    old.state = "RETIRED";
    this.save(old);
    if (!fs.existsSync(run.active)) {
      requireThat(
        readJSON(path.join(run.staging, "marker.json")).nonce === run.nonce &&
          identity(run.staging) === run.directoryIdentity,
        "STAGING_IDENTITY_MISMATCH",
      );
      fs.renameSync(run.staging, run.active);
      syncDir(path.dirname(run.active));
    }
    requireThat(
      readJSON(path.join(run.active, "marker.json")).nonce === run.nonce &&
        identity(run.active) === run.directoryIdentity,
      "HANDOFF_IDENTITY_MISMATCH",
    );
    run.state = "STOPPED";
    this.save(run);
    this.load(id);
    return run;
  }
  async seal(id: string) {
    const run = await this.stop(id);
    await stopDatabase(run.database);
    writeJSON(
      path.join(run.evidence, "domain-files.json"),
      inventory(run.active),
    );
    writeJSON(path.join(run.evidence, "seal.json"), {
      id,
      nonce: run.nonce,
      files: inventory(run.evidence, new Set(["seal.json"])),
    });
    return run;
  }
  async clean(id: string) {
    const run = this.load(id);
    this.assertLineageAvailable(run);
    requireThat(run.state === "STOPPED", "CLEAN_REQUIRES_STOPPED");
    requireThat(
      !run.process || processStatus(run.process) === "STOPPED",
      "PROCESS_ACTIVE",
    );
    requireThat(!pgRunning(run.database), "PG_ACTIVE");
    requireThat(
      controlID(run.database) === run.database.systemID,
      "PG_OWNERSHIP_MISMATCH",
    );
    const seal = readJSON(path.join(run.evidence, "seal.json"));
    requireThat(
      seal.id === id &&
        seal.nonce === run.nonce &&
        JSON.stringify(seal.files) ===
          JSON.stringify(inventory(run.evidence, new Set(["seal.json"]))),
      "EVIDENCE_NOT_SEALED",
    );
    requireThat(
      JSON.stringify(readJSON(path.join(run.evidence, "domain-files.json"))) ===
        JSON.stringify(inventory(run.active)),
      "DOMAIN_CHANGED_AFTER_SEAL",
    );
    // Reversible retirement, deliberately no recursive delete. Registry remains a tombstone.
    const destination = path.join(this.root, "cleaned", id, "active");
    requireThat(!fs.existsSync(destination), "CLEAN_DESTINATION_EXISTS");
    mkdir(path.dirname(destination));
    writeJSON(path.join(this.root, "cleaned", id, "intent.json"), {
      source: run.active,
      destination,
      id,
      nonce: run.nonce,
    });
    this.load(id);
    fs.renameSync(run.active, destination);
    syncDir(path.dirname(destination));
    syncDir(path.dirname(run.active));
    run.active = destination;
    run.state = "CLEANED";
    this.save(run);
    return run;
  }
  async recover(id: string) {
    const run = this.raw(id);
    if (run.state === "RESTORING") return this.finishRestore(id);
    if (run.state === "CLEANED") return this.load(id);
    const destination = path.join(this.root, "cleaned", id, "active"),
      intentFile = path.join(this.root, "cleaned", id, "intent.json");
    if (fs.existsSync(intentFile)) {
      const intent = readJSON(intentFile);
      requireThat(
        run.state === "STOPPED" &&
          intent.id === id &&
          intent.nonce === run.nonce &&
          intent.source === run.active &&
          intent.destination === destination &&
          run.active === path.join(this.root, "slots", run.lineage, "active"),
        "INVALID_CLEAN_INTENT",
      );
      if (!fs.existsSync(destination)) return this.clean(id);
      requireThat(!fs.existsSync(run.active), "AMBIGUOUS_CLEAN");
      run.active = destination;
      run.state = "CLEANED";
      // Validate the moved incarnation before committing the tombstone.
      const marker = readJSON(path.join(destination, "marker.json"));
      requireThat(
        marker.id === id &&
          marker.nonce === run.nonce &&
          identity(destination) === run.directoryIdentity,
        "RUN_OWNERSHIP_MISMATCH",
      );
      requireThat(
        !run.process || processStatus(run.process) === "STOPPED",
        "PROCESS_ACTIVE",
      );
      requireThat(
        !pgRunning(run.database) &&
          controlID(run.database) === run.database.systemID,
        "PG_OWNERSHIP_MISMATCH",
      );
      requireThat(
        JSON.stringify(inventory(destination)) ===
          JSON.stringify(
            readJSON(path.join(run.evidence, "domain-files.json")),
          ),
        "DOMAIN_CHANGED_AFTER_SEAL",
      );
      const seal = readJSON(path.join(run.evidence, "seal.json"));
      requireThat(
        seal.nonce === run.nonce &&
          JSON.stringify(seal.files) ===
            JSON.stringify(inventory(run.evidence, new Set(["seal.json"]))),
        "EVIDENCE_NOT_SEALED",
      );
      this.save(run);
      return this.load(id);
    }
    // Incomplete creation/import stays quarantined. Never infer authority from a pathname.
    requireThat(
      !["CREATING", "INCOMPLETE"].includes(run.state),
      "INCOMPLETE_DOMAIN_RETAINED_REQUIRES_INSPECTION",
    );
    return this.stop(id);
  }
}
