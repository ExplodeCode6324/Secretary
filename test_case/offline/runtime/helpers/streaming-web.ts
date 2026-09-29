// Explicit synthetic browser fixture; no credentials or production data.
import fs from "node:fs";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { serve } from "../../../../src/pi_secretary/src/backend.ts";
import { fixtureModel } from "../../../../src/pi_secretary/src/model.ts";
import { delayedStream } from "./streaming.ts";
const directory = process.argv[2];
if (!directory) throw Error("isolated directory required");
const app = await App.open(directory, {
  model: fixtureModel,
  stream: delayedStream(450, process.argv.includes("--no-thinking")),
});
const server = await serve(app);
fs.writeFileSync(
  directory + "/browser-endpoint.json",
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
console.log("Synthetic streaming fixture ready");
process.on("SIGTERM", () => void server.close().then(() => process.exit()));
