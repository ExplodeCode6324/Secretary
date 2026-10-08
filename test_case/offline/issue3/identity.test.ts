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
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import {
  settingsSource,
  summarizeSettings,
} from "../../../src/pi_secretary/src/settings-memory.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import { extractNewCommitments } from "../../../src/pi_secretary/src/memory-extraction.ts";
import { messageIdentityHash } from "../../../src/pi_secretary/src/message-identity.ts";
import type { AgentMessage } from "../../../src/pi_secretary/src/model.ts";
import type { SettingsApplication } from "../../../src/pi_secretary/src/contracts.ts";

const answer = "Synthetic assistant review. ".repeat(615);
const input = "Synthetic user material. ".repeat(460);
const summary = {
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
};
async function fixture(
  body: (f: {
    app: App;
    reopen: () => Promise<App>;
    calls: { sources: { id: string; text: string; role: string }[][] };
    fail: (value: boolean) => void;
  }) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue3-identity-"));
  const calls = {
    sources: [] as { id: string; text: string; role: string }[][],
  };
  let failure = true;
  const stream: StreamFn = (model, context) => {
    const system = context.messages
      .filter((m) => m.role === "system")
      .map((m) => contentText(m.content))
      .join("\n");
    let text = answer;
    if (system.includes("CONSCIOUSNESS:")) text = JSON.stringify(summary);
    if (system.includes("COMMITMENT_EXTRACTION:")) {
      calls.sources.push(
        JSON.parse(contentText(context.messages.at(-1)!.content)).source,
      );
      text = failure ? "invalid json" : '{"quotes":[]}';
    }
    return replyStream([{ type: "text", text }], model);
  };
  let app = await App.open(dir, { model: fixtureModel, stream });
  try {
    app.host.accept(input);
    await app.host.drain();
    await body({
      app,
      calls,
      fail: (value) => {
        failure = value;
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
async function failSettings(app: App) {
  app.settings.save(
    {
      ...emptySettings(),
      instructions: {
        content: "Synthetic instruction.",
        expected_revision: getInstructions(app.store).revision,
      },
    },
    app.settings.draft().revision,
  );
  const request = app.settings.request(
    app.settings.draft().revision,
    id(),
  ) as SettingsApplication;
  await app.settings.tick();
  assert.equal(
    app.store.get<SettingsApplication>("SettingsApplication", request.id).state,
    "FAILED",
  );
  return request.id;
}

test("settings uses exactly the main event IDs despite assistant display metadata", () =>
  fixture(async ({ app }) => {
    const events = app.store.logs.filter(
      (e) =>
        e.event_type === "main.message" &&
        e.scope.session_id === app.host.sessionID,
    );
    const source = settingsSource(app.host, { world: [], instructions: null });
    assert.deepEqual(
      source.extraction_messages.map((m) => m.id).sort(),
      events.map((e) => e.event_id).sort(),
    );
  }));

test("failed settings extraction blocks main maintenance, explicit retries and restart", () =>
  fixture(async ({ app, calls, fail, reopen }) => {
    const applicationID = await failSettings(app);
    assert.equal(calls.sources.length, 1);
    fail(false);
    const previousTurns = process.env.SECRETARY_MEMORY_UPDATE_TURNS;
    process.env.SECRETARY_MEMORY_UPDATE_TURNS = "1";
    try {
      app.host.maintainIfNeeded();
      await app.host.compact(); // Wait for the maintenance started by the scheduler boundary.
    } finally {
      if (previousTurns === undefined)
        delete process.env.SECRETARY_MEMORY_UPDATE_TURNS;
      else process.env.SECRETARY_MEMORY_UPDATE_TURNS = previousTurns;
    }
    assert.equal(
      calls.sources.length,
      1,
      "automatic maintenance must not replay a failed settings source",
    );
    await app.host.compact();
    assert.equal(
      calls.sources.length,
      1,
      "explicit compact does not override the durable extraction stop",
    );
    app.settings.retry(applicationID);
    await app.settings.tick();
    assert.equal(
      calls.sources.length,
      1,
      "settings retry does not override the durable extraction stop",
    );
    const retried = app.store.get<SettingsApplication>(
      "SettingsApplication",
      applicationID,
    );
    assert.equal(retried.state, "FAILED");
    assert.match(retried.error ?? "", /REPLAY_BLOCKED/);
    app = await reopen();
    await app.host.compact();
    assert.equal(
      calls.sources.length,
      1,
      "restart retains source-level failure protection",
    );
    assert.equal(app.host.memoryStatus().state, "FAILED");
  }));

test("successful settings extraction is reused by main across a restart", () =>
  fixture(async ({ app, calls, fail, reopen }) => {
    fail(false);
    const source = settingsSource(app.host, { world: [], instructions: null });
    await summarizeSettings(app.host, id(), source, null, () => {});
    const count = calls.sources.length;
    assert(count > 0);
    app = await reopen();
    await app.host.compact();
    assert.equal(
      calls.sources.length,
      count,
      "main must reuse the same successful event sources",
    );
    assert.equal(app.host.memoryStatus().state, "COMMITTED");
  }));

test("settings retains equal text in distinct durable events", () =>
  fixture(async ({ app }) => {
    const scope = {
      session_id: app.host.sessionID,
      task_id: null,
      execution_id: null,
    };
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "Identical synthetic text" }],
      timestamp: 123,
    };
    const first = app.store.event(
      "main.message",
      { ...message, display_call_id: "first" },
      scope,
    );
    const second = app.store.event(
      "main.message",
      { ...message, display_call_id: "second" },
      scope,
    );
    app.store.commit([], [first, second]);
    const source = settingsSource(app.host, { world: [], instructions: null });
    assert.deepEqual(
      source.extraction_messages
        .filter((m) => m.text === "Identical synthetic text")
        .map((m) => m.id),
      [first.event_id, second.event_id],
    );
  }));

for (const succeeded of [false, true])
  test(`pre-fix settings ${succeeded ? "success is reused" : "failure stays blocked"} after retry clears the current source`, () =>
    fixture(async ({ app, calls, fail, reopen }) => {
      fail(!succeeded);
      const source = settingsSource(app.host, {
        world: [],
        instructions: null,
      });
      const assistant = source.extraction_messages.find(
        (m) => m.role === "assistant",
      )!;
      const event = app.store.logs.find((e) => e.event_id === assistant.id)!;
      const raw = app.store.read<AgentMessage>(event.payload);
      const legacy = { ...assistant, id: messageIdentityHash(raw) + ":1" };
      const frozen = {
        ...source,
        extraction_messages: [legacy, ...source.extraction_messages],
      };
      app.settings.save(
        {
          ...emptySettings(),
          instructions: {
            content: "Synthetic upgrade instruction",
            expected_revision: getInstructions(app.store).revision,
          },
        },
        app.settings.draft().revision,
      );
      const request = app.settings.request(
        app.settings.draft().revision,
        id(),
      ) as SettingsApplication;
      app.store.commit([
        revise(request, {
          state: "SUMMARIZING",
          source_ref: app.store.put(frozen),
        }),
      ]);
      const extraction = extractNewCommitments({
        store: app.store,
        model: fixtureModel,
        stream: app.host.stream,
        sessionID: app.host.sessionID,
        loopID: request.id,
        consciousnessRevision: 1,
        source: null,
        existing: [],
        completeMessages: [legacy],
      });
      if (succeeded) await extraction;
      else await assert.rejects(extraction);
      app.store.commit([
        revise(
          app.store.get<SettingsApplication>("SettingsApplication", request.id),
          {
            state: "FAILED",
            error: "Synthetic pre-upgrade failure",
            source_ref: null,
          },
        ),
      ]);
      assert.equal(calls.sources.length, 1);
      fail(false);
      app = await reopen();
      await app.host.compact();
      assert.equal(calls.sources.length, succeeded ? 2 : 1);
      if (succeeded) {
        assert(
          calls.sources[1].every((m) => m.role !== "assistant"),
          "reuse legacy assistant success rather than extracting it again",
        );
        assert.equal(app.host.memoryStatus().state, "COMMITTED");
      } else {
        assert.equal(app.host.memoryStatus().state, "FAILED");
        app.settings.retry(request.id);
        await app.settings.tick();
        assert.equal(calls.sources.length, 1);
      }
    }));

test("equal-text events have independent extraction outcomes", () =>
  fixture(async ({ app, calls, fail }) => {
    const scope = {
      session_id: app.host.sessionID,
      task_id: null,
      execution_id: null,
    };
    const message = {
      role: "user" as const,
      content: "Identical event text",
      timestamp: 123,
    };
    const first = app.store.event("main.message", message, scope),
      second = app.store.event("main.message", message, scope);
    app.store.commit([], [first, second]);
    const source = settingsSource(app.host, { world: [], instructions: null });
    const options = {
      store: app.store,
      model: fixtureModel,
      stream: app.host.stream,
      sessionID: app.host.sessionID,
      loopID: id(),
      consciousnessRevision: 1,
      source: null,
      existing: [],
    };
    await assert.rejects(
      extractNewCommitments({
        ...options,
        completeMessages: source.extraction_messages.filter(
          (m) => m.id === first.event_id,
        ),
      }),
    );
    fail(false);
    await extractNewCommitments({
      ...options,
      loopID: id(),
      completeMessages: source.extraction_messages.filter(
        (m) => m.id === second.event_id,
      ),
    });
    assert.equal(calls.sources.length, 2);
    assert.equal(calls.sources[1][0].id, second.event_id);
  }));

for (const extra of ["event", "snapshot"])
  test(`legacy identity ambiguity stops extraction with an extra ${extra}`, () =>
    fixture(async ({ app, calls, fail }) => {
      const source = settingsSource(app.host, {
        world: [],
        instructions: null,
      });
      const assistant = source.extraction_messages.find(
        (m) => m.role === "assistant",
      )!;
      const event = app.store.logs.find((e) => e.event_id === assistant.id)!;
      const raw = app.store.read<AgentMessage>(event.payload);
      const legacy = { ...assistant, id: messageIdentityHash(raw) + ":1" };
      let extraMessage;
      if (extra === "event") {
        const second = app.store.event("main.message", raw, event.scope);
        app.store.commit([], [second]);
        extraMessage = { ...assistant, id: second.event_id };
      } else extraMessage = { ...legacy, id: messageIdentityHash(raw) + ":2" };
      const frozen = {
        ...source,
        end_sequence: app.store.eventSequence,
        extraction_messages: [
          legacy,
          extraMessage,
          ...source.extraction_messages,
        ],
      };
      app.settings.save(
        {
          ...emptySettings(),
          instructions: {
            content: "Synthetic upgrade instruction",
            expected_revision: getInstructions(app.store).revision,
          },
        },
        app.settings.draft().revision,
      );
      const request = app.settings.request(
        app.settings.draft().revision,
        id(),
      ) as SettingsApplication;
      app.store.commit([
        revise(request, {
          state: "SUMMARIZING",
          source_ref: app.store.put(frozen),
        }),
      ]);
      const options = {
        store: app.store,
        model: fixtureModel,
        stream: app.host.stream,
        sessionID: app.host.sessionID,
        loopID: request.id,
        consciousnessRevision: 1,
        source: null,
        existing: [],
      };
      await assert.rejects(
        extractNewCommitments({
          ...options,
          completeMessages: [extra === "snapshot" ? extraMessage : legacy],
        }),
      );
      fail(false);
      await assert.rejects(
        extractNewCommitments({
          ...options,
          loopID: id(),
          completeMessages: [assistant],
        }),
        /LEGACY_IDENTITY_AMBIGUOUS/,
      );
      assert.equal(calls.sources.length, 1);
    }));
