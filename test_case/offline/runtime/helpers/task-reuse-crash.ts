// SIGKILL fault driver: opens only the test-owned Store passed by the parent test.
import { App } from "../../../../src/pi_secretary/src/app.ts";
import {
  fixtureModel,
  fixtureStream,
  replyStream,
  type StreamFn,
} from "../../../../src/pi_secretary/src/model.ts";
const [dir, task, parent, request, stage] = process.argv.slice(2);
const stream: StreamFn = (m, c) =>
  c.messages.at(-1)?.role !== "toolResult"
    ? replyStream(
        [
          {
            type: "toolCall",
            id: "crash-reuse",
            name: "task_propose",
            arguments: {
              goal: "crash revision",
              reuse_task_id: task,
              parent_execution_id: parent,
            },
          },
        ],
        m,
      )
    : fixtureStream(m, c);
const app = await App.open(dir, {
  main: { model: fixtureModel, stream },
  task: { model: fixtureModel, stream: fixtureStream },
});
const commit = app.store.commit.bind(app.store);
const kill = () => process.kill(process.pid, "SIGKILL");
app.store.commit = ((records, events = [], receipt) => {
  const accepting = events.some(
    (e) => e.event_type === "task.request.accepted",
  );
  const creating = records.some(
    (r) => r.record_type === "Execution" && r.revision === 1,
  );
  if (
    (stage === "before-accept" && accepting) ||
    (stage === "before-create" && creating) ||
    (stage === "tool-return" &&
      events.some((e) => e.event_type === "main.tool.result"))
  )
    kill();
  commit(records, events, receipt);
  if (
    (stage === "after-accept" && accepting) ||
    (stage === "after-create" && creating) ||
    (stage === "after-dispatch" &&
      records.some((r) => r.record_type === "Dispatch"))
  )
    kill();
}) as typeof app.store.commit;
if (stage === "tool-return") {
  app.host.accept("Revise report");
  await app.host.drain();
} else {
  app.scheduler.propose("crash revision", request, app.host.sessionID, {
    reuse: task,
    parent,
  });
  app.scheduler.tick();
  await app.scheduler.idle();
}
throw Error("FAULT_POINT_NOT_REACHED");
