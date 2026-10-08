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
import { saveContext } from "../../../src/pi_secretary/src/context.ts";
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
    extract: (enabled: boolean) => void;
  }) => Promise<void>,
) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-issue3-provenance-"),
  );
  const taskID = id(),
    executionID = id();
  let resolution: string | null = null;
  let extractionEnabled = true;
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
          quotes: (extractionEnabled ? packet.source : [])
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
      extract: (enabled) => {
        extractionEnabled = enabled;
      },
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

async function applySettings(app: App, label: string) {
  app.settings.save(
    {
      ...emptySettings(),
      instructions: {
        content: label,
        expected_revision: getInstructions(app.store).revision,
      },
    },
    app.settings.draft().revision,
  );
  const request = app.settings.request(
    app.settings.draft().revision,
    id(),
  ) as import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication;
  await app.settings.tick();
  const result = app.store.get<
    import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication
  >("SettingsApplication", request.id);
  assert.equal(
    result.state,
    "APPLIED",
    result.error ?? "settings application failed",
  );
  return result;
}

for (const mode of ["main", "settings"] as const)
  for (const reopenBeforeResolution of [false, true])
    test(`Issue3 cross-batch ${mode} provenance rejects earlier delivery${reopenBeforeResolution ? " after restart" : ""}`, async () => {
      await fixture(async ({ app, result, reopen, extract }) => {
        app.host.accept("Synthetic same-payload source");
        await app.host.drain();
        const originalEvents = app.store.logs.filter(
          (e) =>
            e.event_type === "main.message" &&
            e.scope.session_id === app.host.sessionID,
        );
        extract(false);
        if (mode === "main") await app.host.compact();
        else await applySettings(app, "Synthetic first batch");
        assert.equal(memory(app).commitments?.length, 0);
        const firstJob = app.store
          .all<CompactionJob>("CompactionJob")
          .findLast((j) => j.mode === "WORKING_MEMORY");
        const firstSettings = app.store
          .all<
            import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication
          >("SettingsApplication")
          .at(-1);
        const early = await deliver(app, result);
        extract(true);
        const repeated = originalEvents.map((event) =>
          app.store.event(
            "main.message",
            app.store.read(event.payload),
            event.scope,
            "MAIN",
          ),
        );
        app.store.commit([], repeated);
        app.store.commit(
          [],
          [app.store.event("input.handled", {}, originalEvents[0].scope)],
        );
        assert(
          repeated.every(
            (event) =>
              !originalEvents.some(
                (original) => original.event_id === event.event_id,
              ),
          ),
        );
        assert(
          repeated.every((event) => event.sequence > early.event.sequence),
        );
        assert.deepEqual(
          repeated.map((event) => event.payload.sha256),
          originalEvents.map((event) => event.payload.sha256),
        );
        if (mode === "main") await app.host.compact();
        else await applySettings(app, "Synthetic second batch");
        const introduced = memory(app).commitments![0];
        assert.equal(introduced.state, "OPEN");
        if (mode === "main") {
          const second = app.store
            .all<CompactionJob>("CompactionJob")
            .findLast((j) => j.mode === "WORKING_MEMORY")!;
          assert.deepEqual(
            firstJob!.source_refs.map((ref) => ref.sha256),
            second.source_refs.map((ref) => ref.sha256),
          );
          assert.deepEqual(
            second.source_event_ids,
            repeated.map((event) => event.event_id),
          );
        } else {
          const source = app.store.read<
            import("../../../src/pi_secretary/src/settings-memory.ts").SettingsSource
          >(firstSettings!.source_ref!);
          assert(
            source.refs.some(
              (ref) => ref.sha256 === introduced.source_refs[0].sha256,
            ),
            "distinct settings batches share the same evidence bytes",
          );
        }
        if (reopenBeforeResolution) app = await reopen();
        assert.equal(
          resolve(app, early.event.event_id),
          "OPEN",
          "later distinct events must not borrow older batch delivery provenance",
        );
        const borrowed = structuredClone(memory(app));
        const firstSource = firstSettings?.source_ref
          ? app.store.read<
              import("../../../src/pi_secretary/src/settings-memory.ts").SettingsSource
            >(firstSettings.source_ref)
          : null;
        borrowed.commitments![0].source_batch = {
          owner_type: mode === "main" ? "CompactionJob" : "SettingsApplication",
          owner_id: mode === "main" ? firstJob!.id : firstSettings!.id,
          source_event_ids:
            mode === "main"
              ? firstJob!.source_event_ids
              : firstSource!.extraction_messages.map((message) => message.id),
          source_end_sequence:
            mode === "main"
              ? firstJob!.source_end_sequence!
              : firstSource!.end_sequence,
        };
        assert.equal(
          resolve(app, early.event.event_id, borrowed),
          "OPEN",
          "borrowing an entire older batch fails because its candidate never introduced this commitment",
        );
        const later = await deliver(app, result);
        assert.equal(
          resolve(app, later.event.event_id),
          "COMPLETED",
          "a later valid delivery must still resolve the actual source batch",
        );
        assert.deepEqual(
          memory(app).commitments![0].source_refs,
          introduced.source_refs,
          "validation preserves original evidence refs",
        );
        const oldLedger = structuredClone(memory(app));
        delete (oldLedger.commitments![0] as { source_batch?: unknown })
          .source_batch;
        const oldContext = app.store.all<Context>("Context")[0];
        app.store.commit([
          {
            ...oldContext,
            ...base(),
            updated_at: oldContext.updated_at,
            raw_context: introduced.source_refs[0],
          },
        ]);
        assert.equal(
          resolve(app, early.event.event_id, oldLedger),
          "OPEN",
          "legacy event-only evidence must not guess which identical batch introduced the obligation even if a Context shares its bytes",
        );
        assert.equal(
          resolve(app, later.event.event_id, oldLedger),
          "OPEN",
          "unowned legacy event-only evidence remains conservative even after a later delivery",
        );
        const stored = memory(app);
        const completed = reconcileCommitments(
          app.store,
          stored,
          [],
          stored.pending_raw_refs[0] ?? introduced.source_refs[0],
          [{ id: introduced.id, event_id: later.event.event_id }],
        );
        app.store.commit([revise(stored, { commitments: completed })]);
        app = await reopen();
        assert.equal(memory(app).commitments![0].state, "COMPLETED");
        assert.deepEqual(memory(app).commitments![0].resolution_event_ids, [
          later.event.event_id,
        ]);
      });
    });

