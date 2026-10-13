import assert from "node:assert/strict";
import { contentText } from "@earendil-works/pi-ai";
import {
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import { emptySettings } from "../../../src/pi_secretary/src/settings-payload.ts";
import { getInstructions } from "../../../src/pi_secretary/src/instructions.ts";
import { base, id, revise } from "../../../src/pi_secretary/src/store.ts";
import { inputMessage } from "../../../src/pi_secretary/src/input-projection.ts";
import type { App } from "../../../src/pi_secretary/src/app.ts";
import type {
  CompactionJob,
  Consciousness,
  Input,
  SettingsApplication,
} from "../../../src/pi_secretary/src/contracts.ts";
export { scenario } from "../issue21/helpers.ts";
export const shortStream: StreamFn = (m, c, o) =>
  c.messages.some(
    (v) =>
      v.role === "system" &&
      /CONSCIOUSNESS|COMMITMENT_EXTRACTION/.test(contentText(v.content)),
  )
    ? fixtureStream(m, c, o)
    : replyStream([{ type: "text", text: "done" }], m);
export const memory = (app: App) =>
  app.store.get<Consciousness>(
    "Consciousness",
    app.host.session.consciousness_id,
  );
export async function turn(app: App, text: string) {
  app.host.accept(text);
  await app.host.drain();
  assert.equal(
    app.host.session.state,
    "IDLE",
    app.host.session.recovery_error ?? "",
  );
}
export async function apply(app: App) {
  app.settings.save(
    {
      ...emptySettings(),
      instructions: {
        content: `Answer concisely. Activation ${app.settings.applications().length}.`,
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
  const result = app.store.get<SettingsApplication>(
    "SettingsApplication",
    request.id,
  );
  assert.equal(result.state, "APPLIED", result.error ?? "");
  return result;
}
// Contract-valid owner fixtures isolate qualification from SQL/model behavior. Integration tests use real Host jobs.
export function covered(
  app: App,
  texts: string[],
  state: "COMMITTED" | "FAILED" | "STALE" = "COMMITTED",
) {
  const sourceIDs: string[] = [];
  const messages = texts.map((text) => {
    const input = app.host.accept(text);
    app.store.commit([
      revise(app.store.get<Input>("Input", input.id), {
        state: "CLAIMED",
        loop_id: id(),
      }),
    ]);
    const handled = revise(app.store.get<Input>("Input", input.id), {
      state: "HANDLED",
    });
    app.store.commit([handled]);
    const message = inputMessage(app.store, handled);
    const event = app.store.event(
      "main.message",
      message,
      { session_id: app.host.sessionID, task_id: null, execution_id: null },
      "MAIN",
    );
    app.store.commit([], [event]);
    sourceIDs.push(event.event_id);
    return message;
  });
  const cs = memory(app),
    ref = app.store.put(messages);
  const job: CompactionJob = {
    schema_version: 1,
    record_type: "CompactionJob",
    ...base(),
    session_id: app.host.sessionID,
    state,
    base_revision: cs.revision,
    source_refs: [ref],
    source_event_ids: sourceIDs,
    covered_event_ids: state === "COMMITTED" ? sourceIDs : [],
    candidate_ref: state === "COMMITTED" ? app.store.put({ items: [] }) : null,
    validation_errors: [],
    mode: "WORKING_MEMORY",
    source_end_sequence: app.store.eventSequence,
  };
  app.store.commit([job]);
  return messages;
}
