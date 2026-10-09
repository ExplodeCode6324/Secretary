import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { JournalOwner } from "./store-lock.ts";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type {
  Contract,
  ObjectRef,
  OperationLogRecord,
  JournalTransaction,
} from "./contracts.ts";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const id = (): string => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
export const base = (recordID = id()) => ({
  id: recordID,
  revision: 1,
  updated_at: now(),
});
export function revise<T extends { revision: number; updated_at: string }>(
  r: T,
  patch: Partial<T>,
): T {
  return { ...r, ...patch, revision: r.revision + 1, updated_at: now() };
}
export type Stored = Extract<Contract, { id: string; revision: number }>;
const schema = JSON.parse(
  fs.readFileSync(
    path.join(root, "src/contracts/contracts.schema.json"),
    "utf8",
  ),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
(addFormats as unknown as (instance: Ajv2020) => void)(ajv);
const validate = ajv.compile(schema);
export function shapeDefinition(name: string, value: unknown) {
  const validator = ajv.getSchema("urn:secretary:contracts:v1#/$defs/" + name);
  if (!validator || !validator(value))
    throw Error("INVALID_" + name + ": " + JSON.stringify(validator?.errors));
}
export function shape(record: unknown): asserts record is Contract {
  if (!validate(record)) {
    const kind = (record as { record_type?: string })?.record_type;
    const specific = kind
      ? ajv.getSchema("urn:secretary:contracts:v1#/$defs/" + kind)
      : undefined;
    if (specific) specific(record);
    throw Error(
      "INVALID_CONTRACT: " +
        JSON.stringify((specific?.errors ?? validate.errors)?.slice(0, 5)),
    );
  }
}
const machines = JSON.parse(
  fs.readFileSync(path.join(root, "src/state_machine/catalog.json"), "utf8"),
).machines as Record<
  string,
  { transitions: { from: string; event: string; to: string }[] }
>;
export function next(machine: string, state: string, event: string): string {
  const edge = machines[machine]?.transitions.find(
    (t) => t.from === state && t.event === event,
  );
  if (!edge) throw Error(`INVALID_TRANSITION ${machine} ${state} ${event}`);
  return edge.to;
}
function syncDir(dir: string) {
  const fd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export class Store {
  readonly dir: string;
  epoch = 1;
  sequence = 0;
  digest = "0".repeat(64);
  eventSequence = 0;
  private records = new Map<string, Stored>();
  private recordsByType = new Map<string, Map<string, Stored>>();
  readonly logs: OperationLogRecord[] = [];
  // Validated immutable references for disposable read projections. No second journal.
  readonly projectionFrames: Pick<
    JournalTransaction,
    "sequence" | "committed_at" | "mutations" | "log_records"
  >[] = [];
  private owner: JournalOwner;
  private closed = false;
  private healthy = true;
  private eventTransactions = new Map<string, string>();
  transactionForEvent(eventID: string) {
    const tx = this.eventTransactions.get(eventID);
    if (!tx) throw Error("EVENT_NOT_COMMITTED");
    return tx;
  }
  private planHistory = new Map<string, ObjectRef>();
  taskPlanAt(taskID: string, revision: number) {
    const ref = this.planHistory.get(`${taskID}:${revision}`);
    if (!ref) throw Error("MISSING_HISTORICAL_PLAN");
    return this.read<import("./contracts.ts").TaskPlan>(ref);
  }
  private receipts = new Map<string, { hash: string; value: unknown }>();
  private admission?: (records: Stored[]) => Stored;
  // Synchronous admission only. The first authoritative mutation and its public
  // request binding share one fsynced journal transaction, including replay.
  withAdmission<T>(
    admission: (records: Stored[]) => Stored,
    action: () => T,
  ): T {
    if (this.admission) throw Error("NESTED_ADMISSION");
    this.admission = admission;
    try {
      return action();
    } finally {
      this.admission = undefined;
    }
  }
  private constructor(dir: string, owner: JournalOwner) {
    this.dir = dir;
    this.owner = owner;
  }
  static async open(dir: string) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { owner, replay } = await JournalOwner.open(dir);
    const s = new Store(dir, owner);
    try {
      fs.mkdirSync(path.join(dir, "objects"), { recursive: true });
      s.replay(replay);
      s.epoch =
        s
          .all()
          .reduce(
            (n, r) =>
              Math.max(n, Number("owner_epoch" in r ? r.owner_epoch : 0)),
            s.epoch - 1,
          ) + 1;
      return s;
    } catch (e) {
      await s.close();
      throw e;
    }
  }
  // Inspect in-memory metadata; clone only a bounded result, with no CAS reads.
  select<T extends Stored>(
    type: T["record_type"],
    predicate: (record: Readonly<T>) => boolean,
    limit: number,
    offset = 0,
    options: { latest?: boolean } = {},
  ): T[] {
    const result: T[] = [];
    for (const record of this.recordsByType.get(type)?.values() ?? []) {
      if (!predicate(record as T)) continue;
      if (offset-- > 0) continue;
      result.push(record as T);
      if (result.length > limit) result.shift();
      if (!options.latest && result.length >= limit) break;
    }
    return structuredClone(result);
  }
  all<T extends Stored = Stored>(type?: T["record_type"]): T[] {
    return structuredClone([
      ...(type
        ? (this.recordsByType.get(type)?.values() ?? [])
        : this.records.values()),
    ]) as T[];
  }
  get<T extends Stored>(type: T["record_type"], recordID: string): T {
    const r = this.records.get(type + ":" + recordID);
    if (!r) throw Error("NOT_FOUND");
    return structuredClone(r) as T;
  }
  find<T extends Stored>(
    type: T["record_type"],
    recordID: string,
  ): T | undefined {
    try {
      return this.get<T>(type, recordID);
    } catch {
      return undefined;
    }
  }
  put(value: unknown, media = "application/json"): ObjectRef {
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
    const sha = hash(bytes);
    const rel = "objects/" + sha;
    const file = path.join(this.dir, rel);
    if (!fs.existsSync(file)) {
      const temp = file + "." + id();
      const fd = fs.openSync(temp, "wx", 0o600);
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, file);
      syncDir(path.dirname(file));
    }
    const ref = {
      path: rel,
      sha256: sha,
      bytes: bytes.length,
      media_type: media,
    };
    this.bytes(ref);
    return ref;
  }
  bytes(ref: ObjectRef): Buffer {
    if (!/^objects\/[a-f0-9]{64}$/.test(ref.path))
      throw Error("INVALID_OBJECT_PATH");
    const f = path.join(this.dir, ref.path);
    if (fs.lstatSync(f).isSymbolicLink()) throw Error("OBJECT_SYMLINK");
    const b = fs.readFileSync(f);
    if (hash(b) !== ref.sha256 || b.length !== ref.bytes)
      throw Error("CORRUPT_OBJECT");
    return b;
  }
  read<T>(ref: ObjectRef): T {
    return JSON.parse(this.bytes(ref).toString()) as T;
  }
  hasReceipt(request: string) {
    return this.receipts.has(request);
  }
  receipt<T>(
    request: string,
    digest: string,
    legacyDigests: string[] = [],
  ): T | undefined {
    const r = this.receipts.get(request);
    if (r && r.hash !== digest && !legacyDigests.includes(r.hash))
      throw Error("REQUEST_CONFLICT");
    return r?.value as T | undefined;
  }
  event(
    kind: string,
    payload: unknown,
    scope: OperationLogRecord["scope"] = {
      session_id: null,
      task_id: null,
      execution_id: null,
    },
    actor: OperationLogRecord["actor"] = "HOST",
  ): OperationLogRecord {
    return {
      record_type: "OperationLogRecord",
      schema_version: 1,
      event_id: id(),
      stream: scope.execution_id
        ? "TASK"
        : scope.session_id
          ? "MAIN"
          : "SYSTEM",
      scope,
      sequence: this.eventSequence + 1,
      event_type: kind,
      occurred_at: now(),
      recorded_at: now(),
      actor,
      payload: this.put(payload),
      causation_id: null,
      correlation_id: scope.execution_id ?? scope.session_id ?? id(),
      related_object_ids: [],
    };
  }
  commit(
    records: Stored[],
    events: OperationLogRecord[] = [],
    receipt?: { request: string; hash: string; value: string },
  ) {
    if (this.closed || !this.healthy) throw Error("STORE_NOT_OWNER");
    if (this.admission) {
      const admission = this.admission;
      this.admission = undefined;
      records = [...records, admission(records)];
    }
    try {
      this.owner.assertOwner();
    } catch (error) {
      this.healthy = false;
      throw error;
    }
    for (const r of records) {
      shape(r);
      const old = this.records.get(r.record_type + ":" + r.id);
      if (r.revision !== (old?.revision ?? 0) + 1)
        throw Error("REVISION_CONFLICT");
    }
    if (
      new Set(records.map((r) => r.record_type + ":" + r.id)).size !==
      records.length
    )
      throw Error("DUPLICATE_MUTATION");
    const txn: JournalTransaction = {
      record_type: "JournalTransaction",
      schema_version: 1,
      txn_id: id(),
      sequence: this.sequence + 1,
      owner_epoch: this.epoch,
      previous_digest: this.digest,
      mutations: records.map((r) => ({
        object_type: r.record_type,
        object_id: r.id,
        expected_revision: r.revision - 1,
        new_revision: r.revision,
        snapshot: this.put(r),
      })),
      log_records: events.map((e, i) => ({
        ...e,
        sequence: this.eventSequence + i + 1,
      })),
      receipts: receipt
        ? [
            {
              record_type: "CommandReceipt",
              schema_version: 1,
              request_id: receipt.request,
              request_hash: receipt.hash,
              status: "ACCEPTED",
              object_id: receipt.value,
              reason: null,
              journal_seq: this.sequence + 1,
            },
          ]
        : [],
      committed_at: now(),
    };
    shape(txn);
    const staged = this.stage(txn);
    const payload = JSON.stringify(txn);
    const digest = hash(payload);
    const frame =
      JSON.stringify({
        payload_b64: Buffer.from(payload).toString("base64"),
        sha256: digest,
      }) + "\n";
    try {
      this.owner.append(frame, digest);
    } catch (e) {
      this.healthy = false;
      throw e;
    }
    this.install(txn, digest, staged);
  }
  private stage(txn: JournalTransaction): Stored[] {
    const staged: Stored[] = [];
    const keys = new Set<string>();
    for (const m of txn.mutations) {
      const key = m.object_type + ":" + m.object_id;
      if (keys.has(key)) throw Error("DUPLICATE_MUTATION");
      keys.add(key);
      const old = this.records.get(key);
      if (
        (old?.revision ?? 0) !== m.expected_revision ||
        m.new_revision !== m.expected_revision + 1
      )
        throw Error("CORRUPT_REVISION");
      const r = this.read<Stored>(m.snapshot);
      shape(r);
      if (
        r.record_type !== m.object_type ||
        r.id !== m.object_id ||
        r.revision !== m.new_revision
      )
        throw Error("CORRUPT_SNAPSHOT");
      this.verifyRefs(r);
      if (
        old &&
        ["Context", "Checkpoint", "TaskResult", "ArchiveManifest"].includes(
          r.record_type,
        )
      )
        throw Error("IMMUTABLE_RECORD");
      if (old?.record_type === "Input" && r.record_type === "Input") {
        if (
          r.session_id !== old.session_id ||
          r.payload.sha256 !== old.payload.sha256
        )
          throw Error("INPUT_IDENTITY_CHANGED");
        if (
          old.state !== r.state &&
          !(
            (old.state === "ACCEPTED" && r.state === "CLAIMED") ||
            (old.state === "CLAIMED" && r.state === "HANDLED")
          )
        )
          throw Error("INVALID_INPUT_TRANSITION");
      }
      if (
        old?.record_type === "Execution" &&
        r.record_type === "Execution" &&
        old.proposal_ref &&
        old.proposal_ref.sha256 !== r.proposal_ref?.sha256
      )
        throw Error("EXECUTION_PROPOSAL_IMMUTABLE");
      if (
        old?.record_type === "ExtractionRecovery" &&
        r.record_type === "ExtractionRecovery"
      ) {
        const immutable = [
          "session_id",
          "group_key",
          "attempt_id",
          "parent_attempt_id",
          "request_id",
          "request_hash",
          "binding_ref",
          "binding_snapshot",
          "request_snapshot",
          "generation",
          "owner_epoch",
        ] as const;
        if (
          immutable.some(
            (key) => JSON.stringify(old[key]) !== JSON.stringify(r[key]),
          )
        )
          throw Error("EXTRACTION_RECOVERY_IDENTITY_CHANGED");
        if (old.state !== "CLAIMED")
          throw Error("EXTRACTION_RECOVERY_TERMINAL_IMMUTABLE");
        if (old.call_id && old.call_id !== r.call_id)
          throw Error("EXTRACTION_RECOVERY_CALL_CHANGED");
      }
      staged.push(r);
    }
    const candidate = new Map(this.records);
    for (const r of staged) candidate.set(r.record_type + ":" + r.id, r);
    if (
      [...candidate.values()].filter((r) => r.record_type === "Session")
        .length > 1
    )
      throw Error("MULTIPLE_MAIN_SESSIONS");
    for (const r of staged) {
      if (
        "session_id" in r &&
        r.session_id &&
        !candidate.has("Session:" + r.session_id)
      )
        throw Error("MISSING_SESSION");
    }
    for (const r of staged) {
      if (r.record_type !== "ExtractionRecovery") continue;
      const peers = [...candidate.values()].filter(
        (other): other is import("./contracts.ts").ExtractionRecovery =>
          other.record_type === "ExtractionRecovery" &&
          other.session_id === r.session_id &&
          other.group_key === r.group_key &&
          other.id !== r.id,
      );
      if (peers.some((other) => other.generation === r.generation))
        throw Error("EXTRACTION_RECOVERY_GENERATION_CONFLICT");
      if (
        r.state === "CLAIMED" &&
        peers.some((other) => other.state === "CLAIMED")
      )
        throw Error("EXTRACTION_RECOVERY_SOURCE_CLAIMED");
      const old = this.records.get("ExtractionRecovery:" + r.id);
      if (
        !old &&
        r.generation !==
          Math.max(0, ...peers.map((other) => other.generation)) + 1
      )
        throw Error("EXTRACTION_RECOVERY_GENERATION_CONFLICT");
    }
    const eventIDs = new Set<string>();
    for (const [index, e] of txn.log_records.entries()) {
      this.verifyRefs(e);
      if (
        e.sequence !== this.eventSequence + index + 1 ||
        eventIDs.has(e.event_id) ||
        this.eventTransactions.has(e.event_id)
      )
        throw Error("CORRUPT_EVENT_SEQUENCE");
      eventIDs.add(e.event_id);
    }
    const requests = new Set<string>();
    for (const r of txn.receipts) {
      if (requests.has(r.request_id) || this.receipts.has(r.request_id))
        throw Error("DUPLICATE_RECEIPT");
      requests.add(r.request_id);
    }
    return staged;
  }
  private install(txn: JournalTransaction, digest: string, staged: Stored[]) {
    this.projectionFrames.push({
      sequence: txn.sequence,
      committed_at: txn.committed_at,
      mutations: txn.mutations,
      log_records: txn.log_records,
    });
    for (const m of txn.mutations)
      if (m.object_type === "TaskPlan")
        this.planHistory.set(`${m.object_id}:${m.new_revision}`, m.snapshot);
    for (const r of staged) {
      this.records.set(r.record_type + ":" + r.id, r);
      let bucket = this.recordsByType.get(r.record_type);
      if (!bucket) {
        bucket = new Map();
        this.recordsByType.set(r.record_type, bucket);
      }
      bucket.set(r.id, r);
    }
    for (const e of txn.log_records) {
      this.eventSequence = e.sequence;
      this.logs.push(e);
      this.eventTransactions.set(e.event_id, txn.txn_id);
    }
    for (const r of txn.receipts)
      this.receipts.set(r.request_id, {
        hash: r.request_hash,
        value: r.object_id,
      });
    this.sequence = txn.sequence;
    this.digest = digest;
  }
  private verifyRefs(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const x of value) this.verifyRefs(x);
      return;
    }
    const v = value as Record<string, unknown>;
    if (
      typeof v.path === "string" &&
      typeof v.sha256 === "string" &&
      typeof v.bytes === "number" &&
      typeof v.media_type === "string"
    ) {
      this.bytes(v as unknown as ObjectRef);
      return;
    }
    for (const child of Object.values(v)) this.verifyRefs(child);
  }
  private replay(data: Buffer) {
    const text = data.toString();
    for (const line of text.split("\n").slice(0, -1)) {
      const frame = JSON.parse(line);
      if (
        !frame ||
        Object.keys(frame).sort().join(",") !== "payload_b64,sha256" ||
        typeof frame.payload_b64 !== "string" ||
        typeof frame.sha256 !== "string"
      )
        throw Error("CORRUPT_FRAME");
      const payload = Buffer.from(frame.payload_b64, "base64");
      if (payload.toString("base64") !== frame.payload_b64)
        throw Error("CORRUPT_BASE64");
      if (hash(payload) !== frame.sha256) throw Error("CORRUPT_JOURNAL");
      const txn = JSON.parse(payload.toString()) as JournalTransaction;
      shape(txn);
      if (
        txn.sequence !== this.sequence + 1 ||
        txn.previous_digest !== this.digest
      )
        throw Error("CORRUPT_CHAIN");
      this.install(txn, frame.sha256, this.stage(txn));
      this.epoch = Math.max(this.epoch, txn.owner_epoch + 1);
    }
  }
  async close() {
    this.closed = true;
    await this.owner.close();
  }
}
