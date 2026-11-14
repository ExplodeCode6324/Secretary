/** File-only projection. Never import Store, clients, runtime configuration or model code. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  sha,
  safePath,
  rootPath,
  inside,
  readFile,
  readJSON,
  fail,
  stamp,
} from "./io.mjs";
export const DEFAULT_LIMITS = Object.freeze({
  journal: 64 * 1024 ** 2,
  record: 64 * 1024 ** 2,
  cas: 256 * 1024 ** 2,
  mutations: 100000,
  milliseconds: 30000,
  details: 200,
});
export async function readSnapshot(
  input,
  overrides = {},
  { allowValidating = false } = {},
) {
  const root = rootPath(input),
    limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [k, v] of Object.entries(limits))
    if (!Number.isSafeInteger(v) || v <= 0 || !Object.hasOwn(DEFAULT_LIMITS, k))
      fail("INVALID_LIMIT");
  const started = performance.now(),
    manifest = readJSON(safePath(root, "manifest.json"), 1024 ** 2);
  if (
    manifest.format !== "secretary-agile-capture-v1" ||
    !(
      manifest.status === "CAPTURED" ||
      (allowValidating && manifest.status === "VALIDATING")
    ) ||
    !manifest.source_root ||
    inside(root, path.resolve(manifest.source_root))
  )
    fail("NOT_OFFLINE_CAPTURE");
  if (!manifest.as_of || !Number.isFinite(Date.parse(manifest.as_of)))
    fail("INVALID_CAPTURE_TIME");
  const core = safePath(root, "instance/data/core");
  const schemaBytes = readFile(
    safePath(root, "contracts.schema.json"),
    limits.record,
  );
  if (sha(schemaBytes) !== manifest.schema_sha256) fail("SCHEMA_HASH");
  const ajv = new Ajv({ strict: false, allErrors: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(schemaBytes));
  const records = new Map(),
    first = new Map(),
    firstDecision = new Map(),
    frames = new Map(),
    events = [];
  const touched = new Map();
  for (const name of ["manifest.json", "contracts.schema.json"]) {
    const p = safePath(root, name);
    touched.set(p, JSON.stringify(stamp(fs.statSync(p, { bigint: true }))));
  }
  let casBytes = 0,
    journalBytes = 0,
    mutations = 0,
    sequence = 0,
    digest = "0".repeat(64),
    eventSequence = 0;
  const tick = () => {
    if (performance.now() - started > limits.milliseconds)
      fail("READ_TIME_LIMIT");
  };
  function bytes(ref) {
    tick();
    if (
      !ref ||
      !/^[a-f0-9]{64}$/.test(ref.sha256) ||
      ref.path !== "objects/" + ref.sha256 ||
      !Number.isSafeInteger(ref.bytes) ||
      ref.bytes < 0
    )
      fail("INVALID_OBJECT_REF");
    if (ref.bytes > limits.record || casBytes + ref.bytes > limits.cas)
      fail("CAS_READ_LIMIT");
    const file = safePath(core, ref.path),
      data = readFile(file, limits.record);
    casBytes += data.length;
    if (
      casBytes > limits.cas ||
      data.length !== ref.bytes ||
      sha(data) !== ref.sha256
    )
      fail("CORRUPT_OBJECT");
    touched.set(
      file,
      JSON.stringify(stamp(fs.statSync(file, { bigint: true }))),
    );
    return data;
  }
  const json = (ref) => JSON.parse(bytes(ref).toString("utf8"));
  const verified = new Set();
  function verifyRefs(value) {
    if (!value || typeof value !== "object") return;
    if (
      typeof value.path === "string" &&
      typeof value.sha256 === "string" &&
      typeof value.bytes === "number" &&
      typeof value.media_type === "string"
    ) {
      const key = JSON.stringify(value);
      if (!verified.has(key)) {
        const data = bytes(value);
        verified.add(key);
        if (
          value.media_type === "application/vnd.secretary.message-list+json"
        ) {
          const envelope = JSON.parse(data);
          if (
            envelope.encoding !== "message-refs-v1" ||
            !Array.isArray(envelope.messages) ||
            Object.keys(envelope).sort().join(",") !== "encoding,messages"
          )
            fail("INVALID_MESSAGE_ENVELOPE");
          for (const ref of envelope.messages) {
            if (ref.media_type !== "application/json")
              fail("INVALID_MESSAGE_ENVELOPE");
            verifyRefs(ref);
          }
        } else if (
          value.media_type === "application/vnd.secretary.image-evidence+json"
        ) {
          const envelope = JSON.parse(data);
          if (
            envelope.encoding !== "image-evidence-v1" ||
            !Array.isArray(envelope.images) ||
            envelope.images.length > 40000 ||
            !/^[a-f0-9]{64}$/.test(envelope.exact_sha256)
          )
            fail("INVALID_IMAGE_ENVELOPE");
          for (const leaf of envelope.images) verifyRefs(leaf.content);
          // Validate referenced image bytes without hydrating base64 or claiming logical request size.
        }
      }
      return;
    }
    for (const child of Object.values(value)) verifyRefs(child);
  }
  function line(data) {
    tick();
    const frame = JSON.parse(data);
    if (
      Object.keys(frame).sort().join(",") !== "payload_b64,sha256" ||
      typeof frame.payload_b64 !== "string"
    )
      fail("CORRUPT_FRAME");
    const payload = Buffer.from(frame.payload_b64, "base64");
    if (
      payload.length > limits.record ||
      payload.toString("base64") !== frame.payload_b64 ||
      sha(payload) !== frame.sha256
    )
      fail("CORRUPT_FRAME_HASH");
    const tx = JSON.parse(payload);
    if (
      !validate(tx) ||
      tx.record_type !== "JournalTransaction" ||
      tx.schema_version !== 1 ||
      tx.sequence !== sequence + 1 ||
      tx.previous_digest !== digest
    )
      fail("CORRUPT_CHAIN_OR_SHAPE");
    const seen = new Set();
    for (const [index, m] of tx.mutations.entries()) {
      if (++mutations > limits.mutations) fail("MUTATION_LIMIT");
      const record = json(m.snapshot),
        key = m.object_type + ":" + m.object_id,
        previous = records.get(key);
      if (
        seen.has(key) ||
        !validate(record) ||
        record.record_type !== m.object_type ||
        record.id !== m.object_id ||
        record.schema_version !== 1 ||
        m.expected_revision !== (previous?.revision ?? 0) ||
        m.new_revision !== m.expected_revision + 1 ||
        record.revision !== m.new_revision
      )
        fail("RECORD_REVISION_OR_SHAPE");
      seen.add(key);
      verifyRefs(record);
      if (!first.has(key))
        first.set(key, { sequence: tx.sequence, index, at: tx.committed_at });
      if (
        record.record_type === "AuthorizationRequest" &&
        record.decided_at &&
        !firstDecision.has(key)
      )
        firstDecision.set(key, record.decided_at);
      records.set(key, record);
    }
    for (const event of tx.log_records) {
      if (event.sequence !== eventSequence + 1) fail("EVENT_SEQUENCE");
      eventSequence = event.sequence;
      verifyRefs(event);
      if (
        ["model.payload", "model.capacity_blocked"].includes(event.event_type)
      )
        events.push(event);
    }
    sequence = tx.sequence;
    digest = frame.sha256;
    frames.set(sequence, digest);
  }
  const journal = safePath(core, "journal.jsonl"),
    initial = fs.statSync(journal, { bigint: true });
  if (initial.size > BigInt(limits.journal)) fail("JOURNAL_LIMIT");
  const hash = createHash("sha256");
  let pending = Buffer.alloc(0);
  const stream = fs.createReadStream(journal, {
    highWaterMark: 64 * 1024,
    flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  });
  for await (const chunk of stream) {
    tick();
    journalBytes += chunk.length;
    hash.update(chunk);
    if (journalBytes > limits.journal) fail("JOURNAL_LIMIT");
    pending = Buffer.concat([pending, chunk]);
    let end;
    while ((end = pending.indexOf(10)) !== -1) {
      if (end > limits.record * 1.4 + 1024) fail("LINE_LIMIT");
      line(pending.subarray(0, end));
      pending = pending.subarray(end + 1);
    }
    if (pending.length > limits.record * 1.4 + 1024) fail("LINE_LIMIT");
  }
  if (pending.length) fail("TRUNCATED_JOURNAL");
  const journalHash = hash.digest("hex");
  touched.set(journal, JSON.stringify(stamp(initial)));
  if (
    JSON.stringify(stamp(initial)) !==
    JSON.stringify(stamp(fs.statSync(journal, { bigint: true })))
  )
    fail("INPUT_CHANGED");
  if (
    manifest.journal?.sha256 !== journalHash ||
    manifest.journal?.sequence !== sequence ||
    manifest.journal?.digest !== digest ||
    manifest.journal?.bytes !== journalBytes
  )
    fail("MANIFEST_JOURNAL_MISMATCH");
  const all = (type) =>
    [...records.values()].filter((r) => r.record_type === type);
  const get = (type, id) => records.get(type + ":" + id);
  function metrics() {
    tick();
    for (const [file, st] of touched)
      if (JSON.stringify(stamp(fs.statSync(file, { bigint: true }))) !== st)
        fail("INPUT_CHANGED");
    return {
      journal_bytes: journalBytes,
      cas_read_bytes: casBytes,
      mutations,
      sequence,
      digest,
      elapsed_ms: Math.ceil(performance.now() - started),
      limits,
      complete: true,
      validation:
        "static framing/schema/references/revisions; not Core business replay",
      quarantines: fs
        .readdirSync(core)
        .filter((x) => x.startsWith("journal.jsonl.incomplete-")),
      noncanonical_objects: fs
        .readdirSync(safePath(core, "objects"))
        .filter((x) => !/^[a-f0-9]{64}$/.test(x)),
    };
  }
  return {
    root,
    manifest,
    all,
    get,
    first,
    firstDecision,
    frames,
    events,
    json,
    bytes,
    metrics,
    limits,
  };
}
