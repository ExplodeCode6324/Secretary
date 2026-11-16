import fs from "node:fs";
import path from "node:path";
import { assertCampaignClosed } from "./campaign.ts";
import {
  batchJudgePolicy,
  deriveMigrationBatch,
  migrationDirectory,
  migrationExportTransaction,
  migrationAnchorRelative,
  migrationBatchVersion,
  legacyBatchVersion,
  publicMigrationRequest,
  validateMigrationAnchor,
  validateMigrationInventories,
  validateMigrationManifest,
  type MigrationBundle,
  type MigrationManifest,
} from "./grading-migration.ts";
import {
  assertGradeStore,
  assertPlannedGradeBaseline,
  commitGradeFiles,
  gradeJSONBytes,
  gradePath,
  gradeUUID,
  readOwnedGradeFile,
  readOwnedGradeJSON,
  requireExistingGradeFacility,
  type GradeOutput,
} from "./grading-transaction.ts";
import {
  assertLease,
  type LeaseContext,
  readJSON,
  repository,
  requireThat,
  sha,
  processStatus,
  noLinks,
  inside,
} from "./io.ts";

export function assertGradingStopped(root: string) {
  assertCampaignClosed(root);
  for (const name of fs
    .readdirSync(path.join(root, "runs"))
    .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))) {
    const run = readJSON(path.join(root, "runs", name));
    requireThat(
      ["STOPPED", "RETIRED", "CLEANED"].includes(run.state) &&
        (!run.process || processStatus(run.process) === "STOPPED"),
      "GRADE_BATCH_REQUIRES_STOPPED_RUNS",
    );
  }
}
export function readTrackedMigrationAnchor() {
  const file = path.join(repository, migrationAnchorRelative);
  noLinks(file);
  return readJSON(file);
}
function ledgerFiles(inventory: any): any[] {
  requireThat(Array.isArray(inventory.files), "MIGRATION_LEDGER_LIST_INVALID");
  const files = inventory.files.filter(
    (f: any) => f.namespace === "review-ledger",
  );
  requireThat(
    files.length > 0 &&
      new Set(files.map((f: any) => f.relative)).size === files.length,
    "MIGRATION_LEDGER_LIST_INVALID",
  );
  return files;
}
function readExternalLedger(directory: string, relative: string) {
  requireThat(
    inside(path.join(repository, ".local/reviews"), directory),
    "MIGRATION_LEDGER_DIRECTORY_INVALID",
  );
  // An empty historical clipboard capture is valid retained evidence, though it
  // can never be imported as a verdict. Preserve that first extraction failure.
  return readOwnedGradeFile(directory, relative);
}
/** A local inventory copy removes dependencies on the original review directory. */
export function verifyMigrationInventories(
  root: string,
  bundle: MigrationBundle,
  copiedLedger = false,
) {
  validateMigrationInventories(bundle);
  const nonce = requireExistingGradeFacility(root).nonce;
  const baseline = bundle.history_inventory.files.filter(
    (f: any) => f.namespace === "facility" && f.facility_nonce === nonce,
  );
  requireThat(
    baseline.some((f: any) => f.relative === "facility.json"),
    "MIGRATION_BASELINE_MISSING",
  );
  for (const f of baseline) {
    const b = readOwnedGradeFile(root, f.relative);
    requireThat(
      b.length === f.bytes && sha(b) === f.sha256,
      "MIGRATION_BASELINE_CHANGED",
    );
  }
  for (const f of ledgerFiles(bundle.submission_inventory)) {
    const name = copiedLedger
      ? `${migrationDirectory(bundle.manifest)}/review-ledger/${f.relative}`
      : null;
    const b = name
      ? readOwnedGradeFile(root, name)
      : readExternalLedger(bundle.review_ledger_directory, f.relative);
    requireThat(
      b.length === f.bytes && sha(b) === f.sha256,
      "MIGRATION_LEDGER_CHANGED",
    );
    // The full original operator ledgers, not a derived zero-count alone,
    // must independently agree that each tail parent has never been sent.
    if (f.kind === "BATCH_INDEX") {
      const index = JSON.parse(b.toString());
      requireThat(
        Array.isArray(index.batches) && index.batches.length === 15,
        "MIGRATION_LEDGER_INVALID",
      );
      for (const e of bundle.manifest.entries) {
        const row = index.batches.find(
          (x: any) => x.batch_id === e.parent_batch_id,
        );
        requireThat(
          row?.submission_status === "NOT_SENT" &&
            (row.attempts ?? []).length === 0 &&
            (row.import_attempts ?? []).length === 0 &&
            JSON.stringify(row.runs) === JSON.stringify(e.runs),
          "MIGRATION_PARENT_ALREADY_SUBMITTED",
        );
      }
    } else if (f.kind === "SUBMISSIONS") {
      const rows = JSON.parse(b.toString());
      requireThat(
        Array.isArray(rows) &&
          !rows.some((x: any) =>
            bundle.manifest.entries.some(
              (e) => e.parent_batch_id === x.batch_id,
            ),
          ),
        "MIGRATION_PARENT_ALREADY_SUBMITTED",
      );
    }
  }
  requireThat(
    ledgerFiles(bundle.submission_inventory).some(
      (f) => f.kind === "BATCH_INDEX",
    ) &&
      ledgerFiles(bundle.submission_inventory).filter(
        (f) => f.kind === "SUBMISSIONS",
      ).length >= 2,
    "MIGRATION_LEDGER_EVIDENCE_MISSING",
  );
}
export function loadMigrationBundle(
  root: string,
  manifestFile: string,
  trustedAnchor?: any,
): MigrationBundle {
  requireThat(
    /^oracles\/migrations\/[a-f0-9-]{36}\/manifest\.json$/.test(manifestFile),
    "MIGRATION_MANIFEST_PATH_INVALID",
  );
  const manifest = readOwnedGradeJSON(root, manifestFile) as MigrationManifest;
  validateMigrationManifest(manifest);
  requireThat(
    manifestFile === migrationDirectory(manifest) + "/manifest.json",
    "MIGRATION_MANIFEST_PATH_INVALID",
  );
  validateMigrationAnchor(
    manifest,
    trustedAnchor ?? readTrackedMigrationAnchor(),
  );
  const dir = migrationDirectory(manifest);
  const bundle = {
    manifest,
    history_inventory: readOwnedGradeJSON(
      root,
      dir + "/history-inventory.json",
    ),
    submission_inventory: readOwnedGradeJSON(
      root,
      dir + "/submission-inventory.json",
    ),
    review_ledger_directory: path.join(root, dir, "review-ledger"),
  };
  verifyMigrationInventories(root, bundle, true);
  return bundle;
}

