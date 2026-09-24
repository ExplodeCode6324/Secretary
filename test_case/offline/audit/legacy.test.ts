// Copy into frozen demo_pi/pi_secretary/test; never changes production source.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {App} from '../../../src/pi_secretary/src/app.ts';
import {Store,id,revise,hash} from '../../../src/pi_secretary/src/store.ts';
import {fixtureModel,fixtureStream,replyStream,type StreamFn} from '../../../src/pi_secretary/src/model.ts';
import type {Input,Context,Execution,Operation,AuthorizationRequest,DecisionRequest,TaskPlan,Notification} from '../../../src/pi_secretary/src/contracts.ts';

async function fixture(run:(a:App,dir:string)=>Promise<void>,stream:StreamFn=fixtureStream){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sec-audit-'));
 const a=await App.open(dir,{model:fixtureModel,stream});
 try {await run(a,dir);} finally {await a.close();fs.rmSync(dir,{recursive:true,force:true});}
}
function approve(a:App){const q=a.store.all<AuthorizationRequest>('AuthorizationRequest')[0];a.authorization.decide({record_type:'ApprovalCommand',schema_version:1,request_id:id(),authorization_id:q.id,expected_revision:q.revision,display_hash:q.display_hash,decision:'APPROVE'});}
const writeStream:StreamFn=(m,c)=>{
 if(JSON.stringify(c.messages.filter(x=>x.role==='system')).includes('TASK_EXECUTOR')&&!c.messages.some(x=>x.role==='toolResult'))
 return replyStream([{type:'toolCall',id:'audit-write',name:'write',arguments:{path:'report.txt',content:'expected'}}],m);
 return fixtureStream(m,c);
};
const decisionStream:StreamFn=(m,c)=>{
 if(JSON.stringify(c.messages.filter(x=>x.role==='system')).includes('TASK_EXECUTOR')&&!c.messages.some(x=>x.role==='toolResult'))
 return replyStream([{type:'toolCall',id:'audit-decision',name:'request_decision',arguments:{question:'Choose one'}}],m);
 return fixtureStream(m,c);
};
async function waiting(a:App){a.scheduler.propose('audit',id(),a.host.sessionID);a.scheduler.tick();await a.scheduler.idle();return a.store.all<Execution>('Execution')[0];}

test('AUD01 target changed after approval must not be overwritten',()=>fixture(async(a,dir)=>{
 const e=await waiting(a);assert.equal(e.state,'WAIT_AUTH');approve(a);
 const file=path.join(dir,'workspaces',e.task_id,'work/report.txt');fs.writeFileSync(file,'concurrent edit');
 await a.scheduler.run(e.id);assert.equal(fs.readFileSync(file,'utf8'),'concurrent edit');
},writeStream));
test('AUD02 expired ordinary decision must be rejected',()=>fixture(async a=>{
 await waiting(a);const q=a.store.all<DecisionRequest>('DecisionRequest')[0];
 a.store.commit([revise(q,{deadline:'2000-01-01T00:00:00Z'})]);
 assert.throws(()=>a.scheduler.answer(q.id,'blue',id(),'MASTER'));
},decisionStream));
test('AUD03 ordinary decision exact redelivery is idempotent',()=>fixture(async a=>{
 await waiting(a);const q=a.store.all<DecisionRequest>('DecisionRequest')[0];const request=id();
 a.scheduler.answer(q.id,'blue',request,'MASTER');const seq=a.store.sequence;
 assert.doesNotThrow(()=>a.scheduler.answer(q.id,'blue',request,'MASTER'));assert.equal(a.store.sequence,seq);
},decisionStream));
test('AUD04 missing referenced object rejected before durable frame',()=>fixture(async(a,dir)=>{
 const input=a.host.accept('baseline');const ref=a.store.put('missing');fs.unlinkSync(path.join(dir,ref.path));
 const before=fs.statSync(path.join(dir,'journal.jsonl')).size;
 assert.throws(()=>a.store.commit([revise(input,{payload:ref})]));
 assert.equal(fs.statSync(path.join(dir,'journal.jsonl')).size,before,'failed commit poisoned durable journal');
}));
test('AUD05 Context is immutable after first commit',()=>fixture(async a=>{
 a.host.accept('context');await a.host.drain();const c=a.store.all<Context>('Context')[0];
 assert.throws(()=>a.store.commit([revise(c,{provider_profile:'mutated'})]));
}));
test('AUD06 illegal Input ACCEPTED to HANDLED rejected',()=>fixture(async a=>{
 const i=a.host.accept('not handled');assert.throws(()=>a.store.commit([revise(i,{state:'HANDLED'})]));
}));
test('AUD07 cross-object missing session rejected',()=>fixture(async a=>{
 const i=a.host.accept('owned');assert.throws(()=>a.store.commit([revise(i,{session_id:id()})]));
}));

