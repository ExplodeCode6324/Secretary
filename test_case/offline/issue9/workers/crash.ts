import { App } from "../../../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../../../src/pi_secretary/src/api-v1.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
const app = await App.open(process.argv[2], {
  model: fixtureModel,
  stream: fixtureStream,
});
const core = await serveCore(app, 0, undefined, { pump: false });
process.send?.({
  phase: "ready",
  endpoint: core.endpoint,
  cursor: core.service.changes.current().cursor,
});
process.on("message", (message) => {
  if (message !== "commit") return;
  const receipt = core.service.command(core.service.principal, "messages", {
    request_id: id(),
    text: "Synthetic post-commit/pre-SSE crash",
  });
  process.send?.({
    phase: "committed",
    request: receipt.request_id,
    cursor: core.service.changes.current().cursor,
  });
  // Hold the event loop before the stream's persisted read loop can write.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
});