export function loadGradeBatch(
  root: string,
  id: string,
  trustedAnchor?: any,
): {
  batch: any;
  privateData: any;
  policy: ReturnType<typeof batchJudgePolicy>;
} {
  requireThat(gradeUUID(id), "GRADE_BATCH_ID_INVALID");
  const commits = assertGradeStore(root);
  const name = `oracles/grade-batch-${id}.json`,
    privateName = `oracles/grade-batch-${id}-private.json`;
  const batch = readOwnedGradeJSON(root, name),
    privateData = readOwnedGradeJSON(root, privateName);
  requireThat(
    batch.batch_id === id &&
      batch.payload_sha256 === sha(JSON.stringify(batch.payload)) &&
      batch.private_data_sha256 === sha(JSON.stringify(privateData)),
    "GRADE_BATCH_CHANGED",
  );
  const policy = batchJudgePolicy(batch);
  if (batch.payload.version === legacyBatchVersion) {
    for (const m of privateData.mapping) {
      requireThat(gradeUUID(m.run), "GRADE_BATCH_RUNS_INVALID");
      const current = readOwnedGradeJSON(
        root,
        `oracles/${m.run}-sealed-v3.json`,
      );
      const frozen = batch.payload.packets.find(
        (p: any) => p.packet_id === m.packet_id,
      );
      requireThat(
        frozen && JSON.stringify(current) === JSON.stringify(frozen),
        "GRADE_BATCH_SOURCE_CHANGED",
      );
    }
  } else {
    requireThat(
      batch.payload.version === migrationBatchVersion &&
        batch.migration?.version === "secretary-judge-migration-binding-v1",
      "MIGRATION_BINDING_INVALID",
    );
    const { manifest } = loadMigrationBundle(
      root,
      batch.migration.manifest_file,
      trustedAnchor,
    );
    const entry = manifest.entries.find((e) => e.child_batch_id === id);
    requireThat(
      entry &&
        entry.facility_nonce === requireExistingGradeFacility(root).nonce,
      "MIGRATION_FACILITY_MISMATCH",
    );
    const parent = loadGradeBatch(root, entry.parent_batch_id, trustedAnchor);
    requireThat(
      parent.batch.payload.version === legacyBatchVersion,
      "MIGRATION_PARENT_NOT_LEGACY",
    );
    requireThat(
      sha(
        readOwnedGradeFile(
          root,
          `oracles/grade-batch-${entry.parent_batch_id}.json`,
        ),
      ) === entry.parent_file_sha256 &&
        sha(
          readOwnedGradeFile(
            root,
            `oracles/grade-batch-${entry.parent_batch_id}-private.json`,
          ),
        ) === entry.parent_private_file_sha256,
      "MIGRATION_PARENT_FILE_CHANGED",
    );
    const expected = deriveMigrationBatch(
      parent.batch,
      parent.privateData,
      entry,
      manifest,
    );
    requireThat(
      JSON.stringify(batch) === JSON.stringify(expected) &&
        readOwnedGradeFile(root, privateName).equals(
          readOwnedGradeFile(
            root,
            `oracles/grade-batch-${entry.parent_batch_id}-private.json`,
          ),
        ),
      "MIGRATION_DERIVATION_CHANGED",
    );
    const indexName = `${migrationDirectory(manifest)}/parent-${entry.parent_batch_id}-child.json`;
    const index = readOwnedGradeJSON(root, indexName);
    const tx = migrationExportTransaction(manifest, entry);
    requireThat(
      JSON.stringify(index) ===
        JSON.stringify({
          version: "secretary-judge-migration-index-v1",
          parent_batch_id: entry.parent_batch_id,
          child_batch_id: id,
          export_transaction_id: tx,
        }) &&
        [name, privateName, indexName].every(
          (n) => commits.get(n)?.transaction_id === tx,
        ),
      "MIGRATION_EXPORT_COMMIT_MISSING",
    );
  }
  return { batch, privateData, policy };
}

