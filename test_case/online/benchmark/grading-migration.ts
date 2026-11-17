import { approvedJudge, type GradingJudgePolicy } from "./grading.ts";
import { requireThat, sha } from "./io.ts";

export const legacyBatchVersion = "secretary-semantic-grade-batch-v3";
export const migrationBatchVersion =
  "secretary-semantic-grade-batch-v3-judge-migration-v1";
export const migrationPolicy = "opus-5.5-extra-migration-v1" as const;
export const migrationInstructionHash =
  "6fcf7edf445f6a582dfff1ebdf9b1417172aef27a4f57e97279c03d93638e12d";
const oldIdentity = 'judge:{model:"Fable 5.2",effort:"Extra"}';
const newIdentity = 'judge:{model:"Opus 5.5",effort:"Extra"}';
const suffix =
  " This batch preserves the frozen V3 rubric and evidence; its judge is Opus 5.5 Extra under opus-5.5-extra-migration-v1.";
export const migrationJudge = {
  provider: "Claude browser",
  model: "Opus 5.5",
  effort: "Extra",
} as const;

/** Pure derivation: no file writes, IDs allocated elsewhere, no regenerated controls. */
export function deriveMigrationPayload(parent: any) {
  requireThat(
    parent?.payload?.version === legacyBatchVersion &&
      parent.payload_sha256 === sha(JSON.stringify(parent.payload)),
    "MIGRATION_PARENT_INVALID",
  );
  const p = parent.payload;
  requireThat(
    Array.isArray(p.controls?.controls) &&
      p.controls.controls.length === 63 &&
      Array.isArray(p.packets) &&
      p.packets.length > 0 &&
      new Set(p.packets.map((x: any) => x.packet_id)).size ===
        p.packets.length &&
      p.packets.every(
        (x: any) =>
          x.payload?.version === "secretary-sealed-grading-v3" &&
          x.payload_sha256 === sha(JSON.stringify(x.payload)) &&
          approvedJudge(x.expected_judge),
      ),
    "MIGRATION_PARENT_PACKET_INVALID",
  );
  requireThat(
    typeof p.instructions === "string" &&
      p.instructions.split(oldIdentity).length === 3,
    "MIGRATION_INSTRUCTION_CHANGED",
  );
  const instructions =
    p.instructions.replaceAll(oldIdentity, newIdentity) + suffix;
  requireThat(
    sha(instructions) === migrationInstructionHash,
    "MIGRATION_INSTRUCTION_CHANGED",
  );
  return {
    version: migrationBatchVersion,
    controls: structuredClone(p.controls),
    packets: p.packets.map((packet: any) => ({
      ...structuredClone(packet),
      expected_judge: { ...migrationJudge },
    })),
    instructions,
    provenance: { judge_policy: migrationPolicy },
  };
}

export function batchJudgePolicy(batch: any): GradingJudgePolicy {
  if (batch?.payload?.version === legacyBatchVersion)
    return "fable-5.2-extra-v3";
  requireThat(
    batch?.payload?.version === migrationBatchVersion &&
      JSON.stringify(batch.payload.provenance) ===
        JSON.stringify({ judge_policy: migrationPolicy }),
    "GRADE_BATCH_POLICY_INVALID",
  );
  return migrationPolicy;
}

/** The upload deliberately omits private/key/manifest bindings. */
export function publicMigrationRequest(batch: any) {
  requireThat(
    batchJudgePolicy(batch) === migrationPolicy &&
      batch.payload_sha256 === sha(JSON.stringify(batch.payload)),
    "MIGRATION_PUBLIC_SOURCE_INVALID",
  );
  return (
    JSON.stringify(
      {
        batch_id: batch.batch_id,
        payload_sha256: batch.payload_sha256,
        payload: batch.payload,
      },
      null,
      2,
    ) + "\n"
  );
}

