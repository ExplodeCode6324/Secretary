import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LocalFiles,
  expired,
} from "../../../src/pi_secretary/src/tui/state.ts";

test("single writer, atomic latest snapshots, permissions, recovery, corrupt input preserved", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue82-state-"));
  const first = new LocalFiles(root),
    second = new LocalFiles(root);
  try {
    const state = await first.open("domain", "fixture");
    await assert.rejects(() => second.open("domain", "fixture"), /OWNED/);
    state.drafts.Main.raw = "原始 /T";
    const a = first.save(state);
    state.drafts.Main.raw = "更新";
    state.drafts.Task.raw = "Task 独立";
    const b = first.save(state);
    await Promise.all([a, b]);
    assert.equal(
      (await fs.stat(path.join(root, "state.json"))).mode & 0o777,
      0o600,
    );
    await first.close();
    const reopened = await second.open("domain", "fixture");
    assert.equal(reopened.drafts.Main.raw, "更新");
    assert.equal(reopened.drafts.Task.raw, "Task 独立");
    await second.close();
    await fs.writeFile(path.join(root, "state.json"), "broken");
    await assert.rejects(() => first.open("domain", "fixture"));
    assert.equal(
      await fs.readFile(path.join(root, "state.json"), "utf8"),
      "broken",
    );
    // A failed open must release its lock so a repaired file can be opened.
    await fs.writeFile(path.join(root, "state.json"), JSON.stringify(state));
    await second.open("domain", "fixture");
  } finally {
    await first.close();
    await second.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("calendar expiry clamps leap day and collection preserves all current references and foreign files", async () => {
  assert(!expired("2024-02-29T12:00:00Z", new Date("2027-02-28T11:59:59Z")));
  assert(expired("2024-02-29T12:00:00Z", new Date("2027-02-28T12:00:00Z")));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue82-expiry-")),
    files = new LocalFiles(root);
  try {
    const state = await files.open("domain", "fixture");
    const old = {
      id: "abc",
      created_at: "2020-01-01",
      raw: "body",
      body: { request_id: "abc", text: "body" },
      attempts: [],
      status: "UNKNOWN" as const,
    };
    const removable = await files.recover(old),
      protectedFile = await files.recover(old);
    state.recovery = { file: protectedFile, id: old.id };
    await files.save(state);
    await fs.writeFile(path.join(root, "foreign.txt"), "preserve");
    const tmp = path.join(root, ".tmp-00000000-0000-0000-0000-000000000000");
    await fs.writeFile(
      tmp,
      JSON.stringify({ version: 1, drafts: state.drafts }),
    );
    await fs.utimes(tmp, new Date("2020-01-01"), new Date("2020-01-01"));
    await files.collect(state, new Date("2026-10-30"));
    await assert.rejects(fs.stat(tmp), /ENOENT/);
    await assert.rejects(fs.stat(path.join(root, removable)), /ENOENT/);
    assert((await fs.stat(path.join(root, protectedFile))).isFile());
    assert((await fs.stat(path.join(root, "foreign.txt"))).isFile());
  } finally {
    await files.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
