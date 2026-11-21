import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {literalFixture,verifyReceiptOnly} from '../../scripts/s36-hosted/remaining-boundaries.mjs';
import {buildInstallFailure} from '../../scripts/s36-hosted/stage-install-rehearsal.mjs';

test('no-op accepts exactly one correctly scoped receipt and rejects extra writes or altered history',()=>{
  const actor={site:'alice-site',uid:'alice',sid:'current-session'};
  const publication={publication_revision:9,state:'unpublished',snapshot_id:null};
  const before={operations:[{id:'historical'}],sites:[{id:actor.site,draft_revision:5,publication}],outbox:[{state:'unknown'}]};
  const operation='save_text_draft', input={schema_version:1,request_id:'shared',expected_draft_revision:5,payload:{entries:[]}};
  const result={schema_version:1,request_id:'shared',site_id:actor.site,changed:false,draft_revision:5,publication};
  const canonical_request=JSON.stringify({operation,...input});
  const row={id:'new',site_id:actor.site,actor_auth_user_id:actor.uid,actor_session_id:actor.sid,
    operation,request_id:input.request_id,state:'succeeded',canonical_request,digest_encoding:'js-json-stringify-v1',
    payload_digest:createHash('sha256').update(canonical_request).digest('hex'),result};
  const next={...before,operations:[...before.operations,row]};
  verifyReceiptOnly(before,next,actor,operation,input,result);
  for(const invalid of [{...next,outbox:[]},{...next,operations:[row]},
    {...next,operations:[...before.operations,{...row,actor_session_id:'incorrect'}]},
    {...next,operations:[...before.operations,row,{...row,id:'extra'}]}])
    assert.throws(()=>verifyReceiptOnly(before,invalid,actor,operation,input,result));
});

test('literal fixture is a per-Session invoker and compares actual content before undoing the write',()=>{
  const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const actor={site:uuid(1),uid:uuid(2),sid:uuid(3)};
  const site={id:actor.site,payload:{entries:[{id:uuid(4),position:0,translations:{en:'fixture'}}]}};
  const fixture=literalFixture(actor,site,uuid(5));
  for(const binding of [actor.site,actor.uid,actor.sid,uuid(5)]) assert.ok(fixture.install.includes(binding));
  assert.match(fixture.install,/SECURITY INVOKER/);
  assert.match(fixture.install,/readback->'entries' IS DISTINCT FROM/);
  assert.match(fixture.install,/EXCEPTION WHEN SQLSTATE 'PZ362'/);
  assert.match(fixture.install,/restored IS DISTINCT FROM before_save/);
  assert.ok(fixture.remove.includes(fixture.bodySha));
  assert.throws(()=>literalFixture({...actor,site:uuid(6)},site,uuid(5)));
});

test('installation failure staging requires the frozen digest and removes the terminal commit',()=>{
  const source='BEGIN;\nSELECT 1;\nCOMMIT;\n';
  const sum=createHash('sha256').update(source).digest('hex');
  const artifact=buildInstallFailure('01',source,sum);
  assert.match(artifact,/s36_rebuild/);
  assert.match(artifact,/S36_INSTALL_FAULT_01/);
  assert.doesNotMatch(artifact,/COMMIT;/);
  assert.throws(()=>buildInstallFailure('01',source,'wrong'));
  const trailing=source+'SELECT 2;\n';
  assert.throws(()=>buildInstallFailure('01',trailing,createHash('sha256').update(trailing).digest('hex')));
});