export function normalizeMigrationResponse(original: string) {
  const trimmed = original.trim();
  // Match only the two outside lines. Never count/scan interior backticks.
  const fenced = /^(?:```|```json)\r?\n([\s\S]*)\r?\n```$/.exec(trimmed);
  return {
    text: fenced ? fenced[1].trim() : trimmed,
    transformation: fenced
      ? "REMOVE_SINGLE_OUTER_MARKDOWN_FENCE_AND_TRIM"
      : "TRIM_ONLY",
  };
}

export const reservedGradeMetadata = [
  "received_at",
  "qualification",
  "source_sha256",
  "source_file_sha256",
  "calibration",
] as const;
export function assertNoReservedGradeMetadata(response: any) {
  for (const value of [
    response,
    ...(Array.isArray(response?.submissions) ? response.submissions : []),
  ]) {
    requireThat(
      value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !reservedGradeMetadata.some((k) => k in value),
      "GRADE_SUBMISSION_RESERVED_METADATA",
    );
  }
}

export type MigrationEntry = {
  ordinal: number;
  facility_nonce: string;
  parent_batch_id: string;
  child_batch_id: string;
  parent_file_sha256: string;
  parent_payload_sha256: string;
  parent_private_file_sha256: string;
  parent_private_data_sha256: string;
  child_payload_sha256: string;
  runs: string[];
  packet_ids: string[];
  not_sent_attestation: {
    state: "NOT_SENT";
    submitted_attempts: number;
    submission_inventory_sha256: string;
  };
};
export type MigrationManifest = {
  version: string;
  cohort_id: string;
  entries: MigrationEntry[];
  history_inventory_sha256: string;
  submission_inventory_sha256: string;
  authorization_reference: string;
};
export type MigrationBundle = {
  manifest: MigrationManifest;
  history_inventory: any;
  submission_inventory: any;
  review_ledger_directory: string;
};
export const migrationAnchorRelative =
  "docs/fix/evidence/issue121-judge-migration-anchor.json";
export const migrationManifestVersion = "secretary-judge-migration-manifest-v1";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const fileJSONHash = (v: unknown) => sha(JSON.stringify(v, null, 2) + "\n");
const orderedKeys = (value: any, keys: string[]) =>
  value &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value)) === JSON.stringify(keys);

export function validateMigrationManifest(manifest: MigrationManifest) {
  requireThat(
    manifest?.version === migrationManifestVersion &&
      uuidPattern.test(manifest.cohort_id) &&
      orderedKeys(manifest, [
        "version",
        "cohort_id",
        "entries",
        "history_inventory_sha256",
        "submission_inventory_sha256",
        "authorization_reference",
      ]) &&
      Array.isArray(manifest.entries) &&
      manifest.entries.length === 6 &&
      digestPattern.test(manifest.history_inventory_sha256) &&
      digestPattern.test(manifest.submission_inventory_sha256) &&
      typeof manifest.authorization_reference === "string" &&
      manifest.authorization_reference.trim(),
    "MIGRATION_MANIFEST_INVALID",
  );
  const runs: string[] = [],
    packets: string[] = [],
    parents: string[] = [],
    children: string[] = [];
  const counts = [2, 1, 1, 1, 1, 3];
  manifest.entries.forEach((e, i) => {
    requireThat(
      orderedKeys(e, [
        "ordinal",
        "facility_nonce",
        "parent_batch_id",
        "child_batch_id",
        "parent_file_sha256",
        "parent_payload_sha256",
        "parent_private_file_sha256",
        "parent_private_data_sha256",
        "child_payload_sha256",
        "runs",
        "packet_ids",
        "not_sent_attestation",
      ]) &&
        orderedKeys(e.not_sent_attestation, [
          "state",
          "submitted_attempts",
          "submission_inventory_sha256",
        ]) &&
        e.ordinal === i + 10 &&
        [e.facility_nonce, e.parent_batch_id, e.child_batch_id].every((v) =>
          uuidPattern.test(v),
        ) &&
        [
          e.parent_file_sha256,
          e.parent_payload_sha256,
          e.parent_private_file_sha256,
          e.parent_private_data_sha256,
          e.child_payload_sha256,
        ].every((v) => digestPattern.test(v)) &&
        Array.isArray(e.runs) &&
        e.runs.length === counts[i] &&
        e.runs.every((v) => uuidPattern.test(v)) &&
        Array.isArray(e.packet_ids) &&
        e.packet_ids.length === counts[i] &&
        e.packet_ids.every((v) => uuidPattern.test(v)) &&
        e.not_sent_attestation?.state === "NOT_SENT" &&
        e.not_sent_attestation.submitted_attempts === 0 &&
        e.not_sent_attestation.submission_inventory_sha256 ===
          manifest.submission_inventory_sha256,
      "MIGRATION_ENTRY_INVALID",
    );
    runs.push(...e.runs);
    packets.push(...e.packet_ids);
    parents.push(e.parent_batch_id);
    children.push(e.child_batch_id);
  });
  requireThat(
    new Set(runs).size === 9 &&
      new Set(packets).size === 9 &&
      new Set([...parents, ...children]).size === 12,
    "MIGRATION_POPULATION_OVERLAP",
  );
  return manifest;
}

export function migrationAnchor(manifest: MigrationManifest) {
  validateMigrationManifest(manifest);
  return {
    version: "secretary-judge-migration-anchor-v1",
    manifest_sha256: fileJSONHash(manifest),
    child_payload_sha256: manifest.entries.map((e) => e.child_payload_sha256),
    history_inventory_sha256: manifest.history_inventory_sha256,
  };
}
export function validateMigrationAnchor(
  manifest: MigrationManifest,
  anchor: any,
) {
  requireThat(
    JSON.stringify(anchor) === JSON.stringify(migrationAnchor(manifest)),
    "MIGRATION_EXTERNAL_ANCHOR_MISMATCH",
  );
}
export function migrationExportTransaction(
  manifest: MigrationManifest,
  entry: MigrationEntry,
) {
  const h = sha(
    `secretary-judge-export-v1|${manifest.cohort_id}|${entry.child_batch_id}`,
  ).slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function migrationDirectory(manifest: MigrationManifest) {
  validateMigrationManifest(manifest);
  return `oracles/migrations/${manifest.cohort_id}`;
}
export function deriveMigrationBatch(
  parent: any,
  privateData: any,
  entry: MigrationEntry,
  manifest: MigrationManifest,
) {
  validateMigrationManifest(manifest);
  requireThat(
    manifest.entries.some((e) => JSON.stringify(e) === JSON.stringify(entry)) &&
      parent.batch_id === entry.parent_batch_id &&
      parent.payload_sha256 === entry.parent_payload_sha256 &&
      fileJSONHash(parent) === entry.parent_file_sha256 &&
      fileJSONHash(privateData) === entry.parent_private_file_sha256 &&
      sha(JSON.stringify(privateData)) === entry.parent_private_data_sha256 &&
      parent.private_data_sha256 === entry.parent_private_data_sha256 &&
      JSON.stringify(privateData.mapping) ===
        JSON.stringify(
          entry.runs.map((run, i) => ({ run, packet_id: entry.packet_ids[i] })),
        ),
    "MIGRATION_PARENT_BINDING_CHANGED",
  );
  const payload = deriveMigrationPayload(parent);
  requireThat(
    JSON.stringify(payload.packets.map((p: any) => p.packet_id)) ===
      JSON.stringify(entry.packet_ids) &&
      sha(JSON.stringify(payload)) === entry.child_payload_sha256,
    "MIGRATION_CHILD_DERIVATION_CHANGED",
  );
  return {
    batch_id: entry.child_batch_id,
    payload_sha256: entry.child_payload_sha256,
    private_data_sha256: entry.parent_private_data_sha256,
    payload,
    migration: {
      version: "secretary-judge-migration-binding-v1",
      manifest_file: migrationDirectory(manifest) + "/manifest.json",
      manifest_sha256: fileJSONHash(manifest),
      parent_batch_id: entry.parent_batch_id,
      parent_payload_sha256: entry.parent_payload_sha256,
      parent_file_sha256: entry.parent_file_sha256,
      parent_private_file_sha256: entry.parent_private_file_sha256,
      parent_private_data_sha256: entry.parent_private_data_sha256,
    },
  };
}

/** Operator ledgers attest NOT_SENT; missing receipts alone never do. */
export function validateMigrationInventories(bundle: MigrationBundle) {
  const m = validateMigrationManifest(bundle.manifest);
  requireThat(
    fileJSONHash(bundle.history_inventory) === m.history_inventory_sha256 &&
      fileJSONHash(bundle.submission_inventory) ===
        m.submission_inventory_sha256 &&
      Array.isArray(bundle.history_inventory?.files) &&
      Array.isArray(bundle.history_inventory?.facilities),
    "MIGRATION_INVENTORY_CHANGED",
  );
  const s = bundle.submission_inventory;
  requireThat(
    Array.isArray(s.batches) &&
      s.batches.length === 15 &&
      new Set(s.batches.map((b: any) => b.batch_id)).size === 15 &&
      Array.isArray(s.rejections) &&
      s.rejections.every(
        (r: any) =>
          r.attributed === true &&
          s.batches.some((b: any) => b.batch_id === r.batch_id) &&
          digestPattern.test(r.source_file_sha256),
      ),
    "MIGRATION_SUBMISSION_HISTORY_INCOMPLETE",
  );
  for (const e of m.entries) {
    const b = s.batches.find((b: any) => b.batch_id === e.parent_batch_id);
    requireThat(
      b?.ordinal === e.ordinal &&
        b.status === "NOT_SENT" &&
        b.submitted_attempts === 0 &&
        b.import_attempts === 0 &&
        !s.rejections.some((r: any) => r.batch_id === e.parent_batch_id),
      "MIGRATION_PARENT_ALREADY_SUBMITTED",
    );
  }
  return bundle;
}
