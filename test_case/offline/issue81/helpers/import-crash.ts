import fs from "node:fs";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
const [dir, phase, argsFile] = process.argv.slice(2);
const app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
const s = new ApplicationService(app, undefined, {
  attachmentPhase: (at) => {
    if (at === phase) process.kill(process.pid, "SIGKILL");
  },
});
s.command(
  s.principal,
  "attachments/import",
  JSON.parse(fs.readFileSync(argsFile, "utf8")),
);
await s.attachmentImports.settle();
throw Error("expected crash point not reached");
