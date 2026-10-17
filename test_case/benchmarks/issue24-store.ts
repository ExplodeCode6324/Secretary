// Synthetic journal generator and repeatable Store benchmark. Never use live data.
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  Store,
  base,
  hash,
  id,
  revise,
} from "../../src/pi_secretary/src/store.ts";
import type {
  Input,
  Session,
  JournalTransaction,
} from "../../src/pi_secretary/src/contracts.ts";
const [mode, dir, countArg = "50000"] = process.argv.slice(2);
const count = Number(countArg);
if (!dir || !path.resolve(dir).includes("issue24"))
  throw Error("Use an isolated issue24 directory");
if (mode === "generate") {
  if (fs.existsSync(dir)) throw Error("Dataset already exists");
  fs.mkdirSync(path.join(dir, "objects"), { recursive: true });
  const put = (v: unknown) => {
    const b = Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v));
    const sha256 = hash(b);
    const rel = "objects/" + sha256;
    fs.writeFileSync(path.join(dir, rel), b);
    return {
      path: rel,
      sha256,
      bytes: b.length,
      media_type: "application/json",
    };
  };
  const session: Session = {
    ...base(),
    schema_version: 1,
    record_type: "Session",
    state: "IDLE",
    owner_epoch: 1,
    active_loop_id: null,
    claimed_input_ids: [],
    last_context_id: null,
    consciousness_id: id(),
    last_journal_seq: 0,
    recovery_error: null,
  };
  let sequence = 0,
    previous_digest = "0".repeat(64);
  const journal = fs.openSync(path.join(dir, "journal.jsonl"), "wx");
  const write = (r: Session | Input, expected_revision = 0) => {
    const txn: JournalTransaction = {
      record_type: "JournalTransaction",
      schema_version: 1,
      txn_id: id(),
      sequence: ++sequence,
      owner_epoch: 1,
      previous_digest,
      mutations: [
        {
          object_type: r.record_type,
          object_id: r.id,
          expected_revision,
          new_revision: r.revision,
          snapshot: put(r),
        },
      ],
      log_records: [],
      receipts: [],
      committed_at: r.updated_at,
    };
    const payload = Buffer.from(JSON.stringify(txn));
    previous_digest = hash(payload);
    fs.writeSync(
      journal,
      JSON.stringify({
        payload_b64: payload.toString("base64"),
        sha256: previous_digest,
      }) + "\n",
    );
  };
  write(session);
  // Exactly 40,000 bytes per input: 2 GB at 50k, each uniquely content addressed.
  for (let n = 0; n < count; n++) {
    const body = Buffer.alloc(40000, 120);
    body.write(String(n).padStart(16, "0"));
    const r: Input = {
      ...base(),
      schema_version: 1,
      record_type: "Input",
      session_id: session.id,
      dedupe_key: "bench-" + n,
      producer: "MASTER",
      state: "ACCEPTED",
      payload: put(body),
      loop_id: null,
      received_at: new Date().toISOString(),
      feedback_id: null,
    };
    write(r);
    write(revise(r, { state: "CLAIMED" }), 1);
    if (n % 10000 === 0) process.stderr.write(`generated ${n}\n`);
  }
  fs.fsyncSync(journal);
  fs.closeSync(journal);
  console.log(
    JSON.stringify({
      records: count + 1,
      transactions: sequence,
      payloadBytes: count * 40000,
    }),
  );
} else if (mode === "measure") {
  const start = performance.now();
  const store = await Store.open(dir);
  const startupMs = performance.now() - start;
  const values: number[] = [];
  for (let n = 0; n < 300; n++) {
    const t = performance.now();
    store.commit([]);
    values.push(performance.now() - t);
  }
  values.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      startupMs,
      commitP50: values[149],
      commitP95: values[284],
      samples: values.length,
      sequence: store.sequence,
      rss: process.memoryUsage().rss,
      node: process.version,
    }),
  );
  await store.close();
} else throw Error("generate or measure");