test("Issue3 legacy Context provenance remains compatible without an event batch", async () => {
  await fixture(async ({ app, result, reopen }) => {
    app.host.accept("Synthetic legacy Context source");
    await app.host.drain();
    const context = app.store.get<Context>(
      "Context",
      app.host.session.last_context_id!,
    );
    await app.host.compact();
    const cs = structuredClone(memory(app));
    delete (cs.commitments![0] as { source_batch?: unknown }).source_batch;
    cs.commitments![0].source_refs = [context.raw_context];
    app.store.commit([revise(memory(app), { commitments: cs.commitments })]);
    app = await reopen();
    const delivery = await deliver(app, result);
    assert.equal(
      resolve(app, delivery.event.event_id),
      "COMPLETED",
      "an explicitly retained older Context still supports valid later completion",
    );
  });
});

test("Issue3 explicit source batch rejects missing owners and mismatched boundaries", async () => {
  await fixture(async ({ app, result }) => {
    app.host.accept("Synthetic explicit batch validation");
    await app.host.drain();
    await app.host.compact();
    const delivery = await deliver(app, result);
    assert.equal(resolve(app, delivery.event.event_id), "COMPLETED");
    type Batch = {
      owner_type: "CompactionJob" | "SettingsApplication";
      owner_id: string;
      source_event_ids: string[];
      source_end_sequence: number;
    };
    const original = memory(app).commitments![0] as { source_batch?: Batch };
    assert(
      original.source_batch,
      "new event-only commitments retain their exact introducing batch",
    );
    for (const patch of [
      { owner_id: id() },
      { owner_type: "SettingsApplication" as const },
      { source_event_ids: [id()] },
      { source_end_sequence: 0 },
    ]) {
      const cs = structuredClone(memory(app));
      (cs.commitments![0] as { source_batch?: Batch }).source_batch = {
        ...original.source_batch,
        ...patch,
      };
      assert.equal(
        resolve(app, delivery.event.event_id, cs),
        "OPEN",
        "invalid explicit provenance must not fall back to any matching blob owner",
      );
    }
    const owner = app.store.get<CompactionJob>(
      "CompactionJob",
      original.source_batch.owner_id,
    );
    app.store.commit([
      revise(owner, { candidate_ref: app.store.put({ commitments: [] }) }),
    ]);
    assert.equal(
      resolve(app, delivery.event.event_id),
      "OPEN",
      "current owner candidate must retain the exact introduced commitment",
    );
    app.store.commit([
      revise(app.store.get<CompactionJob>("CompactionJob", owner.id), {
        candidate_ref: owner.candidate_ref,
        source_event_ids: [],
      }),
    ]);
    assert.equal(
      resolve(app, delivery.event.event_id),
      "OPEN",
      "explicit batch must not fall back when its owner's event set changes",
    );
  });
});

