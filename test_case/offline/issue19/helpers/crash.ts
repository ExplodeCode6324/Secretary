import fs from "node:fs";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
import { retryRuntime } from "../../../../src/pi_secretary/src/model-retry.ts";
import type {
  ModelCall,
  Context,
} from "../../../../src/pi_secretary/src/contracts.ts";
const [dir, phase, mode] = process.argv.slice(2);
const count = path.join(dir, "sends.jsonl");
const stream: StreamFn = (m, c, o) => {
  const system = c.messages
    .filter((m) => m.role === "system")
    .map((m) => contentText(m.content))
    .join(" ");
  const kind = system.includes("COMMITMENT_EXTRACTION:")
    ? "extraction"
    : system.includes("CONSCIOUSNESS:")
      ? "summary"
      : "main";
  fs.appendFileSync(count, JSON.stringify({ kind }) + "\n");
  if (phase === "failure" && mode === "crash")
    throw Object.assign(Error("HTTP 529"), { status: 529 });
  if (
    kind === "main" &&
    phase === "tool" &&
    !c.messages.some((m) => m.role === "toolResult")
  )
    return replyStream(
      [
        {
          type: "toolCall",
          id: "notify-once",
          name: "MasterInteract",
          arguments: { message: "synthetic crash notice" },
        },
      ],
      m,
    );
  return fixtureStream(m, c, o);
};
const app = await App.open(dir, { model: fixtureModel, stream });
retryRuntime.set(app.store, {
  wait: async () => {},
  now: () => Date.now() + 100_000,
});
const commit = app.store.commit.bind(app.store);
if (mode === "crash")
  app.store.commit = ((records, ...rest) => {
    const result = commit(records, ...rest);
    for (const r of records)
      if (r.record_type === "ModelCall") {
        const call = r as ModelCall,
          context = app.store.get<Context>("Context", call.context_id);
        const request = JSON.stringify(app.store.read(call.request));
        const target =
          phase === "summary"
            ? request.includes("CONSCIOUSNESS:")
            : phase === "extraction"
              ? request.includes("COMMITMENT_EXTRACTION:")
              : context.purpose === "MAIN";
        if (
          target &&
          (phase === "failure"
            ? call.state === "INTERRUPTED"
            : call.state === "RESPONSE_SAVED")
        )
          process.kill(process.pid, "SIGKILL");
      }
    return result;
  }) as typeof app.store.commit;
if (mode === "crash") app.host.accept("Synthetic crash recovery source.");
await app.host.drain();
if (phase === "summary" || phase === "extraction")
  await app.host.compact(false);
fs.writeFileSync(
  path.join(dir, "result.json"),
  JSON.stringify({
    state: app.host.session.state,
    calls: app.store.all("ModelCall"),
    notifications: app.store.all("Notification"),
    jobs: app.store.all("MemoryExtractionJob"),
    summary: app.host.memoryStatus(),
  }),
);
await app.close();
