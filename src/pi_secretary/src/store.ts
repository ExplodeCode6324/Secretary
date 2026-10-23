import { EVIDENCE_MEDIA, hydrateEvidence } from "./evidence.ts";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { JournalOwner } from "./store-lock.ts";
import { validateStateTransition } from "./state-transitions.ts";
export { next } from "./state-transitions.ts";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type {
  Contract,
  ObjectRef,
  OperationLogRecord,
  JournalTransaction,
  ModelCall,
} from "./contracts.ts";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const MESSAGE_LIST_MEDIA = "application/vnd.secretary.message-list+json";
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
      ? ajv.getSchema(
          "urn:secretary:contracts:v1#/$defs/" +
            (kind === "Scope" ? "WorkScope" : kind),
        )
      : undefined;
    if (specific) specific(record);
    throw Error(
      "INVALID_CONTRACT: " +
        JSON.stringify((specific?.errors ?? validate.errors)?.slice(0, 5)),
    );
  }
}
function syncDir(dir: string) {
  const fd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
const indexFields: Record<string, string[]> = {
  WorldCommand: ["state"],
  Input: ["state"],
  Feedback: ["state", "execution_id"],
  Execution: ["state", "retention_state", "task_id", "task_occurrence"],
  TaskPlan: ["state", "pending_requests.length"],
  Operation: ["process.state", "scope.execution_id"],
  ModelCall: ["scope.execution_id"],
  SettingsApplication: ["state"],
  CompactionJob: ["state"],
  MemoryExtractionJob: ["pending_extraction"],
};
const fieldValue = (record: Stored, field: string): unknown =>
  field === "pending_extraction" && record.record_type === "MemoryExtractionJob"
    ? !record.merged && (record.state !== "FAILED" || !!record.next_attempt_at)
    : field === "task_occurrence"
      ? JSON.stringify([
          (record as any).task_id,
          (record as any).occurrence_key,
        ])
      : field.split(".").reduce((value: any, key) => value?.[key], record);
export class Store {
  readonly dir: string;
  epoch = 1;
  sequence = 0;
  digest = "0".repeat(64);
  eventSequence = 0;
  private records = new Map<string, Stored>();
  private recordsByType = new Map<string, Map<string, Stored>>();
  private modelCallsByLogicalKey = new Map<string, Map<string, ModelCall>>();
  private recordOrder = new Map<string, number>();
  private indexes = new Map<string, Map<unknown, Map<string, Stored>>>();
  private eventByID = new Map<string, OperationLogRecord>();
  private eventsByType = new Map<string, OperationLogRecord[]>();
  private eventsByExecution = new Map<string, OperationLogRecord[]>();
  readonly logs: OperationLogRecord[] = [];
  indexed<T extends Stored>(
    type: T["record_type"],
    field: string,
    values: unknown[],
    exclude = false,
  ): T[] {
    if (!indexFields[type]?.includes(field)) throw Error("UNKNOWN_STORE_INDEX");
    const wanted = new Set(values),
      result: Stored[] = [];
    const index = this.indexes.get(type + ":" + field);
    if (exclude) {
      for (const [value, bucket] of index ?? [])
        if (!wanted.has(value))
          for (const record of bucket.values()) result.push(record);
    } else {
      for (const value of wanted)
        for (const record of index?.get(value)?.values() ?? [])
          result.push(record);
    }
    result.sort(
      (a, b) =>
        this.recordOrder.get(type + ":" + a.id)! -
        this.recordOrder.get(type + ":" + b.id)!,
    );
    return structuredClone(result) as T[];
  }
  eventById(eventID: string) {
    return this.eventByID.get(eventID);
  }
  events(type: string): readonly OperationLogRecord[] {
    return this.eventsByType.get(type) ?? [];
  }
  eventsSince(type: string, after: number): readonly OperationLogRecord[] {
    const events = this.events(type);
    let lo = 0,
      hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[mid].sequence <= after) lo = mid + 1;
      else hi = mid;
    }
    return events.slice(lo);
  }
  executionEvents(executionID: string): readonly OperationLogRecord[] {
    return this.eventsByExecution.get(executionID) ?? [];
  }

  // Validated immutable references for disposable read projections. No second journal.
  readonly projectionFrames: (Pick<
    JournalTransaction,
    "sequence" | "committed_at" | "mutations" | "log_records"
  > & { digest: string })[] = [];
  private firstSequences = new Map<string, number>();
  firstSequence(type: string, objectID: string) {
    return this.firstSequences.get(type + ":" + objectID) ?? 0;
  }
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
  // Scheduler.answer historically binds identity in DecisionRequest rather
  // than CommandReceipt. Rebuild this index on every journal replay, retaining
  // identities from all committed revisions without changing receipt semantics.
  private decisionAnswerRequests = new Set<string>();
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
      owner.verifyReplay(s.sequence, s.digest);
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
  // Clone only this request's attempts, in insertion order; revisions keep their position.
  modelCallsFor(logicalKey: string): ModelCall[] {
    return structuredClone([
      ...(this.modelCallsByLogicalKey.get(logicalKey)?.values() ?? []),
    ]);
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
      try {
        const fd = fs.openSync(temp, "wx", 0o600);
        try {
          fs.writeFileSync(fd, bytes);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(temp, file);
        syncDir(path.dirname(file));
      } catch (error) {
        // Only the temporary file allocated by this call is ours to remove.
        fs.rmSync(temp, { force: true });
        throw error;
      }
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
    const value = JSON.parse(this.bytes(ref).toString());
    if (ref.media_type === EVIDENCE_MEDIA)
      return hydrateEvidence(this, value) as T;
    if (ref.media_type !== MESSAGE_LIST_MEDIA) return value as T;
    if (
      value?.encoding !== "message-refs-v1" ||
      !Array.isArray(value.messages) ||
      Object.keys(value).sort().join(",") !== "encoding,messages"
    )
      throw Error("INVALID_MESSAGE_LIST");
    return value.messages.map((child: ObjectRef) => {
      shapeDefinition("ObjectRef", child);
      if (child.media_type !== "application/json")
        throw Error("INVALID_MESSAGE_LIST");
      return JSON.parse(this.bytes(child).toString());
    }) as T;
  }
  putMessages(messages: unknown[]) {
    const refs = messages.map((message) => this.put(message));
    return {
      refs,
      raw: this.put(
        { encoding: "message-refs-v1", messages: refs },
        MESSAGE_LIST_MEDIA,
      ),
    };
  }
  // Content consumers use decoded bytes; ObjectRef.bytes remains physical CAS size.
  contentText(ref: ObjectRef): string {
    return [MESSAGE_LIST_MEDIA, EVIDENCE_MEDIA].includes(ref.media_type)
      ? JSON.stringify(this.read(ref))
      : this.bytes(ref).toString();
  }
  contentBytes(ref: ObjectRef): number {
    return [MESSAGE_LIST_MEDIA, EVIDENCE_MEDIA].includes(ref.media_type)
      ? Buffer.byteLength(this.contentText(ref))
      : ref.bytes;
  }
  hasReceipt(request: string) {
    return this.receipts.has(request);
  }
  hasRequestIdentity(request: string) {
    return this.hasReceipt(request) || this.decisionAnswerRequests.has(request);
  }
  receipt<T>(
    request: string,
    digest: string,
    legacyDigests: string[] = [],
  ): T | undefined {
    const r = this.receipts.get(request);
    if (
      !r &&
      this.find<import("./contracts.ts").ApiCommand>("ApiCommand", request)
        ?.command === "attachments/import"
    )
      throw Error("REQUEST_CONFLICT");
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
        [
          "Context",
          "Checkpoint",
          "TaskResult",
          "ArchiveManifest",
          "Attachment",
        ].includes(r.record_type)
      )
        throw Error("IMMUTABLE_RECORD");
      if (old?.record_type === "Input" && r.record_type === "Input") {
        if (
          r.session_id !== old.session_id ||
          (old.attachments?.length &&
            ["producer", "received_at", "dedupe_key", "feedback_id"].some(
              (k) => (r as any)[k] !== (old as any)[k],
            )) ||
          r.payload.sha256 !== old.payload.sha256 ||
          JSON.stringify(r.attachments) !== JSON.stringify(old.attachments) ||
          r.content_digest !== old.content_digest ||
          (JSON.stringify(r.withdrawal) !== JSON.stringify(old.withdrawal) &&
            old.state === "WITHDRAWN")
        )
          throw Error("INPUT_IDENTITY_CHANGED");
      }
      if (
        old?.record_type === "AttachmentImport" &&
        r.record_type === "AttachmentImport"
      ) {
        if (
          old.state !== "PENDING" ||
          !["READY", "FAILED"].includes(r.state) ||
          [
            "attachment_id",
            "expected_sha256",
            "expected_bytes",
            "validation_limits",
          ].some(
            (k) =>
              JSON.stringify((old as any)[k]) !== JSON.stringify((r as any)[k]),
          ) ||
          (r.reserved_bytes !== old.reserved_bytes &&
            !(r.state === "FAILED" && r.reserved_bytes === 0))
        )
          throw Error("ATTACHMENT_IMPORT_IDENTITY_CHANGED");
      }
      if (old) validateStateTransition(old, r);
      if (
        old?.record_type === "Execution" &&
        r.record_type === "Execution" &&
        old.proposal_ref &&
        old.proposal_ref.sha256 !== r.proposal_ref?.sha256
      )
        throw Error("EXECUTION_PROPOSAL_IMMUTABLE");
      if (
        old?.record_type === "Execution" &&
        r.record_type === "Execution" &&
        (JSON.stringify(old.workspace_binding) !==
          JSON.stringify(r.workspace_binding) ||
          (old.scope_id ?? null) !== (r.scope_id ?? null))
      )
        throw Error("EXECUTION_WORKSPACE_IMMUTABLE");
      staged.push(r);
    }
    const candidate = new Map(
      staged.map((r) => [r.record_type + ":" + r.id, r]),
    );
    const sessionCount =
      (this.recordsByType.get("Session")?.size ?? 0) +
      staged.filter(
        (r) =>
          r.record_type === "Session" && !this.records.has("Session:" + r.id),
      ).length;
    if (sessionCount > 1) throw Error("MULTIPLE_MAIN_SESSIONS");
    for (const r of staged) {
      if (r.record_type === "AttachmentImport") {
        const command = candidate.get("ApiCommand:" + r.id);
        const previous = this.records.get("AttachmentImport:" + r.id);
        if (
          command?.record_type !== "ApiCommand" ||
          command.command !== "attachments/import" ||
          (!previous && r.state !== "PENDING") ||
          command.state !==
            (
              {
                PENDING: "QUEUED",
                READY: "COMPLETED",
                FAILED: "FAILED",
              } as const
            )[r.state]
        )
          throw Error("ATTACHMENT_IMPORT_NOT_ATOMIC");
        const args = this.read<{
          expected_sha256: string;
          expected_bytes: string;
        }>(command.arguments_ref);
        if (
          args.expected_sha256 !== r.expected_sha256 ||
          Number(args.expected_bytes) !== r.expected_bytes ||
          (r.state !== "FAILED" && r.reserved_bytes !== r.expected_bytes)
        )
          throw Error("ATTACHMENT_IMPORT_IDENTITY_CHANGED");
        if (r.state === "READY") {
          const a = candidate.get("Attachment:" + r.attachment_id);
          if (
            a?.record_type !== "Attachment" ||
            a.import_request_id !== r.id ||
            a.content.sha256 !== r.expected_sha256 ||
            a.content.bytes !== r.expected_bytes
          )
            throw Error("ATTACHMENT_READY_NOT_ATOMIC");
        }
      }
      if (r.record_type === "Attachment") {
        const entry = candidate.get("AttachmentImport:" + r.import_request_id);
        if (
          entry?.record_type !== "AttachmentImport" ||
          entry.state !== "READY" ||
          entry.attachment_id !== r.id ||
          !["image/png", "image/jpeg"].includes(r.content.media_type)
        )
          throw Error("ATTACHMENT_READY_NOT_ATOMIC");
      }
      if (r.record_type === "Input" && r.attachments?.length) {
        if (
          r.producer !== "MASTER" ||
          new Set(r.attachments.map((a) => a.attachment_id)).size !==
            r.attachments.length
        )
          throw Error("ATTACHMENT_INPUT_INVALID");
        for (const binding of r.attachments) {
          const a = this.records.get("Attachment:" + binding.attachment_id);
          if (
            a?.record_type !== "Attachment" ||
            JSON.stringify(binding) !==
              JSON.stringify({
                attachment_id: a.id,
                import_request_id: a.import_request_id,
                name: a.name,
                content: a.content,
                width: a.width,
                height: a.height,
              })
          )
            throw Error("ATTACHMENT_BINDING_INVALID");
        }
        const digest = hash(
          JSON.stringify({
            version: 2,
            text_sha256: r.payload.sha256,
            attachments: r.attachments.map((a) => ({
              attachment_id: a.attachment_id,
              sha256: a.content.sha256,
              bytes: a.content.bytes,
              media_type: a.content.media_type,
            })),
          }),
        );
        if (r.content_digest !== digest)
          throw Error("ATTACHMENT_INPUT_DIGEST_INVALID");
      }
      if (r.record_type === "Input" && r.state === "WITHDRAWN") {
        if (
          !r.attachments?.length ||
          !r.withdrawal ||
          !txn.log_records.some(
            (e) =>
              e.event_type === "input.withdrawn" &&
              this.read<import("./contracts.ts").Input>(e.payload).id === r.id,
          )
        )
          throw Error("WITHDRAWAL_NOT_ATOMIC");
      }
      if (r.record_type === "WakeTimer") {
        const previous = this.records.get("WakeTimer:" + r.id);
        if (previous?.record_type === "WakeTimer") {
          if (
            previous.state !== "PENDING" ||
            !["FIRED", "CANCELLED"].includes(r.state) ||
            ["session_id", "at", "note", "source_event_ids"].some(
              (k) =>
                JSON.stringify((previous as any)[k]) !==
                JSON.stringify((r as any)[k]),
            )
          )
            throw Error("INVALID_WAKEUP_TRANSITION");
        } else if (r.state !== "PENDING")
          throw Error("INVALID_WAKEUP_TRANSITION");
        if (r.state === "FIRED") {
          const input = staged.find(
            (i) => i.record_type === "Input" && i.id === r.input_id,
          );
          if (
            input?.record_type !== "Input" ||
            input.producer !== "TIMER" ||
            input.session_id !== r.session_id ||
            input.dedupe_key !== "wakeup:" + r.id ||
            !r.fired_at ||
            r.cancelled_at !== null
          )
            throw Error("WAKEUP_INPUT_NOT_ATOMIC");
        } else if (
          r.input_id !== null ||
          r.fired_at !== null ||
          (r.state === "PENDING"
            ? r.cancelled_at !== null
            : r.cancelled_at === null)
        )
          throw Error("INVALID_WAKEUP_STATE");
        if (!previous) {
          const sources = new Set(r.source_event_ids);
          for (const source of [...sources]) {
            const event = this.eventByID.get(source);
            if (!event) continue;
            if (
              !sources.has(event.event_id) ||
              event.event_type !== "input.accepted"
            )
              continue;
            const input = this.read<import("./contracts.ts").Input>(
              event.payload,
            );
            if (input.session_id === r.session_id)
              sources.delete(event.event_id);
          }
          if (sources.size) throw Error("INVALID_WAKEUP_SOURCE");
        }
      }
      if (r.record_type === "Notification") {
        const previous = this.records.get("Notification:" + r.id);
        if (
          previous?.record_type === "Notification" &&
          (previous.session_id !== r.session_id ||
            previous.delivery_key !== r.delivery_key ||
            JSON.stringify(previous.message) !== JSON.stringify(r.message))
        )
          throw Error("NOTIFICATION_CONTENT_IMMUTABLE");
        if (
          previous?.record_type === "Notification" &&
          previous.read_at &&
          previous.read_at !== r.read_at
        )
          throw Error("NOTIFICATION_READ_MONOTONIC");
      }
      if (
        "session_id" in r &&
        r.session_id &&
        !candidate.has("Session:" + r.session_id) &&
        !this.records.has("Session:" + r.session_id)
      )
        throw Error("MISSING_SESSION");
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
      digest,
      sequence: txn.sequence,
      committed_at: txn.committed_at,
      mutations: txn.mutations,
      log_records: txn.log_records,
    });
    for (const m of txn.mutations) {
      const key = m.object_type + ":" + m.object_id;
      if (!this.firstSequences.has(key))
        this.firstSequences.set(key, txn.sequence);
      if (m.object_type === "TaskPlan")
        this.planHistory.set(`${m.object_id}:${m.new_revision}`, m.snapshot);
    }
    for (const r of staged) {
      const previousRecord = this.records.get(r.record_type + ":" + r.id);
      if (!previousRecord)
        this.recordOrder.set(r.record_type + ":" + r.id, this.recordOrder.size);
      for (const field of indexFields[r.record_type] ?? []) {
        const key = r.record_type + ":" + field;
        let index = this.indexes.get(key);
        if (!index) this.indexes.set(key, (index = new Map()));
        if (previousRecord) {
          const oldValue = fieldValue(previousRecord, field),
            old = index.get(oldValue);
          old?.delete(r.id);
          if (old?.size === 0) index.delete(oldValue);
        }
        const value = fieldValue(r, field);
        let bucket = index.get(value);
        if (!bucket) index.set(value, (bucket = new Map()));
        bucket.set(r.id, r);
      }
      if (r.record_type === "DecisionRequest" && r.answer_request_id)
        this.decisionAnswerRequests.add(r.answer_request_id);
      if (r.record_type === "ModelCall") {
        const previous = this.records.get("ModelCall:" + r.id) as
          ModelCall | undefined;
        if (previous?.logical_key && previous.logical_key !== r.logical_key) {
          const old = this.modelCallsByLogicalKey.get(previous.logical_key)!;
          old.delete(r.id);
          if (!old.size)
            this.modelCallsByLogicalKey.delete(previous.logical_key);
        }
        if (r.logical_key) {
          let calls = this.modelCallsByLogicalKey.get(r.logical_key);
          if (!calls)
            this.modelCallsByLogicalKey.set(r.logical_key, (calls = new Map()));
          calls.set(r.id, r);
        }
      }
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
      this.eventByID.set(e.event_id, e);
      let events = this.eventsByType.get(e.event_type);
      if (!events) this.eventsByType.set(e.event_type, (events = []));
      events.push(e);
      if (e.scope.execution_id) {
        let execution = this.eventsByExecution.get(e.scope.execution_id);
        if (!execution)
          this.eventsByExecution.set(e.scope.execution_id, (execution = []));
        execution.push(e);
      }
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
      const ref = v as unknown as ObjectRef;
      if (
        !/^objects\/[a-f0-9]{64}$/.test(ref.path) ||
        ref.path !== "objects/" + ref.sha256
      )
        throw Error("INVALID_OBJECT_PATH");
      const stat = fs.lstatSync(path.join(this.dir, ref.path));
      if (stat.isSymbolicLink()) throw Error("OBJECT_SYMLINK");
      if (!stat.isFile() || stat.size !== ref.bytes)
        throw Error("CORRUPT_OBJECT");
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
