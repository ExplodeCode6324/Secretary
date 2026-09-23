import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {App} from '../src/app.ts';
import {id,hash,root} from '../src/store.ts';
import {fixtureModel,fixtureStream} from '../src/model.ts';
import type {WorldChange,WorldCatalogChange,WorldCommand,Operation,AuthorizationRequest} from '../src/contracts.ts';
const dsn=process.env.SECRETARY_TEST_DATABASE_URL;
async function fixture(run:(a:App,evidence:any[])=>Promise<void>){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sec-world-audit-'));
 const a=await App.open(dir,{model:fixtureModel,stream:fixtureStream},dsn);
 try{await a.world!.pool.query('DROP SCHEMA IF EXISTS wm CASCADE');await a.world!.migrate();const ev=a.store.event('input.accepted',{text:'Synthetic Master: discuss an unrelated topic'},undefined,'MASTER_UI');a.store.commit([],[ev]);await run(a,[{log_event_id:ev.event_id,content:ev.payload}]);}finally{await a.close();fs.rmSync(dir,{recursive:true,force:true});}
}
const catalog=(kind:WorldCatalogChange['kind'],entity:string,source:string,evidence:any[]):WorldCatalogChange=>({record_type:'WorldCatalogChange',schema_version:1,request_id:id(),change_id:id(),request_hash:hash(id()),kind,entity_id:kind==='UPSERT_ENTITY'?entity:null,entity_kind:kind==='UPSERT_ENTITY'?'PERSON':null,display_name:kind==='UPSERT_ENTITY'?'Synthetic person':null,external_key:null,source_id:kind==='REGISTER_SOURCE'?source:null,source_kind:kind==='REGISTER_SOURCE'?'MASTER':null,source_key:kind==='REGISTER_SOURCE'?id():null,description:kind==='REGISTER_SOURCE'?'synthetic source':null,expected_revision:0,evidence});
async function submit(a:App,c:WorldChange|WorldCatalogChange){const w=a.world!.propose(c,{session_id:a.host.sessionID,task_id:null,execution_id:null});const op=a.store.get<Operation>('Operation',w.operation_id);const q=a.store.get<AuthorizationRequest>('AuthorizationRequest',op.authorization_id!);a.authorization.decide({record_type:'ApprovalCommand',schema_version:1,request_id:id(),authorization_id:q.id,expected_revision:q.revision,display_hash:q.display_hash,decision:'APPROVE'});await a.world!.drain();return a.store.get<WorldCommand>('WorldCommand',w.id);}
const fact=(entity:string,source:string,evidence:any[],value:any,revision:number):WorldChange=>({record_type:'WorldChange',schema_version:1,request_id:id(),change_id:id(),request_hash:hash(id()),source_id:source,subject_id:entity,predicate_key:'person.display_name',scope_key:'',expected_revision:revision,mode:'ASSERT',value,object_entity_id:null,assertion_id:id(),replaces_assertion_id:null,resolve_conflict_id:null,resolution_note:null,provenance:{source_kind:'MASTER',source_id:source,evidence,observed_at:null,received_at:new Date().toISOString(),scope:'synthetic',epistemic:'REPORTED'},valid_from:'2026-01-01T00:00:00Z',valid_to:null,fresh_until:null});
test('NEW15 World evidence content must match the referenced Master event',{skip:!dsn},()=>fixture(async(a,ev)=>{
 const entity=id(),source=id();assert.equal((await submit(a,catalog('UPSERT_ENTITY',entity,source,ev))).state,'COMMITTED');assert.equal((await submit(a,catalog('REGISTER_SOURCE',entity,source,ev))).state,'COMMITTED');
 const forged=[{log_event_id:ev[0].log_event_id,content:a.store.put({text:'Invented by model, never said by Master'})}];
 let rejected=false;try{const w=await submit(a,fact(entity,source,forged,'Fabricated Master name',0));rejected=w.state==='REJECTED';}catch{rejected=true;}
 assert(rejected,'MASTER fact committed with unrelated event ID plus model-authored content');
}));
test('NEW16 equal object facts with different key order are SUPPORTING',{skip:!dsn},()=>fixture(async(a,ev)=>{
 const entity=id(),source=id();await submit(a,catalog('UPSERT_ENTITY',entity,source,ev));await submit(a,catalog('REGISTER_SOURCE',entity,source,ev));
 const x=fact(entity,source,ev,{kind:'email',value:'test@example.invalid'},0);x.predicate_key='person.contact';x.scope_key='email:synthetic';assert.equal((await submit(a,x)).state,'COMMITTED');
 const y=fact(entity,source,ev,{value:'test@example.invalid',kind:'email'},1);y.predicate_key=x.predicate_key;y.scope_key=x.scope_key;assert.equal((await submit(a,y)).state,'COMMITTED');
 const rows=await a.world!.read(entity);assert(rows.some(r=>r.status==='SUPPORTING')&&!rows.some(r=>r.status==='CONTESTED'),'equal JSONB values became a knowledge conflict');
}));
test('NEW17 interrupted migration after schema before predicate seed can recover',{skip:!dsn},()=>fixture(async a=>{
 await a.world!.pool.query('DROP SCHEMA wm CASCADE');await a.world!.pool.query(fs.readFileSync(path.join(root,'schema/001_world_model.sql'),'utf8'));await a.world!.migrate();const n=(await a.world!.pool.query('SELECT count(*)::int AS n FROM wm.predicate')).rows[0].n;assert.equal(n,10,'migration returned success with zero registered predicates');
}));
test('NEW18 temporary database deadlock must not become permanent business REJECTED',{skip:!dsn},()=>fixture(async(a,ev)=>{
 const w=a.world!;const original=(w as any).catalog.bind(w);let injected=false;
 (w as any).catalog=async(db:any,c:any)=>{if(!injected){injected=true;await db.query("DO $$ BEGIN RAISE EXCEPTION 'synthetic transient deadlock' USING ERRCODE='40P01'; END $$");}return original(db,c);};
 const c=catalog('UPSERT_ENTITY',id(),id(),ev);const out=await submit(a,c);assert.notEqual(out.state,'REJECTED','SQLSTATE 40P01 consumed change_id as a permanent rejection');
}));