for (const mode of ["main", "settings"] as const)
  test(`Issue3 legacy ${mode} source classification survives cleared owner fields and restart`, async () => {
    await fixture(async ({ app, result, reopen, extract }) => {
      app.host.accept("Synthetic immutable provenance history");
      await app.host.drain();
      const events = app.store.logs.filter(
        (event) =>
          event.event_type === "main.message" &&
          event.scope.session_id === app.host.sessionID,
      );
      extract(false);
      if (mode === "main") await app.host.compact();
      else await applySettings(app, "Synthetic legacy first batch");
      const alias = saveContext(
        app.store,
        events.map((event) => app.store.read(event.payload)),
        events[0].scope,
        "MAIN",
        fixtureModel.id,
        id(),
      );
      const delivery = await deliver(app, result);
      extract(true);
      app.store.commit(
        [],
        events.map((event) =>
          app.store.event(
            "main.message",
            app.store.read(event.payload),
            event.scope,
            "MAIN",
          ),
        ),
      );
      app.store.commit(
        [],
        [app.store.event("input.handled", {}, events[0].scope)],
      );
      if (mode === "main") await app.host.compact();
      else await applySettings(app, "Synthetic legacy second batch");
      const legacy = structuredClone(memory(app));
      delete legacy.commitments![0].source_batch;
      assert.equal(
        alias.raw_context.sha256,
        legacy.commitments![0].source_refs[0].sha256,
      );
      assert.equal(
        resolve(app, delivery.event.event_id, legacy),
        "OPEN",
        "known event evidence cannot borrow a matching earlier Context",
      );
      if (mode === "main") {
        for (const job of app.store
          .all<CompactionJob>("CompactionJob")
          .filter((job) => job.mode === "WORKING_MEMORY"))
          app.store.commit([revise(job, { source_event_ids: [] })]);
      } else {
        for (const application of app.store.all<
          import("../../../src/pi_secretary/src/contracts.ts").SettingsApplication
        >("SettingsApplication"))
          app.store.commit([revise(application, { source_ref: null })]);
      }
      assert.equal(
        resolve(app, delivery.event.event_id, legacy),
        "OPEN",
        "clearing mutable owner fields must not erase the durable event provenance classification",
      );
      app.store.commit([
        revise(memory(app), { commitments: legacy.commitments }),
      ]);
      app = await reopen();
      assert.equal(
        resolve(app, delivery.event.event_id),
        "OPEN",
        "immutable owner history remains authoritative after reopening",
      );
    });
  });

test("Issue3 settings binds a new same-text event instead of an older Context quote", async () => {
  await fixture(async ({ app, result, reopen, extract }) => {
    app.host.accept("Synthetic old Context with missed promise");
    await app.host.drain();
    const original = app.store.logs.findLast(
      (event) =>
        event.event_type === "main.message" &&
        app.store.read<
          import("../../../src/pi_secretary/src/model.ts").AgentMessage
        >(event.payload).role === "assistant",
    )!;
    extract(false);
    await app.host.compact();
    assert.equal(memory(app).commitments!.length, 0);
    const early = await deliver(app, result);
    extract(true);
    const oldMessage = app.store.read<
      import("../../../src/pi_secretary/src/model.ts").AgentMessage
    >(original.payload);
    const later = app.store.event(
      "main.message",
      {
        ...oldMessage,
        timestamp: Math.max(Date.now(), oldMessage.timestamp + 1),
      },
      original.scope,
      "MAIN",
    );
    assert.notEqual(later.payload.sha256, original.payload.sha256);
    app.store.commit([], [later]);
    await applySettings(
      app,
      "Synthetic later same text with a different timestamp",
    );
    const commitment = memory(app).commitments![0];
    assert(commitment);
    assert.equal(
      resolve(app, early.event.event_id),
      "OPEN",
      "an old delivery cannot close the new event's obligation",
    );
    app = await reopen();
    assert.equal(
      resolve(app, early.event.event_id),
      "OPEN",
      "new origin binding survives restart",
    );
    const delivery = await deliver(app, result);
    assert.equal(
      resolve(app, delivery.event.event_id),
      "COMPLETED",
      "the later event supports valid delivery even when an older Context contains identical promise text",
    );
    const cs = memory(app);
    const completed = reconcileCommitments(
      app.store,
      cs,
      [],
      commitment.source_refs[0],
      [{ id: commitment.id, event_id: delivery.event.event_id }],
    );
    app.store.commit([revise(cs, { commitments: completed })]);
    app = await reopen();
    assert.equal(memory(app).commitments![0].state, "COMPLETED");
  });
});
