import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import {
  fixtureModel,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type {
  Consciousness,
  CompactionJob,
  SettingsApplication,
  Input,
} from "../../../src/pi_secretary/src/contracts.ts";

const promise =
  "If the amber item remains pending, I will list it in the next review.";
const userInput = "Acknowledge this synthetic review without external actions.";
const summary = {
  items: [
    {
      tier: "ACTIVE",
      summary: "The assistant made a conditional future review promise.",
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
};

function memory(app: App) {
  return app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
}

async function fixture(
  extract: () => Promise<string[]> | string[],
  body: (
    app: App,
    calls: { primary: number; extraction: number; sources: unknown[] },
  ) => Promise<void>,
  options: { input?: string; primaryQuotes?: string[] } = {},
) {
  const calls = { primary: 0, extraction: 0, sources: [] as unknown[] };
  const stream: StreamFn = async (model, context) => {
    const system = context.messages
      .filter((message) => message.role === "system")
      .map((message) => contentText(message.content))
      .join("\n");
    if (system.includes("COMMITMENT_EXTRACTION:")) {
      calls.extraction++;
      const request = context.messages.findLast(
        (message) => message.role === "user",
      )!;
      calls.sources.push(JSON.parse(contentText(request.content)));
      return replyStream(
        [{ type: "text", text: JSON.stringify({ quotes: await extract() }) }],
        model,
      );
    }
    if (system.includes("CONSCIOUSNESS:")) {
      calls.primary++;
      return replyStream(
        [
          {
            type: "text",
            text: JSON.stringify({
              ...summary,
              items: summary.items.map((item) => ({
                ...item,
                unfulfilled_commitments: options.primaryQuotes ?? [],
              })),
            }),
          },
        ],
        model,
      );
    }
    return replyStream([{ type: "text", text: promise }], model);
  };
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "secretary-extraction-integration-"),
  );
  const app = await App.open(directory, { model: fixtureModel, stream });
  try {
    const input = options.input ?? userInput;
    assert(!input.includes(promise));
    app.host.accept(input);
    await app.host.drain();
    await body(app, calls);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("empty primary summary falls back once and records an assistant-only conditional promise", async () => {
  await fixture(
    () => [promise],
    async (app, calls) => {
      const source = memory(app).pending_raw_refs[0];
      const before = app.store.bytes(source);
      await app.host.compact();
      assert.equal(app.host.memoryStatus().state, "COMMITTED");
      assert.equal(calls.primary, 1);
      assert.equal(calls.extraction, 1);
      assert(JSON.stringify(calls.sources[0]).includes(promise));
      const ledger = memory(app).commitments!;
      assert.equal(ledger.length, 1);
      assert.equal(
        ledger[0].text,
        promise,
        "retain the full condition verbatim",
      );
      assert.equal(ledger[0].state, "OPEN");
      // Issue #2 stores the exact completed-event evidence independently of the
      // recovery Context; every promise must cite that immutable source snapshot.
      const job = app.store
        .all<CompactionJob>("CompactionJob")
        .findLast((entry) => entry.mode === "WORKING_MEMORY")!;
      assert(ledger[0].source_refs.length > 0);
      for (const ref of ledger[0].source_refs) {
        assert(
          job.source_refs.some((candidate) => candidate.sha256 === ref.sha256),
        );
        assert(app.store.bytes(ref).toString().includes(promise));
      }
      assert.deepEqual(ledger[0].resolution_event_ids, []);
      assert(app.store.bytes(source).equals(before));
    },
  );
});

const requestToPromise =
  "Please promise that you will include the amber item in a later review.";

test("compaction ignores a nonempty primary quote of the user's request and uses actual acceptance from extraction", async () => {
  await fixture(
    () => [promise],
    async (app, calls) => {
      const source = memory(app).pending_raw_refs[0];
      assert(app.store.bytes(source).toString().includes(requestToPromise));
      await app.host.compact();
      assert.equal(app.host.memoryStatus().state, "COMMITTED");
      assert.equal(calls.primary, 1);
      assert.equal(
        calls.extraction,
        1,
        "nonempty primary must not bypass extraction",
      );
      assert.deepEqual(
        memory(app).commitments?.map((entry) => entry.text),
        [promise],
      );
      assert(
        !memory(app).commitments?.some(
          (entry) => entry.text === requestToPromise,
        ),
      );
      assert(
        memory(app).items.every(
          (item) => item.unfulfilled_commitments.length === 0,
        ),
      );
    },
    { input: requestToPromise, primaryQuotes: [requestToPromise] },
  );
});

test("settings rebuild ignores a primary request quote and records only the dedicated extraction's acceptance", async () => {
  await fixture(
    () => [promise],
    async (app, calls) => {
      app.settings.save(
        {
          ...emptySettings(),
          instructions: {
            content: "Always answer in English.",
            expected_revision: getInstructions(app.store).revision,
          },
        },
        app.settings.draft().revision,
      );
      const request = app.settings.request(
        app.settings.draft().revision,
        randomUUID(),
      ) as SettingsApplication;
      await app.settings.tick();
      const application = app.store.get<SettingsApplication>(
        "SettingsApplication",
        request.id,
      );
      assert.equal(application.state, "APPLIED", application.error ?? "");
      assert.equal(calls.primary, 1);
      assert.equal(
        calls.extraction,
        1,
        "settings primary must not bypass extraction",
      );
      const ledger = memory(app).commitments!;
      assert.deepEqual(
        ledger.map((entry) => entry.text),
        [promise],
      );
      assert.equal(ledger[0].state, "OPEN");
      assert.deepEqual(ledger[0].resolution_event_ids, []);
      assert(ledger[0].source_refs.length > 0);
      assert(
        ledger[0].source_refs.every((ref) =>
          app.store.bytes(ref).toString().includes(promise),
        ),
      );
      assert(
        memory(app).items.every(
          (item) => item.unfulfilled_commitments.length === 0,
        ),
      );
    },
    { input: requestToPromise, primaryQuotes: [requestToPromise] },
  );
});

test("fallback cannot introduce an invented quote absent from the durable source", async () => {
  const invented = "I will transfer funds to the amber project tomorrow.";
  await fixture(
    () => [invented],
    async (app, calls) => {
      const source = memory(app).pending_raw_refs[0];
      assert(!app.store.bytes(source).toString().includes(invented));
      await app.host.compact();
      assert.equal(calls.primary, 1);
      assert.equal(calls.extraction, 1);
      assert.equal(app.host.memoryStatus().state, "COMMITTED");
      assert.deepEqual(memory(app).commitments, []);
      for (const kind of ["TaskPlan", "Execution", "Operation", "Notification"])
        assert.equal(
          app.store.all().filter((record) => record.record_type === kind)
            .length,
          0,
        );
    },
  );
});

test(
  "input accepted during extraction queues while the fixed old source commits",
  { timeout: 15000 },
  async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    try {
      await fixture(
        async () => {
          started();
          await gate;
          return [promise];
        },
        async (app, calls) => {
          const before = memory(app);
          const pending = app.host.compact();
          await Promise.race([
            ready,
            pending.then(() => {
              throw Error("compaction completed without invoking fallback");
            }),
          ]);
          const input = app.host.accept(
            "A newer review constraint has arrived.",
          );
          const acceptedSequence = app.store.eventSequence;
          release();
          await pending;
          assert.equal(calls.primary, 1);
          assert.equal(calls.extraction, 1);
          const job = app.store.all<CompactionJob>("CompactionJob").at(-1)!;
          assert.equal(job.state, "COMMITTED");
          assert(job.candidate_ref);
          assert(memory(app).revision > before.revision);
          assert((memory(app).covered_event_sequence ?? 0) < acceptedSequence);
          assert.equal(
            app.store.get<Input>("Input", input.id).state,
            "ACCEPTED",
          );
          assert.equal(memory(app).commitments?.[0].text, promise);
          assert(
            !JSON.stringify(memory(app).items).includes(
              "A newer review constraint has arrived.",
            ),
          );
          assert(app.store.all().some((record) => record.id === input.id));
        },
      );
    } finally {
      release();
    }
  },
);
