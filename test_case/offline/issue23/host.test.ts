import test from "node:test";
import assert from "node:assert/strict";
import { contentText } from "@earendil-works/pi-ai";
import { fixture } from "./helpers.ts";
import {
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type {
  Input,
  WakeTimer,
  Consciousness,
} from "../../../src/pi_secretary/src/contracts.ts";
import {
  settingsSource,
  settingsExtractionEvidence,
} from "../../../src/pi_secretary/src/settings-memory.ts";
import { inputMessage } from "../../../src/pi_secretary/src/input-projection.ts";
import { reconcileCommitments } from "../../../src/pi_secretary/src/memory.ts";

test("no-UI HTTP message -> schedule -> TIMER-only model round -> durable notification", async () => {
  const requests: any[] = [];
  let at = "";
  const stream: StreamFn = (model, context, options) => {
    requests.push(structuredClone(context));
    const last = context.messages.at(-1),
      text = last ? contentText(last.content) : "";
    if (last?.role === "user" && text === "schedule synthetic")
      return replyStream(
        [
          {
            type: "toolCall",
            id: "schedule",
            name: "schedule_wakeup",
            arguments: { at, note: "Synthetic reminder" },
          },
        ],
        model,
      );
    if (last?.role === "user" && text.startsWith("Scheduled self-wakeup"))
      return replyStream(
        [
          {
            type: "toolCall",
            id: "notify",
            name: "MasterInteract",
            arguments: { message: "Synthetic timer fired" },
          },
        ],
        model,
      );
    return fixtureStream(model, context, options);
  };
  await fixture(async (f) => {
    at = f.args().at;
    await f.client.command("messages", {
      request_id: id(),
      text: "schedule synthetic",
    });
    await f.app.settle();
    const [timer] = f.app.store.all<WakeTimer>("WakeTimer");
    assert(timer);
    assert.equal(timer.source_event_ids.length, 1);
    f.time += 2000;
    await f.app.settle();
    assert.equal(f.app.host.wakeups.get(timer.id).state, "FIRED");
    assert.equal((await f.client.notifications()).items.length, 1);
    assert.equal(f.app.store.all("TaskPlan").length, 0);
    assert.equal(f.app.store.all("Execution").length, 0);
    assert(
      requests.some((c) =>
        c.messages.some(
          (m: any) =>
            m.role === "user" &&
            contentText(m.content).includes('"late_by_ms":1000'),
        ),
      ),
    );
    const source = settingsSource(f.app.host, {
      world: [],
      instructions: null,
    });
    settingsExtractionEvidence(f.app.host, source);
    assert(
      !source.extraction_messages.some((m) =>
        m.text.startsWith("Scheduled self-wakeup"),
      ),
    );
    const input = f.app.store
      .all<Input>("Input")
      .find((i) => i.producer === "TIMER")!;
    const cs = f.app.store.get<Consciousness>(
      "Consciousness",
      f.app.host.session.consciousness_id,
    );
    const items = [
      {
        item_id: id(),
        source_refs: [],
        last_activity_at: new Date().toISOString(),
        tier: "ACTIVE" as const,
        summary: "synthetic",
        goals: [],
        constraints: [],
        decisions: [],
        open_questions: [],
        unfulfilled_commitments: ["Synthetic reminder"],
        task_refs: [],
        pending_owner: "MAIN" as const,
      },
    ];
    assert.equal(
      reconcileCommitments(
        f.app.store,
        cs,
        items,
        f.app.store.put([inputMessage(f.app.store, input)]),
      ).length,
      0,
    );
    await f.app.host.compact();
    const jobs = f.app.store.all<any>("MemoryExtractionJob");
    assert(
      !jobs.some((j) =>
        JSON.stringify(f.app.store.read(j.source_ref)).includes(
          "Scheduled self-wakeup",
        ),
      ),
    );
    await f.restart();
    await f.app.settle();
    assert.equal((await f.client.notifications()).items.length, 1);
  }, stream);
});

test("TIMER does not release RECOVERY_BLOCKED session", () =>
  fixture(async (f) => {
    const timer = f.app.host.wakeups.schedule(id(), f.args(), f.source());
    f.app.store.commit([
      revise(f.app.host.session, {
        state: "RECOVERY_BLOCKED",
        recovery_error: "synthetic block",
      }),
    ]);
    f.time += 2000;
    f.app.host.wakeups.fireDue();
    await f.app.host.drain();
    assert.equal(f.app.host.session.state, "RECOVERY_BLOCKED");
    assert.equal(f.app.host.wakeups.get(timer.timer_id).state, "FIRED");
    assert.equal(
      f.app.store.all<Input>("Input").find((i) => i.producer === "TIMER")
        ?.state,
      "ACCEPTED",
    );
  }));
