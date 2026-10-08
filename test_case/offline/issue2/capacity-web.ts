// Independent synthetic acceptance server. Never opens the deployed data directory.
import fs from "node:fs";
import { App } from "../../../src/pi_secretary/src/app.ts";
import { serve } from "../../../src/pi_secretary/src/backend.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
const directory = process.argv[2];
if (!directory || !directory.startsWith("/tmp/secretary-issue2-capacity-"))
  throw Error("isolated capacity fixture directory required");
const app = await App.open(directory, {
  model: { ...fixtureModel, contextWindow: 1_000_000, maxTokens: 65536 },
  stream: fixtureStream,
});
const server = await serve(app);
for (const file of ["browser-endpoint.json", "ui-endpoint.json"])
  fs.writeFileSync(directory + "/" + file, JSON.stringify(server.endpoint), {
    mode: 0o600,
  });
console.log("CAPACITY_FIXTURE_READY");
process.on("SIGTERM", () => void server.close().then(() => process.exit()));
