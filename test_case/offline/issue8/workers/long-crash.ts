import fs from "node:fs";
import path from "node:path";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
const [directory, phase] = process.argv.slice(2);
const app = await App.open(directory, {
    model: fixtureModel,
    stream: fixtureStream,
  }),
  service = new ApplicationService(app);
const request = { request_id: id() };
fs.writeFileSync(
  path.join(directory, "test-request.json"),
  JSON.stringify(request),
);
const owner = (app.store as any).owner,
  append = owner.append.bind(owner);
owner.append = (frame: string, digest: string) => {
  const tx = JSON.parse(
    Buffer.from(JSON.parse(frame).payload_b64, "base64").toString(),
  );
  append(frame, digest);
  if (
    tx.mutations.some(
      (m: any) =>
        m.object_type === "ApiCommand" &&
        m.new_revision === (phase === "queued" ? 1 : 2),
    )
  )
    process.kill(process.pid, "SIGKILL");
};
service.command(service.principal, "session/compact", request);
