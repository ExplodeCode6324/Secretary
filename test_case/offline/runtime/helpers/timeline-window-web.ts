// Isolated, synthetic large-history fixture. No model providers or PostgreSQL.
import fs from "node:fs";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { serve } from "../../../../src/pi_secretary/src/backend.ts";
import { base } from "../../../../src/pi_secretary/src/store.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { delayedStream } from "./streaming.ts";
import type { CompactionJob } from "../../../../src/pi_secretary/src/contracts.ts";
const directory = process.argv[2];
if (!directory?.startsWith("/tmp/secretary-window-"))
  throw Error("isolated fixture path required");
const app = await App.open(directory, {
  main: { model: fixtureModel, stream: delayedStream(300) },
  task: { model: fixtureModel, stream: fixtureStream },
});
const count = Number(process.env.WINDOW_SEED ?? 6000);
if (app.store.logs.length < count * 0.9) {
  const scope = {
    session_id: app.host.sessionID,
    task_id: null,
    execution_id: null,
  };
  const source = app.store.put({ synthetic: true });
  for (let i = 0; i < count; i += 100) {
    const jobs: CompactionJob[] = Array.from({ length: 10 }, () => ({
      schema_version: 1,
      record_type: "CompactionJob",
      ...base(),
      state: "COMMITTED",
      session_id: scope.session_id,
      base_revision: 1,
      source_event_ids: [],
      source_refs: [source],
      candidate_ref: null,
      covered_event_ids: [],
      validation_errors: [],
    }));
    const events = Array.from({ length: 90 }, (_, j) =>
      app.store.event(
        "main.message",
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text:
                `synthetic row ${i + j}\n\n` +
                (j % 10 === 0
                  ? "|A|B|\n|-|-|\n|C|D|\n\n```js\nconst synthetic = true;\n```\n"
                  : "Short mixed-history message 中文 😀 ".repeat((j % 5) + 1)),
            },
            { type: "thinking", thinking: "Synthetic visible thought" },
          ],
        },
        scope,
      ),
    );
    app.store.commit(jobs, events);
  }
  app.store.commit(
    [],
    [
      app.store.event(
        "main.message",
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text:
                "LONG_BODY_START\n" +
                "中文😀<script>alert(1)</script>\n".repeat(80000) +
                "LONG_BODY_END",
            },
            {
              type: "thinking",
              thinking: "long visible thought ".repeat(10000),
            },
          ],
        },
        scope,
      ),
    ],
  );
}
const server = await serve(app);
fs.writeFileSync(
  directory + "/browser-endpoint.json",
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
console.log("WINDOW_FIXTURE_READY");
process.on("SIGTERM", () => void server.close().then(() => process.exit()));
