import fs from "node:fs";
import path from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
import type { Input } from "../../../../src/pi_secretary/src/contracts.ts";

const [directory, kind, phase] = process.argv.slice(2);
let timerID = "";
const at = new Date(Date.now() + 60000).toISOString();
const stream: StreamFn = (model, context, options) => {
  const last = context.messages.at(-1);
  if (last?.role === "user" && contentText(last.content) === "run wakeup tool")
    return replyStream(
      [
        {
          type: "toolCall",
          id: "synthetic-wakeup-tool",
          name: kind === "schedule" ? "schedule_wakeup" : "cancel_wakeup",
          arguments:
            kind === "schedule"
              ? { at, note: "synthetic recovery" }
              : { timer_id: timerID },
        },
      ],
      model,
    );
  return fixtureStream(model, context, options);
};
const app = await App.open(directory, { model: fixtureModel, stream });
const source = app.host.accept("synthetic source");
const sources = app.store.logs
  .filter(
    (e) =>
      e.event_type === "input.accepted" &&
      app.store.read<Input>(e.payload).id === source.id,
  )
  .map((e) => e.event_id);
await app.settle();
if (kind !== "schedule") {
  timerID = app.host.wakeups.schedule(
    id(),
    {
      at: kind === "fire" ? new Date(Date.now() + 100).toISOString() : at,
      note: "synthetic recovery",
    },
    sources,
  ).timer_id;
  if (kind === "noop") app.host.wakeups.cancel(timerID);
}
const requestID = id();
fs.writeFileSync(
  path.join(directory, "case.json"),
  JSON.stringify({ kind, phase, timerID, requestID }),
);
const owner = (app.store as any).owner,
  append = owner.append.bind(owner);
owner.append = (frame: string, digest: string) => {
  const tx = JSON.parse(
    Buffer.from(JSON.parse(frame).payload_b64, "base64").toString(),
  );
  const target =
    kind === "fire"
      ? tx.mutations.some((m: any) => m.object_type === "Input")
      : kind === "api"
        ? tx.mutations.some((m: any) => m.object_type === "ApiCommand")
        : tx.receipts.length > 0;
  if (target) {
    if (phase === "after") append(frame, digest);
    process.kill(process.pid, "SIGKILL");
  }
  append(frame, digest);
};
if (kind === "fire") {
  await new Promise((resolve) => setTimeout(resolve, 150));
  app.host.wakeups.fireDue();
} else if (kind === "api") {
  const service = new ApplicationService(app);
  service.command(service.principal, "wakeups/" + timerID + "/cancel", {
    request_id: requestID,
  });
} else {
  // Accept before installing receipt-based crash injection for the tool itself.
  owner.append = append;
  app.host.accept("run wakeup tool");
  owner.append = (frame: string, digest: string) => {
    const tx = JSON.parse(
      Buffer.from(JSON.parse(frame).payload_b64, "base64").toString(),
    );
    if (tx.receipts.length) {
      if (phase === "after") append(frame, digest);
      process.kill(process.pid, "SIGKILL");
    }
    append(frame, digest);
  };
  await app.settle();
}
throw Error("CRASH_NOT_INJECTED");
