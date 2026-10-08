import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  replyStream,
  type AgentMessage,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { id } from "../../../src/pi_secretary/src/store.ts";
import type {
  Consciousness,
  Context,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";

const model = { ...fixtureModel, contextWindow: 1_000_000, maxTokens: 65536 };
const promise = "I will deliver the synthetic amber report tomorrow.";
const item = {
  tier: "ACTIVE",
  summary: "Synthetic amber report is pending.",
  goals: [],
  constraints: [],
  decisions: [],
  open_questions: [],
  unfulfilled_commitments: [],
  task_refs: [],
  pending_owner: "MAIN",
};

for (const boundary of ["before-first", "after-first"] as const) {
  test(`ISSUE3 checkpoint recovery repairs user provenance ${boundary} and keeps identical inputs distinct`, async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "secretary-issue3-checkpoint-"),
    );
    const extractionSources: { id: string; role: string; text: string }[][] =
      [];
    const stream: StreamFn = (m, c) => {
      const system = c.messages
        .filter((x) => x.role === "system")
        .map((x) => contentText(x.content))
        .join("\n");
      let text = "Synthetic request acknowledged.";
      if (system.includes("COMMITMENT_EXTRACTION:")) {
        const payload = JSON.parse(
          contentText(c.messages.findLast((x) => x.role === "user")!.content),
        );
        extractionSources.push(payload.source);
        text = JSON.stringify({
          quotes: payload.source.some(
            (x: { text: string }) => x.text === promise,
          )
            ? [promise]
            : [],
        });
      } else if (system.includes("CONSCIOUSNESS:"))
        text = JSON.stringify({ items: [item] });
      return replyStream([{ type: "text", text }], m);
    };
    let app = await App.open(dir, { model, stream });
    try {
      const inputs = [app.host.accept(promise), app.host.accept(promise)];
      const originalPayloads = inputs.map((i) => i.payload);
      const commit = app.store.commit.bind(app.store);
      let interrupted = false;
      app.store.commit = (records, events = [], receipt) => {
        const inputEvent = events.some(
          (event) =>
            event.event_type === "main.message" &&
            app.store.read<AgentMessage>(event.payload).role === "user",
        );
        if (inputEvent && !interrupted) {
          interrupted = true;
          if (boundary === "after-first") {
            // Simulate a pre-fix journal: the already persisted event has a random ID.
            commit(
              records,
              events.map((event) => ({ ...event, event_id: id() })),
              receipt,
            );
          }
          throw Error("SYNTHETIC_CHECKPOINT_EVENT_INTERRUPTION");
        }
        return commit(records, events, receipt);
      };
      await app.host.drain();
      assert(interrupted);
      assert.equal(app.host.session.state, "RECOVERY_BLOCKED");
      const checkpoint = app.store.get<Context>(
        "Context",
        app.host.session.last_context_id!,
      );
      const checkpointBytes = app.store
        .bytes(checkpoint.raw_context)
        .toString();
      assert.equal(
        app.store
          .read<AgentMessage[]>(checkpoint.raw_context)
          .filter(
            (m) => m.role === "user" && contentText(m.content) === promise,
          ).length,
        2,
      );
      app.store.commit = commit;
      await app.close();
      app = await App.open(dir, { model, stream });
      await app.host.drain();
      assert.equal(
        app.host.session.state,
        "IDLE",
        app.host.session.recovery_error ?? "",
      );
      const userSources = () =>
        app.store.logs.filter(
          (event) =>
            event.event_type === "main.message" &&
            app.store.read<AgentMessage>(event.payload).role === "user",
        );
      assert.equal(
        userSources().length,
        2,
        "every claimed Input must retain exactly one durable source event",
      );
      assert.equal(new Set(userSources().map((e) => e.event_id)).size, 2);
      assert.deepEqual(
        userSources()
          .map((e) => app.store.read<AgentMessage>(e.payload).timestamp)
          .sort(),
        inputs.map((i) => Date.parse(i.received_at)).sort(),
      );
      assert.equal(
        app.store.bytes(checkpoint.raw_context).toString(),
        checkpointBytes,
      );
      assert.deepEqual(
        inputs.map((i) => app.store.get<Input>("Input", i.id).payload),
        originalPayloads,
      );
      await app.host.compact();
      const memory = app.store.get<Consciousness>(
        "Consciousness",
        app.host.session.consciousness_id,
      );
      assert(
        memory.commitments?.some(
          (c) => c.text === promise && c.state === "OPEN",
        ),
        "maintenance must extract the interrupted original input",
      );
      const seen = extractionSources.flat().filter((s) => s.text === promise);
      assert.equal(seen.length, 2);
      assert.equal(
        new Set(seen.map((s) => s.id)).size,
        2,
        "same wording in different inputs remains two source events",
      );
      const sourceIDs = userSources().map((e) => e.event_id);
      const calls = extractionSources.length;
      await app.close();
      app = await App.open(dir, { model, stream });
      await app.host.drain();
      await app.host.compact();
      assert.deepEqual(
        userSources().map((e) => e.event_id),
        sourceIDs,
      );
      assert.equal(
        extractionSources.length,
        calls,
        "restart must not replay completed extraction",
      );
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
