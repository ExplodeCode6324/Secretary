/** Candidate-bound, credential-free evidence checker. Never creates a live domain. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { hash } from "../../src/pi_secretary/src/store.ts";
import { freezeAcceptanceConfig } from "./issue84-config.ts";
import { phases } from "./issue84-budget.ts";

const [dryPath, calibrationPath, assumptionsPath] = process.argv.slice(2);
assert(
  dryPath && calibrationPath && assumptionsPath,
  "USE_DRY_CALIBRATION_ASSUMPTIONS_PATHS",
);
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
assert(
  !git("status", "--porcelain", "--untracked-files=no"),
  "TRACKED_WORKTREE_DIRTY",
);
const source = git("rev-parse", "HEAD^{tree}");
const config = freezeAcceptanceConfig();
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const evidence: { path: string; sha256: string }[] = [];
function load(root: string, name: string) {
  const file = path.resolve(root, name);
  assert(
    file.startsWith(path.resolve(".demo-data/issue84") + path.sep),
    "OUTSIDE_ACCEPTANCE_ROOT",
  );
  evidence.push({ path: file, sha256: hash(fs.readFileSync(file)) });
  return read(file);
}
for (const [root, mode] of [
  [dryPath, "dry"],
  [calibrationPath, "calibration"],
]) {
  const manifest = load(root, "manifest.json"),
    observations = load(root, "observations.json");
  assert.equal(manifest.source, source, "WRONG_CANDIDATE");
  assert.equal(manifest.mode, mode);
  assert.equal(manifest.configHash, config.hash, "WRONG_CONFIG");
  assert.equal(manifest.freshness.empty, true, "FRESHNESS_NOT_PROVEN");
  assert.equal(observations.guardCalls, 0);
  assert.deepEqual(observations.wireViolations, [], "REFUSED_WIRE_VIOLATION");
  assert.equal(observations.session, "IDLE");
  assert(!observations.sessionStates.includes("CAPACITY_BLOCKED"));
  assert(!observations.maintenancePending, "PENDING_MAINTENANCE");
  assert(observations.requests.length > 0);
  assert(
    observations.requests.every((r: { input: number }) => r.input <= 80_000),
  );
  assert(
    observations.compactionJobs.some(
      (j: { state: string }) => j.state === "COMMITTED",
    ),
  );
  assert(
    observations.requests.some((r: { kind: string }) => r.kind === "summary"),
  );
  assert(
    observations.requests.some(
      (r: { kind: string }) => r.kind === "extraction",
    ),
  );
  if (mode === "dry") {
    assert(
      observations.activePeak >= 3,
      "CONCURRENT_MAIN_AND_TWO_TASKS_NOT_EXERCISED",
    );
    assert(
      observations.requests.some((r: { role: string }) => r.role === "task"),
    );
    const ledger = load(root, "usage.json"),
      scenarios = load(root, "scenarios.json");
    for (const phase of phases.filter((p) => p !== "reserve"))
      assert(
        ledger.attempts.some((a: { phase: string }) => a.phase === phase),
        "UNTESTED_PATH_" + phase,
      );
    assert(
      ledger.attempts.some(
        (a: { http: number; ms: number }) => a.http === 429 && a.ms < 120_000,
      ),
    );
    assert(ledger.refusals.length > 0);
    assert(
      ledger.attempts.some((a: { phase: string }) => a.phase === "reserve"),
    );
    for (const key of [
      "recoveryBlocked",
      "resumedSameInput",
      "shared",
      "image",
      "decision",
      "authorization",
      "redo",
      "restarted",
      "maintenanceRecovery",
      "crashRecovery",
    ])
      assert(scenarios[key] === true, "MISSING_SCENARIO_" + key);
    assert(!ledger.halted);
    assert(
      ledger.attempts.every((a: { ended?: number }) => a.ended !== undefined),
    );
  } else {
    assert(
      observations.inputs.filter(
        (i: { producer: string }) => i.producer === "MASTER",
      ).length >= 12,
    );
    assert(
      observations.compactionJobs.some(
        (j: { state: string; mode: string }) =>
          j.state === "COMMITTED" && j.mode === "CONTEXT_COMPACTION",
      ),
      "CONTEXT_TRIMMING_NOT_EXERCISED",
    );
  }
}
const assumptions = read(assumptionsPath);
assert.equal(assumptions.model, "deepseek-flash");
assert.equal(assumptions.inputUSDPerMillion, 0.3);
assert.equal(assumptions.outputUSDPerMillion, 1.2);
assert.equal(assumptions.maxImageTokens, 1024);
assert(
  Date.now() - Date.parse(assumptions.checkedAt) < 86_400_000,
  "PROVIDER_ASSUMPTIONS_EXPIRED",
);
assert.equal(
  assumptions.pricingURL,
  "https://api-docs.deepseek.com/quick_start/pricing/",
);
assert.equal(
  assumptions.visionURL,
  "https://api-docs.deepseek.com/guides/vision/",
);
evidence.push({
  path: path.resolve(assumptionsPath),
  sha256: hash(fs.readFileSync(assumptionsPath)),
});
const result = {
  status: "PASS",
  checkedAt: new Date().toISOString(),
  head: git("rev-parse", "HEAD"),
  source,
  configHash: config.hash,
  evidence,
  assumptions,
  scope:
    "Technical preflight only; Master native acceptance and final real-provider evidence are separate.",
};
fs.writeFileSync(
  ".demo-data/issue84/preflight.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(JSON.stringify(result, null, 2));
