import {App} from '../../../../src/pi_secretary/src/app.ts';
import {fixtureModel,fixtureStream} from '../../../../src/pi_secretary/src/model.ts';
const app=await App.open(process.argv[2],{model:fixtureModel,stream:fixtureStream});
app.host.accept('AUDIT_BATCH_A'); app.host.accept('AUDIT_BATCH_B_MUST_REACH_MODEL');
const commit=app.store.commit.bind(app.store);
app.store.commit=((records,events=[],receipt)=>{
  commit(records,events,receipt);
  if(events.some(e=>e.event_type==='main.message' && app.store.bytes(e.payload).toString().includes('AUDIT_BATCH_A'))){
    process.kill(process.pid,'SIGKILL');
  }
}) as typeof app.store.commit;
await app.host.drain();
