import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";

const helper = fileURLToPath(
  new URL("./helpers/issue4-crash.ts", import.meta.url),
);
const evidenceRoot = fileURLToPath(
  new URL("../../reports/issue4-20261006/crash/", import.meta.url),
);
fs.mkdirSync(evidenceRoot, { recursive: true });
const run = fs.mkdtempSync(path.join(evidenceRoot, "run-"));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
fs.writeFileSync(
  path.join(run, "manifest.json"),
  JSON.stringify(
    {
      command:
        "node --import tsx --test test_case/offline/issue4/crash.test.ts",
      started_at: new Date().toISOString(),
      node: process.version,
      files: [
        "test_case/offline/issue4/crash.test.ts",
        "test_case/offline/issue4/helpers/issue4-crash.ts",
        "src/pi_secretary/src/memory-extraction-recovery.ts",
        "src/pi_secretary/src/host-memory-recovery.ts",
        "src/pi_secretary/src/host.ts",
        "src/pi_secretary/src/transport.ts",
        "src/pi_secretary/src/store.ts",
      ].map((name) => ({
        name,
        sha256: createHash("sha256")
          .update(fs.readFileSync(path.join(repo, name)))
          .digest("hex"),
      })),
    },
    null,
    2,
  ),
);
const read = (dir: string, name: string) =>
  JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const counts = (dir: string) =>
  fs
    .readFileSync(path.join(dir, "sends.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .reduce(
      (n, row) => {
        n[row.kind] = (n[row.kind] ?? 0) + 1;
        return n;
      },
      {} as Record<string, number>,
    );

async function child(mode: string, dir: string, boundary: string) {
  const worker = spawn(
    process.execPath,
    ["--import", "tsx", helper, mode, dir, boundary],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "",
    exited = false;
  worker.stdout.on("data", (b) => {
    stdout += b;
  });
  worker.stderr.on("data", (b) => {
    stderr += b;
  });
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });
  const timeout = setTimeout(() => worker.kill("SIGKILL"), 25_000);
  try {
    if (mode === "crash") {
      while (!fs.existsSync(path.join(dir, "boundary.json")) && !exited)
        await delay(10);
      assert.ok(
        fs.existsSync(path.join(dir, "boundary.json")),
        "child never reached boundary: " + stderr,
      );
      assert.equal(read(dir, "boundary.json").pid, worker.pid);
      assert.equal(worker.kill("SIGKILL"), true);
    }
    const status = await exit;
    fs.writeFileSync(
      path.join(dir, mode + ".process.json"),
      JSON.stringify({ pid: worker.pid, ...status, stdout, stderr }, null, 2),
    );
    if (mode === "crash") assert.equal(status.signal, "SIGKILL");
    else assert.equal(status.code, 0, stderr);
    await delay(50); // Give the killed parent's lock-helper pipe time to close.
  } finally {
    clearTimeout(timeout);
    if (!exited) worker.kill("SIGKILL");
  }
}

for (const boundary of [
  "authorization",
  "prepared-unlinked",
  "linked-prepared",
  "in-flight",
  "stream-called",
  "response-saved",
  "extraction-succeeded",
  "owner-committed",
]) {
  test(
    `SIGKILL ${boundary}: restart replays receipts without another send or duplicate memory`,
    { timeout: 90_000 },
    async () => {
      const dir = path.join(run, boundary);
      fs.mkdirSync(dir);
      await child("crash", dir, boundary);
      const killed = read(dir, "boundary.json");
      const recovery = killed.recoveries[0];
      assert.ok(recovery, "authorization persisted before killing");
      assert.equal(killed.recoveries.length, 1);
      assert.deepEqual(killed.receipts, [
        { request_id: recovery.request_id, recovery_id: recovery.id },
      ]);
      const sent = [
        "stream-called",
        "response-saved",
        "extraction-succeeded",
        "owner-committed",
      ].includes(boundary);
      const completed = [
        "response-saved",
        "extraction-succeeded",
        "owner-committed",
      ].includes(boundary);
      const sends = counts(dir);
      assert.equal(
        sends.extraction,
        sent ? 2 : 1,
        "one initial failure plus at most one authorized send",
      );
      if (boundary === "linked-prepared")
        assert.equal(
          killed.calls.find((c: any) => c.id === recovery.call_id)?.state,
          "PREPARED",
        );
      if (["in-flight", "stream-called"].includes(boundary))
        assert.equal(
          killed.calls.find((c: any) => c.id === recovery.call_id)?.state,
          "IN_FLIGHT",
        );
      if (boundary === "response-saved")
        assert.ok(
          killed.calls.find((c: any) => c.id === recovery.call_id)?.response,
        );
      for (const mode of ["same", "fresh", "stale"]) {
        await child(mode, dir, boundary);
        const replay = read(dir, mode + ".json");
        assert.notEqual(
          replay.before.pid,
          killed.pid,
          "reopened in a new process",
        );
        assert.deepEqual(
          counts(dir),
          sends,
          mode + " request must never send on restart",
        );
        if (mode === "same") {
          assert.equal(replay.error, null);
          assert.equal(
            replay.result.recovery_id,
            recovery.id,
            "same durable receipt",
          );
          assert.equal(
            replay.result.status,
            completed ? "SUCCEEDED" : "BLOCKED",
          );
        }
        if (mode === "fresh" && completed) {
          assert.equal(replay.error, null);
          assert.equal(replay.result.status, "SUCCEEDED");
        }
        if (mode === "fresh" && !completed) {
          assert.ok(replay.error || replay.result.status === "BLOCKED");
          assert.equal(
            replay.after.recoveries.length,
            1,
            "consumed authorization cannot mint another generation",
          );
        }
        if (mode === "stale")
          assert.match(replay.error ?? "", /BINDING_MISMATCH/);
        const memory = replay.after.consciousness;
        assert.equal(replay.after.ownerEvents, completed ? 1 : 0);
        assert.equal((memory.commitments ?? []).length, completed ? 1 : 0);
        if (completed) {
          assert.equal(memory.last_job_id, killed.jobs[0].id);
          assert.equal(
            memory.commitments[0].source_batch.owner_id,
            killed.jobs[0].id,
          );
          assert.equal(
            memory.revision,
            read(dir, "fixture.json").before.consciousness.revision + 1,
          );
        }
        assert.equal(
          replay.after.jobs[0].state,
          completed ? "COMMITTED" : "FAILED",
        );
      }
      fs.writeFileSync(
        path.join(dir, "passed.json"),
        JSON.stringify(
          {
            boundary,
            actualSignal: "SIGKILL",
            sends,
            result: "PASS",
            preservedStore: path.join(dir, "store"),
          },
          null,
          2,
        ),
      );
    },
  );
}
