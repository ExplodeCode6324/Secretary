import * as fs from 'node:fs';
import * as path from 'node:path';
import {getModel} from '@earendil-works/pi-ai/compat';
import {App} from '../src/app.ts';
import {roleModel,type StreamFn} from '../src/model.ts';
import type {Consciousness,CompactionJob} from '../src/contracts.ts';
const battery=JSON.parse(fs.readFileSync(process.env.AUDIT_MEMORY_BATTERY!,'utf8'));
const keys=JSON.parse(fs.readFileSync(process.env.SECRETARY_CREDENTIALS_FILE!,'utf8'));
const selected=getModel('opencode-go','gpt-5.6-luna');
const chosen=roleModel(selected,keys.main);let calls=0;
const stream:StreamFn=(m,c,o)=>{if(++calls>30)throw Error('AUDIT_CALL_BUDGET');return chosen.stream(m,c,o);};
const dir=process.env.AUDIT_MEMORY_DATA!;let app=await App.open(dir,{model:selected,stream});
const phase:any[]=[];
try{
 for(let i=0;i<battery.events.length;i++){
  app.host.accept(battery.events[i]);await app.host.drain();
  if(battery.compact_after.includes(i+1)){
   await app.host.compact();
   phase.push({after:i+1,consciousness:app.store.all<Consciousness>('Consciousness'),jobs:app.store.all<CompactionJob>('CompactionJob')});
  }
 }
 await app.close();app=await App.open(dir,{model:selected,stream});
 const before=app.store.logs.length;app.host.accept(battery.question);await app.host.drain();
 const messages=app.store.logs.slice(before).filter(l=>l.event_type==='main.message').map(l=>app.store.read<any>(l.payload)).map(m=>({role:m.role,content:Array.isArray(m.content)?m.content.filter((c:any)=>c.type==='text'||c.type==='toolCall').map((c:any)=>c.type==='text'?{type:'text',text:c.text}:c):m.content}));
 const result={implementation:'pi',evidence_level:'LIVE_MODEL',calls,phase,messages,limitations:['short synthetic battery','logical dates are story labels, not real duration']};
 fs.writeFileSync(process.env.AUDIT_MEMORY_REPORT!,JSON.stringify(result,null,2));
}finally{await app.close();}
