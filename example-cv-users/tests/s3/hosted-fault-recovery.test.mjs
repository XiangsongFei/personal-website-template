import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCleanupRollback} from '../../scripts/s36-hosted/outbox-live.mjs';
import {publicationFaultFixture,recoveryCommands} from '../../scripts/s36-hosted/publication-recovery.mjs';
import {calculateTimeboxWindow} from '../../scripts/s36-hosted/session-timebox-plan.mjs';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('cleanup compares durable state and independently verifies advancing database time',()=>{
  const before={clock:12,pointer:{revision:4},outbox_enabled:true};
  verifyCleanupRollback(before,{...before,clock:15});
  assert.throws(()=>verifyCleanupRollback(before,{...before,clock:15,outbox_enabled:false}));
  assert.throws(()=>verifyCleanupRollback(before,{...before,clock:11}));
});

test('publication fixtures bind distinct requests, genuine draft 6, after-effect trigger, and narrow teardown',()=>{
  const actor={site:uuid(1),uid:uuid(2),sid:uuid(3)};
  const site={draft_revision:5,publication:{publication_revision:9,state:'unpublished'},
    payload:{schema_version:1,entries:[{id:uuid(4),position:0,translations:{en:'original'}}]}};
  const keys=Object.fromEntries(['save','faultPublish','publish','faultWithdraw','withdraw'].map((name,index)=>[name,uuid(index+10)]));
  const commands=recoveryCommands(site,keys);
  assert.notEqual(commands.save.payload.entries[0].translations.en,'original');
  assert.equal(commands.faultPublish.snapshot_id,null);
  assert.deepEqual([commands.publish.expected_draft_revision,commands.withdraw.expected_publication_revision],[6,10]);
  const fixture=publicationFaultFixture(actor,commands);
  for(const id of [actor.site,actor.uid,actor.sid,keys.faultPublish,keys.faultWithdraw]) assert.ok(fixture.install.includes(id));
  for(const id of [keys.save,keys.publish,keys.withdraw]) assert.ok(!fixture.install.includes(id));
  assert.match(fixture.install,/DEFERRABLE INITIALLY DEFERRED/);
  assert.match(fixture.install,/source_draft_revision=6/);
  assert.ok(fixture.remove.includes(fixture.bodySha));
});

test('natural expiry rehearsal requires the same qualified session after the requested timebox boundary',()=>{
  const sid=uuid(1), uid=uuid(2), bound={sid,uid};
  const fixture={policy:{scope:'isolated-rehearsal',timeboxSeconds:300,inactivitySeconds:0},now:1010,
    session:{id:sid,uid,createdAt:1000,notAfter:null},jwt:{...bound,expiresAt:4600},
    grant:{...bound,expiresAt:1500,active:true,epoch:1},proof:{...bound,expiresAt:1530,active:true,epoch:1}};
  assert.deepEqual(calculateTimeboxWindow(fixture),{sid,beforeAt:1285,afterAt:1310,deadline:1300,eligibilityEnds:1500});
  assert.throws(()=>calculateTimeboxWindow({...fixture,grant:{...fixture.grant,expiresAt:1305}}));
  assert.throws(()=>calculateTimeboxWindow({...fixture,jwt:{...fixture.jwt,sid:uuid(3)}}));
  assert.throws(()=>calculateTimeboxWindow({...fixture,session:{...fixture.session,notAfter:1250}}));
  assert.throws(()=>calculateTimeboxWindow({...fixture,policy:{...fixture.policy,timeboxSeconds:0}}));
});

test('timebox migration is derived only from the exact frozen M7 and trusted session age',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {buildTimeboxMigration}=await import('../../scripts/s36-hosted/session-timebox.mjs');
  const source=await readFile(new URL('../../supabase/migrations/20261111045535_s3_private_service_identity.sql',import.meta.url),'utf8');
  const {sql,sha}=buildTimeboxMigration(source);
  assert.match(sha,/^[a-f0-9]{64}$/);
  assert.match(sql,/SELECT a.created_at INTO born FROM auth.sessions a WHERE a.id=s AND a.user_id=u/);
  assert.match(sql,/WHERE w.singleton AND w.project_ref='vellypyadcxkvqftsbrg' FOR SHARE/);
  assert.match(sql,/R05_SESSION_TIMEBOX_EXPIRED/);
  assert.throws(()=>buildTimeboxMigration(source.replace('RETURN QUERY SELECT u,s;', 'RETURN QUERY SELECT s,u;')));
});

test('timebox restores both authoritative policy and checked DB readback after an action error',async()=>{
  const {withPlatformTimebox,zeroPolicy}=await import('../../scripts/s36-hosted/session-timebox.mjs');
  let hosted=0, db=0, changes=[];
  const admin={read:async()=>({...zeroPolicy,seconds:hosted}),set:async seconds=>{hosted=seconds;}};
  const testError=new Error('action failed');
  await assert.rejects(withPlatformTimebox({admin,change:label=>{
    changes.push(label);
    if(label==='timebox-policy-restore') throw Error('first reset did not commit');
    db=label==='timebox-policy-activate'?300:0;
  },readLocal:()=>db,receipt:()=>{},action:async()=>{
    assert.deepEqual([hosted,db],[300,300]);
    throw testError;
  }}),error=>error===testError);
  assert.deepEqual([hosted,db],[0,0]);
  assert.deepEqual(changes,['timebox-policy-activate','timebox-policy-restore','timebox-policy-recover']);
});
