import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { App } from "../../src/pi_secretary/src/app.ts";
import {
  base,
  id,
  revise,
  type Stored,
} from "../../src/pi_secretary/src/store.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../src/pi_secretary/src/model.ts";
const [dir, countText = "1000"] = process.argv.slice(2);
const count = Number(countText);
if (!dir?.includes("issue24") || fs.existsSync(dir))
  throw Error("Fresh issue24 directory required");
const app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
try {
  await app.settings.tick();
  const plan = app.scheduler.propose(
    "Synthetic benchmark report",
    id(),
    app.host.sessionID,
  );
  app.scheduler.tick();
  await app.scheduler.idle();
  const execution = app.store.all<any>("Execution")[0];
  const feedback = app.store.all<any>("Feedback")[0];
  app.store.commit([
    revise(app.store.get<any>("TaskPlan", plan.id), { state: "CLOSED" }),
    revise(execution, { retention_state: "RETIRED" }),
    revise(feedback, { state: "HANDLED" }),
  ]);
  const input = {
    ...base(),
    schema_version: 1,
    record_type: "Input",
    session_id: app.host.sessionID,
    dedupe_key: id(),
    producer: "MASTER",
    state: "HANDLED",
    payload: app.store.put("synthetic", "text/plain"),
    loop_id: null,
    received_at: new Date().toISOString(),
    feedback_id: null,
  };
  const templates = [
    input,
    app.store.get<any>("TaskPlan", plan.id),
    app.store.get<any>("Execution", execution.id),
    app.store.get<any>("Feedback", feedback.id),
  ];
  for (let n = 0; n < count; n += 100) {
    const records: Stored[] = [];
    const events = [];
    for (let j = n; j < Math.min(n + 100, count); j++) {
      const r = { ...templates[j % 4], ...base() };
      if (r.record_type === "Execution") r.occurrence_key = "synthetic-" + j;
      records.push(r);
      events.push(app.store.event("synthetic.history", {}));
    }
    app.store.commit(records, events);
  }
  for (let n = 0; n < 10; n++) {
    await app.pump();
    await app.host.drain();
  }
  const wall = performance.now(),
    cpu = process.cpuUsage();
  for (let n = 0; n < 200; n++) {
    await app.pump();
    await app.host.drain();
    app.host.maintainIfNeeded();
  }
  const usage = process.cpuUsage(cpu);
  console.log(
    JSON.stringify({
      records: count,
      iterations: 200,
      wallMs: performance.now() - wall,
      cpuMs: (usage.user + usage.system) / 1000,
    }),
  );
} finally {
  await app.close();
}
