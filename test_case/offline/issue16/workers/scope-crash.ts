import fs from "node:fs";
import path from "node:path";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../../../src/pi_secretary/src/model.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
import type { AuthorizationRequest } from "../../../../src/pi_secretary/src/contracts.ts";
const root = process.argv[2],
  project = path.join(root, "project");
fs.mkdirSync(project);
const app = await App.open(path.join(root, "data"), {
  model: fixtureModel,
  stream: fixtureStream,
});
const scope = app.scheduler.scopes.save({
  name: "Crash scope",
  kind: "DIRECTORY",
  root_path: project,
});
const script = path.join(root, "program.mjs");
fs.writeFileSync(
  script,
  `import fs from 'node:fs';let data='';process.stdin.on('data',b=>data+=b);process.stdin.on('end',()=>{if(JSON.parse(data).parameters.goal==='second'){fs.writeFileSync('second-proof','yes');console.log(JSON.stringify({summary:'done',outcome:'SUCCEEDED',effect:'APPLIED'}));}else{process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync('first-proof','x'),50);}});`,
);
const p = app.scheduler.registerProgram(script, "Crash fixture");
for (const goal of ["first", "second"])
  app.scheduler.propose(goal, id(), app.host.sessionID, {
    scopeID: scope.id,
    programID: p.id,
  });
app.scheduler.tick();
await app.scheduler.idle();
const q = app.store.all<AuthorizationRequest>("AuthorizationRequest")[0];
app.authorization.decide({
  schema_version: 1,
  record_type: "ApprovalCommand",
  request_id: id(),
  authorization_id: q.id,
  expected_revision: q.revision,
  display_hash: q.display_hash,
  decision: "APPROVE",
});
const commit = app.store.commit.bind(app.store);
app.store.commit = ((...args: Parameters<typeof commit>) => {
  const result = commit(...args);
  const op = args[0]?.find(
    (r) => r.record_type === "Operation" && r.process?.state === "RUNNING",
  );
  if (op?.record_type === "Operation")
    fs.writeFileSync(path.join(root, "ready"), JSON.stringify(op.process));
  return result;
}) as typeof commit;
app.scheduler.tick();
await app.scheduler.idle();
await app.close();
