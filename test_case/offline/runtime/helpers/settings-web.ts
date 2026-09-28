// Isolated, explicitly launched fixture server for browser acceptance. Never uses production data.
import fs from "node:fs";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { serve } from "../../../../src/pi_secretary/src/backend.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
const directory = process.argv[2];
if (!directory || !process.env.SECRETARY_TEST_DATABASE_URL)
  throw Error("isolated directory and test database required");
const app = await App.open(
  directory,
  { model: fixtureModel, stream: fixtureStream },
  process.env.SECRETARY_TEST_DATABASE_URL,
);
await app.world!.migrate();
const server = await serve(app);
fs.writeFileSync(
  directory + "/browser-endpoint.json",
  JSON.stringify(server.endpoint),
  { mode: 0o600 },
);
console.log(server.endpoint.url);
process.on("SIGTERM", () => void server.close().then(() => process.exit()));
