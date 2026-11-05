/** Fresh credential-free rehearsal through the SAME admission/adapter/Core service as live. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "pg";
import { CoreClient } from "../../src/pi_secretary/src/core-client.ts";
import { id, hash } from "../../src/pi_secretary/src/store.ts";
import { usageReport } from "./issue84-usage.ts";
import { redoSource } from "./issue84-prompts.ts";
import { runRecoveryHarness } from "./issue84-memory-recovery.ts";

const [run, mode] = process.argv.slice(2);
const observe = (process.env.ISSUE84_POLICY ?? "observe") === "observe";
assert(
  /^[a-z0-9_]{1,24}$/.test(run) && ["dry", "calibration"].includes(mode),
  "USE_RUN_LABEL_DRY_OR_CALIBRATION",
);
const root = path.resolve(".demo-data/issue84/runs", run, mode);
assert(!fs.existsSync(root), "FRESH_ROOT_REQUIRED");
const database = "secretary84_" + run + "_" + mode;
const admin = new Client({
  connectionString: "postgresql://secretary84@127.0.0.1:55484/postgres",
});
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  if (observe)
    await admin.query(
      `CREATE DATABASE "${database}_recovery" TEMPLATE template0`,
    );
} finally {
  await admin.end();
}
let processHandle!: ChildProcess;
let output = "";
let exit: number | null | undefined;
const spawnService = (resume: boolean) => {
  exit = undefined;
  processHandle = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "test_case/online/serve-issue84.ts",
      mode,
      ...(resume ? ["--resume"] : []),
    ],
    {
      env: { ...process.env, ISSUE84_RUN: run },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  processHandle.on("exit", (code) => {
    exit = code;
  });
  const capture = (chunk: Buffer) => {
    output += chunk.toString();
  };
  processHandle.stdout!.on("data", capture);
  processHandle.stderr!.on("data", capture);
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(
  check: () => boolean | Promise<boolean>,
  label: string,
  ms = 180_000,
) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    assert(
      exit === undefined,
      "SERVICE_EXIT_" + String(exit) + ": " + output.slice(-2000),
    );
    await pause(200);
  }
  throw Error("REHEARSAL_TIMEOUT_" + label);
}
const read = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const obs = () => read("observations.json");
const scenarios: Record<string, unknown> = {
  evidenceClass: "SCRIPTED_MODEL",
  native: false,
};
let client!: CoreClient;
async function connect() {
  await until(
    () => fs.existsSync(path.join(root, "core/core-endpoint.json")),
    "endpoint",
  );
  await until(async () => {
    try {
      client = new CoreClient(read("core/core-endpoint.json"));
      await client.core();
      return true;
    } catch {
      return false;
    }
  }, "core");
}
const command = (line: string) => processHandle.stdin!.write(line + "\n");
async function commandWhenReady(
  line: string,
  accepted: () => boolean,
  label: string,
) {
  // Snapshots may briefly precede a maintenance start. A refused local dry
  // command has no effect; retry only until its explicit acknowledgement.
  await until(
    () => {
      if (accepted()) return true;
      command(line);
      return false;
    },
    label,
    30_000,
  );
}
async function send(text: string, extra: object = {}) {
  const request = id();
  const receipt = await client.command("messages", {
    request_id: request,
    text,
    ...extra,
  });
  assert.equal(receipt.acceptance, "ACCEPTED");
  await until(
    () =>
      obs().inputs.some(
        (i: any) => i.dedupe_key === request && i.state === "HANDLED",
      ) || obs().session === "RECOVERY_BLOCKED",
    "input",
  );
  return request;
}
async function next(phase: string) {
  if (!observe) await client.command("session/compact", { request_id: id() });
  await until(
    () => (observe ? obs().quiescent : obs().idle),
    "quiescence-before-" + phase,
  );
  command("next " + phase);
  await until(() => read("usage.json").phase === phase, "phase-" + phase, 5000);
  console.log("PHASE " + phase);
}
async function completed(task: string) {
  await until(
    () =>
      obs().executions.some(
        (e: any) =>
          e.task_id === task && ["SUCCEEDED", "FAILED"].includes(e.state),
      ),
    "task",
  );
}
if (observe)
  await runRecoveryHarness(
    root + "-recovery",
    `postgresql://secretary84@127.0.0.1:55484/${database}_recovery`,
  );
spawnService(false);
try {
  await connect();
  if (mode === "calibration") {
    for (let i = 0; i < 12; i++) {
      await send(
        `Calibration ${i + 1}: ` +
          "synthetic conversation context ".repeat(190),
      );
      assert.equal(obs().session, "IDLE");
    }
    await until(() => obs().idle, "calibration-maintenance");
  } else {
    command("fault-429");
    await until(() => output.includes("FAULT_429_ARMED"), "429-armed", 5000);
    if (observe) {
      await send("dry probe with transient 429");
      assert.equal(obs().session, "IDLE");
      scenarios.transientRetry = true;
      await until(() => obs().quiescent, "before-forbidden-tool");
      await commandWhenReady(
        "fault-tool",
        () => output.includes("FAULT_TOOL_ARMED"),
        "forbidden-armed",
      );
      const oldOperations = obs().operations.length;
      const refused = await send("dry forbidden-tool probe");
      assert.equal(obs().session, "RECOVERY_BLOCKED");
      assert.equal(obs().operations.length, oldOperations);
      assert(
        read("usage.json").batches.some(
          (b: any) => !b.admitted && b.names.includes("bash"),
        ),
      );
      scenarios.forbiddenTool = true;
      // One explicit operator recovery after a reviewed synthetic fault; no repeat loop.
      await client.command("session/resume", { request_id: id() });
      await until(
        () =>
          obs().inputs.some(
            (i: any) => i.dedupe_key === refused && i.state === "HANDLED",
          ),
        "policy-recovery",
      );
      scenarios.resumedSameInput = true;
    } else {
      let blockedRequest = "";
      for (let n = 0; n < 12; n++) {
        blockedRequest = await send("dry probe " + n);
        if (obs().session === "RECOVERY_BLOCKED") break;
      }
      assert.equal(obs().session, "RECOVERY_BLOCKED");
      scenarios.recoveryBlocked = true;
      command("release-reserve");
      await until(() => read("usage.json").release === "main", "reserve", 5000);
      await client.command("session/resume", { request_id: id() });
      await until(
        () =>
          obs().inputs.some(
            (i: any) =>
              i.dedupe_key === blockedRequest && i.state === "HANDLED",
          ),
        "resume-input",
      );
      assert.equal(
        obs().inputs.filter((i: any) => i.dedupe_key === blockedRequest).length,
        1,
      );
      scenarios.resumedSameInput = true;
    }
    await next("vision");
    const file = path.join(root, "vision.png"),
      bytes = fs.readFileSync(file),
      request = id();
    await client.command("attachments/import", {
      request_id: request,
      source_path: file,
      expected_sha256: hash(bytes),
      expected_bytes: String(bytes.length),
      name: "vision.png",
    });
    let imported: any;
    await until(async () => {
      imported = await client.query("requests/" + request);
      return imported.receipt.state === "COMPLETED";
    }, "image-import");
    await send("dry image", {
      attachment_ids: [imported.result.attachment_id],
    });
    assert(obs().requests.some((r: any) => r.images.length > 0));
    scenarios.image = true;
    if (!observe) {
      // First normal request plus summary/extraction uses three vision calls.
      await client.command("session/compact", { request_id: id() });
      await until(() => obs().idle, "vision-first-compact");
      await send("dry vision followup");
      const armedBefore = output.split("FAULT_429_ARMED").length;
      command("fault-429 2");
      await until(
        () => output.split("FAULT_429_ARMED").length > armedBefore,
        "maintenance-fault-armed",
        5000,
      );
      // Two HTTP errors exhaust the remaining two calls; the next maintenance
      // attempt is denied by the real admission gate and becomes FAILED.
      await client.command("session/compact", { request_id: id() });
      await until(
        () =>
          obs().compactionJobs.some(
            (j: any) => j.state === "FAILED" && !j.next_attempt_at,
          ),
        "maintenance-budget-refusal",
      );
      assert.equal(obs().session, "IDLE");
      command("release-reserve");
      await until(
        () => read("usage.json").release === "vision",
        "maintenance-reserve",
        5000,
      );
      command("retry-maintenance");
      await until(() => obs().idle, "maintenance-recovered");
      scenarios.maintenanceRecovery = true;
    }
    await next("shared");
    const before = new Set(obs().executions.map((e: any) => e.id));
    await send("84 shared");
    await until(
      () =>
        obs().executions.filter(
          (e: any) => !before.has(e.id) && e.state === "RUNNING",
        ).length === 2,
      "two-running",
    );
    await send("dry concurrent main");
    await until(
      () =>
        obs().executions.filter(
          (e: any) => !before.has(e.id) && e.state === "SUCCEEDED",
        ).length === 2,
      "shared-complete",
    );
    const shared = obs().executions.filter((e: any) => !before.has(e.id));
    assert.notEqual(
      shared[0].workspace_binding.root_path,
      shared[1].workspace_binding.root_path,
    );
    assert.notEqual(
      fs.readFileSync(
        path.join(shared[0].workspace_binding.root_path, "report.txt"),
        "utf8",
      ),
      fs.readFileSync(
        path.join(shared[1].workspace_binding.root_path, "report.txt"),
        "utf8",
      ),
    );
    scenarios.shared = true;
    scenarios.textMaterials = true;
    await next("matters");
    await commandWhenReady(
      "approval-scope",
      () => fs.existsSync(path.join(root, "approval-scope.json")),
      "scope",
    );
    await send("84 question");
    await until(
      () => obs().decisions.some((d: any) => d.state === "OPEN"),
      "decision",
    );
    const decision = obs().decisions.find((d: any) => d.state === "OPEN");
    await client.command(`decisions/${decision.id}/answer`, {
      request_id: id(),
      answer: "/M synthetic answer",
    });
    await completed(decision.task_id);
    const answered = obs().decisions.find((d: any) => d.id === decision.id);
    assert.equal(answered.answered_by, "MASTER");
    assert.deepEqual(answered.answer, { value: "/M synthetic answer" });
    assert(
      obs().executions.some(
        (e: any) => e.task_id === decision.task_id && e.state === "SUCCEEDED",
      ),
    );
    scenarios.decision = true;
    await send("84 approval");
    await until(
      () => obs().authorizations.some((a: any) => a.state === "PENDING"),
      "authorization",
    );
    const a = obs().authorizations.find((a: any) => a.state === "PENDING");
    const display: any = await client.query("authorizations/" + a.id);
    await client.command(`authorizations/${a.id}/decision`, {
      request_id: id(),
      expected_revision: display.revision,
      display_hash: display.display_hash,
      decision: "APPROVE",
    });
    await until(
      () =>
        obs().authorizations.find((x: any) => x.id === a.id).state ===
        "CONSUMED",
      "consumed",
    );
    scenarios.authorization = true;
    await until(() => obs().idle, "before-crash");
    await commandWhenReady(
      "fault-hold",
      () => output.includes("FAULT_HOLD_ARMED"),
      "hold-armed",
    );
    const crashRequest = id();
    await client.command("messages", {
      request_id: crashRequest,
      text: "dry crash recovery probe",
    });
    await until(
      () => read("usage.json").attempts.some((a: any) => a.ended === undefined),
      "inflight-before-kill",
      5000,
    );
    processHandle.kill("SIGKILL");
    while (exit === undefined) await pause(100);
    spawnService(true);
    await connect();
    await until(
      () => obs().session === "IDLE" || obs().session === "RECOVERY_BLOCKED",
      "crash-reopen",
    );
    if (obs().session === "RECOVERY_BLOCKED")
      await client.command("session/resume", { request_id: id() });
    await until(
      () =>
        obs().inputs.some(
          (i: any) => i.dedupe_key === crashRequest && i.state === "HANDLED",
        ),
      "crash-input-recovered",
    );
    assert(
      read("usage.json").attempts.some(
        (a: any) =>
          a.termination === "unknown_after_restart" && a.ms === 120_000,
      ),
    );
    scenarios.crashRecovery = true;
    await next("redo");
    const oldIds = new Set(obs().executions.map((e: any) => e.id));
    await send("84 failure");
    await until(
      () =>
        obs().executions.some(
          (e: any) => !oldIds.has(e.id) && e.state === "FAILED",
        ),
      "failure",
    );
    const failed = obs().executions.find((e: any) => !oldIds.has(e.id));
    fs.writeFileSync(
      path.join(failed.workspace_binding.root_path, "source.txt"),
      redoSource,
      { flag: "wx", mode: 0o600 },
    );
    await send("", {
      failure_action: {
        failure_key: "EXECUTION:" + failed.id,
        expected_revision: (
          (await client.query("failures/EXECUTION:" + failed.id)) as {
            revision: string;
          }
        ).revision,
        action: "REDO",
      },
    });
    await until(
      () =>
        obs().executions.some(
          (e: any) =>
            e.continuation_of === failed.id && e.state === "SUCCEEDED",
        ),
      "redo",
    );
    const success = obs().executions.find(
      (e: any) => e.continuation_of === failed.id,
    );
    const result = obs().results.find(
      (r: any) => r.execution_id === success.id,
    );
    assert.equal(result.artifacts[0].content.sha256, hash(redoSource));
    assert(
      obs().operations.some(
        (o: any) =>
          o.id === result.artifacts[0].producing_operation_id &&
          o.scope.execution_id === success.id &&
          o.state === "SUCCEEDED",
      ),
    );
    scenarios.redo = true;
    await until(() => obs().idle, "final-maintenance");
    await client.command("core/stop", { request_id: id() });
    while (exit === undefined) await pause(100);
    const beforeRestart = read("manifest.json");
    spawnService(true);
    await connect();
    assert.equal(read("manifest.json").fingerprint, beforeRestart.fingerprint);
    scenarios.restarted = true;
    await until(() => obs().idle, "restarted-idle");
  }
  if (mode === "dry" && observe) {
    const report = usageReport(root);
    assert.deepEqual(report.reconciliation.mismatches, []);
    scenarios.reconciliation = true;
    scenarios.usageReport = true;
  }
  scenarios.status = "PASS";
  console.log("PASS " + mode);
} catch (error) {
  scenarios.status = "FAIL";
  scenarios.error = String(error);
  throw error;
} finally {
  if (client! && exit === undefined)
    await client.command("core/stop", { request_id: id() }).catch(() => {});
  await pause(500);
  if (exit === undefined) processHandle!.kill("SIGTERM");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(root, "driver.log"), output, { mode: 0o600 });
  fs.writeFileSync(
    path.join(root, "scenarios.json"),
    JSON.stringify(scenarios, null, 2) + "\n",
    { mode: 0o600 },
  );
}
