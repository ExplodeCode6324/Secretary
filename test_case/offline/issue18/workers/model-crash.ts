import fs from "node:fs";
import path from "node:path";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
const [dir, phase] = process.argv.slice(2);
const once = path.join(dir, "killed");
const kill = () => {
  fs.writeFileSync(once, "yes");
  process.kill(process.pid, "SIGKILL");
};
const stream: StreamFn = (model, context, options) => {
  fs.appendFileSync(path.join(dir, "sends"), "x");
  if (phase === "in-flight" && !fs.existsSync(once)) kill();
  if (
    phase === "tool-saved" &&
    !context.messages.some((m) => m.role === "toolResult")
  )
    return replyStream(
      [
        {
          type: "toolCall",
          id: "read-once",
          name: "read",
          arguments: { path: "evidence.txt" },
        },
      ],
      model,
    );
  return fixtureStream(model, context, options);
};
const app = await App.open(dir, { model: fixtureModel, stream });
if (["response-saved", "tool-saved"].includes(phase) && !fs.existsSync(once)) {
  const commit = app.store.commit.bind(app.store);
  app.store.commit = ((...args: Parameters<typeof commit>) => {
    const result = commit(...args);
    if (
      args[0]?.some(
        (r) =>
          phase === "response-saved" &&
          r.record_type === "ModelCall" &&
          r.state === "RESPONSE_SAVED",
      ) ||
      (phase === "tool-saved" &&
        args[1]?.some((r) => r.event_type === "executor.tool.result"))
    )
      kill();
    return result;
  }) as typeof commit;
}
if (!app.store.all("TaskPlan").length) {
  const p = app.scheduler.propose(
    "Synthetic complete task",
    id(),
    app.host.sessionID,
  );
  fs.writeFileSync(
    path.join(dir, "workspaces", p.id, "work", "evidence.txt"),
    "original evidence",
  );
}
app.scheduler.tick();
await app.scheduler.idle();
fs.writeFileSync(
  path.join(dir, "states"),
  JSON.stringify(app.store.all("Execution")),
);
fs.writeFileSync(
  path.join(dir, "tool-count"),
  String(
    app.store.logs.filter(
      (l) =>
        l.event_type === "executor.tool.result" &&
        app.store.read<any>(l.payload).key.includes(":read:"),
    ).length,
  ),
);
await app.close();
