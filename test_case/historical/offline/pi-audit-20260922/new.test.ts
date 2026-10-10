import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {App} from '../../../../src/pi_secretary/src/app.ts';
import {Store,id,revise} from '../../../../src/pi_secretary/src/store.ts';
import {fixtureModel,fixtureStream,replyStream,type StreamFn} from '../../../../src/pi_secretary/src/model.ts';
import {getCurrentTools} from '@earendil-works/pi-ai';
import type {Execution,Input,Context,TaskPlan,DecisionRequest,Consciousness,CompactionJob,Operation,AuthorizationRequest} from '../../../../src/pi_secretary/src/contracts.ts';
async function fixture(run:(a:App,dir:string)=>Promise<void>,stream:StreamFn=fixtureStream,model=fixtureModel){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sec-new-audit-'));
 const a=await App.open(dir,{model,stream});
 try{await run(a,dir);}finally{await a.close();fs.rmSync(dir,{recursive:true,force:true});}
}
const isTask=(c:any)=>JSON.stringify(c.messages.filter((m:any)=>m.role==='system')).includes('TASK_EXECUTOR');
const ask:StreamFn=(m,c,o)=>isTask(c)&&!c.messages.some(x=>x.role==='toolResult')?replyStream([{type:'toolCall',id:'ask',name:'request_decision',arguments:{question:'choose'}}],m):fixtureStream(m,c,o);
async function waiting(a:App){a.scheduler.propose('task',id(),a.host.sessionID);a.scheduler.tick();await a.scheduler.idle();return a.store.all<Execution>('Execution')[0];}
const csReply=(m:any,label='summary')=>replyStream([{type:'text',text:JSON.stringify({items:[{tier:'ACTIVE',summary:label,goals:[],constraints:[],decisions:[],open_questions:[],unfulfilled_commitments:[],task_refs:[],pending_owner:'MAIN'}]})}],m);

