import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Domains, validateConfiguration, type Run } from "./domain.ts";
import {
  binary,
  cleanEnvironment,
  deploymentGuard,
  inside,
  inventory,
  lease,
  noLinks,
  processStatus,
  read,
  readJSON,
  repository,
  requireThat,
  sha,
  syncDir,
  writeJSON,
  type FileEntry,
} from "./io.ts";
import { controlID, pgRunning } from "./postgres.ts";

export const archiveDestination =
  "/Volumes/share/Files/HDD2/ELIZA/ELIZA_BAK/secretary-test-bak";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const identity = (p: string) => {
  const s = fs.statSync(p);
  return `${s.dev}:${s.ino}`;
};
export function assertArchiveTargetExternal(
  root: string,
  destination: string,
  mount = "/Volumes/share",
) {
  noLinks(root);
  noLinks(destination);
  noLinks(mount);
  requireThat(
    fs.statSync(destination).isDirectory() && fs.statSync(mount).isDirectory(),
    "ARCHIVE_TARGET_NOT_DIRECTORY",
  );
  requireThat(
    inside(mount, destination) &&
      fs.statSync(mount).dev !== fs.statSync(path.dirname(mount)).dev,
    "ARCHIVE_MOUNT_UNAVAILABLE",
  );
  requireThat(
    fs.statSync(destination).dev !== fs.statSync(root).dev,
    "ARCHIVE_TARGET_SAME_VOLUME",
  );
}
export type ArchiveManifest = {
  schema: "secretary-facility-archive-v1";
  archive_id: string;
  created_at: string;
  source: string;
  source_identity: string;
  repository: string;
  facility_nonce: string;
  root_mode: number;
  runs: { id: string; state: Run["state"]; lineage: string }[];
  entries: FileEntry[];
};
export type ArchiveResult = {
  status: "DRY_RUN" | "ARCHIVED";
  source: string;
  destination: string;
  files: number;
  bytes: number;
  archive_directory?: string;
  archive_sha256?: string;
  source_removed?: boolean;
  warnings?: string[];
};
function childNames(root: string, name: string) {
  const dir = path.join(root, name);
  if (!fs.existsSync(dir)) return [];
  noLinks(dir);
  requireThat(fs.statSync(dir).isDirectory(), "ARCHIVE_EXPECTED_DIRECTORY");
  return fs.readdirSync(dir).sort();
}
function ownedStoppedRuns(d: Domains): Run[] {
  const allowed = new Set([
    "facility.json",
    "controller.lock",
    "runs",
    "evidence",
    "pg",
    "slots",
    "retired",
    "cleaned",
    "checkpoints",
    "reports",
    "configs",
  ]);
  for (const name of fs.readdirSync(d.root))
    requireThat(
      allowed.has(name) || /^failure-[0-9a-f-]{36}\.json$/.test(name),
      "ARCHIVE_UNKNOWN_TOP_LEVEL",
    );
  for (const name of childNames(d.root, "configs")) {
    requireThat(name.endsWith(".json"), "ARCHIVE_UNKNOWN_CONFIG");
    validateConfiguration(readJSON(path.join(d.root, "configs", name)));
  }
  const names = childNames(d.root, "runs");
  requireThat(
    names.length > 0 &&
      names.every((n) => n.endsWith(".json") && uuid.test(n.slice(0, -5))),
    "ARCHIVE_INVALID_RUN_REGISTRY",
  );
  const runs = names.map((n) => d.load(n.slice(0, -5)));
  for (const run of runs) {
    requireThat(
      ["STOPPED", "CLEANED", "RETIRED"].includes(run.state),
      "ARCHIVE_RUN_NOT_STOPPED",
    );
    requireThat(
      !run.process || processStatus(run.process) === "STOPPED",
      "ARCHIVE_WORKER_NOT_STOPPED",
    );
    requireThat(!pgRunning(run.database), "ARCHIVE_PG_ACTIVE");
    requireThat(
      controlID(run.database) === run.database.systemID,
      "ARCHIVE_PG_OWNERSHIP_MISMATCH",
    );
  }
  const exact = (name: string, expected: string[]) =>
    requireThat(
      JSON.stringify(childNames(d.root, name)) ===
        JSON.stringify(expected.sort()),
      "ARCHIVE_ORPHAN_" + name.toUpperCase(),
    );
  exact(
    "pg",
    runs.map((r) => r.id),
  );
  exact(
    "evidence",
    runs.map((r) => r.id),
  );
  exact(
    "retired",
    runs.filter((r) => r.state === "RETIRED").map((r) => r.id),
  );
  exact(
    "cleaned",
    runs.filter((r) => r.state === "CLEANED").map((r) => r.id),
  );
  exact("slots", [...new Set(runs.map((r) => r.lineage))]);
  for (const lineage of new Set(runs.map((r) => r.lineage))) {
    const active = runs.filter(
      (r) => r.lineage === lineage && r.state === "STOPPED",
    );
    requireThat(
      active.length <= 1 &&
        JSON.stringify(childNames(d.root, "slots/" + lineage)) ===
          JSON.stringify(active.length ? ["active"] : []),
      "ARCHIVE_UNKNOWN_SLOT_RESOURCE",
    );
  }
  for (const cp of childNames(d.root, "checkpoints")) {
    requireThat(uuid.test(cp), "ARCHIVE_UNKNOWN_CHECKPOINT");
    const manifest = readJSON(
      path.join(d.root, "checkpoints", cp, "manifest.json"),
    );
    requireThat(
      manifest.id === cp &&
        manifest.complete === true &&
        runs.some((r) => r.id === manifest.run),
      "ARCHIVE_UNKNOWN_CHECKPOINT",
    );
  }
  return runs;
}
function runArchive(
  command: "create" | "verify",
  manifest: string,
  archive: string,
) {
  return JSON.parse(
    execFileSync(
      binary("python3"),
      [
        path.join(repository, "test_case/online/benchmark/archive.py"),
        command,
        manifest,
        archive,
      ],
      {
        env: cleanEnvironment(path.dirname(manifest)),
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10 * 60 * 1000,
        encoding: "utf8",
      },
    ),
  );
}
/** Read every tar entry and verify size/hash/type/mode, without extraction or execution. */
export function verifyArchive(directory: string) {
  noLinks(directory);
  runArchive(
    "verify",
    path.join(directory, "manifest.json"),
    path.join(directory, "facility.tar.gz"),
  );
  return true;
}
/** Library destination may be a temporary directory in tests; CLI must require the approved external mount. */
export async function archiveFacility(
  root: string,
  destination: string,
  apply = false,
): Promise<ArchiveResult> {
  deploymentGuard(repository, root);
  requireThat(
    root !== path.join(repository, ".local/benchmark"),
    "ARCHIVE_MIXED_ROOT",
  );
  noLinks(destination);
  requireThat(
    fs.statSync(destination).isDirectory() &&
      !inside(root, destination) &&
      !inside(destination, root),
    "ARCHIVE_DESTINATION_OVERLAP",
  );
  // Do not let Domains.use mint a marker and thereby claim pre-existing data.
  const markerPath = path.join(root, "facility.json");
  requireThat(fs.existsSync(markerPath), "ARCHIVE_UNMARKED_FACILITY");
  const markerBytes = read(markerPath),
    marker = JSON.parse(markerBytes.toString());
  requireThat(
    marker.version === 1 &&
      marker.repository === repository &&
      uuid.test(marker.nonce),
    "ARCHIVE_FOREIGN_FACILITY",
  );
  const sourceIdentity = identity(root);
  return lease(root, async () => {
    requireThat(
      identity(root) === sourceIdentity && read(markerPath).equals(markerBytes),
      "ARCHIVE_FACILITY_CHANGED",
    );
    const d = new Domains(root),
      runs = ownedStoppedRuns(d),
      entries = inventory(root);
    const summary: ArchiveResult = {
      status: "DRY_RUN",
      source: root,
      destination,
      files: entries.filter((e) => e.kind === "file").length,
      bytes: entries.reduce((n, e) => n + e.bytes, 0),
    };
    if (!apply) return summary;
    const id = randomUUID(),
      created = new Date(),
      parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(created);
    const day = ["year", "month", "day"]
      .map((kind) => parts.find((p) => p.type === kind)!.value)
      .join("");
    const dateDirectory = path.join(destination, day);
    const stage = path.join(dateDirectory, ".pending-" + id),
      published = path.join(dateDirectory, id);
    const localStage = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "secretary-archive-")),
    );
    fs.chmodSync(localStage, 0o700);
    const warnings: string[] = [];
    try {
      const manifest: ArchiveManifest = {
        schema: "secretary-facility-archive-v1",
        archive_id: id,
        created_at: created.toISOString(),
        source: root,
        source_identity: sourceIdentity,
        repository,
        facility_nonce: marker.nonce,
        root_mode: fs.statSync(root).mode & 0o777,
        runs: runs.map((r) => ({
          id: r.id,
          state: r.state,
          lineage: r.lineage,
        })),
        entries,
      };
      writeJSON(path.join(localStage, "manifest.json"), manifest);
      fs.writeFileSync(
        path.join(localStage, "RESTORE.md"),
        `# Retained benchmark facility\n\nArchive: facility.tar.gz. Manifest: manifest.json. Receipt: receipt.json.\n\nThis is a complete private stopped-state backup, including PostgreSQL files, credentials, CAS, workspaces, reports and original failures. Keep access restricted. Verify every tar member against the manifest before extraction. Extract only into a new private staging directory; never overwrite live data. PostgreSQL physical files require a compatible PG18 installation. Existing Core records contain absolute workspace paths: extracting at an arbitrary new pathname does not authorize booting it. Review the original canonical source path, ownership registry, processes and database identity before any explicit recovery. Do not start a retired run or attach this backup to the agile instance.\n\nOriginal source: ${root}\nCreated (UTC): ${created.toISOString()}\n`,
        { flag: "wx", mode: 0o600 },
      );
      // Build the complete package locally. Only four complete files cross to the target.
      const local = runArchive(
        "create",
        path.join(localStage, "manifest.json"),
        path.join(localStage, "facility.tar.gz"),
      );
      const archiveHash: string = local.archive_sha256,
        manifestHash = sha(read(path.join(localStage, "manifest.json")));
      const receipt = {
        schema: "secretary-facility-archive-receipt-v1",
        archive_id: id,
        source: root,
        source_identity: sourceIdentity,
        archive_sha256: archiveHash,
        manifest_sha256: manifestHash,
      };
      writeJSON(path.join(localStage, "receipt.json"), {
        ...receipt,
        state: "LOCAL_VERIFIED_SOURCE_RETAINED",
        verified_at: new Date().toISOString(),
      });
      noLinks(dateDirectory);
      fs.mkdirSync(dateDirectory, { recursive: true, mode: 0o700 });
      fs.mkdirSync(stage, { mode: 0o700 });
      for (const filename of [
        "facility.tar.gz",
        "manifest.json",
        "receipt.json",
        "RESTORE.md",
      ]) {
        const output = path.join(stage, filename);
        noLinks(output);
        fs.copyFileSync(
          path.join(localStage, filename),
          output,
          fs.constants.COPYFILE_EXCL,
        );
        fs.chmodSync(output, 0o600);
        const fd = fs.openSync(output, "r");
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
      // Verify from the destination itself, not just the local staging package.
      const remote = runArchive(
        "verify",
        path.join(stage, "manifest.json"),
        path.join(stage, "facility.tar.gz"),
      );
      requireThat(
        remote.archive_sha256 === archiveHash &&
          sha(read(path.join(stage, "manifest.json"))) === manifestHash,
        "ARCHIVE_TRANSFER_MISMATCH",
      );
      requireThat(
        identity(root) === sourceIdentity &&
          read(markerPath).equals(markerBytes) &&
          JSON.stringify(inventory(root)) === JSON.stringify(entries),
        "ARCHIVE_SOURCE_CHANGED",
      );
      ownedStoppedRuns(d);
      writeJSON(path.join(stage, "receipt.json"), {
        ...receipt,
        state: "VERIFIED_SOURCE_RETAINED",
        verified_at: new Date().toISOString(),
      });
      syncDir(stage);
      requireThat(!fs.existsSync(published), "ARCHIVE_DESTINATION_EXISTS");
      fs.renameSync(stage, published);
      syncDir(dateDirectory);
      requireThat(
        identity(root) === sourceIdentity &&
          JSON.stringify(inventory(root)) === JSON.stringify(entries),
        "ARCHIVE_SOURCE_CHANGED",
      );
      // From here a complete, verified, fsynced backup is already published. Cleanup
      // failures are explicit warnings, never a false claim that the source is gone.
      try {
        fs.rmSync(root, { recursive: true });
        syncDir(path.dirname(root));
      } catch (error) {
        warnings.push(
          "SOURCE_CLEANUP_" +
            ((error as NodeJS.ErrnoException).code ?? "FAILED"),
        );
      }
      const removed = !fs.existsSync(root);
      try {
        writeJSON(path.join(published, "receipt.json"), {
          ...receipt,
          state: removed
            ? "ARCHIVED_SOURCE_REMOVED"
            : "ARCHIVED_SOURCE_CLEANUP_INCOMPLETE",
          finished_at: new Date().toISOString(),
          warnings,
        });
      } catch (error) {
        warnings.push(
          "RECEIPT_UPDATE_" +
            ((error as NodeJS.ErrnoException).code ?? "FAILED"),
        );
      }
      return {
        ...summary,
        status: "ARCHIVED",
        archive_directory: published,
        archive_sha256: archiveHash,
        source_removed: removed,
        warnings,
      };
    } finally {
      // This is our exclusive local temporary package. A failure retains the source
      // and any destination .pending directory; there is no need to keep a third copy.
      try {
        fs.rmSync(localStage, { recursive: true, force: true });
      } catch {
        warnings.push("LOCAL_TEMP_CLEANUP_FAILED:" + localStage);
      }
    }
  });
}
