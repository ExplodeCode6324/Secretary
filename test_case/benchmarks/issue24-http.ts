import fs from "node:fs";
import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { App } from "../../src/pi_secretary/src/app.ts";
import { serveCore } from "../../src/pi_secretary/src/api-v1.ts";
import {
  fixtureModel,
  fixtureStream,
} from "../../src/pi_secretary/src/model.ts";
const dir = process.argv[2];
if (!dir?.includes("issue24") || fs.existsSync(dir))
  throw Error("Fresh issue24 directory required");
const app = await App.open(dir, { model: fixtureModel, stream: fixtureStream });
await app.settings.tick();
const server = await serveCore(app, 0, undefined, { pump: false });
const worker = new Worker(
  `const {parentPort,workerData}=require('node:worker_threads');const http=require('node:http');const {performance}=require('node:perf_hooks');let stop=false;parentPort.on('message',()=>{stop=true});const samples=[];async function run(){while(!stop){const start=performance.now();await new Promise((resolve,reject)=>http.get(workerData.url+'/api/v1/core',{headers:{authorization:'Bearer '+workerData.token}},r=>{if(r.statusCode!==200){reject(Error('HTTP '+r.statusCode));return;}r.resume();r.on('end',resolve)}).on('error',reject));samples.push(performance.now()-start);await new Promise(r=>setTimeout(r,2));}parentPort.postMessage(samples);parentPort.close();}parentPort.postMessage('ready');run();`,
  { eval: true, workerData: server.endpoint },
);
await new Promise<void>((resolve) => worker.once("message", () => resolve()));
const samples: number[] = [];
let result: Promise<number[]>;
try {
  for (let n = 0; n < 100; n++) {
    for (let j = 0; j < 10; j++) {
      const start = performance.now();
      app.store.commit([]);
      samples.push(performance.now() - start);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  result = new Promise((resolve) => worker.once("message", resolve));
  worker.postMessage("stop");
  const http = await result;
  const stats = (a: number[]) => {
    a.sort((a, b) => a - b);
    return {
      samples: a.length,
      p95: a[Math.floor(a.length * 0.95)],
      max: a.at(-1),
    };
  };
  console.log(JSON.stringify({ commit: stats(samples), http: stats(http) }));
} finally {
  await worker.terminate();
  await server.close();
}
