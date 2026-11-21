import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstatSync,realpathSync} from 'node:fs';
import {exact,uuid} from '../../lib/business/protocol.mjs';
import {publicationProject,privateFile} from './target.mjs';
import {writeOnce} from './r3.mjs';

const worker='ecv_s36_outbox_worker';
const admitted=new WeakSet();
const eventIds=[1,2,3,4,5];
const digest=text=>createHash('sha256').update(text).digest('hex');
const types=['published','unpublished','published','published','unpublished'];
const methods=Object.freeze({
  claim:'SELECT site_private.claim_text_outbox($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::boolean,$6::integer) AS result',
  start:'SELECT site_private.start_text_outbox($1::uuid,$2::uuid,$3::uuid,$4::bigint) AS result',
  finish:'SELECT site_private.finish_text_outbox($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::bigint) AS result',
  fail:'SELECT site_private.fail_text_outbox($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::bigint) AS result',
  unknown:'SELECT site_private.unknown_text_outbox($1::uuid,$2::uuid,$3::uuid,$4::bigint) AS result',
  read:'SELECT site_private.read_text_outbox($1::uuid) AS result',
  current:'SELECT site_private.read_text_outbox_publication($1::uuid) AS result'
});
const purpose=[
  {covers:['R21','R22','R23'],kind:'concurrent-claim-stale-and-superseded',maxCalls:6,egress:0},
  {covers:['R22'],kind:'lease-expiry-and-three-attempt-limit',maxCalls:7,egress:0},
  {covers:['R22','R24'],kind:'started-then-expired-injected-before-egress',maxCalls:6,egress:0},
  {covers:['R21','R23'],kind:'stale-version-not-sent',maxCalls:4,egress:0},
  {covers:['R20','R21','R24'],kind:'loopback-delivery-with-lost-finish-receipt',maxCalls:7,egress:1}
];

function eventActions(event,workerIds) {
  const [first,second]=workerIds;
  const {event_id,site_id,publication_revision}=event;
  const step=(method,values,expected,conditions={})=>({method,values,expected,...conditions});
  const token=randomUUID();
  const next=randomUUID();
  const third=randomUUID();
  const extra=randomUUID();
  const lease=(value=token,generation=1,owner=first)=>[event_id,owner,value,generation];
  const claim=(value,generation,retry,expected,conditions={},owner=first,length=5000)=>
    step('claim',[...lease(value,generation,owner),retry,length],expected,conditions);
  const read=(state,attempt)=>step('read',[event_id],{state,attempt});
  const pointer=()=>step('current',[site_id],{publication_revision:5,state:'unpublished'});
  const supersede=(value=token,owner=first)=>step('finish',[...lease(value,1,owner),'superseded',5],{state:'superseded'});
  switch(publication_revision) {
    case 1:
      return [
        claim(token,0,false,'one-lease-one-PT409',{parallel:'claim-race'}),
        claim(next,0,false,'one-lease-one-PT409',{parallel:'claim-race'},second),
        read('leased',1),
        step('finish',[...lease(third,1,'race.owner'),'superseded',5],'PT503',{requires:'resolved-race'}),
        {...supersede('race.token','race.owner'),requires:'resolved-race'},
        claim(extra,1,false,{claimed:false,state:'superseded'})
      ];
    case 2:
      return [
        claim(token,0,false,{claimed:true,attempt:1},{},first,1500),
        claim(next,1,false,{claimed:false,state:'failed',code:'LEASE_EXPIRED'},{waitForLeaseExpiry:true}),
        claim(next,1,true,{claimed:true,attempt:2},{},first,1500),
        claim(third,2,false,{claimed:false,state:'failed',code:'LEASE_EXPIRED'},{waitForLeaseExpiry:true}),
        claim(third,2,true,{claimed:true,attempt:3},{},first,1500),
        claim(extra,3,true,{claimed:false,state:'failed',code:'LEASE_EXPIRED'},{waitForLeaseExpiry:true}),
        read('failed',3)
      ];
    case 3:
      return [
        claim(token,0,false,{claimed:true,attempt:1},{},first,1500),
        step('start',lease(),{state:'leased',dispatch_started:true},{fault:'stop-before-egress'}),
        claim(next,1,false,{claimed:false,state:'unknown'},{waitForLeaseExpiry:true}),
        step('finish',[...lease(),'superseded',5],'PT503'),
        claim(third,1,true,{claimed:false,state:'unknown'}),
        read('unknown',1)
      ];
    case 4:
      return [claim(token,0,false,{claimed:true,attempt:1}),pointer(),supersede(),read('superseded',1)];
    case 5:
      return [
        claim(token,0,false,{claimed:true,attempt:1}),pointer(),
        step('start',lease(),{state:'leased',dispatch_started:true},{egressAfterCommit:1}),
        step('finish',[...lease(),'delivered',5],{state:'delivered'},{requires:'unique-loopback-ack',fault:'discard-finish-reply'}),
        read('delivered',1),
        claim(next,1,true,{claimed:false,state:'delivered'}),
        read('delivered',1)
      ];
    default: throw new Error('OUTBOX_EVENT_NOT_STAGED');
  }
}

