// Child-only process crash fixture; all inputs/tools/results are synthetic.
import fs from "node:fs";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type AgentMessage,
  type StreamFn,
} from "../../../src/pi_secretary/src/model.ts";
import type { Context } from "../../../src/pi_secretary/src/contracts.ts";
const [directory, boundary, phase] = process.argv.slice(2);
if (
  !directory?.startsWith("/tmp/secretary-issue2-kill-") ||
  !["compaction", "receipt"].includes(boundary) ||
  !["crash", "recover"].includes(phase)
)
  throw Error("isolated kill fixture arguments required");
process.env.SECRETARY_MEMORY_UPDATE_TURNS = "1";
let work = fs.existsSync(directory + "/seeded.json");
const model = { ...fixtureModel, contextWindow: 49152, maxTokens: 65536 };
const stream: StreamFn = (m, c, o) => {
  const system = c.messages
    .filter((x) => x.role === "system")
    .map((x) => contentText(x.content))
    .join("\n");
  if (
    system.includes("CONSCIOUSNESS") ||
    system.includes("COMMITMENT_EXTRACTION")
  )
    return fixtureStream(m, c, o);
  if (!work)
    return replyStream(
      [
        {
          type: "text",
          text: "Synthetic historical assistant: " + "x".repeat(26000),
        },
      ],
      m,
    );
  const results = c.messages.filter((x) => x.role === "toolResult");
  if (results.length < 2)
    return replyStream(
      [
        {
          type: "toolCall",
          id: "kill-query-" + results.length,
          name: "task_query",
          arguments: {},
        },
      ],
      m,
    );
  return replyStream(
    [{ type: "text", text: "Synthetic recovered after two tool rounds" }],
    m,
  );
};
const app = await App.open(directory, { model, stream });
app.scheduler.query = (() => {
  fs.appendFileSync(directory + "/queries.log", "executed\n");
  return { synthetic: "small durable result" };
}) as unknown as typeof app.scheduler.query;
if (!work) {
  app.host.accept("Synthetic old seed; retain this exact Master anchor.");
  await app.host.drain();
  if (app.host.memoryStatus().state !== "COMMITTED")
    throw Error(
      "seed memory did not commit: " + JSON.stringify(app.host.memoryStatus()),
    );
  fs.writeFileSync(directory + "/seeded.json", JSON.stringify({ seed: true }));
  work = true;
}
const commit = app.store.commit.bind(app.store);
app.store.commit = ((records, events = [], receipt) => {
  const result = commit(records, events, receipt);
  if (phase === "crash") {
    const cropped =
      boundary === "compaction" &&
      events.some((e) => e.event_type === "context.compacted");
    const tool =
      boundary === "receipt" &&
      events.some((e) => e.event_type === "main.tool.result") &&
      app.store.logs.filter((e) => e.event_type === "main.tool.result")
        .length === 2;
    if (cropped || tool) {
      const cp = app.store.get<Context>(
        "Context",
        app.host.session.last_context_id!,
      );
      const messages = app.store.read<AgentMessage[]>(cp.raw_context);
      fs.writeFileSync(
        directory + "/crash.json",
        JSON.stringify({
          boundary,
          session: app.host.session,
          checkpoint: cp.id,
          protected_from_index: cp.protected_from_index,
          canonicalLength: messages.length,
          canonicalBytes: cp.raw_context.bytes,
          toolIndices: messages.flatMap((m, i) =>
            m.role === "assistant" &&
            m.content.some((p) => p.type === "toolCall")
              ? [i]
              : [],
          ),
          toolKeys: app.store.logs
            .filter((e) => e.event_type === "main.tool.result")
            .map((e) => app.store.read<{ key: string }>(e.payload).key),
        }),
      );
      process.kill(process.pid, "SIGKILL");
    }
  }
  return result;
}) as typeof app.store.commit;
try {
  if (phase === "crash")
    app.host.accept(
      "Synthetic active loop: query twice and retain the amber condition.",
    );
  await app.host.drain();
  const cp = app.store.get<Context>(
    "Context",
    app.host.session.last_context_id!,
  );
  const canonical = app.store.read<AgentMessage[]>(cp.raw_context);
  const requests = app.store
    .all<Context>("Context")
    .filter((c) => c.capture_kind === "MODEL_REQUEST" && c.purpose === "MAIN");
  fs.writeFileSync(
    directory + "/result-" + phase + ".json",
    JSON.stringify({
      state: app.host.session.state,
      error: app.host.session.recovery_error,
      canonicalLength: canonical.length,
      canonicalBytes: cp.raw_context.bytes,
      protected_from_index: cp.protected_from_index,
      canonicalHasOldAssistant: JSON.stringify(canonical).includes(
        "x".repeat(26000),
      ),
      canonicalHasAnchor: JSON.stringify(canonical).includes(
        "retain this exact Master anchor",
      ),
      toolIndices: canonical.flatMap((m, i) =>
        m.role === "assistant" && m.content.some((p) => p.type === "toolCall")
          ? [i]
          : [],
      ),
      requests: requests.map((c) => ({
        loop: c.loop_id,
        source: c.source_context_id,
        id: c.id,
        length: c.messages.length,
        bytes: c.raw_context.bytes,
        hasOldAssistant: JSON.stringify(app.store.read(c.raw_context)).includes(
          "x".repeat(26000),
        ),
        hasAnchor: JSON.stringify(app.store.read(c.raw_context)).includes(
          "retain this exact Master anchor",
        ),
      })),
      toolKeys: app.store.logs
        .filter((e) => e.event_type === "main.tool.result")
        .map((e) => app.store.read<{ key: string }>(e.payload).key),
      queryCount: fs.existsSync(directory + "/queries.log")
        ? fs
            .readFileSync(directory + "/queries.log", "utf8")
            .trim()
            .split("\n").length
        : 0,
    }),
  );
} finally {
  await app.close();
}
