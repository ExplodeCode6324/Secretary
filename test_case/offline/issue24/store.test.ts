import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Store,
  base,
  id,
  revise,
} from "../../../src/pi_secretary/src/store.ts";
import type {
  Session,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";
const session = (): Session => ({
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
});
function input(store: Store, sessionID: string): Input {
  return {
    ...base(),
    schema_version: 1,
    record_type: "Input",
    session_id: sessionID,
    dedupe_key: id(),
    producer: "MASTER",
    state: "ACCEPTED",
    payload: store.put("synthetic", "text/plain"),
    loop_id: null,
    received_at: new Date().toISOString(),
    feedback_id: null,
  };
}
test("staging resolves same transaction Session and rejects duplicate Session without installing state", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue24-stage-"));
  let store = await Store.open(dir);
  try {
    const s = session(),
      i = input(store, s.id);
    store.commit([i, s]);
    assert.equal(store.get<Input>("Input", i.id).session_id, s.id);
    assert.throws(() => store.commit([session()]), /MULTIPLE_MAIN_SESSIONS/);
    assert.equal(store.all("Session").length, 1);
    assert.throws(() => store.commit([input(store, id())]), /MISSING_SESSION/);
    store.commit([revise(s, { state: "STOPPED" })]);
    const digest = store.digest,
      sequence = store.sequence;
    await store.close();
    store = await Store.open(dir);
    assert.equal(store.digest, digest);
    assert.equal(store.sequence, sequence);
    assert.equal(store.all("Session").length, 1);
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("reference metadata rejects missing, truncated and symlink objects; reads reject same-length corruption", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue24-refs-"));
  let store = await Store.open(dir);
  try {
    const s = session();
    store.commit([s]);
    for (const kind of ["missing", "short", "symlink"]) {
      const i = input(store, s.id);
      const file = path.join(dir, i.payload.path);
      if (kind === "missing") fs.unlinkSync(file);
      if (kind === "short") fs.writeFileSync(file, "x");
      if (kind === "symlink") {
        fs.unlinkSync(file);
        fs.symlinkSync("/dev/null", file);
      }
      assert.throws(() => store.commit([i]));
      fs.rmSync(file, { force: true });
    }
    const i = input(store, s.id);
    store.commit([i]);
    fs.writeFileSync(
      path.join(dir, i.payload.path),
      "X".repeat(i.payload.bytes),
    );
    assert.throws(() => store.bytes(i.payload), /CORRUPT_OBJECT/);
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
