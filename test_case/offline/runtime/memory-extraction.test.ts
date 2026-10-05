// Parser/transport contract tests only. These fixtures do not establish model cognition.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  contentText,
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { Store, id } from "../../../src/pi_secretary/src/store.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { reconcileCommitments } from "../../../src/pi_secretary/src/memory.ts";
import { extractNewCommitments } from "../../../src/pi_secretary/src/memory-extraction.ts";
import type {
  Context,
  Consciousness,
  WorkItem,
  ModelCall,
  MemoryCommitment,
} from "../../../src/pi_secretary/src/contracts.ts";

async function withStore(run: (store: Store) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secretary-extraction-"));
  const app = await App.open(dir, {
    model: fixtureModel,
    stream: fixtureStream,
  });
  const store = app.store;
  try {
    await run(store);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const source = [
  {
    role: "assistant",
    content:
      "If Master requests a review, I will list the open approval obligation.",
  },
];
function extract(
  store: Store,
  stream: StreamFn,
  maxTokens = 4096,
  existing: MemoryCommitment[] = [],
) {
  return extractNewCommitments({
    store,
    model: { ...fixtureModel, maxTokens },
    stream,
    sessionID: store.all("Session")[0].id,
    loopID: id(),
    consciousnessRevision: 7,
    source,
    existing,
  });
}

test("extracts unchanged conditional quote with no tools, bounded output and durable request/response evidence", () =>
  withStore(async (store) => {
    let requests = 0;
    const existing: MemoryCommitment[] = [
      {
        id: id(),
        text: "Existing promise",
        state: "OPEN",
        source_refs: [store.put("Existing promise")],
        task_refs: [],
        resolution_event_ids: [],
      },
    ];
    const beforeMemory = structuredClone(store.all("Consciousness"));
    const quote = source[0].content;
    const stream: StreamFn = (model, context, options) => {
      requests++;
      assert.equal(options?.maxTokens, 4096);
      assert(
        context.messages
          .filter((message) => message.role === "system")
          .every((message) => !message.toolsAdded?.length),
      );
      const user = context.messages.findLast(
        (message) => message.role === "user",
      )!;
      assert.deepEqual(JSON.parse(contentText(user.content)), {
        source,
        existing,
      });
      return replyStream(
        [{ type: "text", text: JSON.stringify({ quotes: [quote] }) }],
        model,
      );
    };
    assert.deepEqual(await extract(store, stream, 8192, existing), [quote]);
    assert.equal(requests, 1);
    const call = store.all<ModelCall>("ModelCall")[0];
    assert.equal(call.state, "RESPONSE_SAVED");
    assert(call.response);
    const context = store.get<Context>("Context", call.context_id);
    assert.equal(context.purpose, "COMPACTION");
    assert.equal(context.consciousness_revision, 7);
    assert.equal(
      JSON.stringify(store.all("Consciousness")),
      JSON.stringify(beforeMemory),
      "extractor must not modify the memory ledger",
    );
  }));

test("permits empty extraction and respects a smaller model output limit", () =>
  withStore(async (store) => {
    assert.deepEqual(
      await extract(
        store,
        (model, _context, options) => {
          assert.equal(options?.maxTokens, 512);
          return replyStream([{ type: "text", text: '{"quotes":[]}' }], model);
        },
        512,
      ),
      [],
    );
  }));

for (const [name, answer] of [
  ["malformed JSON", '{"quotes":'],
  ["non-object", "[]"],
  ["missing quotes", "{}"],
  ["wrong quote collection", '{"quotes":"promise"}'],
  ["non-string quote", '{"quotes":[42]}'],
  ["empty quote", '{"quotes":["  "]}'],
  ["oversized quote", JSON.stringify({ quotes: ["a".repeat(1201)] })],
  [
    "too many quotes",
    JSON.stringify({ quotes: Array.from({ length: 17 }, (_, i) => String(i)) }),
  ],
  ["unexpected fields", '{"quotes":[],"resolutions":[]}'],
  ["markdown instead of JSON", '```json\n{"quotes":[]}\n```'],
])
  test(`rejects ${name} without retry while retaining the response`, () =>
    withStore(async (store) => {
      let requests = 0;
      await assert.rejects(
        extract(store, (model) => {
          requests++;
          return replyStream([{ type: "text", text: answer }], model);
        }),
      );
      assert.equal(requests, 1);
      assert.equal(store.all<ModelCall>("ModelCall").length, 1);
      assert(store.all<ModelCall>("ModelCall")[0].response);
    }));

for (const reason of ["length", "error", "aborted", "toolUse"] as const) {
  test(`rejects ${reason} response before another request`, () =>
    withStore(async (store) => {
      let requests = 0;
      const stream: StreamFn = async (model) => {
        requests++;
        const result: AssistantMessage = await replyStream(
          [{ type: "text", text: '{"quotes":[]}' }],
          model,
        ).result();
        result.stopReason = reason;
        if (reason === "error" || reason === "aborted")
          result.errorMessage = "synthetic provider failure";
        if (reason === "toolUse")
          result.content = [
            {
              type: "toolCall",
              id: "synthetic",
              name: "do_not_execute",
              arguments: {},
            },
          ];
        const response = createAssistantMessageEventStream();
        queueMicrotask(() => {
          if (reason === "error" || reason === "aborted")
            response.push({ type: "error", reason, error: result });
          else response.push({ type: "done", reason, message: result });
          response.end(result);
        });
        return response;
      };
      await assert.rejects(extract(store, stream), /COMMITMENT_EXTRACTION/);
      assert.equal(requests, 1);
      assert(
        store.all<ModelCall>("ModelCall")[0].response,
        "provider failure response must be saved",
      );
    }));
}

test("rejects a transport throw without retry and records failed attempt", () =>
  withStore(async (store) => {
    let requests = 0;
    await assert.rejects(
      extract(store, () => {
        requests++;
        throw Error("synthetic connection failure");
      }),
      /synthetic connection failure/,
    );
    assert.equal(requests, 1);
    assert.equal(store.all<ModelCall>("ModelCall")[0].state, "INTERRUPTED");
  }));

test("candidate extraction cannot bypass caller source verification", () =>
  withStore(async (store) => {
    const unsupported =
      "I will perform a different action never stated in the source.";
    const quotes = await extract(store, (model) =>
      replyStream(
        [{ type: "text", text: JSON.stringify({ quotes: [unsupported] }) }],
        model,
      ),
    );
    const original = store.put(source);
    const item: WorkItem = {
      item_id: id(),
      tier: "ACTIVE",
      summary: "Candidate only",
      goals: [],
      constraints: [],
      decisions: [],
      open_questions: [],
      unfulfilled_commitments: quotes,
      task_refs: [],
      source_refs: [original],
      last_activity_at: new Date().toISOString(),
      pending_owner: "MAIN",
    };
    const memory = store.all<Consciousness>("Consciousness")[0];
    assert.deepEqual(reconcileCommitments(store, memory, [item], original), []);
  }));

for (const invalid of ["error-on-stop", "tool-on-stop"] as const)
  test(`rejects ${invalid} despite a nominal complete stop`, () =>
    withStore(async (store) => {
      let requests = 0;
      const stream: StreamFn = async (model) => {
        requests++;
        const result = await replyStream(
          [{ type: "text", text: '{"quotes":[]}' }],
          model,
        ).result();
        if (invalid === "error-on-stop")
          result.errorMessage = "synthetic invalid success";
        else
          result.content.push({
            type: "toolCall",
            id: "synthetic",
            name: "do_not_execute",
            arguments: {},
          });
        const response = createAssistantMessageEventStream();
        queueMicrotask(() => {
          response.push({ type: "done", reason: "stop", message: result });
          response.end(result);
        });
        return response;
      };
      await assert.rejects(extract(store, stream), /COMMITMENT_EXTRACTION/);
      assert.equal(requests, 1);
      assert(store.all<ModelCall>("ModelCall")[0].response);
    }));