export function supersededGradeParent(root: string, parent: string) {
  for (const name of fs.readdirSync(path.join(root, "oracles"))) {
    if (!/^grade-batch-[a-f0-9-]{36}\.json$/.test(name)) continue;
    const b = readOwnedGradeJSON(root, "oracles/" + name);
    if (
      b.payload?.version === migrationBatchVersion &&
      b.migration?.parent_batch_id === parent
    )
      return true;
  }
  return false;
}

export function exportJudgeMigration(
  root: string,
  context: LeaseContext,
  bundle: MigrationBundle,
  childID: string,
  trustedAnchor?: any,
  expectedPreparationHash?: string,
) {
  assertLease(context, root);
  assertGradingStopped(root);
  assertGradeStore(root);
  verifyMigrationInventories(root, bundle);
  assertPlannedGradeBaseline(root, bundle.history_inventory);
  validateMigrationAnchor(
    bundle.manifest,
    trustedAnchor ?? readTrackedMigrationAnchor(),
  );
  const manifest = bundle.manifest,
    entry = manifest.entries.find((e) => e.child_batch_id === childID);
  requireThat(
    entry && entry.facility_nonce === requireExistingGradeFacility(root).nonce,
    "MIGRATION_FACILITY_MISMATCH",
  );
  const parent = loadGradeBatch(root, entry.parent_batch_id, trustedAnchor);
  requireThat(
    sha(
      readOwnedGradeFile(
        root,
        `oracles/grade-batch-${entry.parent_batch_id}.json`,
      ),
    ) === entry.parent_file_sha256 &&
      sha(
        readOwnedGradeFile(
          root,
          `oracles/grade-batch-${entry.parent_batch_id}-private.json`,
        ),
      ) === entry.parent_private_file_sha256,
    "MIGRATION_PARENT_FILE_CHANGED",
  );

  requireThat(
    !supersededGradeParent(root, entry.parent_batch_id),
    "MIGRATION_PARENT_ALREADY_RESERVED",
  );
  const dir = path.join(root, "oracles");
  for (const name of fs.readdirSync(dir)) {
    if (/^grade-batch-receipt-[a-f0-9-]{36}\.json$/.test(name)) {
      const receipt = readOwnedGradeJSON(root, "oracles/" + name);
      requireThat(
        receipt.submission?.batch_id !== entry.parent_batch_id,
        "MIGRATION_PARENT_ALREADY_IMPORTED",
      );
    }
    requireThat(
      !entry.runs.some((run) => name.startsWith(run + "-verdict-")),
      "MIGRATION_RUN_ALREADY_GRADED",
    );
    const match = /^grade-batch-([a-f0-9-]{36})\.json$/.exec(name);
    if (match && match[1] !== entry.parent_batch_id) {
      const previous = loadGradeBatch(root, match[1], trustedAnchor);
      requireThat(
        !previous.privateData.mapping.some((m: any) =>
          entry.runs.includes(m.run),
        ),
        "MIGRATION_RUN_ALREADY_BATCHED",
      );
    }
  }
  const child = deriveMigrationBatch(
    parent.batch,
    parent.privateData,
    entry,
    manifest,
  );
  const prefix = migrationDirectory(manifest),
    tx = migrationExportTransaction(manifest, entry);
  const indexName = `${prefix}/parent-${entry.parent_batch_id}-child.json`;
  const index = {
    version: "secretary-judge-migration-index-v1",
    parent_batch_id: entry.parent_batch_id,
    child_batch_id: childID,
    export_transaction_id: tx,
  };
  const outputs: GradeOutput[] = [
    {
      name: `${prefix}/manifest.json`,
      content: gradeJSONBytes(manifest),
      reuse: true,
    },
    {
      name: `${prefix}/history-inventory.json`,
      content: gradeJSONBytes(bundle.history_inventory),
      reuse: true,
    },
    {
      name: `${prefix}/submission-inventory.json`,
      content: gradeJSONBytes(bundle.submission_inventory),
      reuse: true,
    },
  ];
  for (const f of ledgerFiles(bundle.submission_inventory))
    outputs.push({
      name: `${prefix}/review-ledger/${f.relative}`,
      content: readExternalLedger(bundle.review_ledger_directory, f.relative),
      reuse: true,
    });
  const requestName = `${prefix}/requests/judge-migration-request-${childID}.txt`;
  outputs.push(
    {
      name: `oracles/grade-batch-${childID}-private.json`,
      content: readOwnedGradeFile(
        root,
        `oracles/grade-batch-${entry.parent_batch_id}-private.json`,
      ),
    },
    {
      name: `oracles/grade-batch-${childID}.json`,
      content: gradeJSONBytes(child),
    },
    { name: indexName, content: gradeJSONBytes(index) },
    { name: requestName, content: Buffer.from(publicMigrationRequest(child)) },
  );
  // All bytes above are derived exclusively from the anchored inputs. The writer
  // verifies the complete staged set before the first irreversible promotion.
  const committed = commitGradeFiles(
    root,
    context,
    "JUDGE_MIGRATION_EXPORT",
    outputs,
    {
      parent_batch_id: entry.parent_batch_id,
      child_batch_id: childID,
      index_file: indexName,
    },
    tx,
    expectedPreparationHash,
  );
  loadGradeBatch(root, childID, trustedAnchor);
  return {
    ...committed,
    batch_id: childID,
    parent_batch_id: entry.parent_batch_id,
    payload_sha256: child.payload_sha256,
    request: gradePath(root, requestName),
    request_sha256: sha(publicMigrationRequest(child)),
  };
}
