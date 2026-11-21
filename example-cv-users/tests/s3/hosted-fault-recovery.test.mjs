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
