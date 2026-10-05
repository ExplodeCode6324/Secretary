import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
for (const boundary of ["compaction", "receipt"]) {
  test(`SIGKILL after durable ${boundary} resumes short projection with stable canonical tool identities`, () => {
    const directory = fs.mkdtempSync("/tmp/secretary-issue2-kill-");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("SECRETARY_"),
      ),
    );
    const run = (phase: string) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "test_case/offline/issue2/kill-recovery-worker.ts",
          directory,
          boundary,
          phase,
        ],
        {
          cwd: process.cwd(),
          env,
          encoding: "utf8",
          timeout: 20000,
          maxBuffer: 1024 * 1024,
        },
      );
    try {
      const stopped = run("crash");
      assert.equal(stopped.signal, "SIGKILL", stopped.stderr + stopped.stdout);
      const crash = JSON.parse(
        fs.readFileSync(directory + "/crash.json", "utf8"),
      );
      assert.equal(crash.session.state, "RUNNING");
      assert(crash.canonicalBytes > 26000);
      const recovered = run("recover");
      assert.equal(recovered.status, 0, recovered.stderr + recovered.stdout);
      const result = JSON.parse(
        fs.readFileSync(directory + "/result-recover.json", "utf8"),
      );
      assert.equal(result.state, "IDLE", result.error);
      assert.equal(
        result.queryCount,
        2,
        "each of two synthetic query tools must execute once only",
      );
      assert.equal(result.toolKeys.length, 2);
      assert(result.canonicalHasOldAssistant && result.canonicalHasAnchor);
      assert.equal(result.protected_from_index, crash.protected_from_index);
      const active = result.requests.filter(
        (r: { loop: string }) => r.loop === crash.session.active_loop_id,
      );
      assert(active.length >= 1);
      assert(
        active.every(
          (r: {
            bytes: number;
            hasOldAssistant: boolean;
            hasAnchor: boolean;
            source: string;
          }) =>
            r.bytes < crash.canonicalBytes &&
            !r.hasOldAssistant &&
            r.hasAnchor &&
            r.source,
        ),
      );
      if (boundary === "receipt") {
        assert.deepEqual(result.toolKeys, crash.toolKeys);
        assert.deepEqual(result.toolIndices, crash.toolIndices);
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
