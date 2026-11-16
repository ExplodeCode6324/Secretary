import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertLease,
  type LeaseContext,
  inside,
  mkdir,
  noLinks,
  read,
  repository,
  requireThat,
  sha,
  syncDir,
  writeJSON,
} from "./io.ts";

export type GradeFile = { name: string; bytes: number; sha256: string };
export type GradeOutput = { name: string; content: Buffer; reuse?: boolean };
export type GradeCommit = {
  version: string;
  transaction_id: string;
  operation: string;
  files: GradeFile[];
  parent_child: any;
};
export const gradeJSONBytes = (v: unknown) =>
  Buffer.from(JSON.stringify(v, null, 2) + "\n");
export const gradeUUID = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);

export function gradePath(root: string, name: string) {
  requireThat(
    typeof name === "string" &&
      name.length > 0 &&
      !path.isAbsolute(name) &&
      name.split("/").every((p) => p && p !== "." && p !== "..") &&
      !name.includes("\\"),
    "GRADE_RELATIVE_PATH_INVALID",
  );
  const file = path.resolve(root, name);
  requireThat(inside(root, file), "GRADE_PATH_ESCAPE");
  noLinks(file);
  return file;
}
export function readOwnedGradeFile(root: string, name: string) {
  const file = gradePath(root, name),
    st = fs.lstatSync(file);
  requireThat(
    st.isFile() &&
      st.nlink === 1 &&
      st.uid === process.getuid?.() &&
      (st.mode & 0o077) === 0,
    "GRADE_OWNED_FILE_REQUIRED",
  );
  return read(file);
}
export function readOwnedGradeJSON(root: string, name: string) {
  return JSON.parse(readOwnedGradeFile(root, name).toString());
}
export function requireExistingGradeFacility(root: string) {
  const marker = readOwnedGradeJSON(root, "facility.json");
  requireThat(
    marker.repository === repository && gradeUUID(marker.nonce),
    "FOREIGN_FACILITY",
  );
  return marker;
}
function fileList(root: string, directory: string): string[] {
  const base = gradePath(root, directory);
  if (!fs.existsSync(base)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const relative = directory + "/" + entry.name;
    requireThat(!entry.isSymbolicLink(), "GRADE_SYMLINK_FORBIDDEN");
    if (entry.isDirectory()) result.push(...fileList(root, relative));
    else {
      requireThat(entry.isFile(), "GRADE_FILE_TYPE_INVALID");
      result.push(relative);
    }
  }
  return result.sort();
}
function transactionNames(root: string) {
  const dir = path.join(root, "oracles/.grading-transactions");
  if (!fs.existsSync(dir)) return [];
  noLinks(dir);
  return fs.readdirSync(dir).map((id) => {
    requireThat(gradeUUID(id), "GRADE_TRANSACTION_NAME_INVALID");
    return id;
  });
}
function validateCommit(root: string, id: string): GradeCommit {
  const commit = readOwnedGradeJSON(root, `oracles/grading-commit-${id}.json`);
  const prepared = readOwnedGradeJSON(
    root,
    `oracles/.grading-transactions/${id}/prepare.json`,
  );
  requireThat(
    commit.version === "secretary-grading-commit-v1" &&
      commit.transaction_id === id &&
      JSON.stringify(commit) === JSON.stringify(prepared) &&
      Array.isArray(commit.files) &&
      new Set(commit.files.map((f: GradeFile) => f.name)).size ===
        commit.files.length,
    "GRADE_COMMIT_CHANGED",
  );
  for (const file of commit.files as GradeFile[]) {
    requireThat(
      file.name.startsWith("oracles/") &&
        !file.name.startsWith("oracles/.grading-") &&
        !file.name.startsWith("oracles/grading-commit-"),
      "GRADE_COMMIT_PATH_INVALID",
    );
    const bytes = readOwnedGradeFile(root, file.name);
    requireThat(
      bytes.length === file.bytes && sha(bytes) === file.sha256,
      "GRADE_COMMITTED_FILE_CHANGED",
    );
  }
  return commit;
}

