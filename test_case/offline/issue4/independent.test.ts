import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { fixtureModel, fixtureStream, replyStream, type StreamFn } from "../../../src/pi_secretary/src/model.ts";
import { extractNewCommitments } from "../../../src/pi_secretary/src/memory-extraction.ts";
import { listExtractionRecoveryGroups, recoverExtractionOnce, type RecoveryRequest } from "../../../src/pi_secretary/src/memory-extraction-recovery.ts";
import { id, type Store } from "../../../src/pi_secretary/src/store.ts";
import type { ExtractionRecovery } from "../../../src/pi_secretary/src/contracts.ts";

const quote = "I will report the synthetic result tomorrow.";
async function fixture(body: (f: { app: () => App; reopen: () => Promise<void>; options: () => { store: Store; model: typeof fixtureModel; sessionID: string; consciousnessRevision: number }; fail: (stream?: StreamFn) => Promise<void> }) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-independent-"));
  let app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
  const sessionID = app.host.sessionID;
  const source = [{ id: id(), role: "assistant" as const, text: quote }];
  const options = () => ({ store: app.store, model: fixtureModel, sessionID, consciousnessRevision: 1 });
  try { await body({ app: () => app, options, reopen: async () => { await app.close(); app = await App.open(dir, { model: fixtureModel, stream: fixtureStream }); }, fail: async (stream = model => replyStream([{ type: "text", text: "invalid" }], model)) => {
    await assert.rejects(extractNewCommitments({ ...options(), stream, loopID: id(), source: null, completeMessages: source, existing: [] }));
  } }); } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const successful: StreamFn = model => replyStream([{ type: "text", text: JSON.stringify({ quotes: [quote] }) }], model);
const requestFor = (f: Parameters<Parameters<typeof fixture>[0]>[0]): RecoveryRequest => ({ request_id: id(), ...listExtractionRecoveryGroups(f.options())[0].binding! });

test("independent: same logical request survives JSON field order and restart without another send", async () => {
  await fixture(async f => {
    await f.fail(); const request = requestFor(f); let sends = 0;
    const stream: StreamFn = (...args) => { sends++; return successful(...args); };
    const first = await recoverExtractionOnce({ ...f.options(), request, stream });
    assert.equal(first.status, "SUCCEEDED"); await f.reopen();
    const reordered = Object.fromEntries(Object.entries(request).reverse()) as RecoveryRequest;
    assert.deepEqual(await recoverExtractionOnce({ ...f.options(), request: reordered, stream }), first);
    assert.equal(sends, 1);
  });
});

test("independent: same ID changed payload is rejected before effects", async () => {
  await fixture(async f => {
    await f.fail(); const request = requestFor(f);
    await recoverExtractionOnce({ ...f.options(), request, stream: successful });
    const before = f.app().store.sequence;
    for (const patch of [{ source_hash: "f".repeat(64) }, { expected_revision: 2 }, { policy: "different" }, { implementation_version: "different" }])
      await assert.rejects(recoverExtractionOnce({ ...f.options(), request: { ...request, ...patch }, stream: () => { throw Error("unexpected send"); } }), /REQUEST_CONFLICT/);
    assert.equal(f.app().store.sequence, before);
  });
});

test("independent: stale revision, config, session and source cannot authorize", async () => {
  await fixture(async f => {
    await f.fail(); const request = requestFor(f); const before = f.app().store.sequence;
    for (const patch of [{ consciousnessRevision: 2 }, { runtimeConfigHash: "changed" }, { sessionID: id() }])
      await assert.rejects(recoverExtractionOnce({ ...f.options(), ...patch, request, stream: () => { throw Error("unexpected send"); } }), /BLOCKED|BINDING_MISMATCH/);
    await assert.rejects(recoverExtractionOnce({ ...f.options(), request: { ...request, group_key: "f".repeat(64) }, stream: successful }), /BINDING_MISMATCH/);
    assert.equal(f.app().store.sequence, before);
  });
});

test("independent: ambiguous transport failure stays blocked after restart", async () => {
  await fixture(async f => {
    let sends = 0;
    await f.fail(() => { sends++; throw Error("synthetic connection lost after possible dispatch"); });
    for (let n = 0; n < 2; n++) {
      const group = listExtractionRecoveryGroups(f.options())[0];
      assert.equal(group.status, "BLOCKED"); assert.match(group.reason, /UNKNOWN/);
      await assert.rejects(recoverExtractionOnce({ ...f.options(), request: { request_id: id(), ...group.binding! }, stream: successful }), /BLOCKED/);
      await f.reopen();
    }
    assert.equal(sends, 1);
  });
});

test("independent: complete response survives interrupted success journal and reconciles without send", async () => {
  await fixture(async f => {
    const store = f.app().store, original = store.commit.bind(store);
    store.commit = (...args) => {
      if (args[1]?.some(e => e.event_type === "memory.extraction.succeeded" || e.event_type === "memory.extraction.failed")) throw Error("synthetic process boundary before extraction terminal log");
      return original(...args);
    };
    try { await f.fail(successful); } finally { store.commit = original; }
    await f.reopen(); const group = listExtractionRecoveryGroups(f.options())[0];
    assert.equal(group.status, "RECONCILE");
    const beforeLogs = f.app().store.logs.map(e => JSON.stringify(e));
    const result = await recoverExtractionOnce({ ...f.options(), request: requestFor(f), stream: () => { throw Error("reconcile must never send"); } });
    assert.equal(result.status, "SUCCEEDED"); assert.deepEqual(result.quotes, [quote]);
    assert.deepEqual(f.app().store.logs.slice(0, beforeLogs.length).map(e => JSON.stringify(e)), beforeLogs);
  });
});

for (const boundary of ["authorization", "linked", "in_flight"] as const) test(`independent: interruption after ${boundary} consumes authorization and restart never sends`, async () => {
  await fixture(async f => {
    await f.fail(); const request = requestFor(f); const store = f.app().store, original = store.commit.bind(store);
    let cut = false, sends = 0;
    store.commit = (...args) => {
      if (cut) throw Error("synthetic process is gone");
      const result = original(...args);
      const reached = boundary === "authorization" ? args[1]?.some(e => e.event_type === "memory.extraction.recovery_authorized")
        : boundary === "linked" ? args[1]?.some(e => e.event_type === "memory.extraction.call_linked")
        : args[0].some(r => r.record_type === "ModelCall" && r.state === "IN_FLIGHT");
      if (reached) { cut = true; throw Error("synthetic process boundary"); }
      return result;
    };
    const stream: StreamFn = (...args) => { sends++; return successful(...args); };
    try { await assert.rejects(recoverExtractionOnce({ ...f.options(), request, stream })); } finally { store.commit = original; }
    assert.equal(sends, 0); await f.reopen();
    const result = await recoverExtractionOnce({ ...f.options(), request, stream });
    assert.notEqual(result.status, "SUCCEEDED"); assert.equal(sends, 0);
    const group = listExtractionRecoveryGroups(f.options())[0];
    const replay = recoverExtractionOnce({ ...f.options(), request: { request_id: id(), ...group.binding! }, stream });
    if (boundary === "linked") assert.equal((await replay).status, "BLOCKED");
    else await assert.rejects(replay, /BLOCKED|SOURCE_CLAIMED/);
    assert.equal(sends, 0); assert.equal(f.app().store.all<ExtractionRecovery>("ExtractionRecovery").length, 1);
  });
});

test("independent: concurrent different authorization IDs for same source dispatch at most once", async () => {
  await fixture(async f => {
    await f.fail(); const a = requestFor(f), b = { ...a, request_id: id() }; let sends = 0;
    const stream: StreamFn = (...args) => { sends++; return successful(...args); };
    const results = await Promise.allSettled([recoverExtractionOnce({ ...f.options(), request: a, stream }), recoverExtractionOnce({ ...f.options(), request: b, stream })]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1); assert.equal(sends, 1);
    assert.equal(f.app().store.all<ExtractionRecovery>("ExtractionRecovery").length, 1);
  });
});

for (const interruptAfterDatabase of [false, true]) test(`independent PostgreSQL: settings extraction recovery preserves one World receipt${interruptAfterDatabase ? " across database/local crash boundary" : " on replay"}`, { skip: !process.env.SECRETARY_TEST_DATABASE_URL }, async () => {
  // This opt-in test is run only by validation/postgres-issue4.py in a fresh Unix-socket cluster.
  assert.equal(process.env.ISSUE4_ISOLATED_POSTGRES, "1");
  const dsn = new URL(process.env.SECRETARY_TEST_DATABASE_URL!);
  assert.match(dsn.searchParams.get("host") ?? "", /^\/tmp\/sec-issue4-sock-/);
  const { contentText } = await import("@earendil-works/pi-ai");
  const { emptySettings } = await import("../../../src/pi_secretary/src/settings-payload.ts");
  const { getInstructions } = await import("../../../src/pi_secretary/src/instructions.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-world-"));
  let fail = true, extractionCalls = 0, summaries = 0;
  const stream: StreamFn = (model, context, options) => {
    const system = contentText(context.messages[0].content);
    if (system.includes("COMMITMENT_EXTRACTION:")) {
      extractionCalls++;
      return replyStream([{ type: "text", text: fail ? "invalid" : JSON.stringify({ quotes: [quote] }) }], model);
    }
    if (system.includes("CONSCIOUSNESS:")) summaries++;
    return system.includes("CONSCIOUSNESS:") ? fixtureStream(model, context, options) : replyStream([{ type: "text", text: quote }], model);
  };
  let app = await App.open(dir, { model: fixtureModel, stream }, process.env.SECRETARY_TEST_DATABASE_URL);
  try {
    await app.world!.migrate();
    app.host.accept("Please report the synthetic result tomorrow."); await app.host.drain();
    const entity = id();
    app.settings.save({ ...emptySettings(), instructions: { content: "Synthetic recovery instructions", expected_revision: getInstructions(app.store).revision }, edits: [
      { kind: "ENTITY", entity_id: entity, entity_kind: "PERSON", display_name: "Synthetic Issue4 Person", expected_revision: 0 },
      { kind: "FACT", mode: "ASSERT", subject_id: entity, predicate_key: "person.display_name", scope_key: "", expected_revision: 0, value: "Synthetic Issue4 Name" },
    ] }, app.settings.draft().revision);
    const application = app.settings.request(app.settings.draft().revision, id()) as import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication;
    await app.settings.tick();
    assert.equal(app.store.get<import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication>("SettingsApplication", application.id).state, "FAILED");
    assert.equal(await app.world!.batchReceipt(application.id), null);
    const group = app.host.memoryRecoveryPreflight()[0]; assert.equal(group.status, "READY");
    const request = { request_id: id(), ...group.binding! }; const summaryCount = summaries;
    let applyCalls = 0;
    const originalApply = app.world!.applyBatch.bind(app.world!);
    app.world!.applyBatch = (...args) => { applyCalls++; return originalApply(...args); };
    if (interruptAfterDatabase) app.world!.export = async () => { throw Error("synthetic crash after committed World receipt"); };
    fail = false;
    const first = await app.host.recoverMemory(request);
    assert.equal(first.status, interruptAfterDatabase ? "BLOCKED" : "SUCCEEDED");
    assert.equal(applyCalls, 1); assert.equal(extractionCalls, 2); assert.equal(summaries, summaryCount);
    const receipt = await app.world!.batchReceipt(application.id); assert(receipt);
    const rows = (await app.world!.browse({ subject: entity, history: true })).rows; assert.equal(rows.length, 1);
    await app.close();
    app = await App.open(dir, { model: fixtureModel, stream }, process.env.SECRETARY_TEST_DATABASE_URL);
    app.world!.applyBatch = async () => { throw Error("existing World receipt must prevent duplicate applyBatch"); };
    for (let n = 0; n < 2; n++) assert.equal((await app.host.recoverMemory(request)).status, "SUCCEEDED");
    assert.equal(extractionCalls, 2); assert.equal(summaries, summaryCount);
    assert.deepEqual(await app.world!.batchReceipt(application.id), receipt);
    assert.deepEqual((await app.world!.browse({ subject: entity, history: true })).rows, rows);
    assert.equal(app.store.get<import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication>("SettingsApplication", application.id).state, "APPLIED");
    assert.equal(getInstructions(app.store).revision, 2);
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const stopReason of ["error", "aborted", "length", "toolUse"] as const) test(`independent: saved ${stopReason} response has an explicit restart classification`, async () => {
  await fixture(async f => {
    await f.fail(async model => {
      const stream = replyStream([{ type: "text", text: "incomplete" }], model);
      const message = await stream.result(); message.stopReason = stopReason;
      if (stopReason === "error" || stopReason === "aborted") message.errorMessage = "synthetic provider termination";
      return stream;
    });
    await f.reopen();
    const group = listExtractionRecoveryGroups(f.options())[0];
    assert.equal(group.status, stopReason === "error" || stopReason === "aborted" ? "BLOCKED" : "READY");
    if (group.status === "BLOCKED") assert.match(group.reason, /UNKNOWN/);
    else assert.equal(group.reason, "TERMINAL_RESPONSE_INVALID");
  });
});

test("independent: exact original PREPARED call permits one new authorization but unknown unlinked start does not", async () => {
  await fixture(async f => {
    const store = f.app().store, original = store.commit.bind(store);
    store.commit = (...args) => {
      const value = original(...args);
      if (args[1]?.some(e => e.event_type === "memory.extraction.call_linked")) throw Error("synthetic stopped before IN_FLIGHT");
      return value;
    };
    try { await f.fail(() => { throw Error("must never dispatch original PREPARED call"); }); } finally { store.commit = original; }
    await f.reopen();
    assert.equal(listExtractionRecoveryGroups(f.options())[0].status, "READY");
    let sends = 0;
    const result = await recoverExtractionOnce({ ...f.options(), request: requestFor(f), stream: (...args) => { sends++; return successful(...args); } });
    assert.equal(result.status, "SUCCEEDED"); assert.equal(sends, 1);
  });
  await fixture(async f => {
    const store = f.app().store, original = store.commit.bind(store); let gone = false;
    store.commit = (...args) => {
      if (gone) throw Error("synthetic process gone");
      const value = original(...args);
      if (args[1]?.some(e => e.event_type === "memory.extraction.started")) { gone = true; throw Error("synthetic unlinked start"); }
      return value;
    };
    try { await f.fail(); } finally { store.commit = original; }
    await f.reopen();
    const group = listExtractionRecoveryGroups(f.options())[0]; assert.equal(group.status, "BLOCKED"); assert.equal(group.reason, "UNKNOWN_BEFORE_MODEL_LINK");
  });
});

test("independent: failed compaction owner boundary cannot be replaced by a later self-consistent snapshot", async () => {
  const { contentText } = await import("@earendil-works/pi-ai");
  const { revise } = await import("../../../src/pi_secretary/src/store.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-owner-binding-"));
  let sends = 0;
  const stream: StreamFn = (model, context, options) => {
    const system = contentText(context.messages[0].content);
    if (system.includes("COMMITMENT_EXTRACTION:")) { sends++; return replyStream([{ type: "text", text: "invalid" }], model); }
    return system.includes("CONSCIOUSNESS:") ? fixtureStream(model, context, options) : replyStream([{ type: "text", text: quote }], model);
  };
  const app = await App.open(dir, { model: fixtureModel, stream });
  try {
    app.host.accept("Please report tomorrow."); await app.host.drain(); await app.host.compact();
    const originalGroup = app.host.memoryRecoveryPreflight()[0]; assert.equal(originalGroup.status, "READY");
    const job = app.store.all<import("../../../src/pi_secretary/src/contracts.ts").CompactionJob>("CompactionJob").at(-1)!;
    assert.equal(job.state, "FAILED");
    const boundary = app.store.event("synthetic.owner.boundary", {}, { session_id: app.host.sessionID, task_id: null, execution_id: null });
    app.store.commit([], [boundary]);
    const progress = app.store.read<{ plan: { extra: Record<string, unknown> }; candidate: unknown }>(job.progress_ref!);
    progress.plan.extra.source_end_sequence = boundary.sequence;
    app.store.commit([revise(job, { source_end_sequence: boundary.sequence, progress_ref: app.store.put(progress) })]);
    const before = sends;
    assert.equal(app.host.memoryRecoveryPreflight()[0].status, "BLOCKED", "current owner consistency cannot replace the attempt's original source boundary");
    await assert.rejects(app.host.recoverMemory({ request_id: id(), ...originalGroup.binding! }));
    assert.equal(sends, before);
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("independent: Store rejects terminal recovery rewrites and identity drift", async () => {
  const { revise } = await import("../../../src/pi_secretary/src/store.ts");
  await fixture(async f => {
    await f.fail(); const result = await recoverExtractionOnce({ ...f.options(), request: requestFor(f), stream: successful });
    const store = f.app().store, saved = store.get<ExtractionRecovery>("ExtractionRecovery", result.recovery_id), before = store.sequence;
    for (const patch of [{ state: "CLAIMED" as const }, { quotes: ["changed quote"] }, { error: "changed error" }])
      assert.throws(() => store.commit([revise(saved, patch)]), /TERMINAL_IMMUTABLE/);
    for (const patch of [{ request_id: id() }, { attempt_id: id() }, { parent_attempt_id: id() }, { group_key: "f".repeat(64) }, { generation: saved.generation + 1 }, { owner_epoch: saved.owner_epoch + 1 }])
      assert.throws(() => store.commit([revise(saved, patch)]), /IDENTITY_CHANGED/);
    assert.equal(store.sequence, before); assert.deepEqual(store.get<ExtractionRecovery>("ExtractionRecovery", result.recovery_id), saved);
  });
});

test("independent: Store prevents second source claimant and nonmonotonic generation", async () => {
  const { base, revise } = await import("../../../src/pi_secretary/src/store.ts");
  await fixture(async f => {
    await f.fail(); const store = f.app().store, original = store.commit.bind(store);
    store.commit = (...args) => { const value = original(...args); if (args[1]?.some(e => e.event_type === "memory.extraction.recovery_authorized")) throw Error("synthetic stopped after claim"); return value; };
    try { await assert.rejects(recoverExtractionOnce({ ...f.options(), request: requestFor(f), stream: successful })); } finally { store.commit = original; }
    const saved = store.all<ExtractionRecovery>("ExtractionRecovery")[0], before = store.sequence;
    assert.equal(saved.state, "CLAIMED");
    assert.throws(() => store.commit([{ ...saved, ...base(), request_id: id(), attempt_id: id(), generation: saved.generation + 1 }]), /SOURCE_CLAIMED/);
    assert.throws(() => store.commit([{ ...saved, ...base(), request_id: id(), attempt_id: id(), state: "FAILED", generation: saved.generation }]), /GENERATION_CONFLICT/);
    assert.throws(() => store.commit([{ ...saved, ...base(), request_id: id(), attempt_id: id(), state: "FAILED", generation: saved.generation + 2 }]), /GENERATION_CONFLICT/);
    assert.equal(store.sequence, before);
    store.commit([revise(saved, { call_id: id() })]);
    assert.throws(() => store.commit([revise(store.get<ExtractionRecovery>("ExtractionRecovery", saved.id), { call_id: id() })]), /CALL_CHANGED/);
  });
});

for (const owner of ["compaction", "settings"] as const) test(`independent: ${owner} failed explicit retry remains stopped through ordinary retry and restart`, async () => {
  const { contentText } = await import("@earendil-works/pi-ai");
  const { emptySettings } = await import("../../../src/pi_secretary/src/settings-payload.ts");
  const { getInstructions } = await import("../../../src/pi_secretary/src/instructions.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue4-stop-again-"));
  let sends = 0;
  const stream: StreamFn = (model, context, options) => {
    const system = contentText(context.messages[0].content);
    if (system.includes("COMMITMENT_EXTRACTION:")) { sends++; return replyStream([{ type: "text", text: "invalid again" }], model); }
    return system.includes("CONSCIOUSNESS:") ? fixtureStream(model, context, options) : replyStream([{ type: "text", text: quote }], model);
  };
  let app = await App.open(dir, { model: fixtureModel, stream });
  let applicationID = "";
  try {
    app.host.accept("Please report tomorrow."); await app.host.drain();
    if (owner === "compaction") await app.host.compact();
    else {
      app.settings.save({ ...emptySettings(), instructions: { content: "Synthetic instructions", expected_revision: getInstructions(app.store).revision } }, app.settings.draft().revision);
      applicationID = (app.settings.request(app.settings.draft().revision, id()) as import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication).id;
      await app.settings.tick();
    }
    assert.equal(sends, 1);
    const group = app.host.memoryRecoveryPreflight()[0]; assert.equal(group.status, "READY");
    const request = { request_id: id(), ...group.binding! };
    assert.equal((await app.host.recoverMemory(request)).status, "FAILED"); assert.equal(sends, 2);
    assert.equal((await app.host.recoverMemory(request)).status, "FAILED"); assert.equal(sends, 2);
    const ordinary = async () => {
      if (owner === "compaction") await app.host.compact();
      else { const blocked = app.settings.retry(applicationID); assert.equal(blocked.state, "FAILED"); assert.match(blocked.error ?? "", /MEMORY_EXTRACTION_RECOVERY_REQUIRED/); await app.settings.tick(); }
      assert.equal(sends, 2);
    };
    await ordinary(); await app.close(); app = await App.open(dir, { model: fixtureModel, stream });
    assert.equal(sends, 2); await ordinary();
    const next = app.host.memoryRecoveryPreflight().find(g => g.group_key === group.group_key)!; assert.equal(next.status, "READY");
    assert.equal((await app.host.recoverMemory({ request_id: id(), ...next.binding! })).status, "FAILED"); assert.equal(sends, 3);
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
