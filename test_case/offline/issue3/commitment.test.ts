import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { base, id, now, revise } from "../../../src/pi_secretary/src/store.ts";
import { TerminalController } from "../../../src/pi_secretary/src/tui.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import { reconcileCommitments } from "../../../src/pi_secretary/src/memory.ts";
import {
  fixtureModel,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Consciousness,
  Context,
  Notification,
  TaskResult,
  CompactionJob,
} from "../../../src/pi_secretary/src/contracts.ts";

const promise = "收到执行结果后汇报；不轮询运行中任务";
const memory = (app: App) =>
  app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
async function fixture(
  body: (f: {
    app: App;
    reopen: () => Promise<App>;
    result: TaskResult;
    propose: (eventID: string) => void;
  }) => Promise<void>,
) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-issue3-commitment-"),
  );
  const taskID = id(),
    executionID = id();
  let resolution: string | null = null;
  const stream: StreamFn = (model, context) => {
    const system = contentText(context.messages[0].content);
    const packet = JSON.parse(
      system.includes("CONSCIOUSNESS:") ||
        system.includes("COMMITMENT_EXTRACTION:")
        ? contentText(context.messages.at(-1)!.content)
        : "{}",
    );
    const answer = system.includes("COMMITMENT_EXTRACTION:")
      ? JSON.stringify({
          quotes: packet.source
            .filter((m: { text: string }) => m.text.endsWith(promise))
            .map((m: { text: string }) => m.text),
        })
      : system.includes("CONSCIOUSNESS:")
        ? JSON.stringify({
            items: [
              {
                tier: "ACTIVE",
                summary: "Synthetic result reporting",
                goals: [],
                constraints: [],
                decisions: [],
                open_questions: [],
                unfulfilled_commitments: [],
                task_refs: [taskID],
                pending_owner: "MAIN",
              },
            ],
            resolutions: resolution
              ? packet.commitments.map((c: { id: string }) => ({
                  id: c.id,
                  event_id: resolution,
                }))
              : [],
          })
        : promise;
    return replyStream([{ type: "text", text: answer }], model);
  };
  let app = await App.open(dir, { model: fixtureModel, stream });
  try {
    const evidence = app.store.put(
      "Synthetic task result evidence",
      "text/plain",
    );
    const result: TaskResult = {
      schema_version: 1,
      record_type: "TaskResult",
      ...base(),
      task_id: taskID,
      execution_id: executionID,
      outcome: "SUCCEEDED",
      summary: "Synthetic report complete",
      limitations: [],
      evidence: [evidence],
      artifacts: [],
      detail_ref: evidence,
      needs_action: false,
      verified_by: "PROGRAM_CHECK",
      observed_at: now(),
    };
    app.store.commit([result]);
    await body({
      app,
      result,
      propose: (eventID) => {
        resolution = eventID;
      },
      reopen: async () => {
        await app.close();
        app = await App.open(dir, { model: fixtureModel, stream });
        return app;
      },
    });
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function introduce(app: App) {
  app.host.accept("Acknowledge the synthetic reporting obligation.");
  await app.host.drain();
  await app.host.compact();
  assert.equal(app.host.memoryStatus().state, "COMMITTED");
  assert.equal(memory(app).commitments?.[0].state, "OPEN");
}
async function deliver(app: App, result: TaskResult) {
  const tool = (app.host as any)
    .tools(id())
    .find((t: any) => t.name === "MasterInteract");
  await tool.execute(
    id(),
    { message: `${result.task_id}: ${result.outcome}` },
    undefined,
    () => {},
  );
  const queued = app.store.all<Notification>("Notification").at(-1)!;
  assert.equal(queued.state, "QUEUED");
  new TerminalController(app, () => {}).refresh();
  const event = app.store.logs.findLast(
    (e) => e.event_type === "notification.result",
  )!;
  return { event, notification: app.store.read<Notification>(event.payload) };
}
function resolve(app: App, eventID: string, cs = memory(app), end = Infinity) {
  return reconcileCommitments(
    app.store,
    cs,
    [],
    cs.pending_raw_refs[0] ?? cs.commitments![0].source_refs[0],
    [{ id: cs.commitments![0].id, event_id: eventID }],
    end,
  )[0].state;
}

test("Issue3 event-source promise: extraction → maintenance → real notification delivery → completion survives restart", async () => {
  await fixture(async ({ app, result, propose, reopen }) => {
    await introduce(app);
    const before = memory(app).commitments![0];
    assert(
      !app.store
        .all<Context>("Context")
        .some((c) => c.raw_context.sha256 === before.source_refs[0].sha256),
      "exercise event-only evidence",
    );
    const { event } = await deliver(app, result);
    propose(event.event_id);
    app.host.accept("Review the delivered synthetic result.");
    await app.host.drain();
    await app.host.compact();
    assert.equal(memory(app).commitments![0].state, "COMPLETED");
    assert.deepEqual(memory(app).commitments![0].resolution_event_ids, [
      event.event_id,
    ]);
    app = await reopen();
    assert.equal(memory(app).commitments![0].state, "COMPLETED");
    assert.deepEqual(
      memory(app).commitments![0].source_refs,
      before.source_refs,
    );
  });
});

test("Issue3 delivery validation rejects early, unrelated, foreign-session, unreceipted and forged evidence", async () => {
  await fixture(async ({ app, result }) => {
    const early = await deliver(app, result);
    await introduce(app);
    const cs = memory(app);
    assert.equal(resolve(app, early.event.event_id), "OPEN", "early delivery");
    const { event, notification } = await deliver(app, result);
    assert.equal(
      resolve(app, event.event_id, cs, event.sequence - 1),
      "OPEN",
      "outside fixed source boundary",
    );
    const badTime = app.store.event("notification.result", notification);
    badTime.occurred_at = "2000-01-01T00:00:00.000Z";
    app.store.commit([], [badTime]);
    assert.equal(
      resolve(app, badTime.event_id),
      "OPEN",
      "delivery timestamp predates source despite later log sequence",
    );
    const attempt = (patch: Partial<Notification>, persist = true) => {
      const value = { ...notification, ...base(), ...patch };
      const forged = app.store.event("notification.result", value);
      app.store.commit(persist ? [value] : [], [forged]);
      assert.equal(resolve(app, forged.event_id), "OPEN");
    };
    attempt({ session_id: id() }, false);
    attempt({ message: app.store.put(`${id()}: SUCCEEDED`, "text/plain") });
    attempt({
      message: app.store.put(`${result.task_id}: FAILED`, "text/plain"),
    });
    attempt({ receipt: null });
    attempt({ state: "FAILED" });
    attempt({
      receipt: app.store.put({ delivery_key: id(), presented: true }),
    });
    attempt({}, false);
    const wrongScope = app.store.event("notification.result", notification, {
      session_id: id(),
      task_id: null,
      execution_id: null,
    });
    app.store.commit([], [wrongScope]);
    assert.equal(
      resolve(app, wrongScope.event_id),
      "OPEN",
      "explicitly foreign notification scope",
    );
    const emptySources = structuredClone(cs);
    emptySources.commitments![0].source_refs = [];
    assert.equal(
      resolve(app, event.event_id, emptySources),
      "OPEN",
      "empty source list",
    );
    const wrongTask = structuredClone(cs);
    wrongTask.commitments![0].task_refs = [id()];
    assert.equal(resolve(app, event.event_id, wrongTask), "OPEN");
    const forgedSource = structuredClone(cs);
    forgedSource.commitments![0].source_refs = [
      app.store.put([{ role: "assistant", content: promise, timestamp: 0 }]),
    ];
    assert.equal(
      resolve(app, event.event_id, forgedSource),
      "OPEN",
      "unanchored quote blob",
    );
    assert.equal(
      resolve(app, event.event_id),
      "COMPLETED",
      "valid notification still closes original",
    );
  });
});

test("Issue3 legacy Context sources retain completion while foreign Context and compound promises remain open", async () => {
  await fixture(async ({ app, result }) => {
    await introduce(app);
    const cs = memory(app);
    const context = app.store.get<Context>(
      "Context",
      app.host.session.last_context_id!,
    );
    const legacy = structuredClone(cs);
    legacy.commitments![0].source_refs = [context.raw_context];
    delete legacy.commitments![0].source_batch;
    const { event } = await deliver(app, result);
    assert.equal(resolve(app, event.event_id, legacy), "COMPLETED");
    const compound = structuredClone(legacy);
    compound.commitments![0].text += "，并完成另一项工作";
    assert.equal(resolve(app, event.event_id, compound), "OPEN");
    const foreign = structuredClone(legacy);
    foreign.session_id = id();
    assert.equal(resolve(app, event.event_id, foreign), "OPEN");
  });
});

test("Issue3 event origins require the original session, sequence and exact snapshot", async () => {
  await fixture(async ({ app, result }) => {
    await introduce(app);
    const { event } = await deliver(app, result);
    const cs = memory(app);
    const job = app.store
      .all<CompactionJob>("CompactionJob")
      .findLast((j) => j.mode === "WORKING_MEMORY")!;
    const original = app.store.logs.find(
      (event) => event.event_id === job.source_event_ids.at(-1),
    )!;
    const foreign = app.store.event(
      "main.message",
      app.store.read(original.payload),
      { session_id: id(), task_id: null, execution_id: null },
    );
    app.store.commit([], [foreign]);
    app.store.commit([
      revise(job, {
        source_event_ids: [
          ...job.source_event_ids.slice(0, -1),
          foreign.event_id,
        ],
      }),
    ]);
    assert.equal(
      resolve(app, event.event_id),
      "OPEN",
      "foreign event cannot vouch for source",
    );
    app.store.commit([
      revise(app.store.get<CompactionJob>("CompactionJob", job.id), {
        source_event_ids: [id()],
      }),
    ]);
    assert.equal(
      resolve(app, event.event_id),
      "OPEN",
      "unknown event cannot vouch for source",
    );
  });
});

test("Issue3 settings event-only evidence can resolve after delivery", async () => {
  await fixture(async ({ app, result, propose }) => {
    app.host.accept("Acknowledge a synthetic report.");
    await app.host.drain();
    const text = "已向 Master 承诺：" + promise;
    const event = app.store.event(
      "main.message",
      {
        role: "assistant",
        content: [{ type: "text", text }],
        timestamp: Date.now(),
      },
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      "MAIN",
    );
    app.store.commit([], [event]);
    app.settings.save(
      {
        ...emptySettings(),
        instructions: {
          content: "Answer synthetic tests concisely.",
          expected_revision: getInstructions(app.store).revision,
        },
      },
      app.settings.draft().revision,
    );
    app.settings.request(app.settings.draft().revision, id());
    await app.settings.tick();
    const commitment = memory(app).commitments!.find((c) => c.text === text)!;
    assert(commitment, "settings must extract the promise absent from Context");
    assert(
      !app.store
        .all<Context>("Context")
        .some(
          (context) =>
            context.raw_context.sha256 === commitment.source_refs[0].sha256,
        ),
    );
    const { event: delivered } = await deliver(app, result);
    propose(delivered.event_id);
    app.host.accept("Check the delivered synthetic report.");
    await app.host.drain();
    await app.host.compact();
    assert.equal(
      memory(app).commitments!.find((c) => c.id === commitment.id)!.state,
      "COMPLETED",
    );
  });
});

test("Issue3 identical settings event bodies retain distinct delivery boundaries", async () => {
  await fixture(async ({ app, result }) => {
    app.host.accept("Acknowledge a synthetic report.");
    await app.host.drain();
    const text = "已向 Master 承诺：" + promise;
    const message = {
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    };
    const scope = {
      session_id: app.host.sessionID,
      task_id: null,
      execution_id: null,
    };
    app.store.commit(
      [],
      [app.store.event("main.message", message, scope, "MAIN")],
    );
    const oldDelivery = await deliver(app, result);
    app.store.commit(
      [],
      [app.store.event("main.message", message, scope, "MAIN")],
    );
    app.settings.save(
      {
        ...emptySettings(),
        instructions: {
          content: "Keep distinct synthetic events.",
          expected_revision: getInstructions(app.store).revision,
        },
      },
      app.settings.draft().revision,
    );
    app.settings.request(app.settings.draft().revision, id());
    await app.settings.tick();
    const cs = memory(app);
    const commitment = cs.commitments!.find((c) => c.text === text)!;
    assert(commitment);
    const only = { ...cs, commitments: [commitment] };
    assert.equal(
      resolve(app, oldDelivery.event.event_id, only),
      "OPEN",
      "the same payload emitted again after delivery is a later source event",
    );
    const delivered = await deliver(app, result);
    assert.equal(resolve(app, delivered.event.event_id, only), "COMPLETED");
  });
});
