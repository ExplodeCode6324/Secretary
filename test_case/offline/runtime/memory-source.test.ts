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
import type {
  Consciousness,
  CompactionJob,
  ObjectRef,
} from "../../../src/pi_secretary/src/contracts.ts";

test("compaction includes assistant-only promises despite display metadata and excludes unrelated events", async () => {
  const promise = "I will include the amber item in the next review.";
  const unrelated = "I will send an unrelated payment.";
  type Event = {
    event_id: string;
    source_ref: ObjectRef;
    message?: AgentMessage;
  };
  const batches: Event[][] = [];
  const stream: StreamFn = (model, context) => {
    if (
      contentText(context.messages[0].content).includes(
        "COMMITMENT_EXTRACTION:",
      )
    ) {
      const message = context.messages.findLast(
        (entry) => entry.role === "user",
      )!;
      const packet = JSON.parse(contentText(message.content)) as {
        source: { id: string; text: string }[];
      };
      // Extraction receives whole eligible messages, never summary snippets.
      const quotes = packet.source
        .map((entry) => entry.text)
        .filter((text) => text === promise);
      return replyStream(
        [{ type: "text", text: JSON.stringify({ quotes }) }],
        model,
      );
    }
    if (contentText(context.messages[0].content).includes("CONSCIOUSNESS:")) {
      const message = context.messages.findLast(
        (entry) => entry.role === "user",
      )!;
      const packet = JSON.parse(contentText(message.content)) as {
        source_chunk: string;
      };
      // This small material fits complete fragments. Larger fragments are covered
      // by the Issue #2 Unicode reconstruction and fixed-budget helper tests.
      batches.push(
        JSON.parse(packet.source_chunk).map((fragment: { fragment: string }) =>
          JSON.parse(fragment.fragment),
        ),
      );
      return replyStream(
        [
          {
            type: "text",
            text: JSON.stringify({
              items: [
                {
                  tier: "ACTIVE",
                  summary: "Synthetic review",
                  goals: [],
                  constraints: [],
                  decisions: [],
                  open_questions: [],
                  unfulfilled_commitments: [],
                  task_refs: [],
                  pending_owner: "MAIN",
                },
              ],
              resolutions: [],
            }),
          },
        ],
        model,
      );
    }
    return replyStream([{ type: "text", text: promise }], model);
  };
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-memory-source-"),
  );
  const app = await App.open(dir, { model: fixtureModel, stream });
  try {
    app.host.accept(
      "Please acknowledge this synthetic review. No external actions.",
    );
    await app.host.drain();
    const assistantEvent = app.store.logs.find(
      (entry) =>
        entry.event_type === "main.message" &&
        app.store.read<AgentMessage>(entry.payload).role === "assistant",
    )!;
    const logged = app.store.read<AgentMessage & { display_call_id?: string }>(
      assistantEvent.payload,
    );
    assert(logged.display_call_id, "exercise actual UI correlation metadata");
    const memory = app.store.get<Consciousness>(
      "Consciousness",
      app.host.session.consciousness_id,
    );
    const originalBytes = app.store.bytes(memory.pending_raw_refs[0]);
    assert(originalBytes.toString().includes(promise));
    assert(!originalBytes.toString().includes("display_call_id"));
    const outside = app.store.event(
      "main.message",
      { ...logged, content: [{ type: "text", text: unrelated }] },
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      "MAIN",
    );
    const otherSession = app.store.event(
      "main.message",
      logged,
      {
        session_id: "00000000-0000-4000-8000-000000000000",
        task_id: null,
        execution_id: null,
      },
      "MAIN",
    );
    app.store.commit([], [outside, otherSession]);
    await app.host.compact();
    assert.equal(app.host.memoryStatus().state, "COMMITTED");
    assert(
      batches[0].some((entry) => entry.event_id === assistantEvent.event_id),
      "actual assistant response must be in model compaction sources",
    );
    assert(
      !batches[0].some((entry) =>
        [outside.event_id, otherSession.event_id].includes(entry.event_id),
      ),
    );
    const source = batches[0].find(
      (entry) => entry.event_id === assistantEvent.event_id,
    )!;
    assert.deepEqual(
      source.source_ref,
      assistantEvent.payload,
      "retain original durable log reference",
    );
    const after = app.store.get<Consciousness>("Consciousness", memory.id);
    assert.equal(after.commitments?.length, 1);
    assert.equal(after.commitments![0].text, promise);
    assert.equal(after.commitments![0].state, "OPEN");
    assert(
      app.store.bytes(memory.pending_raw_refs[0]).equals(originalBytes),
      "do not rewrite source objects",
    );
    const job = app.store.all<CompactionJob>("CompactionJob").at(-1)!;
    assert(job.covered_event_ids.includes(assistantEvent.event_id));
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
