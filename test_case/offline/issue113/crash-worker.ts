import { App } from "../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../src/pi_secretary/src/model.ts";
import { id, revise } from "../../../src/pi_secretary/src/store.ts";
import type { AuthorizationRequest } from "../../../src/pi_secretary/src/contracts.ts";
const app = await App.open(process.argv[2], {
  model: fixtureModel,
  stream: fixtureStream,
});
const input = app.host.accept("Create the crash fixture scope"),
  loop = id();
app.store.commit([revise(input, { state: "CLAIMED", loop_id: loop })], []);
const ev = app.store.events("input.accepted").at(-1)!.event_id;
const status = app.scopeImports.propose(
  { name: "Crash scope", kind: "NONE" },
  [ev],
  { session_id: app.host.sessionID, task_id: null, execution_id: null },
  loop,
  id(),
);
const a = app.store.get<AuthorizationRequest>(
  "AuthorizationRequest",
  status.authorization_id,
);
app.authorization.decide({
  record_type: "ApprovalCommand",
  schema_version: 1,
  request_id: id(),
  authorization_id: a.id,
  expected_revision: a.revision,
  display_hash: a.display_hash,
  decision: process.argv[3] === "reject" ? "REJECT" : "APPROVE",
});
if (process.argv[3] === "committed") app.scopeImports.drain();
process.send!({
  ready: true,
  operation_id: status.operation_id,
  phase: process.argv[3],
});
setInterval(() => {}, 1000);