/** Readers never infer historical status merely from a legacy-looking filename. */
export function assertGradeStore(root: string) {
  const commits = new Map<string, GradeCommit>();
  for (const id of transactionNames(root)) {
    requireThat(
      fs.existsSync(path.join(root, "oracles", `grading-commit-${id}.json`)),
      "GRADE_TRANSACTION_UNCOMMITTED",
    );
    const commit = validateCommit(root, id);
    for (const f of commit.files) {
      requireThat(!commits.has(f.name), "GRADE_FILE_MULTIPLE_COMMITS");
      commits.set(f.name, commit);
    }
  }
  const oracles = path.join(root, "oracles");
  if (!fs.existsSync(oracles)) return commits;
  for (const name of fs.readdirSync(oracles)) {
    const m = /^grading-commit-([a-f0-9-]{36})\.json$/.exec(name);
    if (m)
      requireThat(
        fs.existsSync(
          path.join(oracles, ".grading-transactions", m[1], "prepare.json"),
        ),
        "GRADE_COMMIT_JOURNAL_MISSING",
      );
  }
  const baselines = fileList(root, "oracles/migrations").filter((n) =>
    n.endsWith("/history-inventory.json"),
  );
  for (const file of baselines) {
    const prefix = file.slice(0, -"history-inventory.json".length);
    const manifest = readOwnedGradeJSON(root, prefix + "manifest.json");
    const inventoryBytes = readOwnedGradeFile(root, file);
    requireThat(
      sha(inventoryBytes) === manifest.history_inventory_sha256,
      "GRADE_BASELINE_CHANGED",
    );
    const inventory = JSON.parse(inventoryBytes.toString());
    const nonce = requireExistingGradeFacility(root).nonce;
    requireThat(Array.isArray(inventory.files), "GRADE_BASELINE_INVALID");
    const baseline = inventory.files.filter(
      (f: any) => f.namespace === "facility" && f.facility_nonce === nonce,
    );
    requireThat(
      baseline.some((f: any) => f.relative === "facility.json"),
      "GRADE_BASELINE_FACILITY_MISSING",
    );
    const names = new Set<string>();
    for (const f of baseline) {
      requireThat(!names.has(f.relative), "GRADE_BASELINE_DUPLICATE");
      names.add(f.relative);
      const bytes = readOwnedGradeFile(root, f.relative);
      requireThat(
        bytes.length === f.bytes && sha(bytes) === f.sha256,
        "GRADE_BASELINE_FILE_CHANGED",
      );
    }
    for (const name of fileList(root, "oracles")) {
      if (
        name.startsWith("oracles/.grading-") ||
        name.startsWith("oracles/grading-commit-")
      )
        continue;
      if (names.has(name)) continue;
      requireThat(commits.has(name), "GRADE_UNMARKED_NEW_FILE");
    }
  }
  // A child cannot become historical by removing its journal/manifest.
  for (const name of fs.readdirSync(oracles)) {
    if (!/^grade-batch-[a-f0-9-]{36}\.json$/.test(name)) continue;
    const batch = readOwnedGradeJSON(root, "oracles/" + name);
    if (
      batch.payload?.version ===
      "secretary-semantic-grade-batch-v3-judge-migration-v1"
    ) {
      requireThat(commits.has("oracles/" + name), "GRADE_CHILD_COMMIT_MISSING");
    }
  }
  return commits;
}

