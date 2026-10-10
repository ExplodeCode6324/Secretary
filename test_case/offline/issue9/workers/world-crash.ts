import fs from "node:fs";
import path from "node:path";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
const [directory, dsn, phase] = process.argv.slice(2);
const app = await App.open(
  directory,
  { model: fixtureModel, stream: fixtureStream },
  dsn,
);
await app.world!.migrate();
const svc = new ApplicationService(app),
  command = (route: string, body: any) =>
    svc.command(svc.principal, route, body);
command("sync/initialize", { request_id: id() });
const snapshot: any = await svc.query(svc.principal, "sync/bootstrap");
const entity = id();
fs.writeFileSync(
  path.join(directory, "fixture.json"),
  JSON.stringify({ snapshot, entity }),
);
if (phase === "before")
  app.world!.export = async () => {
    process.kill(process.pid, "SIGKILL");
  };
else {
  const pool = app.world!.pool,
    query = pool.query.bind(pool);
  (pool as any).query = (sql: any, ...args: any[]) => {
    if (String(sql).startsWith("UPDATE wm.audit_outbox"))
      process.kill(process.pid, "SIGKILL");
    return (query as any)(sql, ...args);
  };
}
const draft: any = await svc.query(svc.principal, "settings");
command("settings/draft", {
  request_id: id(),
  expected_revision: draft.draft.revision,
  payload: {
    instructions: null,
    edits: [
      {
        kind: "ENTITY",
        entity_id: entity,
        entity_kind: "PERSON",
        display_name: "Synthetic crash entity",
        expected_revision: "0",
      },
    ],
    command_ids: [],
  },
});
command("settings/apply", {
  request_id: id(),
  expected_revision: String(app.settings.draft().revision),
});
await app.settings.tick();
throw Error("world crash point not hit");