export function buildOutboxBatch(observed,aliceSite) {
  assert.equal(observed.target,publicationProject);
  assert.ok(uuid(aliceSite));
  assert.deepEqual(observed.acl,[false,false]);
  assert.equal(observed.site_total,2);
  assert.equal(observed.user_total,2);
  assert.equal(observed.sites.length,2);
  assert.equal(observed.snapshots.length,2);
  for(const site of observed.sites) {
    const isAlice=site.id===aliceSite;
    assert.equal(site.draft_revision,isAlice?5:0);
    assert.deepEqual([site.publication.state,site.publication.snapshot_id,site.publication.publication_revision],
      ['unpublished',null,isAlice?5:0]);
  }
  assert.equal(observed.sites.filter(s=>s.id===aliceSite).length,1);
  assert.equal(observed.outbox.length,5);
  const workerIds=[randomUUID(),randomUUID()];
  const entries=eventIds.map((version,index)=>{
    const event=observed.outbox.find(row=>row.publication_revision===version);
    assert.ok(event&&uuid(event.id)&&uuid(event.operation_id));
    assert.equal(event.site_id,aliceSite);
    assert.equal(event.event_type,types[index]);
    assert.equal(event.state,'pending');
    assert.deepEqual([event.lease_generation,event.attempt_count],[0,0]);
    for(const k of ['lease_owner','lease_token','lease_until','dispatch_started_at','completed_at','last_code'])
      assert.equal(event[k],null,k);
    const history=observed.history.find(h=>h.site_id===aliceSite&&h.publication_revision===version);
    assert.equal(history?.state,event.event_type);
    assert.equal(history.operation_id,event.operation_id);
    const bound={event_id:event.id,site_id:aliceSite,publication_revision:version,event_type:event.event_type,...purpose[index]};
    const actions=eventActions(bound,workerIds);
    assert.equal(actions.length,bound.maxCalls);
    return {...bound,actions};
  });
  assert.equal(new Set(entries.map(event=>event.event_id)).size,5);
  const workerCallLimit=entries.reduce((total,event)=>total+event.actions.length,0);
  const egressLimit=entries.reduce((total,event)=>total+event.egress,0);
  assert.deepEqual([workerCallLimit,egressLimit],[30,1]);
  return {project:publicationProject,aliceSite,worker,workerIds,requiresSeparateApproval:true,
    expectedPointer:{publication_revision:5,state:'unpublished'},sourceSha256:digest(JSON.stringify(observed)),
    events:entries,workerCallLimit,
    workerConnectionLimit:2,egressLimit,receiver:'verified HTTPS loopback only',
    sql:methods,optionalSecondDelivery:{needsExplicitPublicationWrites:true,createPublicationRevision:6,
      deferEventIdUntilReadback:true,withdrawToRevision:7,additionalWorkerCalls:7,additionalEgress:1}};
}

