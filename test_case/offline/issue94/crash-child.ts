// Child-process crash fixture: abrupt exit after/before a durable Main message commit.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createAssistantMessageEventStream,
  contentText,
} from "@earendil-works/pi-ai";
const [source, root, phase, reason, withArtifact = "yes"] =
  process.argv.slice(2);
const mod = (file: string) =>
  import(pathToFileURL(path.join(source, "src/pi_secretary/src", file)).href);
const { App } = await mod("app.ts"),
  { fixtureModel, fixtureStream, replyStream } = await mod("model.ts"),
  { id, base } = await mod("store.ts");
const stream = (m: any, c: any) => {
  if (
    c.messages.some(
      (v: any) =>
        v.role === "system" &&
        contentText(v.content).includes("COMMITMENT_EXTRACTION:"),
    )
  )
    return fixtureStream(m, c);
  const out = createAssistantMessageEventStream();
  void replyStream([{ type: "text", text: "crash fixture final" }], m)
    .result()
    .then((message: any) => {
      message.stopReason = reason;
      out.push({ type: "done", reason: reason as "stop" | "length", message });
      out.end(message);
    });
  return out;
};
const app = await App.open(root, {
  main: { model: fixtureModel, stream },
  task: { model: fixtureModel, stream: fixtureStream },
});
if (phase !== "recover") {
  app.scheduler.propose("crash fixture", id(), app.host.sessionID);
  app.scheduler.tick();
  await app.scheduler.idle();
  if (withArtifact === "yes") {
    const old = app.store.all("TaskResult")[0],
      f = app.store.all("Feedback").find((f: any) => f.result_id === old.id);
    const result = {
      ...old,
      ...base(),
      artifacts: [
        {
          artifact_id: id(),
          name: "report.txt",
          workspace_path: "report.txt",
          content: app.store.put("snapshot", "text/plain"),
          producing_operation_id: null,
        },
      ],
    };
    app.store.commit([
      result,
      { ...f, ...base(), result_id: result.id, input_id: null },
    ]);
  }
  const commit = app.store.commit.bind(app.store);
  app.store.commit = (...args: any[]) => {
    const terminal = args[1]?.some(
      (e: any) =>
        e.event_type === "main.message" &&
        app.store.read(e.payload).role === "assistant",
    );
    if (terminal && phase === "before") process.exit(77);
    const result = commit(...args);
    if (terminal && phase === "after") process.exit(77);
    return result;
  };
  await app.host.drain();
  throw Error("CRASH_NOT_REACHED");
}
const snapshots = [];
for (let i = 0; i < 3; i++) {
  await app.host.resume();
  snapshots.push({
    state: app.host.session.state,
    inputs: app.store.all("Input").map((i: any) => i.state),
    deliveries: app.store.logs.filter(
      (e: any) => e.event_type === "main.delivery",
    ).length,
  });
}
fs.writeFileSync(
  path.join(root, "crash-observation.json"),
  JSON.stringify(snapshots, null, 2),
);
await app.close();
