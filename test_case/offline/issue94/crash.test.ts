import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const script = path.resolve("test_case/offline/issue94/crash-child.ts");
for (const reason of ["stop", "length"])
  for (const phase of ["before", "after"])
    for (const artifacts of ["yes", "no"])
      test(`durable crash ${phase} ${reason}, artifacts ${artifacts}`, () => {
        const root = fs.realpathSync(
          fs.mkdtempSync(path.join(os.tmpdir(), "issue94-crash-")),
        );
        try {
          const run = (source: string, dir: string, p: string) =>
            spawnSync(
              process.execPath,
              ["--import", "tsx", script, source, dir, p, reason, artifacts],
              { encoding: "utf8", timeout: 30000 },
            );
          const candidate = path.join(root, "candidate");
          const crash = run(process.cwd(), candidate, phase);
          assert.equal(crash.status, 77, crash.stderr);
          const recovered = run(process.cwd(), candidate, "recover");
          assert.equal(recovered.status, 0, recovered.stderr);
          const seen = JSON.parse(
            fs.readFileSync(
              path.join(candidate, "crash-observation.json"),
              "utf8",
            ),
          );
          assert(
            seen.every(
              (s: any) => s.deliveries <= (artifacts === "yes" ? 1 : 0),
            ),
            JSON.stringify(seen),
          );
          if (reason === "stop") {
            assert.equal(seen.at(-1).state, "IDLE");
            assert(seen.at(-1).inputs.every((s: string) => s === "HANDLED"));
            assert.equal(seen.at(-1).deliveries, artifacts === "yes" ? 1 : 0);
          }
          if (process.env.SECRETARY_ISSUE94_BASELINE && phase === "after") {
            const baseline = path.join(root, "baseline");
            assert.equal(
              run(process.env.SECRETARY_ISSUE94_BASELINE, baseline, phase)
                .status,
              77,
            );
            const r = run(
              process.env.SECRETARY_ISSUE94_BASELINE,
              baseline,
              "recover",
            );
            assert.equal(r.status, 0, r.stderr);
            const before = JSON.parse(
              fs.readFileSync(
                path.join(baseline, "crash-observation.json"),
                "utf8",
              ),
            );
            assert.deepEqual(
              seen.map(({ deliveries, ...v }: any) => v),
              before.map(({ deliveries, ...v }: any) => v),
            );
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      });
