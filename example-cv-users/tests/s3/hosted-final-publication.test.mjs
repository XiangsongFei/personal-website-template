import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerFixtureSql,runHttpsContrast,verifyDomainRestoration} from '../../scripts/s36-hosted/hosted-final-publication.mjs';
import {bindR24} from '../../scripts/s36-hosted/r24-plan.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('owner probe binds site, actor, real session and one request, controls SQLSTATE and restores in a subtransaction',()=>{
  const bound={target:id(1),uid:id(2),sid:id(3),requestKey:id(4)};
  const {install,remove,bodySha256}=ownerFixtureSql(bound);
  for(const value of Object.values(bound)) assert.ok(install.includes(value));
  assert.match(install,/session_user='ecv_s3_internal_api_login'/);
  assert.match(install,/EXCEPTION WHEN SQLSTATE '42501'/);
  assert.match(install,/EXCEPTION WHEN SQLSTATE 'PZ057'/);
  assert.equal(install.match(/site_api\.read_introduction\(target\)/g).length,3);
  assert.ok(remove.includes(bodySha256));
  assert.match(remove,/DROP POLICY s36_owner_fixture_delete/);
  assert.throws(()=>ownerFixtureSql({...bound,requestKey:"'; SELECT 1"}));
});

test('R24 binds only the current Alice withdrawal; prior UNKNOWN and FAILED remain byte-for-byte',()=>{
  const alice=id(1),bob=id(2),request=id(12);
  const before={outbox:[['superseded',1],['failed',3],['unknown',1],['superseded',1],['delivered',1]]
    .map(([state,attempt_count],i)=>({id:id(i+20),state,attempt_count}))};
  const rows=[[alice,6,'published'],[alice,7,'unpublished'],[bob,1,'published'],[bob,2,'unpublished']]
   .map(([site_id,publication_revision,event_type],i)=>({id:id(i+30),site_id,publication_revision,event_type,
      operation_id:id(i+40),state:'pending',attempt_count:0,lease_generation:0}));
  const after={target:'vellypyadcxkvqftsbrg',acl:[false,false],outbox:[...before.outbox,...rows],
    sites:[[alice,7,5],[bob,2,0]].map(([id,publication_revision,draft_revision])=>({id,draft_revision,
      publication:{state:'unpublished',snapshot_id:null,publication_revision}})),
    operations:[{id:rows[1].operation_id,request_id:request,operation:'unpublish_site',site_id:alice}]};
  const plan=bindR24(after,before,alice,bob,request);
  assert.equal(plan.events[0].event_id,rows[1].id);
  assert.equal(plan.workerCallLimit,7);
  assert.deepEqual(plan.events[0].actions.map(x=>x.method),['claim','current','start','unknown','read','claim','read']);
  assert.throws(()=>bindR24({...after,outbox:[{...after.outbox[0],state:'pending'},...after.outbox.slice(1)]},
    before,alice,bob,request));
  assert.throws(()=>bindR24(after,before,alice,bob,id(99)));
});

test('restore allows audit timestamp advance only, preserving domain state and identity',()=>{
  const before={id:id(4),state:'reserved',verified_at:null,updated_at:'2026-11-21T00:00:00Z'};
  const after={...before,updated_at:'2026-11-21T00:10:00Z'};
  verifyDomainRestoration([before],[after]);
  assert.throws(()=>verifyDomainRestoration([before],[{...after,state:'active'}]));
  assert.throws(()=>verifyDomainRestoration([before],[{...after,id:id(5)}]));
});

test('both open-gate HTTPS preflights precede dispatch; each publish is followed by an immediate content check',async()=>{
 const steps=[];
 const hooks={publication:async label=>steps.push(label),afterPreflight:()=>steps.push('admitted'),
   readHttp:async(name,stage,state)=>{
     steps.push([name,stage,state]);
     return {snapshotId:name,projectionSha256:name,bodySha256:name};
   }};
 await runHttpsContrast(hooks);
 assert.deepEqual(steps,[['alice','preflight','unpublished'],['bob','preflight','unpublished'],'admitted',
   'alicePublish',['alice','published','published'],'bobPublish',['bob','published','published'],
   ['alice','both-published','published'],'aliceWithdraw',['alice','withdrawn','unpublished'],
   'bobWithdraw',['bob','withdrawn','unpublished']]);
});

test('a failed preflight dispatches no publication, and a failed content check prevents the next publish',async()=>{
 for(const stage of ['preflight','published']) {
   const dispatched=[];
   await assert.rejects(runHttpsContrast({publication:async label=>dispatched.push(label),afterPreflight:()=>{},
     readHttp:async(name,phase)=>{
       if(phase===stage&&(stage==='published'||name==='bob')) throw Error('HTTPS_NOT_VERIFIED');
     }}),/HTTPS_NOT_VERIFIED/);
   assert.deepEqual(dispatched,stage==='preflight'?[]:['alicePublish']);
 }
});