async function corrupt(mode:string){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sec-journal-audit-'));
 let a=await App.open(dir,{model:fixtureModel,stream:fixtureStream});a.host.accept('durable');await a.close();
 const file=path.join(dir,'journal.jsonl');const lines=fs.readFileSync(file,'utf8').trimEnd().split('\n');
 const at=lines.length-1;const frame=JSON.parse(lines[at]);
 if(mode==='extra') frame.unrecognized_control=true;
 if(mode==='base64') frame.payload_b64='!'+frame.payload_b64;
 if(mode==='event') {const tx=JSON.parse(Buffer.from(frame.payload_b64,'base64').toString());assert(tx.log_records.length);tx.log_records[0].sequence=999;const bytes=Buffer.from(JSON.stringify(tx));frame.payload_b64=bytes.toString('base64');frame.sha256=hash(bytes);}
 lines[at]=JSON.stringify(frame);fs.writeFileSync(file,lines.join('\n')+'\n');
 let reopened:Store|undefined;let rejected=false;
 try{reopened=await Store.open(dir);}catch{rejected=true;}finally{await reopened?.close();fs.rmSync(dir,{recursive:true,force:true});}
 assert(rejected,'recovery accepted malformed '+mode);
}
test('AUD08 outer frame unknown fields rejected',()=>corrupt('extra'));
test('AUD09 invalid base64 rejected',()=>corrupt('base64'));
test('AUD10 event sequence discontinuity rejected',()=>corrupt('event'));
test('AUD11 notification is not SENT before channel receipt',()=>fixture(async a=>{
 const t=(a.host as any).tools(id()).find((t:any)=>t.name==='MasterInteract');
 await t.execute(id(),{message:'test notification'},undefined,()=>{});
 assert.notEqual(a.store.all<Notification>('Notification')[0].state,'SENT');
}));
test('AUD12 stale epoch/attempt rejected by final gate',()=>fixture(async a=>{
 await waiting(a);approve(a);const op=a.store.all<Operation>('Operation')[0];
 a.store.commit([revise(op,{owner_epoch:a.store.epoch+99,attempt_id:id()})]);
 assert.throws(()=>a.authorization.dispatch(op.id));
},writeStream));
test('AUD13 QUEUE persists occurrence while previous run waits',()=>fixture(async a=>{
 const p=a.scheduler.propose('periodic',id(),a.host.sessionID,{interval:60});
 const due=Date.parse(p.next_due_at!);a.scheduler.tick(due);await a.scheduler.idle();
 assert.equal(a.store.all<Execution>('Execution')[0].state,'WAIT_DECISION');
 a.scheduler.tick(due+60000);await a.scheduler.idle();
 assert.equal(a.store.get<TaskPlan>('TaskPlan',p.id).pending_occurrences.length,1);
},decisionStream));
test('AUD14 Context tools_schema records actual tool definitions',()=>fixture(async a=>{
 a.host.accept('hello');await a.host.drain();const c=a.store.all<Context>('Context')[0];
 const defs=a.store.read<any[]>(c.tools_schema);
 assert(defs.some(d=>d.name==='task_propose'||d.function?.name==='task_propose'),'tools_schema contains no actual task_propose schema');
}));
test('AUD15 source input exact bytes retained and conflict rejected',()=>fixture(async a=>{
 const request=id();const text='A\r\n中文\u0000é';const i=a.host.accept(text,request);
 assert.equal(a.store.bytes(i.payload).toString(),text);assert.equal(a.host.accept(text,request).id,i.id);
 assert.throws(()=>a.host.accept(text+'x',request));
}));

for (const guard of ['valid','epoch','attempt'] as const) {
 test('AUD12-refinement '+guard,()=>fixture(async a=>{
  await waiting(a);approve(a);const op=a.store.all<Operation>('Operation')[0];
  if(guard==='epoch') a.store.commit([revise(op,{owner_epoch:a.store.epoch+99})]);
  if(guard==='attempt') a.store.commit([revise(op,{attempt_id:id()})]);
  if(guard==='valid') assert.doesNotThrow(()=>a.authorization.dispatch(op.id));
  else assert.throws(()=>a.authorization.dispatch(op.id));
 },writeStream));
}
