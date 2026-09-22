import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
  fs.readFileSync(path.join(root, "json/contracts.schema.json"), "utf8"),
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
  fs.readFileSync(path.join(root, "state_machine/catalog.json"), "utf8"),
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
  readonly logs: OperationLogRecord[] = [];
  private helper: ChildProcessWithoutNullStreams;
  private closed = false;
  private healthy = true;
  private eventTransactions = new Map<string, string>();
  transactionForEvent(eventID: string) {
    const tx = this.eventTransactions.get(eventID);
    if (!tx) throw Error("EVENT_NOT_COMMITTED");
    return tx;
  }
  private receipts = new Map<string, { hash: string; value: unknown }>();
  private constructor(dir: string, helper: ChildProcessWithoutNullStreams) {
    this.dir = dir;
    this.helper = helper;
    helper.once("exit", () => {
      this.healthy = false;
    });
  }
  static async open(dir: string) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const helper = spawn(
      "python3",
      [
        fileURLToPath(new URL("./lock.py", import.meta.url)),
        path.join(dir, "owner.lock"),
      ],
      { stdio: "pipe" },
    );
    await new Promise<void>((resolve, reject) => {
      helper.once("error", reject);
      helper.stdout.once("data", (b) =>
        String(b).trim() === "LOCKED" ? resolve() : reject(Error("OWNER_BUSY")),
      );
      helper.once("exit", (code) => {
        if (code) reject(Error("OWNER_BUSY"));
      });
    });
    const s = new Store(dir, helper);
    try {
      fs.mkdirSync(path.join(dir, "objects"), { recursive: true });
      s.replay();
      s.epoch =
        s
          .all()
          .reduce(
            (n, r) =>
              Math.max(n, Number("owner_epoch" in r ? r.owner_epoch : 0)),
            0,
          ) + 1;
      return s;
    } catch (e) {
      await s.close();
      throw e;
    }
  }
  all<T extends Stored = Stored>(type?: T["record_type"]): T[] {
    return structuredClone(
      [...this.records.values()].filter((r) => !type || r.record_type === type),
    ) as T[];
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
  receipt<T>(request: string, digest: string): T | undefined {
    const r = this.receipts.get(request);
    if (r && r.hash !== digest) throw Error("REQUEST_CONFLICT");
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
    if (this.closed || !this.healthy || this.helper.exitCode !== null)
      throw Error("STORE_NOT_OWNER");
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
    const payload = JSON.stringify(txn);
    const digest = hash(payload);
    const frame =
      JSON.stringify({
        payload_b64: Buffer.from(payload).toString("base64"),
        sha256: digest,
      }) + "\n";
    const file = path.join(this.dir, "journal.jsonl");
    const fd = fs.openSync(file, "a", 0o600);
    try {
      fs.writeFileSync(fd, frame);
      fs.fsyncSync(fd);
      syncDir(this.dir);
    } catch (e) {
      this.healthy = false;
      throw e;
    } finally {
      fs.closeSync(fd);
    }
    this.apply(txn, digest);
  }
  private apply(txn: JournalTransaction, digest: string) {
    for (const m of txn.mutations) {
      const old = this.records.get(m.object_type + ":" + m.object_id);
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
      this.records.set(r.record_type + ":" + r.id, r);
    }
    for (const e of txn.log_records) {
      this.bytes(e.payload);
      this.eventSequence = Math.max(this.eventSequence, e.sequence);
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
  private replay() {
    const file = path.join(this.dir, "journal.jsonl");
    if (!fs.existsSync(file)) return;
    const data = fs.readFileSync(file);
    const last = data.lastIndexOf(10);
    if (last !== data.length - 1) {
      fs.writeFileSync(file + ".incomplete-" + id(), data.subarray(last + 1));
      fs.truncateSync(file, last + 1);
    }
    const text = data.subarray(0, last + 1).toString();
    for (const line of text.split("\n").filter(Boolean)) {
      const frame = JSON.parse(line);
      const payload = Buffer.from(frame.payload_b64, "base64");
      if (hash(payload) !== frame.sha256) throw Error("CORRUPT_JOURNAL");
      const txn = JSON.parse(payload.toString()) as JournalTransaction;
      shape(txn);
      if (
        txn.sequence !== this.sequence + 1 ||
        txn.previous_digest !== this.digest
      )
        throw Error("CORRUPT_CHAIN");
      this.apply(txn, frame.sha256);
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    const exited = new Promise<void>((r) =>
      this.helper.once("exit", () => r()),
    );
    if (this.helper.exitCode !== null) return;
    this.helper.stdin.end();
    await exited;
  }
}
