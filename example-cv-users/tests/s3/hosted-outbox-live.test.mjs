import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedWorkerReply,checkEventInventory} from '../../scripts/s36-hosted/outbox-live.mjs';

const event={event_id:'event1',site_id:'alice',event_type:'published',publication_revision:1};
const row={id:event.event_id,site_id:event.site_id,event_type:event.event_type,publication_revision:1,
  state:'superseded',lease_owner:'owner',lease_token:'token',attempt_count:1,lease_generation:1,max_attempts:3,
  next_attempt_at:0,lease_until:1500,dispatch_started_at:null,completed_at:1000,last_code:'VERSION_SUPERSEDED'};

test('validates native worker DTO, rejection state and fixed identity',()=>{
  assert.equal(expectedWorkerReply(row,{state:'superseded',attempt:1},event),row);
  assert.equal(expectedWorkerReply({claimed:false,record:row},{claimed:false,state:'superseded'},event),row);
  assert.throws(()=>expectedWorkerReply({...row,id:'elsewhere'},{state:'superseded'},event));
  assert.throws(()=>expectedWorkerReply({...row,lease_generation:2},{state:'superseded'},event));
  assert.throws(()=>expectedWorkerReply(row,{dispatch_started:true},event));
});
test('independent durable readback rejects other IDs, replayed tokens and changed baseline',()=>{
  const events=[event,...[2,3,4,5].map(publication_revision=>({...event,publication_revision,event_id:'event'+publication_revision}))];
  const observed=[{...row,lease_until:new Date(1500).toISOString(),completed_at:new Date(1000).toISOString()},
    ...events.slice(1).map(e=>({...e,id:e.event_id,state:'pending',attempt_count:0,lease_generation:0,dispatch_started_at:null}))];
  const known=new Map([[row.id,row]]);
  checkEventInventory({events},observed,known);
  assert.throws(()=>checkEventInventory({events},[{...observed[0],lease_token:'wrong'},...observed.slice(1)],known));
  assert.throws(()=>checkEventInventory({events},[...observed.slice(0,4),{...observed[4],attempt_count:1}],known));
});
