import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Domains, configuration } from "../../online/benchmark/domain.ts";
import {
  archiveFacility,
  assertArchiveTargetExternal,
  verifyArchive,
} from "../../online/benchmark/archive.ts";
import {
  read,
  readJSON,
  repository,
  writeJSON,
} from "../../online/benchmark/io.ts";
import { stopDatabase } from "../../online/benchmark/postgres.ts";

const rootPath = () =>
  path.join(repository, ".local/benchmark/archive-tests", randomUUID());
const temporary = () =>
  fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "secretary-archive-test-")),
  );

test("archive never adopts an unmarked/mixed root and requires an external mounted volume at the CLI boundary", async () => {
  const root = rootPath(),
    target = temporary();
  try {
    await assert.rejects(
      () => archiveFacility(root, target),
      /UNMARKED_FACILITY/,
    );
    assert.equal(fs.existsSync(root), false);
    await assert.rejects(
      () => archiveFacility(path.join(repository, ".local/benchmark"), target),
      /MIXED_ROOT/,
    );
    assert.throws(
      () => assertArchiveTargetExternal(repository, target, target),
      /MOUNT_UNAVAILABLE|SAME_VOLUME/,
    );
  } finally {
    fs.rmSync(target, { recursive: true });
  }
});

test(
  "complete stopped Core/PG facility archives with original failures; publication failure preserves source",
  { timeout: 120000 },
  async (t) => {
    const root = rootPath(),
      target = temporary();
    let runID: string | undefined;
    try {
      await Domains.use(root, async (d) => {
        const run = await d.start((await d.create()).id);
        runID = run.id;
      });
      await assert.rejects(
        () => archiveFacility(root, target, true),
        /RUN_NOT_STOPPED/,
      );
      assert.deepEqual(fs.readdirSync(target), []);
      await Domains.use(root, async (d) => {
        await d.seal(runID!);
      });
      const run = readJSON(path.join(root, "runs", runID + ".json"));
      writeJSON(path.join(root, "configs", "fixture.json"), configuration);
      const failure = "failure-" + randomUUID() + ".json";
      writeJSON(path.join(root, failure), {
        case: "first-failure",
        status: "FAIL",
        reason: "Synthetic original evidence must survive archival",
      });
      const evidence = path.join(root, "evidence", runID!);
      fs.mkdirSync(path.join(evidence, "empty-evidence"));
      const held = readJSON(path.join(root, "runs", runID + ".json"));
      writeJSON(path.join(root, "runs", runID + ".json"), {
        ...held,
        state: "INCOMPLETE",
      });
      await assert.rejects(
        () => archiveFacility(root, target),
        /RUN_NOT_STOPPED/,
      );
      writeJSON(path.join(root, "runs", runID + ".json"), held);
      fs.mkdirSync(path.join(root, "pg", randomUUID()));
      await assert.rejects(() => archiveFacility(root, target), /ORPHAN_PG/);
      for (const name of fs.readdirSync(path.join(root, "pg")))
        if (name !== runID) fs.rmdirSync(path.join(root, "pg", name));
      fs.writeFileSync(
        path.join(root, "unexpected-private-data"),
        "do not adopt",
      );
      await assert.rejects(
        () => archiveFacility(root, target),
        /UNKNOWN_TOP_LEVEL/,
      );
      fs.unlinkSync(path.join(root, "unexpected-private-data"));
      fs.symlinkSync(target, path.join(evidence, "escape"));
      await assert.rejects(() => archiveFacility(root, target), /SYMLINK_TREE/);
      fs.unlinkSync(path.join(evidence, "escape"));
      fs.linkSync(path.join(root, failure), path.join(evidence, "hardlink"));
      await assert.rejects(
        () => archiveFacility(root, target),
        /UNSAFE_TREE_ENTRY/,
      );
      fs.unlinkSync(path.join(evidence, "hardlink"));
      const dry = await archiveFacility(root, target);
      assert.equal(dry.status, "DRY_RUN");
      assert(dry.bytes > 1_000_000);
      assert.deepEqual(fs.readdirSync(target), []);
      const copy = fs.copyFileSync.bind(fs);
      let localPackageVerified = false;
      t.mock.method(
        fs,
        "copyFileSync",
        (source: any, destination: any, mode?: number) => {
          if (path.basename(String(source)) === "facility.tar.gz") {
            assert(!String(source).startsWith(target + path.sep));
            assert(verifyArchive(path.dirname(String(source))));
            localPackageVerified = true;
            fs.writeFileSync(destination, "injected corrupt transfer", {
              flag: "wx",
              mode: 0o600,
            });
            return;
          }
          return copy(source, destination, mode);
        },
      );
      try {
        await assert.rejects(() => archiveFacility(root, target, true));
      } finally {
        t.mock.restoreAll();
      }
      assert(localPackageVerified);
      assert(fs.existsSync(path.join(root, failure)));
      const rename = fs.renameSync.bind(fs);
      t.mock.method(fs, "renameSync", (source: any, destination: any) => {
        if (path.basename(String(source)).startsWith(".pending-"))
          throw Error("INJECTED_PUBLICATION_FAILURE");
        return rename(source, destination);
      });
      try {
        await assert.rejects(
          () => archiveFacility(root, target, true),
          /INJECTED_PUBLICATION_FAILURE/,
        );
      } finally {
        t.mock.restoreAll();
      }
      assert(fs.existsSync(path.join(root, failure)));
      assert(fs.existsSync(run.database.directory));
      const pendingDirectory = fs
        .readdirSync(target)
        .flatMap((day) =>
          fs
            .readdirSync(path.join(target, day))
            .map((name) => path.join(target, day, name)),
        )
        .find((p) => path.basename(p).startsWith(".pending-"));
      assert(pendingDirectory);
      // One transfer-failure package is intentionally corrupt; the later publication-failure
      // package is complete and must be independently verifiable.
      const pendingPackages = fs
        .readdirSync(target)
        .flatMap((day) =>
          fs
            .readdirSync(path.join(target, day))
            .map((name) => path.join(target, day, name)),
        );
      assert(
        pendingPackages.some((p) => {
          try {
            return verifyArchive(p);
          } catch {
            return false;
          }
        }),
      );
      const result = await archiveFacility(root, target, true);
      assert.equal(result.status, "ARCHIVED");
      assert.equal(result.source_removed, true);
      assert.deepEqual(result.warnings, []);
      assert.equal(fs.existsSync(root), false);
      assert(result.archive_directory);
      assert(verifyArchive(result.archive_directory!));
      const manifest = readJSON(
        path.join(result.archive_directory, "manifest.json"),
      );
      assert(manifest.entries.some((entry: any) => entry.path === failure));
      assert(
        manifest.entries.some(
          (entry: any) =>
            entry.path === `evidence/${runID}/empty-evidence` &&
            entry.kind === "directory",
        ),
      );
      assert(
        manifest.entries.some(
          (entry: any) =>
            entry.path.startsWith(`pg/${runID}/data/base/`) &&
            entry.kind === "file",
        ),
      );
      assert(
        manifest.entries.some((entry: any) =>
          entry.path.endsWith("core/journal.jsonl"),
        ),
      );
      assert.equal(
        readJSON(path.join(result.archive_directory, "receipt.json")).state,
        "ARCHIVED_SOURCE_REMOVED",
      );
      const archive = path.join(result.archive_directory, "facility.tar.gz"),
        good = read(archive);
      fs.writeFileSync(archive, Buffer.from("not a gzip archive"));
      assert.throws(() => verifyArchive(result.archive_directory!));
      fs.writeFileSync(archive, good);
      assert(verifyArchive(result.archive_directory!));
    } finally {
      t.mock.restoreAll();
      // Failure leaves the known test facility retained, but never an active worker/database.
      if (runID && fs.existsSync(root))
        await Domains.use(root, async (d) => {
          const run = await d.stop(runID!);
          await stopDatabase(run.database);
        });
      // Temporary test archive data only; actual NAS is never touched by this suite.
      fs.rmSync(target, { recursive: true, force: true });
    }
  },
);
