import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";
import { Store, hash } from "../../../src/pi_secretary/src/store.ts";
import { JournalOwner } from "../../../src/pi_secretary/src/store-lock.ts";

// Ordinary unit instrumentation: JavaScript is forbidden to mutate the journal.
// No helper is stopped, signalled, or replaced, and no owner-loss race is driven.
async function withoutParentJournalWrites(
  dir: string,
  run: () => Promise<void>,
) {
  const open = fs.openSync;
  const truncate = fs.truncateSync;
  const journal = path.join(dir, "journal.jsonl");
  fs.openSync = ((file, flags, mode) => {
    if (String(file) === journal && flags !== "r")
      throw Error("PARENT_JOURNAL_WRITE");
    return open(file, flags, mode);
  }) as typeof fs.openSync;
  fs.truncateSync = ((file, length) => {
    if (String(file) === journal) throw Error("PARENT_JOURNAL_TRUNCATE");
    return truncate(file, length);
  }) as typeof fs.truncateSync;
  syncBuiltinESMExports();
  try {
    await run();
  } finally {
    fs.openSync = open;
    fs.truncateSync = truncate;
    syncBuiltinESMExports();
  }
}

test("journal append is performed by lock holder; acknowledged commit is immediately replayable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-owner-unit-"));
  let store: Store | undefined;
  try {
    store = await Store.open(dir);
    const event = store.event("durable-owner-commit", { ok: true });
    await withoutParentJournalWrites(dir, async () => {
      store!.commit([], [event]);
    });
    const frame = JSON.parse(
      fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8"),
    );
    const payload = Buffer.from(frame.payload_b64, "base64");
    assert.equal(hash(payload), frame.sha256);
    assert.equal(store.digest, frame.sha256);
    assert.equal(store.sequence, 1);
    assert.equal(
      JSON.parse(payload.toString()).log_records[0].event_id,
      event.event_id,
    );
    await store.close();
    store = await Store.open(dir);
    assert.equal(store.sequence, 1);
    assert.equal(store.logs[0].event_id, event.event_id);
  } finally {
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tail quarantine and truncation are performed by the lock holder", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-owner-tail-"));
  let store: Store | undefined;
  try {
    store = await Store.open(dir);
    store.commit([]);
    await store.close();
    const journal = path.join(dir, "journal.jsonl");
    const durable = fs.readFileSync(journal);
    fs.appendFileSync(journal, "{unfinished");
    await withoutParentJournalWrites(dir, async () => {
      store = await Store.open(dir);
    });
    assert.deepEqual(fs.readFileSync(journal), durable);
    const quarantine = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith("journal.jsonl.incomplete-"));
    assert.equal(quarantine.length, 1);
    assert.equal(
      fs.readFileSync(path.join(dir, quarantine[0]), "utf8"),
      "{unfinished",
    );
    assert.equal(store.sequence, 1);
    store.commit([]);
    assert.equal(store.sequence, 2);
  } finally {
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("live owner excludes another opener and closed owner cannot append after normal handoff", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-owner-handoff-"));
  let first: Store | undefined;
  let second: Store | undefined;
  try {
    first = await Store.open(dir);
    first.commit([], [first.event("event-only-first-owner", {})]);
    const firstEpoch = first.epoch;
    await assert.rejects(Store.open(dir), /OWNER_BUSY/);
    await first.close();
    await first.close();
    second = await Store.open(dir);
    assert.equal(second.epoch, firstEpoch + 1);
    second.commit([]);
    assert.throws(() => first!.commit([]), /STORE_NOT_OWNER/);
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    const rows = fs
      .readFileSync(path.join(dir, "journal.jsonl"), "utf8")
      .trim()
      .split("\n");
    assert.deepEqual(
      rows.map(
        (line) =>
          JSON.parse(
            Buffer.from(JSON.parse(line).payload_b64, "base64").toString(),
          ).sequence,
      ),
      [1, 2],
    );
  } finally {
    await first?.close();
    await second?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("each normal owner gets a fresh startup channel and close removes it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-owner-mailbox-"));
  const channelOf = (owner: JournalOwner) =>
    (owner as unknown as { channel: string }).channel;
  let first: JournalOwner | undefined;
  let second: JournalOwner | undefined;
  try {
    first = (await JournalOwner.open(dir)).owner;
    const firstChannel = channelOf(first);
    assert.equal(fs.statSync(firstChannel).mode & 0o777, 0o700);
    await first.close();
    assert.equal(fs.existsSync(firstChannel), false);
    second = (await JournalOwner.open(dir)).owner;
    const secondChannel = channelOf(second);
    assert.notEqual(firstChannel, secondChannel);
    await second.close();
    assert.equal(fs.existsSync(secondChannel), false);
  } finally {
    await first?.close();
    await second?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("helper rejects a malformed append and permanently fails that protocol owner", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-owner-protocol-"));
  let owner: JournalOwner | undefined;
  let reopened: Store | undefined;
  try {
    owner = (await JournalOwner.open(dir)).owner;
    assert.throws(
      () => owner!.append("{}\n", "0".repeat(64)),
      /STORE_NOT_OWNER/,
    );
    assert.throws(
      () => owner!.append("{}\n", "0".repeat(64)),
      /STORE_NOT_OWNER/,
    );
    assert.equal(fs.existsSync(path.join(dir, "journal.jsonl")), false);
    await owner.close();
    reopened = await Store.open(dir);
    assert.equal(reopened.sequence, 0);
  } finally {
    await owner?.close();
    await reopened?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("helper rejects an already appended frame instead of duplicating its sequence", async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "issue4-owner-chain-unit-"),
  );
  let store: Store | undefined;
  try {
    store = await Store.open(dir);
    store.commit([]);
    const frame = fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8");
    const owner = (store as unknown as { owner: JournalOwner }).owner;
    assert.throws(() => owner.append(frame, store!.digest), /STORE_NOT_OWNER/);
    assert.equal(
      fs.readFileSync(path.join(dir, "journal.jsonl"), "utf8"),
      frame,
    );
    assert.throws(() => store!.commit([]), /STORE_NOT_OWNER/);
  } finally {
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const field of ["id", "digest"] as const) {
  test(`mismatched ${field} acknowledgement never installs state or restores failed owner`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-owner-ack-"));
    let store: Store | undefined;
    try {
      store = await Store.open(dir);
      const owner = (store as any).owner;
      const read = owner.readReply.bind(owner);
      owner.readReply = () => ({ ...read(), [field]: "mismatched-unit-reply" });
      assert.throws(() => store!.commit([]), /STORE_NOT_OWNER/);
      assert.equal(store.sequence, 0);
      assert.equal(store.digest, "0".repeat(64));
      assert.equal(store.projectionFrames.length, 0);
      owner.readReply = read;
      // Even after the reply source is restored, this Store stays failed.
      assert.throws(() => store!.commit([]), /STORE_NOT_OWNER/);
      await store.close();
      store = await Store.open(dir);
      assert.equal(store.sequence, 1);
    } finally {
      await store?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("corrupt startup releases ownership so repaired journal can be reopened", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-owner-startup-"));
  let store: Store | undefined;
  try {
    store = await Store.open(dir);
    store.commit([]);
    await store.close();
    const journal = path.join(dir, "journal.jsonl");
    const valid = fs.readFileSync(journal);
    fs.writeFileSync(journal, "{}\n");
    await assert.rejects(Store.open(dir), /CORRUPT/);
    await assert.rejects(Store.open(dir), /CORRUPT/);
    fs.writeFileSync(journal, valid);
    store = await Store.open(dir);
    assert.equal(store.sequence, 1);
  } finally {
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unacknowledged transport timeout is permanent despite a late ACK", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue24-timeout-"));
  const { owner } = await JournalOwner.open(dir);
  try {
    (owner as any).timeoutMs = 100;
    process.kill((owner as any).childPID, "SIGSTOP");
    const started = performance.now();
    assert.throws(() => owner.append("{}\n", "unit-digest"), /STORE_NOT_OWNER/);
    assert.ok(performance.now() - started < 2000);
    const state = new Int32Array((owner as any).reply, 0, 2);
    Atomics.store(state, 0, 1); // late completion cannot clear failed state
    assert.throws(() => owner.append("{}\n", "unit-digest"), /STORE_NOT_OWNER/);
  } finally {
    await owner.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("close recognizes a signalled helper and remains idempotent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue24-close-"));
  const { owner } = await JournalOwner.open(dir);
  const channel = (owner as any).channel;
  try {
    process.kill((owner as any).childPID, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await owner.close();
    await owner.close();
    assert.equal(fs.existsSync(channel), false);
  } finally {
    await owner.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
