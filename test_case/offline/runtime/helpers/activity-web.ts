// Isolated synthetic server for browser/PTY acceptance. No production credentials.
import fs from "node:fs";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { serve } from "../../../../src/pi_secretary/src/backend.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
import { delayedStream } from "./streaming.ts";
import { revise, base } from "../../../../src/pi_secretary/src/store.ts";
import type { CompactionJob } from "../../../../src/pi_secretary/src/contracts.ts";
import type { Consciousness } from "../../../../src/pi_secretary/src/contracts.ts";
const directory = process.argv[2];
if (!directory) throw Error("isolated directory required");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stream: StreamFn = async (m, c, o) => {
  const system = c.messages
    .filter((x) => x.role === "system")
    .map((x) => contentText(x.content))
    .join();
  if (
    system.includes("CONSCIOUSNESS") ||
    system.includes("COMMITMENT_EXTRACTION")
  ) {
    await wait(700);
    return fixtureStream(m, c, o);
  }
  if (c.messages.at(-1)?.role === "toolResult") return fixtureStream(m, c, o);
  const text = contentText(c.messages.at(-1)?.content ?? []);
  if (text.includes("query-memory"))
    return replyStream([
      {
        type: "toolCall",
        id: crypto.randomUUID(),
        name: "memory_read",
        arguments: { source: "consciousness" },
      },
    ]);
  return delayedStream(300)(m, c, o);
};
let calls = 0;
const taskStream: StreamFn = async (m, c, o) => {
  await wait(++calls === 1 ? 5500 : 8500);
  return fixtureStream(m, c, o);
};
const app = await App.open(directory, {
  // Leave room for the complete synthetic user message and retained input anchors.
  main: { model: { ...fixtureModel, contextWindow: 131072 }, stream },
  task: { model: fixtureModel, stream: taskStream },
});
// Seed enough synthetic source to exercise real multi-chunk settings work.
const cs = app.store.get<Consciousness>(
  "Consciousness",
  app.host.session.consciousness_id,
);
if (!app.host.session.last_context_id) {
  app.host.accept("synthetic setup");
  await app.host.drain();
  app.store.commit([
    revise(app.store.get<Consciousness>("Consciousness", cs.id), {
      pending_raw_refs: [
        app.store.put([
          {
            role: "user",
            content: "synthetic history ".repeat(1700),
            timestamp: 1,
          },
        ]),
      ],
    }),
  ]);
}
if (
  process.env.TIMELINE_HISTORY_SEED === "1" &&
  !app.store.all<CompactionJob>("CompactionJob").length
) {
  const source = app.store.put({ synthetic: true });
  const jobs: CompactionJob[] = Array.from({ length: 80 }, () => ({
    schema_version: 1,
    record_type: "CompactionJob",
    ...base(),
    state: "COMMITTED",
    session_id: app.host.sessionID,
    base_revision: 1,
    source_event_ids: [],
    source_refs: [source],
    candidate_ref: null,
    covered_event_ids: [],
    validation_errors: [],
  }));
  app.store.commit(jobs);
}
const server = await serve(app);
fs.writeFileSync(
  directory + "/browser-endpoint.json",
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
fs.writeFileSync(
  directory + "/ui-endpoint.json",
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
console.log("ACTIVITY_FIXTURE_READY");
process.on("SIGTERM", () => void server.close().then(() => process.exit()));
