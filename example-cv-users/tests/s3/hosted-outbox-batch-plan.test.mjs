import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {writeOnce} from '../../scripts/s36-hosted/r3.mjs';
import {admitOutboxPlan,buildOutboxBatch,outboxCall,recordOutboxInvalidation,verifyOutboxCurrent} from '../../scripts/s36-hosted/outbox-batch-plan.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const aliceSite=id(1);
const outbox=Array.from({length:5},(_,i)=>({id:id(i+10),site_id:aliceSite,publication_revision:i+1,
  event_type:i===1||i===4?'unpublished':'published',operation_id:id(i+20),state:'pending',attempt_count:0,
  lease_generation:0,lease_owner:null,lease_token:null,lease_until:null,dispatch_started_at:null,completed_at:null,last_code:null}));
const row=(site,draft,publication)=>({id:site,draft_revision:draft,publication:{state:'unpublished',snapshot_id:null,publication_revision:publication}});
const observed={target:'vellypyadcxkvqftsbrg',acl:[false,false],site_total:2,user_total:2,snapshots:[{},{}],
  sites:[row(aliceSite,5,5),row(id(2),0,0)],outbox,history:outbox.map(e=>({...e,state:e.event_type}))};
test('binds exactly the five reconciled pending events and refuses drift',()=>{
  const plan=buildOutboxBatch(observed,aliceSite);
  assert.equal(plan.events.length,5);
  assert.equal(plan.events.reduce((sum,e)=>sum+e.maxCalls,0),plan.workerCallLimit);
  assert.equal(plan.events.reduce((sum,e)=>sum+e.egress,0),1);
  assert.throws(()=>buildOutboxBatch({...observed,acl:[true,false]},aliceSite));
  assert.throws(()=>buildOutboxBatch({...observed,outbox:[{...outbox[0],attempt_count:1},...outbox.slice(1)]},aliceSite));
  assert.throws(()=>buildOutboxBatch({...observed,outbox:[...outbox.slice(0,4),{...outbox[4],site_id:id(2)}]},aliceSite));
});
test('worker queries are parameterized and exclude other events and arbitrary methods',()=>{
  const plan=buildOutboxBatch(observed,aliceSite);
  const call=outboxCall(plan,outbox[0].id,0);
  assert.match(call.text,/claim_text_outbox\(\$1::uuid/);
  assert.equal(call.values[0],outbox[0].id);
  assert.notEqual(call.values[1],outboxCall(plan,outbox[0].id,1).values[1]);
  assert.throws(()=>outboxCall(plan,id(100),0));
  assert.throws(()=>outboxCall(plan,outbox[0].id,6));
  assert.throws(()=>outboxCall(plan,outbox[0].id,3));
  const winner=outboxCall(plan,outbox[0].id,1);
  assert.deepEqual(outboxCall(plan,outbox[0].id,4,1).values.slice(1,3),winner.values.slice(1,3));
  for(const index of [0,1]) {
    const [,owner,token]=outboxCall(plan,outbox[0].id,index).values;
    const wrong=outboxCall(plan,outbox[0].id,3,index);
    assert.equal(wrong.expected,'PT503');
    assert.equal(wrong.values[1],owner);
    assert.match(wrong.values[2],/^[a-f0-9-]{36}$/);
    assert.notEqual(wrong.values[2],token);
  }
  verifyOutboxCurrent(plan,{publication_revision:5,state:'unpublished'});
  assert.throws(()=>verifyOutboxCurrent(plan,{publication_revision:6,state:'published'}));
});
test('sink persists the current admitted event once and rejects stale events and excess fields',()=>{
  const proposed=buildOutboxBatch(observed,aliceSite);
  const path=mkdtempSync(join(realpathSync(tmpdir()),'s36-outbox-sink.'));
  try {
    const file=join(path,'outbox-plan.json');
    writeOnce(file,proposed);
    const hash=createHash('sha256').update(JSON.stringify(proposed)+'\n').digest('hex');
    assert.throws(()=>admitOutboxPlan(file,'a'.repeat(64)));
    const plan=admitOutboxPlan(file,hash);
    assert.ok(Object.isFrozen(plan.events[0].actions));
    const event=index=>Object.fromEntries(['event_id','site_id','publication_revision','event_type'].map(key=>[key,plan.events[index][key]]));
    assert.throws(()=>recordOutboxInvalidation(proposed,path,event(4),event(4).event_id));
    assert.throws(()=>recordOutboxInvalidation(plan,path,event(0),event(0).event_id));
    const input=event(4);
    assert.throws(()=>recordOutboxInvalidation(plan,path,{...input,payload:'excess'},input.event_id));
    assert.throws(()=>recordOutboxInvalidation(plan,path,input,id(100)));
    assert.deepEqual(recordOutboxInvalidation(plan,path,input,input.event_id),{accepted:true,duplicate:false});
    assert.deepEqual(recordOutboxInvalidation(plan,path,input,input.event_id),{accepted:true,duplicate:true});
  } finally { rmSync(path,{recursive:true,force:true}); }
});

test('receiver peer boundary rejects network identity, forwarding, paths and plaintext impostors without listening',async()=>{
  const {checkOutboxReceiverPeer}=await import('../../scripts/s36-hosted/outbox-loopback-receiver.mjs');
  const fingerprint='AA:'.repeat(31)+'AA';
  const req={socket:{remoteAddress:'127.0.0.1',authorized:true,getPeerCertificate:()=>({fingerprint256:fingerprint})},
    method:'POST',url:'/invalidate',headers:{host:'127.0.0.1:9444','content-type':'application/json','idempotency-key':id(10)}};
  checkOutboxReceiverPeer(req,'127.0.0.1:9444',fingerprint);
  const unsafe=[
    {...req,socket:{...req.socket,authorized:false}},
    {...req,socket:{...req.socket,remoteAddress:'192.0.2.1'}},
    {...req,socket:{...req.socket,getPeerCertificate:()=>({fingerprint256:'wrong'})}},
    {...req,headers:{...req.headers,'x-forwarded-host':'127.0.0.1:9444'}},
    {...req,url:'/invalidate?spoof=1'}
  ];
  for (const attempt of unsafe) assert.throws(()=>checkOutboxReceiverPeer(attempt,'127.0.0.1:9444',fingerprint));
});
