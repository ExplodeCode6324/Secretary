import { App } from "../../pi_secretary/src/app.ts";
import { fixtureModel, fixtureStream } from "../../pi_secretary/src/model.ts";
import { base, id } from "../../pi_secretary/src/store.ts";
import type { Execution } from "../../pi_secretary/src/contracts.ts";
const app = await App.open(process.argv[2], {
  model: fixtureModel,
  stream: fixtureStream,
});
try {
  const task = app.scheduler.propose(
    "Synthetic download",
    id(),
    app.host.sessionID,
  );
  await app.settle();
  const execution = app.store.all<Execution>("Execution")[0];
  const artifact = {
    artifact_id: id(),
    name: "result.txt",
    content: app.store.put("download 中文 😀", "text/plain"),
    workspace_path: "result.txt",
    producing_operation_id: null,
  };
  app.store.commit([
    {
      ...base(),
      record_type: "TaskResult",
      schema_version: 1,
      task_id: task.id,
      execution_id: execution.id,
      outcome: "SUCCEEDED",
      summary: "Synthetic",
      limitations: [],
      evidence: [artifact.content],
      artifacts: [artifact],
      detail_ref: app.store.put({}),
      needs_action: false,
      verified_by: "NOT_VERIFIED",
      observed_at: new Date().toISOString(),
    },
  ]);
  console.log(
    JSON.stringify({ id: artifact.artifact_id, hash: artifact.content.sha256 }),
  );
} finally {
  await app.close();
}
