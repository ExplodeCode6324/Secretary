// Bounded paid-provider verification: fresh synthetic store, no database or deployment.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { App } from "../../src/pi_secretary/src/app.ts";
import {
  Agent,
  roleModel,
  type StreamFn,
} from "../../src/pi_secretary/src/model.ts";
import { durableStream } from "../../src/pi_secretary/src/transport.ts";
import { id, revise } from "../../src/pi_secretary/src/store.ts";
import { saveContext } from "../../src/pi_secretary/src/context.ts";
import {
  requestBudget,
  budgetConfig,
  effectiveTools,
} from "../../src/pi_secretary/src/budget.ts";
import type {
  Consciousness,
  Context,
  ModelCall,
} from "../../src/pi_secretary/src/contracts.ts";
const output = process.argv[2];
if (!output) throw Error("Report path required");
if (fs.existsSync(output)) throw Error("Refusing to overwrite live evidence");
const directory = path.resolve(".demo-data/issue2-live-" + Date.now());
const keys = JSON.parse(
  fs.readFileSync(".demo-data/live-credentials.json", "utf8"),
);
const main = roleModel(
  getModel("opencode-go", "deepseek-v4.1-flash"),
  keys.main,
  "main",
);
const task = roleModel(
  getModel("opencode-go", "gpt-5.6-luna"),
  keys.task,
  "task",
);
function sourceManifest() {
  const files = fs
    .readdirSync("src/pi_secretary/src")
    .filter((f) => /\.(ts|js)$/.test(f))
    .map((f) => "src/pi_secretary/src/" + f);
  files.push("test_case/online/test-issue2-live.ts");
  return Object.fromEntries(
    files
      .sort()
      .map((file) => [
        file,
        createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      ]),
  );
}
const sourceBefore = sourceManifest();
const priorCap = process.env.SECRETARY_MAIN_CONTEXT_WINDOW;
const observedRequests: any[] = [];
const calls = { main: 0, task: 0 };
function bounded(role: "main" | "task", stream: StreamFn): StreamFn {
  return (m, c, o) => {
    if (++calls[role] > (role === "main" ? 8 : 1))
      throw Error("SYNTHETIC_LIVE_CALL_LIMIT");
    observedRequests.push({
      role,
      model: m.id,
      maxTokens: o?.maxTokens ?? null,
      message_count: c.messages.length,
      serialized_message_bytes: Buffer.byteLength(JSON.stringify(c.messages)),
      messages_sha256: createHash("sha256")
        .update(JSON.stringify(c.messages))
        .digest("hex"),
      contains_seed_padding: JSON.stringify(c.messages).includes(
        "ISSUE2_SYNTHETIC_PADDING",
      ),
      messages: structuredClone(c.messages),
      tool_names: effectiveTools(c.messages).map((tool) => tool.name),
    });
    return stream(m, c, o);
  };
}
const app = await App.open(directory, {
  main: { ...main, stream: bounded("main", main.stream) },
  task: { ...task, stream: bounded("task", task.stream) },
});
const report: any = {
  started_at: new Date().toISOString(),
  pass: false,
  scope:
    "Fresh synthetic store; no world database; main memory + task transport probe; not deployed",
  models: { main: main.model.id, task: task.model.id },
  directory,
  source_manifest_before: sourceBefore,
  budget_config_initial: budgetConfig(),
  cases: [],
};
async function turn(text: string) {
  app.host.accept(text);
  await app.host.drain();
  assert.equal(
    app.host.session.state,
    "IDLE",
    app.host.session.recovery_error ?? "",
  );
  const c = app.store.get<Context>(
    "Context",
    app.host.session.last_context_id!,
  );
  const assistant = app.store
    .read<any[]>(c.raw_context)
    .findLast((m) => m.role === "assistant");
  return contentText(assistant.content);
}
try {
  await turn(
    "This is a synthetic verification. Do not create tasks, change the World Model, send notifications, or perform external actions. Synthetic project AMBER: only if Master approves the synthetic review, provide the final report; otherwise keep it pending. Remember this conditional requirement. Reply with one short acknowledgement.",
  );
  await turn(
    "Synthetic detail: the review concerns the cobalt sample. There has been no approval yet. Reply in one sentence, without tools.",
  );
  const before = app.host
    .previewContext()
    .filter((m) => m.role === "assistant").length;
  await app.host.compact();
  assert.equal(
    app.host.memoryStatus().state,
    "COMMITTED",
    JSON.stringify(app.host.memoryStatus().errors),
  );
  assert.equal(
    app.host.previewContext().filter((m) => m.role === "assistant").length,
    before,
  );
  const cs = app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
  assert(cs.items.length);
  assert.equal(cs.context_compaction ?? null, null);
  report.cases.push({
    case: "live summary and independent extraction update memory without cropping",
    pass: true,
    items: cs.items,
    commitments: cs.commitments,
  });
  // Seed only an assistant checkpoint, explicitly synthetic and never a provider response.
  // The real memory source and original canonical snapshots above remain unchanged.
  // This isolates request cropping from paid generation of 96 KiB of irrelevant text.
  const priorContext = app.store.get<Context>(
    "Context",
    app.host.session.last_context_id!,
  );
  const priorCanonical = app.store.read<any[]>(priorContext.raw_context);
  const originalRef = priorContext.raw_context;
  const template = priorCanonical.findLast(
    (message) => message.role === "assistant",
  );
  assert(template);
  const paddingText =
    "ISSUE2_SYNTHETIC_PADDING: irrelevant historical fixture; no new commitments. " +
    "x".repeat(96000);
  const seededMessages = [
    ...priorCanonical,
    {
      ...template,
      content: [{ type: "text", text: paddingText }],
      timestamp: Date.now(),
      stopReason: "stop",
    },
  ];
  const seeded = saveContext(
    app.store,
    seededMessages,
    { session_id: app.host.sessionID, task_id: null, execution_id: null },
    "MAIN",
    main.model.id,
    id(),
    main.model.contextWindow,
  );
  app.store.commit([revise(app.host.session, { last_context_id: seeded.id })]);
  process.env.SECRETARY_MAIN_CONTEXT_WINDOW = "96000";
  const beforeCrop = requestBudget(main.model, app.host.previewContext());
  assert(
    beforeCrop.occupancy >= budgetConfig().normal,
    "Synthetic seed must trigger actual MAIN maintenance path",
  );
  report.synthetic_seed = {
    original_context_id: priorContext.id,
    original_ref: originalRef,
    seeded_context_id: seeded.id,
    seeded_ref: seeded.raw_context,
    padding_bytes: Buffer.byteLength(paddingText),
    kind: "Direct synthetic historical assistant checkpoint, not a generated response or completed memory event",
    process_local_context_limit: 96000,
    budget_before: beforeCrop,
  };
  const requestsBeforeRecall = observedRequests.length;
  const response = await turn(
    "Read only, no tools: return JSON with fields project, sample, approved (boolean), and report_condition. Use the synthetic conversation; do not invent approval.",
  );
  const parsed = JSON.parse(
    response.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
  );
  report.cases.push({
    case: "recall raw response before assertions",
    response: parsed,
  });
  assert(/amber/i.test(parsed.project));
  assert(/cobalt/i.test(parsed.sample));
  assert.equal(parsed.approved, false);
  assert(/approv|批准/i.test(parsed.report_condition));
  report.cases.push({
    case: "next main request retains conditional constraint and current facts",
    pass: true,
    response: parsed,
  });
  const finalCs = app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
  assert(
    finalCs.context_compaction,
    "Real MAIN prepareRequest did not persist context compaction",
  );
  const croppedEvents = app.store.logs
    .filter((log) => log.event_type === "context.compacted")
    .map((log) => app.store.read<any>(log.payload));
  assert(croppedEvents.length > 0);
  const crop = croppedEvents.at(-1)!;
  const recallRequests = observedRequests
    .slice(requestsBeforeRecall)
    .filter((request) => request.role === "main");
  assert.equal(
    recallRequests.length,
    1,
    "Recall should require exactly one real MAIN request",
  );
  assert.equal(recallRequests[0].contains_seed_padding, false);
  assert(crop.after.estimated_tokens < crop.before.estimated_tokens);
  assert.deepEqual(
    app.store.read(originalRef),
    priorCanonical,
    "Original canonical snapshot changed",
  );
  assert.deepEqual(
    app.store.read(seeded.raw_context),
    seededMessages,
    "Full synthetic canonical evidence changed",
  );
  report.cases.push({
    case: "real MAIN capacity path crops historical assistant, preserves complete source and conditional recall",
    pass: true,
    context_compaction: finalCs.context_compaction,
    compaction: crop,
    target_reached: crop.target_reached,
    canonical_original_unchanged: true,
    canonical_seed_unchanged: true,
    recall_request_bytes: recallRequests[0].serialized_message_bytes,
    seeded_canonical_bytes: Buffer.byteLength(JSON.stringify(seededMessages)),
    scope_limit:
      "Synthetic assistant history directly seeded after real memory summary; does not test summarization of a naturally generated long conversation.",
  });
  const probe = new Agent({
    initialState: {
      model: task.model,
      systemPrompt:
        "Synthetic transport verification. No tools. Return exactly TASK_BUDGET_OK.",
      tools: [],
    },
    streamFn: durableStream(
      app.store,
      bounded("task", task.stream),
      { session_id: app.host.sessionID, task_id: id(), execution_id: id() },
      id(),
      "TASK",
    ),
  });
  await probe.prompt("Return TASK_BUDGET_OK.");
  assert(!probe.state.errorMessage, probe.state.errorMessage);
  assert(
    contentText(
      (
        probe.state.messages.findLast(
          (m) => m.role === "assistant",
        ) as AssistantMessage
      ).content,
    ).includes("TASK_BUDGET_OK"),
  );
  report.cases.push({
    case: "real task provider honors guarded request path",
    pass: true,
  });
  assert.equal(app.store.all("Execution").length, 0);
  assert.equal(app.store.all("Operation").length, 0);
  assert.equal(app.store.all("Notification").length, 0);
  report.pass = true;
} catch (error) {
  report.error = String(error)
    .replaceAll(keys.main, "[REDACTED]")
    .replaceAll(keys.task, "[REDACTED]");
  process.exitCode = 1;
} finally {
  report.requests = app.store.all<ModelCall>("ModelCall").map((call) => {
    const c = app.store.get<Context>("Context", call.context_id);
    return {
      purpose: c.purpose,
      state: call.state,
      budget: c.request_budget,
      usage: call.response
        ? app.store.read<AssistantMessage>(call.response).usage
        : null,
    };
  });
  report.final_payloads = app.store.logs
    .filter((l) => l.event_type === "model.payload")
    .map((l) => app.store.read(l.payload));
  report.calls = calls;
  report.observed_provider_requests = observedRequests;
  report.source_manifest_after = sourceManifest();
  report.source_changed_during_run =
    JSON.stringify(sourceBefore) !==
    JSON.stringify(report.source_manifest_after);
  if (report.source_changed_during_run) {
    report.pass = false;
    report.error = "SOURCE_CHANGED_DURING_RUN";
    process.exitCode = 1;
  }
  if (priorCap === undefined) delete process.env.SECRETARY_MAIN_CONTEXT_WINDOW;
  else process.env.SECRETARY_MAIN_CONTEXT_WINDOW = priorCap;
  report.completed_at = new Date().toISOString();
  await app.close();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({ pass: report.pass, calls, error: report.error, output }),
  );
}
