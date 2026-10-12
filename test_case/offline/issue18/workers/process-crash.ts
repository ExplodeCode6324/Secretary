import fs from "node:fs";
import path from "node:path";
import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
import { id } from "../../../../src/pi_secretary/src/store.ts";
import type {
  Execution,
  AuthorizationRequest,
} from "../../../../src/pi_secretary/src/contracts.ts";
const [dir, kind, phase] = process.argv.slice(2);
const stream: StreamFn = (model, context) =>
  context.messages.some((m) => m.role === "toolResult")
    ? fixtureStream(model, context)
    : replyStream(
        [
          {
            type: "toolCall",
            id: "synthetic-shell",
            name: "bash",
            arguments: {
              command:
                "trap '' TERM; while :; do printf x >> proof; sleep 0.1; done",
              timeout: 60,
            },
          },
        ],
        model,
      );
const app = await App.open(dir, { model: fixtureModel, stream });
let programID: string | undefined;
if (kind === "program") {
  const file = path.join(dir, "program.cjs");
  fs.writeFileSync(
    file,
    "const fs=require('fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync('proof','x'),100);",
  );
  programID = app.scheduler.registerProgram(file, "Synthetic long program").id;
}
const plan = app.scheduler.propose(
  "Synthetic process test",
  id(),
  app.host.sessionID,
  { programID },
);
app.scheduler.tick();
await app.scheduler.idle();
const a = app.store.all<AuthorizationRequest>("AuthorizationRequest")[0];
app.authorization.decide({
  schema_version: 1,
  record_type: "ApprovalCommand",
  request_id: id(),
  authorization_id: a.id,
  expected_revision: a.revision,
  display_hash: a.display_hash,
  decision: "APPROVE",
});
const commit = app.store.commit.bind(app.store);
app.store.commit = ((...args: Parameters<typeof commit>) => {
  const op = args[0]?.find(
    (r) => r.record_type === "Operation" && r.process?.state === "RUNNING",
  );
  if (op && phase === "before-identity") process.kill(process.pid, "SIGKILL");
  const result = commit(...args);
  if (op?.record_type === "Operation") {
    if (phase === "after-identity") process.kill(process.pid, "SIGKILL");
    fs.writeFileSync(
      path.join(dir, "ready"),
      JSON.stringify({
        process: op.process,
        cwd: path.join(dir, "workspaces", plan.id, "work"),
      }),
    );
  }
  return result;
}) as typeof commit;
await app.scheduler.run(app.store.all<Execution>("Execution")[0].id);
await app.close();
