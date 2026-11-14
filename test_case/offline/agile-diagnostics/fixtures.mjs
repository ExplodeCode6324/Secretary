import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha } from "../../../scripts/agile-diagnostics/io.mjs";
const schemaFile = new URL(
  "../../../src/contracts/contracts.schema.json",
  import.meta.url,
);
export const at = "2026-11-14T00:00:00.000Z";
export function fixture() {
  const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "agile005-files-")),
    ),
    core = path.join(root, "instance/data/core");
  fs.mkdirSync(path.join(core, "objects"), { recursive: true });
  const schema = fs.readFileSync(schemaFile),
    defs = JSON.parse(schema).$defs;
  fs.writeFileSync(path.join(root, "contracts.schema.json"), schema);
  let seq = 0,
    digest = "0".repeat(64),
    eventSequence = 0;
  function put(value) {
    const data = Buffer.from(JSON.stringify(value)),
      h = sha(data);
    fs.writeFileSync(path.join(core, "objects", h), data);
    return {
      path: "objects/" + h,
      sha256: h,
      bytes: data.length,
      media_type: "application/json",
    };
  }
  function value(d) {
    if (d.$ref) {
      const name = d.$ref.split("/").at(-1);
      if (name === "Digest") return "0".repeat(64);
      if (name === "ID") return randomUUID();
      if (name === "Time") return at;
      if (name === "ObjectRef") return put({});
      return value(defs[name]);
    }
    if (d.const !== undefined) return d.const;
    if (d.enum) return d.enum[0];
    if (d.anyOf || d.oneOf) {
      const choices = d.anyOf ?? d.oneOf;
      return value(choices.find((x) => x.type === "null") ?? choices[0]);
    }
    if (d.type === "null") return null;
    if (d.type === "object" || d.properties)
      return Object.fromEntries(
        (d.required ?? []).map((k) => [k, value(d.properties[k])]),
      );
    if (d.type === "array")
      return Array.from({ length: d.minItems ?? 0 }, () => value(d.items));
    if (d.type === "integer" || d.type === "number")
      return Math.max(
        0,
        d.minimum ?? 0,
        d.exclusiveMinimum !== undefined ? d.exclusiveMinimum + 1 : 0,
      );
    if (d.type === "boolean") return false;
    if (d.pattern?.includes("a-f0-9")) return "0".repeat(64);
    if (d.format === "date-time") return at;
    return "x".repeat(Math.max(1, d.minLength ?? 0));
  }
  function make(type, patch = {}) {
    return {
      ...value(defs[type]),
      record_type: type,
      schema_version: 1,
      id: randomUUID(),
      revision: 1,
      updated_at: at,
      ...patch,
    };
  }
  function event(
    kind,
    payload,
    scope = { session_id: null, task_id: null, execution_id: null },
  ) {
    return {
      record_type: "OperationLogRecord",
      schema_version: 1,
      event_id: randomUUID(),
      stream: "MAIN",
      scope,
      sequence: ++eventSequence,
      event_type: kind,
      occurred_at: at,
      recorded_at: at,
      actor: "HOST",
      payload: put(payload),
      causation_id: null,
      correlation_id: randomUUID(),
      related_object_ids: [],
    };
  }
  function commit(records = [], events = [], time = at) {
    const tx = {
      record_type: "JournalTransaction",
      schema_version: 1,
      txn_id: randomUUID(),
      sequence: ++seq,
      owner_epoch: 1,
      previous_digest: digest,
      mutations: records.map((r) => ({
        object_type: r.record_type,
        object_id: r.id,
        expected_revision: r.revision - 1,
        new_revision: r.revision,
        snapshot: put(r),
      })),
      log_records: events,
      receipts: [],
      committed_at: time,
    };
    const b = Buffer.from(JSON.stringify(tx));
    digest = sha(b);
    fs.appendFileSync(
      path.join(core, "journal.jsonl"),
      JSON.stringify({ payload_b64: b.toString("base64"), sha256: digest }) +
        "\n",
    );
  }
  function seal(extra = {}) {
    if (!seq) commit();
    const b = fs.readFileSync(path.join(core, "journal.jsonl"));
    const manifest = {
      format: "secretary-agile-capture-v1",
      status: "CAPTURED",
      source_root: "/synthetic-never-running-source",
      as_of: "2026-11-15T00:00:00.000Z",
      schema_sha256: sha(schema),
      journal: { sha256: sha(b), bytes: b.length, sequence: seq, digest },
      ...extra,
    };
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify(manifest),
    );
    return root;
  }
  return {
    root,
    core,
    put,
    make,
    event,
    commit,
    seal,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
