import fs from "node:fs";
import path from "node:path";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import { ApplicationService } from "../../../../src/pi_secretary/src/application-service.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
import { interrupted } from "../helpers.ts";
const [dir, phase] = process.argv.slice(2);
const app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
const api = new ApplicationService(app);
const { e, op } = interrupted(app);
const body = {
  request_id: id(),
  expected_revision: String(op.revision),
  outcome: "UNVERIFIED",
  note: "Synthetic resolution",
};
fs.writeFileSync(
  path.join(dir, "request"),
  JSON.stringify({ e: e.id, op: op.id, body }),
);
const commit = app.store.commit.bind(app.store);
app.store.commit = ((...args: Parameters<typeof commit>) => {
  const value = commit(...args);
  if (
    args[0]?.some((r) =>
      phase === "resolved"
        ? r.record_type === "Operation" && r.state === "FAILED"
        : r.record_type === "Execution" && r.state === "FAILED",
    )
  )
    process.kill(process.pid, "SIGKILL");
  return value;
}) as typeof commit;
api.command(api.principal, `operations/${op.id}/resolve`, body);
throw Error("FAULT_WINDOW_NOT_REACHED");
