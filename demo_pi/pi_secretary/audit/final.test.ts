import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {App} from '../src/app.ts';
import {id} from '../src/store.ts';
import {fixtureModel,fixtureStream,replyStream,type StreamFn} from '../src/model.ts';
import type {Execution,AuthorizationRequest,Consciousness} from '../src/contracts.ts';
async function fixture(run:(a:App,dir:string)=>Promise<void>,stream:StreamFn=fixtureStream){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sec-final-audit-'));
 const a=await App.open(dir,{model:fixtureModel,stream});
 try{await run(a,dir);}finally{await a.close();fs.rmSync(dir,{recursive:true,force:true});}
}
function approve(a:App){const q=a.store.all<AuthorizationRequest>('AuthorizationRequest').find(q=>q.state==='PENDING')!;a.authorization.decide({schema_version:1,record_type:'ApprovalCommand',request_id:id(),authorization_id:q.id,expected_revision:q.revision,display_hash:q.display_hash,decision:'APPROVE'});}
test('NEW19 program business FAILED cannot be promoted to SUCCEEDED by exit zero',()=>fixture(async(a,dir)=>{
 const script=path.join(dir,'failed.mjs');fs.writeFileSync(script,"console.log(JSON.stringify({summary:'Unable to perform assignment',outcome:'FAILED',effect:'NOT_APPLIED'}));");
 const reg=a.scheduler.registerProgram(script,'synthetic failure');a.scheduler.propose('must complete work',id(),a.host.sessionID,{programID:reg.id});a.scheduler.tick();await a.scheduler.idle();approve(a);await a.scheduler.run(a.store.all<Execution>('Execution')[0].id);
 assert.notEqual(a.store.all<Execution>('Execution')[0].state,'SUCCEEDED','registered result schema accepts FAILED and runtime promotes it');
}));
test('NEW20 cancellation of program ignoring SIGTERM needs bounded escalation',()=>fixture(async(a,dir)=>{
 const script=path.join(dir,'ignore-term.mjs');fs.writeFileSync(script,"import fs from 'node:fs';process.on('SIGTERM',()=>{});fs.writeFileSync('ready','yes');setInterval(()=>{},100);");
 const reg=a.scheduler.registerProgram(script,'synthetic cancellation');const plan=a.scheduler.propose('wait until cancelled',id(),a.host.sessionID,{programID:reg.id});a.scheduler.tick();await a.scheduler.idle();approve(a);const eid=a.store.all<Execution>('Execution')[0].id;const run=a.scheduler.run(eid);
 let child:any;
 try{
  for(let n=0;n<100&&!fs.existsSync(path.join(dir,'workspaces',plan.id,'work','ready'));n++)await new Promise(r=>setTimeout(r,10));
  assert(fs.existsSync(path.join(dir,'workspaces',plan.id,'work','ready')));
  child=(a.scheduler as any).running.get(eid)?.child;assert(child);a.scheduler.cancel(eid);
  const stopped=await Promise.race([run.then(()=>true),new Promise<boolean>(r=>setTimeout(()=>r(false),300))]);
  assert(stopped,'cancel only sends SIGTERM; no configured escalation or completion bound');
 }finally{child?.kill('SIGKILL');await run;}
}));
test('NEW21 summary cannot claim source covered while omitting its explicit constraint',()=>{
 const stream:StreamFn=(m,c,o)=>JSON.stringify(c).includes('CONSCIOUSNESS')?replyStream([{type:'text',text:JSON.stringify({items:[{tier:'QUIET',summary:'Unrelated small talk',goals:[],constraints:[],decisions:[],open_questions:[],unfulfilled_commitments:[],task_refs:[],pending_owner:null}]})}],m):fixtureStream(m,c,o);
 return fixture(async a=>{a.host.accept('MASTER_CONSTRAINT: Preserve unique constraint NO_EXTERNAL_PAYMENTS.');await a.host.drain();await a.host.compact();const cs=a.store.all<Consciousness>('Consciousness')[0];assert(cs.covered_event_ids.length>0);assert(JSON.stringify(cs.items).includes('NO_EXTERNAL_PAYMENTS')||cs.pending_raw_refs.length>0,'all source marked covered and raw pending cleared although explicit constraint omitted');},stream);
});
test('NEW22 upstream at-prefix normalization cannot bypass workspace read boundary',async()=>{
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'sec-read-outside-'));const file=path.join(outside,'sentinel.txt');fs.writeFileSync(file,'OUTSIDE_SECRET_SENTINEL');let received='';
 const stream:StreamFn=(m,c,o)=>{
  if(!JSON.stringify(c.messages.filter(x=>x.role==='system')).includes('TASK_EXECUTOR'))return fixtureStream(m,c,o);
  const results=c.messages.filter(x=>x.role==='toolResult');
  if(!results.length)return replyStream([{type:'toolCall',id:'outside-read',name:'read',arguments:{path:'@'+file}}],m);
  received=JSON.stringify(results);return replyStream([{type:'text',text:'stop'}],m);
 };
 try{await fixture(async a=>{a.scheduler.propose('read only inside workspace',id(),a.host.sessionID);a.scheduler.tick();await a.scheduler.idle();assert(!received.includes('OUTSIDE_SECRET_SENTINEL'),'unapproved outside absolute path reached model through @ prefix');},stream);}finally{fs.rmSync(outside,{recursive:true,force:true});}
});
