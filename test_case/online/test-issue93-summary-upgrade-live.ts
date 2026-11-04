/** Copy-only upgrade acceptance: original v2 journal/objects are never opened for writing. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import { fixtureStream, roleModel } from "../../src/pi_secretary/src/model.ts";
import { hash } from "../../src/pi_secretary/src/store.ts";
import { modelLifetime } from "../../src/pi_secretary/src/model-retry.ts";
import type {
  CompactionJob,
  Consciousness,
} from "../../src/pi_secretary/src/contracts.ts";
import type { SettingsSource } from "../../src/pi_secretary/src/settings-memory.ts";
import { acceptanceStream, type LiveUsage } from "./acceptance-stream.ts";
import { configureLiveOutputBudget } from "./issue91-budget.ts";

const sourceRoot = path.resolve(process.argv[2]);
const root = path.resolve(process.argv[3]);
const offline = process.argv[4] === "--offline";
for (const value of [sourceRoot, root])
  assert(value.startsWith(path.resolve(".demo-data/issue93") + path.sep));
assert(sourceRoot !== root && !fs.existsSync(root));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const core = path.join(root, "core");
fs.mkdirSync(core);
const originalJournal = fs.readFileSync(path.join(sourceRoot, "journal.jsonl"));
fs.writeFileSync(path.join(core, "journal.jsonl"), originalJournal);
fs.cpSync(path.join(sourceRoot, "objects"), path.join(core, "objects"), {
  recursive: true,
});
process.env.SECRETARY_MODE = "live";
process.env.SECRETARY_MAX_OUTPUT_TOKENS = "8192";
configureLiveOutputBudget(8192);
const usage: LiveUsage = { main: 0, task: 0, tools: 0, calls: [] };
const limits = {
  main: 32,
  task: 0,
  tools: 25,
  cutoff: Date.now() + 40 * 60000,
};
const report: any = {
  evidence: offline
    ? "OFFLINE_FIXTURE_SUPPORTED_UPGRADE_ON_REAL_DOMAIN_COPY"
    : "REAL_PROVIDER_SUPPORTED_UPGRADE_ON_REAL_DOMAIN_COPY",
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceRoot,
  original_journal_sha256: hash(originalJournal),
  started_at: new Date().toISOString(),
  limits,
  usage,
  steps: [],
};
const save = () =>
  fs.writeFileSync(
    path.join(root, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
save();
const model = getModel("opencode-go", "deepseek-v4.1-flash");
const keys = offline
  ? null
  : JSON.parse(fs.readFileSync(".demo-data/live-credentials.json", "utf8"));
const stream = offline
  ? fixtureStream
  : acceptanceStream(
      roleModel(model, keys.main, "main").stream,
      "main",
      usage,
      limits,
      save,
    );
const app = await App.open(core, {
  main: { model, stream },
  task: {
    model,
    stream: () => {
      throw Error("LIVE_BUDGET_NO_TASK_SENDS");
    },
  },
});
const timer = setTimeout(
  () => modelLifetime(app.store).abort(Error("CORE_STOPPING")),
  limits.cutoff - Date.now() + 120000,
);
try {
  const old = structuredClone(
    app.store
      .all<CompactionJob>("CompactionJob")
      .filter((j) => j.state === "FAILED" && j.mode === "WORKING_MEMORY")
      .at(-1)!,
  );
  assert(old);
  const oldProgress = app.store.bytes(old.progress_ref!);
  assert.equal(
    app.store.read<any>(old.progress_ref!).plan.version,
    "bounded-summary-v2",
  );
  const before = app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
  assert(app.settings.blocked, "new runtime must queue supported rebuild");
  const applicationID = app.settings.applications().at(-1)!.id;
  await app.settings.tick();
  const application = app.settings
    .applications()
    .find((a) => a.id === applicationID)!;
  report.steps.push({
    case: "runtime_settings_rebuild",
    application_id: application.id,
    state: application.state,
    error: application.error,
  });
  save();
  assert.equal(application.state, "APPLIED", application.error ?? "");
  assert.equal(app.settings.blocked, false);
  const source = app.store.read<SettingsSource>(application.source_ref!);
  assert.equal(source.plan.version, "bounded-summary-v3");
  const fragments = source.plan.chunks.flatMap((c) => JSON.parse(c));
  assert(source.plan.chunks.length <= 64);
  assert(
    old.source_event_ids.every((eventID) =>
      fragments.some((f) => f.source_id === eventID),
    ),
  );
  const rebuilt = app.store.get<Consciousness>("Consciousness", before.id);
  assert(rebuilt.covered_event_sequence! >= old.source_end_sequence!);
  assert.equal(rebuilt.last_job_id, null);
  assert.deepEqual(rebuilt.pending_raw_refs, []);
  for (const commitment of before.commitments ?? [])
    assert(
      rebuilt.commitments?.some(
        (c) => c.id === commitment.id && c.text === commitment.text,
      ),
    );
  assert.deepEqual(app.store.get<CompactionJob>("CompactionJob", old.id), old);
  assert(app.store.bytes(old.progress_ref!).equals(oldProgress));
  report.steps.push({
    case: "superseded_v2_preserved",
    old_job_id: old.id,
    old_source_events: old.source_event_ids.length,
    new_chunks: source.plan.chunks.length,
    source_utf8_bytes: fragments.reduce(
      (n, f) => n + Buffer.byteLength(f.fragment),
      0,
    ),
    covered_event_sequence: rebuilt.covered_event_sequence,
    commitments_preserved: before.commitments?.length ?? 0,
  });
  save();
  app.host.accept(
    "这是隔离升级验证，请仅回答‘升级验证完成’，不使用工具、不执行任务。",
  );
  await app.host.drain();
  assert.equal(app.host.session.state, "IDLE");
  await app.host.compact();
  const next = app.store.all<CompactionJob>("CompactionJob").at(-1)!;
  assert.notEqual(next.id, old.id);
  assert.equal(next.state, "COMMITTED", next.validation_errors.join("; "));
  assert.equal(next.policy_id, "bounded-summary-v3");
  assert.deepEqual(app.store.get<CompactionJob>("CompactionJob", old.id), old);
  report.steps.push({
    case: "new_maintenance_after_upgrade",
    job_id: next.id,
    state: next.state,
    policy: next.policy_id,
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  modelLifetime(app.store).abort(Error("CORE_STOPPING"));
  await app.close();
  report.original_unchanged =
    hash(fs.readFileSync(path.join(sourceRoot, "journal.jsonl"))) ===
    hash(originalJournal);
  assert(report.original_unchanged);
  report.finished_at = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      root,
      status: report.status,
      error: report.error,
      usage: { main: usage.main, task: usage.task, tools: usage.tools },
      original_unchanged: report.original_unchanged,
    }),
  );
}
