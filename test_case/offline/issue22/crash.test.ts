import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Fixture, provider } from "./helpers.ts";
for (const phase of ["notification", "sending", "accepted"])
  test(`SIGKILL ${phase}: outbox reconciliation and at-least-once recovery`, () =>
    provider(async (endpoint, received) => {
      const f = new Fixture();
      try {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "test_case/offline/issue22/workers/crash.ts",
            f.dir,
            endpoint,
            phase,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let errors = "";
        child.stderr.on("data", (b) => (errors += b));
        const [, signal] = await once(child, "exit");
        assert.equal(signal, "SIGKILL", errors);
        assert.equal(received.length, phase === "accepted" ? 1 : 0);
        f.time += 30000;
        await f.open();
        await f.app.pushes.tick();
        assert.equal(f.dispatches().length, 1);
        assert.equal(f.dispatches()[0].state, "DISPATCHED");
        assert.equal(received.length, phase === "accepted" ? 2 : 1);
        assert.equal(
          f.dispatches()[0].attempts,
          phase === "notification" ? 1 : 2,
        );
        await f.app.pushes.tick();
        assert.equal(received.length, phase === "accepted" ? 2 : 1);
      } finally {
        await f.close();
      }
    }));