export function admitOutboxPlan(path,hash) {
  assert.match(hash,/^[0-9a-f]{64}$/);
  const bytes=privateFile(path);
  assert.equal(digest(bytes),hash);
  const plan=JSON.parse(bytes);
  assert.equal(bytes,JSON.stringify(plan)+'\n');
  assert.equal(plan.project,publicationProject);
  assert.equal(plan.requiresSeparateApproval,true);
  function freeze(value) {
    if (value!==null&&typeof value==='object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  }
  freeze(plan);
  admitted.add(plan);
  return plan;
}

export function verifyOutboxCurrent(plan,result) {
  assert.equal(plan.project,publicationProject);
  assert.deepEqual(result,plan.expectedPointer);
}

// This prepares a query for a future sequencer; it never opens a database connection.
export function outboxCall(plan,eventId,index,raceWinner) {
  assert.equal(plan.project,publicationProject);
  assert.equal(plan.worker,worker);
  assert.ok(uuid(eventId));
  const actions=plan.events.find(event=>event.event_id===eventId)?.actions;
  assert.ok(actions && Number.isSafeInteger(index) && index>=0 && index<actions.length);
  const {method,values,expected,...conditions}=actions[index];
  assert.ok(Object.hasOwn(methods,method));
  if (conditions.requires==='resolved-race') {
    assert.ok(raceWinner===0||raceWinner===1);
    const [,owner,token]=actions[raceWinner].values;
    return {text:methods[method],values:values.map(value=>value==='race.owner'?owner:value==='race.token'?token:value),expected,conditions};
  }
  return {text:methods[method],values:[...values],expected,conditions};
}

export function assertOutboxReceiptBinding(plan,journal) {
  assert.ok(admitted.has(plan));
  assert.ok(isAbsolute(journal)&&realpathSync(journal)===journal);
  const stat=lstatSync(journal);
  assert.ok(stat.isDirectory()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0);
}

// A separate TLS boundary calls this only on an authenticated loopback request.
// writeOnce fsyncs both the exclusively created 0600 file and its directory.

export function recordOutboxInvalidation(plan,journal,input,idempotencyKey) {
  assertOutboxReceiptBinding(plan,journal);
  exact(input,['event_id','site_id','publication_revision','event_type']);
  assert.equal(input.event_id,idempotencyKey);
  const admitted=plan.events.find(event=>event.event_id===input.event_id&&event.egress===1);
  assert.ok(admitted && plan.project===publicationProject);
  const record=Object.fromEntries(Object.keys(input).map(key=>[key,admitted[key]]));
  assert.deepEqual(input,record);
  const path=join(journal,'invalidate-'+admitted.event_id+'.json');
  try { writeOnce(path,record); return {accepted:true,duplicate:false}; }
  catch(error) {
    if(error?.code!=='EEXIST') throw error;
    assert.deepEqual(JSON.parse(privateFile(path)),record);
    return {accepted:true,duplicate:true};
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [mode,readback,fixture,journal]=process.argv.slice(2);
  assert.equal(mode,'--plan-only');
  assert.equal(process.argv.length,6);
  assert.ok(isAbsolute(journal));
  const config=JSON.parse(privateFile(fixture));
  assert.equal(config.project,publicationProject);
  const plan=buildOutboxBatch(JSON.parse(privateFile(readback)),config.aliceSite);
  const path=join(journal,'outbox-batch.json');
  writeOnce(path,plan);
  const sha256=digest(privateFile(path));
  admitOutboxPlan(path,sha256);
  writeOnce(join(journal,'outbox-batch-binding.json'),{project:plan.project,sha256,sourceSha256:plan.sourceSha256});
  console.log(JSON.stringify({project:plan.project,sha256,workerCalls:plan.workerCallLimit,egress:plan.egressLimit}));
}
