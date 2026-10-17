import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { fixture } from "../offline/issue23/helpers.ts";
import { interrupted } from "../offline/issue18/helpers.ts";
import { base, revise, Store } from "../../src/pi_secretary/src/store.ts";

// Fixed 100 operations per execution, plus two unresolved process identities.
// The separate regression test exercises a single concentrated execution.
for (const count of process.argv.slice(2).map(Number)) {
  await fixture(async (f) => {
    const { app } = f;
    await app.settings.tick();
    const { e, op } = interrupted(app);
    for (let offset = 0; offset < count; offset += 100) {
      const execution = { ...e, ...base() };
      const operations = Array.from(
        { length: Math.min(100, count - offset) },
        () => ({
          ...op,
          ...base(),
          scope: { ...op.scope, execution_id: execution.id },
        }),
      );
      execution.unknown_operation_ids = operations.map((o) => o.id);
      app.store.commit([execution, ...operations]);
    }
    interrupted(app, "shell.run", "/synthetic/unknown-a", false);
    interrupted(app, "program.run", "/synthetic/unknown-b", false);
    const all = app.store.all.bind(app.store),
      indexed = app.store.indexed.bind(app.store);
    let visited = 0,
      queries = 0;
    app.store.all = ((...args: Parameters<typeof all>) => {
      const result = all(...args);
      if (args[0] === "Operation") {
        queries++;
        visited += result.length;
      }
      return result;
    }) as typeof all;
    app.store.indexed = ((...args: Parameters<typeof indexed>) => {
      const result = indexed(...args);
      if (args[0] === "Operation") {
        queries++;
        visited += result.length;
      }
      return result;
    }) as typeof indexed;
    const worker = new Worker(
      `
      const {parentPort,workerData}=require('node:worker_threads');
      const http=require('node:http');const {performance}=require('node:perf_hooks');
      let stop=false;parentPort.on('message',()=>stop=true);const samples=[];
      parentPort.postMessage('ready');
      (async()=>{while(!stop){const start=performance.now();await new Promise((resolve,reject)=>http.get(workerData.url+'/api/v1/core',{headers:{authorization:'Bearer '+workerData.token}},r=>{if(r.statusCode!==200) return reject(Error('HTTP '+r.statusCode));r.resume();r.on('end',resolve)}).on('error',reject));samples.push(performance.now()-start);await new Promise(r=>setTimeout(r,2));}parentPort.postMessage(samples);parentPort.close()})();`,
      { eval: true, workerData: f.server.endpoint },
    );
    await new Promise<void>((resolve) =>
      worker.once("message", () => resolve()),
    );
    const start = performance.now();
    await (app.scheduler as any).recoverProcesses(true);
    const startup = { ms: performance.now() - start, queries, visited };
    const response = new Promise<number[]>((resolve) =>
      worker.once("message", resolve),
    );
    worker.postMessage("stop");
    const http = await response;
    await worker.terminate();
    queries = visited = 0;
    const periodicStart = performance.now();
    await (app.scheduler as any).recoverProcesses();
    const periodic = {
      ms: performance.now() - periodicStart,
      queries,
      visited,
    };
    queries = visited = 0;
    // Exclude the two pending identities to measure the genuinely idle gate.
    for (const operation of app.store.indexed<any>(
      "Operation",
      "process.state",
      ["UNCONFIRMED"],
    )) {
      app.store.commit([
        revise(operation, {
          process: { ...operation.process, state: "STOPPED" },
        }),
      ]);
    }
    queries = visited = 0;
    const idleStart = performance.now();
    for (let i = 0; i < 10; i++) app.scheduler.tick(Date.now() + i * 300);
    const idle = { ms: performance.now() - idleStart, queries, visited };
    await f.close();
    const replayStart = performance.now();
    const reopened = await Store.open(f.dir);
    const replayMs = performance.now() - replayStart;
    await reopened.close();
    console.log(
      JSON.stringify({
        count,
        startup,
        periodic,
        idle,
        replayMs,
        http: { samples: http.length, maxMs: Math.max(...http) },
        probe:
          "two missing-identity UNCONFIRMED records; no subprocess/signals",
      }),
    );
  });
}
