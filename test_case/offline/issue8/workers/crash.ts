import fs from "node:fs";
import path from "node:path";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
const [directory, phase, kind] = process.argv.slice(2);
const app = await App.open(directory, {
  model: fixtureModel,
  stream: fixtureStream,
});
const service = new ApplicationService(app);
let route = "messages",
  body: Record<string, unknown> = {
    request_id: id(),
    text: "synthetic crash input",
  };
if (kind === "task") {
  route = "task-requests";
  body = { request_id: id(), goal: "synthetic crash task" };
}
if (kind === "approval") {
  const op = app.authorization.prepare(
    { session_id: app.host.sessionID, task_id: null, execution_id: null },
    "file.write",
    "synthetic.txt",
    { text: "data" },
  );
  const a: any = app.store.get("AuthorizationRequest", op.authorization_id!);
  route = "authorizations/" + a.id + "/decision";
  body = {
    request_id: id(),
    expected_revision: String(a.revision),
    display_hash: a.display_hash,
    decision: "APPROVE",
  };
}
if (kind === "settings") {
  app.settings.save(
    {
      instructions: { content: "Synthetic preference", expected_revision: 1 },
      edits: [],
      command_ids: [],
    },
    app.settings.draft().revision,
  );
  route = "settings/apply";
  body = {
    request_id: id(),
    expected_revision: String(app.settings.draft().revision),
  };
}
fs.writeFileSync(
  path.join(directory, "test-request.json"),
  JSON.stringify({ route, body }),
);
const owner = (app.store as any).owner,
  append = owner.append.bind(owner);
owner.append = (frame: string, digest: string) => {
  const tx = JSON.parse(
    Buffer.from(JSON.parse(frame).payload_b64, "base64").toString(),
  );
  if (tx.mutations.some((m: any) => m.object_type === "ApiCommand")) {
    if (phase === "after") append(frame, digest);
    process.kill(process.pid, "SIGKILL");
  }
  append(frame, digest);
};
service.command(service.principal, route, body);
throw Error("CRASH_NOT_INJECTED");
