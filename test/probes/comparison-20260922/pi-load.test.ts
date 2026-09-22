import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {App} from '../src/app.ts';
import {id} from '../src/store.ts';
import {fixtureModel,fixtureStream} from '../src/model.ts';
import type {Input} from '../src/contracts.ts';
test('LOAD01 1000 durable inputs, duplicate concurrent ingress and fresh reopen',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sec-load-'));let a=await App.open(dir,{model:fixtureModel,stream:fixtureStream});
 const requests=Array.from({length:1000},(_,i)=>({id:id(),text:`${i}:`+'x'.repeat(1024)}));const start=performance.now();const phases:any[]=[];
 try{
  for(let n=0;n<1000;n+=20){await Promise.all(requests.slice(n,n+20).map(async r=>{const first=a.host.accept(r.text,r.id);assert.equal(a.host.accept(r.text,r.id).id,first.id);}));
   if([100,500,1000].includes(n+20))phases.push({inputs:n+20,elapsed_ms:performance.now()-start,heap_bytes:process.memoryUsage().heapUsed});}
  const before=a.store.all<Input>('Input');assert.equal(before.length,1000);await a.close();const reopen=performance.now();a=await App.open(dir,{model:fixtureModel,stream:fixtureStream});const recovery=performance.now()-reopen;
  const after=a.store.all<Input>('Input');assert.equal(after.length,1000);for(const r of requests){const item=after.find(i=>i.dedupe_key===r.id)!;assert.equal(a.store.bytes(item.payload).toString(),r.text);assert.equal(item.state,'ACCEPTED');}
  fs.writeFileSync(process.env.AUDIT_LOAD_REPORT!,JSON.stringify({implementation:'pi',inputs:1000,attempts:2000,phases,recovery_ms:recovery,verdict:'PASS',limitations:['short ingestion/recovery load, not continuous uptime','Promise concurrency on one Node event loop']},null,2));
 }finally{await a.close();fs.rmSync(dir,{recursive:true,force:true});}
});