test('NEW01 SIGKILL during input batch assembly must not mark unseen B handled',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sec-batch-crash-'));
 const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('./crash-batch.ts',import.meta.url)),dir],{stdio:'ignore'});
 const [,signal]=await once(child,'close');assert.equal(signal,'SIGKILL');
 let a:App|undefined;const seen:string[]=[];
 try{
  for(let n=0;n<30;n++){try{a=await App.open(dir,{model:fixtureModel,stream:(m,c,o)=>{seen.push(JSON.stringify(c));return fixtureStream(m,c,o)}});break;}catch(e){if(!String(e).includes('OWNER_BUSY'))throw e;await new Promise(r=>setTimeout(r,20));}}
  assert(a);await a.host.drain();
  assert(a.store.all<Input>('Input').every(i=>i.state==='HANDLED'));
  assert(seen.some(x=>x.includes('AUDIT_BATCH_B_MUST_REACH_MODEL')),'B marked HANDLED without ever entering any recovered model request');
 }finally{await a?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('NEW02 missing reference rejection must leave a reopenable store',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sec-poison-'));let a=await App.open(dir,{model:fixtureModel,stream:fixtureStream});
 try{const i=a.host.accept('good');const ref=a.store.put('vanishes');fs.unlinkSync(path.join(dir,ref.path));assert.throws(()=>a.store.commit([revise(i,{payload:ref})]));await a.close();
  let s:Store|undefined;await assert.doesNotReject(async()=>{s=await Store.open(dir)});await s?.close();
 }finally{await a.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('NEW03 cancelled decision becomes obsolete and cannot block retirement incorrectly',()=>fixture(async a=>{
 const e=await waiting(a);const d=a.store.all<DecisionRequest>('DecisionRequest')[0];a.scheduler.cancel(e.id);
 assert.notEqual(a.store.get<DecisionRequest>('DecisionRequest',d.id).state,'OPEN');
},ask));
test('NEW04 decision accepted without a nonempty answer must be rejected',()=>fixture(async a=>{
 await waiting(a);const d=a.store.all<DecisionRequest>('DecisionRequest')[0];assert.throws(()=>a.scheduler.answer(d.id,undefined,id()));
},ask));
test('NEW05 crash after decision commit but before feedback must be repaired on reopen',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sec-decision-gap-'));let a=await App.open(dir,{model:fixtureModel,stream:ask});
 try{
  a.scheduler.feedback=(()=>{throw Error('injected stop before feedback')}) as typeof a.scheduler.feedback;
  const e=await waiting(a);assert.equal(e.state,'WAIT_DECISION');assert.equal(a.store.all('Feedback').length,0);await a.close();
  a=await App.open(dir,{model:fixtureModel,stream:ask});a.host.deliverFeedback();
  assert(a.store.all('Input').length>0,'durable OPEN decision never redelivered to main after restart');
 }finally{await a.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('NEW06 later compaction must receive previously committed working memory',()=>{
 const inputs:string[]=[];const stream:StreamFn=(m,c,o)=>{if(JSON.stringify(c).includes('CONSCIOUSNESS')){inputs.push(JSON.stringify(c.messages.filter(x=>x.role==='user')));return csReply(m,'COMMITTED_MEMORY_MARKER_'+inputs.length);}return fixtureStream(m,c,o);};
 return fixture(async a=>{a.host.accept('original conversation');await a.host.drain();await a.host.compact();a.host.accept('next conversation');await a.host.drain();await a.host.compact();assert.equal(inputs.length,2);assert(inputs[1].includes('COMMITTED_MEMORY_MARKER_1'),'new job must receive current items');},stream);
});
test('NEW07 compaction commit resolving capacity must permit next model call',()=>{
 const stream:StreamFn=(m,c,o)=>JSON.stringify(c).includes('CONSCIOUSNESS')?csReply(m):fixtureStream(m,c,o);
 return fixture(async a=>{a.host.accept('old');await a.host.drain();a.host.accept('new pending');a.store.commit([revise(a.host.session,{state:'CAPACITY_BLOCKED'})]);await a.host.compact();assert.equal(a.store.all<CompactionJob>('CompactionJob')[0].state,'COMMITTED');await a.host.drain();assert(a.store.all<Input>('Input').every(i=>i.state==='HANDLED'));},stream);
});
test('NEW08 task checkpoint obeys configured model capacity above 32768',()=>fixture(async a=>{
 a.scheduler.propose('large source',id(),a.host.sessionID,{materials:['x'.repeat(95000)]});a.scheduler.tick();await a.scheduler.idle();const e=a.store.all<Execution>('Execution')[0];assert.equal(e.state,'SUCCEEDED');
},fixtureStream,{...fixtureModel,contextWindow:262144}));
test('NEW09 child followup receives saved parent context marker',()=>{
 let parent:string|undefined;const captured:string[]=[];const stream:StreamFn=(m,c,o)=>{if(isTask(c))captured.push(JSON.stringify(c));return fixtureStream(m,c,o)};
 return fixture(async a=>{a.scheduler.propose('parent',id(),a.host.sessionID,{materials:['PARENT_CONTEXT_MARKER_MUST_SURVIVE']});a.scheduler.tick();await a.scheduler.idle();parent=a.store.all<Execution>('Execution')[0].id;captured.length=0;a.scheduler.propose('followup',id(),a.host.sessionID,{parent});a.scheduler.tick();await a.scheduler.idle();assert(captured.some(x=>x.includes('PARENT_CONTEXT_MARKER_MUST_SURVIVE')));},stream);
});
test('NEW10 target precondition is rechecked after waiting for authorization',()=>{
 const stream:StreamFn=(m,c,o)=>isTask(c)&&!c.messages.some(x=>x.role==='toolResult')?replyStream([{type:'toolCall',id:'write',name:'write',arguments:{path:'out.txt',content:'effect'}}],m):fixtureStream(m,c,o);
 return fixture(async(a,dir)=>{const p=a.scheduler.propose('needs ready',id(),a.host.sessionID,{preconditions:[{condition_id:id(),kind:'RESOURCE_PRESENT',target:'ready.txt',required_revision:null}]});const root=path.join(dir,'workspaces',p.id,'work');fs.writeFileSync(path.join(root,'ready.txt'),'ready');a.scheduler.tick();await a.scheduler.idle();const q=a.store.all<AuthorizationRequest>('AuthorizationRequest')[0];assert(q);fs.unlinkSync(path.join(root,'ready.txt'));a.authorization.decide({record_type:'ApprovalCommand',schema_version:1,request_id:id(),authorization_id:q.id,expected_revision:q.revision,display_hash:q.display_hash,decision:'APPROVE'});await a.scheduler.run(a.store.all<Execution>('Execution')[0].id);assert(!fs.existsSync(path.join(root,'out.txt')),'effect ran after precondition vanished');},stream);
});
test('CONTROL Pi 0.87 system messages really contain recoverable tool declarations',()=>fixture(async a=>{
 a.host.accept('hello');await a.host.drain();const c=a.store.all<Context>('Context')[0];const messages=a.store.read<any[]>(c.tools_schema);assert(getCurrentTools(messages).some(t=>t.name==='task_propose'));assert(a.store.read<any[]>(c.raw_context)[0].role==='system');
}));
