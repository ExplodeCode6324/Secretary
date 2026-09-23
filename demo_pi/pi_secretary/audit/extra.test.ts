import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {App} from '../src/app.ts';
import {id} from '../src/store.ts';
import {fixtureModel,fixtureStream,replyStream,type StreamFn} from '../src/model.ts';
import type {Execution,AuthorizationRequest,TaskPlan} from '../src/contracts.ts';
const isTask=(c:any)=>JSON.stringify(c.messages.filter((m:any)=>m.role==='system')).includes('TASK_EXECUTOR');
async function fixture(run:(a:App,dir:string)=>Promise<void>,stream:StreamFn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sec-extra-audit-'));
 const a=await App.open(dir,{model:fixtureModel,stream});
 try{await run(a,dir);}finally{await a.close();fs.rmSync(dir,{recursive:true,force:true});}
}
test('NEW11 identical provider tool id in later response must not alias earlier intent',async()=>{
 let calls=0;
 const stream:StreamFn=(m,c,o)=>{
  if(isTask(c))return fixtureStream(m,c,o);
  calls++;
  if(calls<=2)return replyStream([{type:'toolCall',id:'same_provider_id',name:'task_propose',arguments:{goal:calls===1?'first goal':'second distinct goal',acceptance_criteria:['done']}}],m);
  return replyStream([{type:'text',text:'done'}],m);
 };
 await fixture(async a=>{a.host.accept('two separate tasks');await a.host.drain();assert.equal(a.store.all('TaskPlan').length,2,'second response tool call incorrectly replayed first task receipt');},stream);
});
test('NEW12 earlier read followed by WAIT_AUTH must stop model loop immediately',async()=>{
 let calls=0;
 const stream:StreamFn=(m,c,o)=>{
  if(!isTask(c))return fixtureStream(m,c,o);
  calls++;
  if(calls===1)return replyStream([{type:'toolCall',id:'read',name:'read',arguments:{path:'source.txt'}},{type:'toolCall',id:'write',name:'write',arguments:{path:'output.txt',content:'new'}}],m);
  return replyStream([{type:'text',text:'should not have been called while WAIT_AUTH'}],m);
 };
 await fixture(async(a,dir)=>{const p=a.scheduler.propose('read then write',id(),a.host.sessionID);fs.writeFileSync(path.join(dir,'workspaces',p.id,'work','source.txt'),'source');a.scheduler.tick();await a.scheduler.idle();assert.equal(a.store.all<Execution>('Execution')[0].state,'WAIT_AUTH');assert.equal(calls,1,'Pi requested another completion after durable authorization wait');},stream);
});
test('NEW13 approved workspace path must not follow a replaced work root symlink',async()=>{
 const stream:StreamFn=(m,c,o)=>isTask(c)&&!c.messages.some(x=>x.role==='toolResult')?replyStream([{type:'toolCall',id:'w',name:'write',arguments:{path:'sentinel.txt',content:'unauthorized replacement'}}],m):fixtureStream(m,c,o);
 await fixture(async(a,dir)=>{
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'sec-outside-sentinel-'));
  try{
   fs.writeFileSync(path.join(outside,'sentinel.txt'),'protected sentinel');
   const p=a.scheduler.propose('write inside task workspace',id(),a.host.sessionID);a.scheduler.tick();await a.scheduler.idle();
   const root=path.join(dir,'workspaces',p.id,'work');fs.renameSync(root,root+'-saved');fs.symlinkSync(outside,root);
   const q=a.store.all<AuthorizationRequest>('AuthorizationRequest')[0];
   a.authorization.decide({schema_version:1,record_type:'ApprovalCommand',request_id:id(),authorization_id:q.id,expected_revision:q.revision,display_hash:q.display_hash,decision:'APPROVE'});
   await a.scheduler.run(a.store.all<Execution>('Execution')[0].id);
   assert.equal(fs.readFileSync(path.join(outside,'sentinel.txt'),'utf8'),'protected sentinel','write escaped task workspace through symlink work root');
  }finally{fs.rmSync(outside,{recursive:true,force:true});}
 },stream);
});
test('NEW14 accepted future followup must pin parent before trigger fires',async()=>{
 await fixture(async a=>{a.scheduler.propose('parent',id(),a.host.sessionID);a.scheduler.tick();await a.scheduler.idle();const parent=a.store.all<Execution>('Execution')[0];a.scheduler.propose('future followup',id(),a.host.sessionID,{parent:parent.id,at:'2099-01-01T00:00:00Z'});assert(a.store.get<Execution>('Execution',parent.id).pending_followup_ids.length>0,'parent has no durable followup pin until future trigger');},fixtureStream);
});
