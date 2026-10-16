import { testPostgres } from "../helpers/postgres.ts";
import { apply } from "../issue28/helpers.ts";
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
    await apply(f.app);
    const appliedSource = settingsSource(f.app.host, {
      world: [],
      instructions: null,
    });
    assert(
      !appliedSource.extraction_messages.some((m) =>
        m.text.startsWith("Scheduled self-wakeup"),
      ),
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

test("same-batch Master sources and TIMER-origin rescheduling keep exact provenance", async () => {
  let at = "";
  const stream: StreamFn = (m, c, o) => {
    const last = c.messages.at(-1);
    if (last?.role === "user")
      return replyStream(
        [
          {
            type: "toolCall",
            id: "reschedule",
            name: "schedule_wakeup",
            arguments: { at, note: "synthetic next wakeup" },
          },
        ],
        m,
      );
    return fixtureStream(m, c, o);
  };
  await fixture(async (f) => {
    at = f.args().at;
    const inputs = [
      f.app.host.accept("first synthetic request"),
      f.app.host.accept("second synthetic constraint"),
    ];
    const events = () =>
      f.app.store.logs.filter((e) => e.event_type === "input.accepted");
    const expected = events()
      .filter((e) =>
        inputs.some((i) => i.id === f.app.store.read<Input>(e.payload).id),
      )
      .map((e) => e.event_id);
    await f.app.settle();
    const first = f.app.store.all<WakeTimer>("WakeTimer")[0];
    assert.deepEqual(first.source_event_ids, expected);
    assert.equal(expected.length, 2);
    f.time += 2000;
    at = f.args().at;
    await f.app.settle();
    const next = f.app.store
      .all<WakeTimer>("WakeTimer")
      .find((t) => t.id !== first.id)!;
    const timerEvents = events()
      .filter((e) => f.app.store.read<Input>(e.payload).producer === "TIMER")
      .map((e) => e.event_id);
    assert.equal(timerEvents.length, 1);
    assert.deepEqual(next.source_event_ids, timerEvents);
    assert.equal(next.state, "PENDING");
  }, stream);
});

for (const name of ["schedule_wakeup", "cancel_wakeup"])
  test(`${name} rejects extra arguments before mutation`, async () => {
    let args: Record<string, string> = {};
    const stream: StreamFn = (m, c, o) =>
      c.messages.at(-1)?.role === "user"
        ? replyStream(
            [{ type: "toolCall", id: "invalid-extra", name, arguments: args }],
            m,
          )
        : fixtureStream(m, c, o);
    await fixture(async (f) => {
      const timer = f.app.host.wakeups.schedule(id(), f.args(), f.source());
      args =
        name === "schedule_wakeup"
          ? { ...f.args(), reason: "unexpected" }
          : { timer_id: timer.timer_id, reason: "unexpected" };
      await f.app.settle();
      assert.equal(f.app.store.all<WakeTimer>("WakeTimer").length, 1);
      assert.equal(f.app.host.wakeups.get(timer.timer_id).state, "PENDING");
      const results = f.app.store.logs
        .filter((e) => e.event_type === "main.message")
        .map((e) => f.app.store.read<any>(e.payload));
      assert(
        results.some(
          (v) =>
            v.role === "toolResult" &&
            v.isError &&
            contentText(v.content).includes("additional"),
        ),
      );
    }, stream);
  });

testPostgres(
  "PostgreSQL input coverage survives TIMER followed by Settings apply and restart",
  (dsn) =>
    fixture(
      async (f) => {
        await f.app.world!.migrate();
        f.app.host.wakeups.schedule(id(), f.args(), f.source());
        await f.app.settle();
        f.time += 2000;
        await f.app.settle();
        await f.app.world!.memorySearch.advance();
        assert.equal(f.app.world!.memorySearch.state, "ready");
        await apply(f.app);
        await f.restart();
        await f.app.world!.memorySearch.advance();
        await f.app.host.compact();
        await apply(f.app);
        assert.equal(f.app.host.session.state, "IDLE");
      },
      fixtureStream,
      dsn,
    ),
);