/** Publish immutable files. prepare is durable before any live pathname exists. */
export function commitGradeFiles(
  root: string,
  context: LeaseContext,
  operation: string,
  outputs: GradeOutput[],
  parentChild: any = null,
  transactionID: string = randomUUID(),
  expectedPreparationHash?: string,
) {
  assertLease(context, root);
  requireExistingGradeFacility(root);
  assertGradeStore(root);
  requireThat(
    gradeUUID(transactionID) &&
      outputs.length > 0 &&
      new Set(outputs.map((f) => f.name)).size === outputs.length,
    "GRADE_TRANSACTION_INVALID",
  );
  const publish: GradeOutput[] = [];
  for (const out of outputs) {
    requireThat(
      out.name.startsWith("oracles/") &&
        !out.name.startsWith("oracles/.grading-") &&
        !out.name.startsWith("oracles/grading-commit-"),
      "GRADE_OUTPUT_PATH_INVALID",
    );
    const dest = gradePath(root, out.name);
    if (fs.existsSync(dest)) {
      requireThat(
        out.reuse === true &&
          out.name.startsWith("oracles/migrations/") &&
          sha(readOwnedGradeFile(root, out.name)) === sha(out.content),
        "GRADE_NO_OVERWRITE",
      );
    } else publish.push(out);
  }
  requireThat(publish.length > 0, "GRADE_TRANSACTION_ALREADY_PRESENT");
  const dir = gradePath(root, `oracles/.grading-transactions/${transactionID}`);
  requireThat(!fs.existsSync(dir), "GRADE_TRANSACTION_ALREADY_PRESENT");
  const marker: GradeCommit = {
    version: "secretary-grading-commit-v1",
    transaction_id: transactionID,
    operation,
    files: publish.map((f) => ({
      name: f.name,
      bytes: f.content.length,
      sha256: sha(f.content),
    })),
    parent_child: parentChild,
  };
  if (expectedPreparationHash !== undefined)
    requireThat(
      sha(gradeJSONBytes(marker)) === expectedPreparationHash,
      "GRADE_PREPARATION_COPY_MISMATCH",
    );
  mkdir(path.dirname(dir));
  fs.mkdirSync(dir, { mode: 0o700 });
  writeJSON(path.join(dir, "prepare.json"), marker);
  syncDir(path.dirname(dir));
  for (const out of publish) {
    context.assertActive();
    const stage = path.join(dir, "files", out.name);
    mkdir(path.dirname(stage));
    const fd = fs.openSync(
      stage,
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_WRONLY |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fs.writeFileSync(fd, out.content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    syncDir(path.dirname(stage));
  }
  // Verify every staged byte before promoting any file; no random/timestamp data
  // is introduced here beyond the explicitly preallocated transaction ID.
  for (const f of marker.files) {
    const bytes = readOwnedGradeFile(
      root,
      `oracles/.grading-transactions/${transactionID}/files/${f.name}`,
    );
    requireThat(
      bytes.length === f.bytes && sha(bytes) === f.sha256,
      "GRADE_STAGING_CHANGED",
    );
  }
  for (const out of publish) {
    assertLease(context, root);
    const stage = path.join(dir, "files", out.name),
      dest = gradePath(root, out.name);
    mkdir(path.dirname(dest));
    // link is no-replace even across the lease-liveness residual window. The
    // short two-link interval remains uncommitted and unreadable by the store.
    fs.linkSync(stage, dest);
    fs.unlinkSync(stage);
    syncDir(path.dirname(dest));
    syncDir(path.dirname(stage));
  }
  assertLease(context, root);
  const markerFile = path.join(
    root,
    "oracles",
    `grading-commit-${transactionID}.json`,
  );
  requireThat(!fs.existsSync(markerFile), "GRADE_NO_OVERWRITE");
  writeJSON(markerFile, marker);
  assertGradeStore(root);
  return {
    transaction_id: transactionID,
    marker: markerFile,
    files: marker.files,
  };
}

/** Only uncommitted local operations can be quarantined; original evidence stays. */
export function reconcileGradeTransaction(
  root: string,
  context: LeaseContext,
  id: string,
  expectedPrepareHash: string,
) {
  assertLease(context, root);
  requireExistingGradeFacility(root);
  requireThat(
    gradeUUID(id) &&
      !fs.existsSync(path.join(root, "oracles", `grading-commit-${id}.json`)),
    "GRADE_RECONCILE_COMMITTED_OR_INVALID",
  );
  const preparation = readOwnedGradeFile(
    root,
    `oracles/.grading-transactions/${id}/prepare.json`,
  );
  requireThat(
    sha(preparation) === expectedPrepareHash,
    "GRADE_RECONCILE_UNREVIEWED",
  );
  const prepared = JSON.parse(preparation.toString()) as GradeCommit;
  requireThat(
    prepared.transaction_id === id && Array.isArray(prepared.files),
    "GRADE_RECONCILE_INVALID",
  );
  const quarantineID = randomUUID(),
    q = gradePath(root, `oracles/.grading-quarantine/${quarantineID}`);
  // A no-replace link can be interrupted before its stage link is removed.
  // Accept two links only when these exact journal paths share one inode.
  const linkedStages: string[] = [];
  const baselineNames = new Set<string>();
  for (const file of fileList(root, "oracles/migrations").filter((n) =>
    n.endsWith("/history-inventory.json"),
  )) {
    const inv = readOwnedGradeJSON(root, file),
      nonce = requireExistingGradeFacility(root).nonce;
    for (const f of inv.files ?? [])
      if (f.namespace === "facility" && f.facility_nonce === nonce)
        baselineNames.add(f.relative);
  }
  for (const f of prepared.files) {
    requireThat(
      !baselineNames.has(f.name),
      "GRADE_RECONCILE_BASELINE_FORBIDDEN",
    );
    requireThat(
      f.name.startsWith("oracles/") &&
        !f.name.startsWith("oracles/.grading-") &&
        !f.name.startsWith("oracles/grading-commit-"),
      "GRADE_RECONCILE_PATH_INVALID",
    );
    const names = [
      f.name,
      `oracles/.grading-transactions/${id}/files/${f.name}`,
    ];
    const paths = names.map((n) => gradePath(root, n));
    const stats = paths.map((p) => (fs.existsSync(p) ? fs.lstatSync(p) : null));
    const paired =
      stats.every(
        (s) =>
          s?.isFile() &&
          s.nlink === 2 &&
          s.uid === process.getuid?.() &&
          (s.mode & 0o077) === 0,
      ) &&
      stats[0]!.ino === stats[1]!.ino &&
      stats[0]!.dev === stats[1]!.dev;
    for (let i = 0; i < names.length; i++) {
      if (!stats[i]) continue;
      const bytes = paired
        ? fs.readFileSync(paths[i])
        : readOwnedGradeFile(root, names[i]);
      requireThat(
        bytes.length === f.bytes && sha(bytes) === f.sha256,
        "GRADE_RECONCILE_CHANGED",
      );
    }
    if (paired) linkedStages.push(paths[1]);
  }
  mkdir(q);
  writeJSON(path.join(q, "reconciliation.json"), {
    version: "secretary-grading-reconciliation-v1",
    transaction_id: id,
    quarantine_id: quarantineID,
    original: prepared,
    interrupted_stage_links: linkedStages.map((p) => path.relative(root, p)),
    at: new Date().toISOString(),
    action: "QUARANTINE_ONLY_NO_MODEL_RETRY",
  });
  for (const stage of linkedStages) {
    assertLease(context, root);
    fs.unlinkSync(stage);
    syncDir(path.dirname(stage));
  }
  for (const f of prepared.files) {
    const dest = gradePath(root, f.name);
    if (!fs.existsSync(dest)) continue;
    assertLease(context, root);
    const target = path.join(q, "published", f.name);
    mkdir(path.dirname(target));
    fs.renameSync(dest, target);
    syncDir(path.dirname(dest));
    syncDir(path.dirname(target));
  }
  assertLease(context, root);
  fs.renameSync(
    path.join(root, "oracles/.grading-transactions", id),
    path.join(q, "transaction"),
  );
  syncDir(path.join(root, "oracles/.grading-transactions"));
  syncDir(q);
  assertGradeStore(root);
  return {
    quarantine_id: quarantineID,
    transaction_id: id,
    status: "QUARANTINED_NOT_RETRIED",
  };
}
