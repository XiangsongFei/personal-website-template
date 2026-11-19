// OFFLINE ONLY. Pure state/effect tests, no JWT, Grant, SQL, Storage or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessError,sha256} from '../../lib/business/protocol.mjs';
import {initialTextPublication,planTextPublication,readTextPublicationOperation,textPayload} from '../../lib/business/text-publication.mjs';

const id=n=>'b3600000-0000-4000-8000-'+String(n).padStart(12,'0');
const site=id(1),owner=id(2),actor={uid:owner,sid:id(3)};
const payload=(text='Draft only')=>({schema_version:1,entries:[{id:id(4),position:0,translations:{zh:'纯文本',en:text}}]});
const pub=(request=10,pr=0,dr=0,snapshot_id=null)=>({schema_version:1,request_id:id(request),
  expected_publication_revision:pr,expected_draft_revision:dr,snapshot_id});
const unpub=(request=11,pr=1)=>({schema_version:1,request_id:id(request),expected_publication_revision:pr});
const save=(request=12,dr=0,text='Changed draft')=>({schema_version:1,request_id:id(request),expected_draft_revision:dr,payload:payload(text)});
const initial=()=>initialTextPublication({site_id:site,owner_uid:owner,payload:payload()});
const plan=(s,op,input,opts={})=>planTextPublication(s,actor,op,input,{now:1800000000,snapshot_id:id(100),...opts});
const code=c=>e=>e instanceof BusinessError&&e.code===c;

test('OFFLINE initial permanent row uses S3.2 unpublished/null/revision0 plus a real baseline revision',async()=>{
  const s=await initial();
  assert.deepEqual(s.publication,{site_id:site,state:'unpublished',snapshot_id:null,publication_revision:0,changed_at:null,changed_by:null});
  assert.equal(s.draft_revisions[0].site_revision,0);assert.equal(s.snapshots.length,0);
});
test('OFFLINE snapshot deep copies revision0; subsequent draft change does not publish or mutate snapshot',async()=>{
  const before=await initial(),published=await plan(before,'publish_site',pub());
  const draft=await plan(published.next,'save_text_draft',save());
  assert.equal(published.mode,'OFFLINE_PLAN');assert.equal('persisted' in published.result,false);
  assert.equal(published.next.snapshots[0].source_draft_revision,0);
  assert.equal(draft.next.draft_revision,1);assert.equal(draft.next.snapshots[0].payload.entries[0].translations.en,'Draft only');
  assert.deepEqual(draft.next.publication,published.next.publication);
  assert.equal(draft.effects.publication,null);assert.equal(draft.effects.outbox.length,0);
  assert.equal(before.snapshots.length,0);assert.equal(before.draft_revision,0);
});
test('OFFLINE source payload and every returned snapshot/history node are immutable and detached',async()=>{
  const source=payload(),s=await initialTextPublication({site_id:site,owner_uid:owner,payload:source});
  source.entries[0].translations.en='outside mutation';
  const p=await plan(s,'publish_site',pub());
  assert.equal(p.next.snapshots[0].payload.entries[0].translations.en,'Draft only');
  assert.throws(()=>{p.next.snapshots[0].payload.entries[0].translations.en='mutate';},TypeError);
  assert.throws(()=>p.next.snapshots.pop(),TypeError);assert.throws(()=>p.next.operations.pop(),TypeError);
});
test('OFFLINE state/pointer/revision/snapshot/audit/receipt/outbox are one proposed write set',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  assert.equal(p.effects.snapshots.length,1);assert.equal(p.effects.operations.length,1);
  assert.equal(p.effects.audits.length,1);assert.equal(p.effects.outbox.length,1);
  assert.equal(p.effects.publication.snapshot_id,p.effects.snapshots[0].id);
  assert.equal(p.effects.publication.publication_revision,1);
  assert.equal(p.effects.outbox[0].publication_revision,1);assert.equal(p.effects.outbox[0].state,'pending');
});
test('OFFLINE idempotent replay returns original result before stale expected revision CAS, without new effects',async()=>{
  const first=await plan(await initial(),'publish_site',pub());
  const draft=await plan(first.next,'save_text_draft',save());
  const replay=await plan(draft.next,'publish_site',pub(),{snapshot_id:id(101)});
  assert.equal(replay.replayed,true);assert.deepEqual(replay.result,first.result);
  assert.equal(replay.next.draft_revision,1);assert.equal(replay.next.snapshots.length,1);
  for(const [name,rows]of Object.entries(replay.effects))assert.equal(name==='publication'?rows:rows.length,name==='publication'?null:0);
});
test('OFFLINE same idempotency key with changed payload/CAS is a conflict',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  await assert.rejects(plan(p.next,'publish_site',pub(10,1)),code('REQUEST_CONFLICT'));
  const s=await plan(await initial(),'save_text_draft',save());
  await assert.rejects(plan(s.next,'save_text_draft',save(12,0,'different')),code('REQUEST_CONFLICT'));
});
test('OFFLINE new stale publication/draft revisions fail without changing caller state',async()=>{
  const p=await plan(await initial(),'publish_site',pub()),before=structuredClone(p.next);
  await assert.rejects(plan(p.next,'publish_site',pub(13)),code('REQUEST_CONFLICT'));
  await assert.rejects(plan(p.next,'publish_site',pub(13,1,9)),code('REQUEST_CONFLICT'));
  assert.deepEqual(p.next,before);
});
test('OFFLINE unpublish preserves state row and all history; repeated unpublish is no-op',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  const u=await plan(p.next,'unpublish_site',unpub());
  assert.equal(u.next.publication.site_id,site);assert.equal(u.next.publication.state,'unpublished');
  assert.equal(u.next.publication.snapshot_id,null);assert.equal(u.next.publication.publication_revision,2);
  assert.equal(u.next.snapshots.length,1);assert.equal(u.next.draft_revisions.length,1);
  const repeat=await plan(u.next,'unpublish_site',unpub(14,2));
  assert.equal(repeat.result.changed,false);assert.equal(repeat.next.publication.publication_revision,2);
  assert.equal(repeat.effects.audits.length,0);assert.equal(repeat.effects.outbox.length,0);
});
test('OFFLINE publishing same snapshot is no-op; explicit re-publication increments without rewinding draft',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  const noop=await plan(p.next,'publish_site',pub(15,1));
  assert.equal(noop.result.changed,false);assert.equal(noop.next.snapshots.length,1);
  const draft=await plan(noop.next,'save_text_draft',save());
  const changed=await plan(draft.next,'publish_site',pub(16,1,1),{snapshot_id:id(101)});
  const old=await plan(changed.next,'publish_site',pub(17,2,1,id(100)));
  assert.equal(old.next.publication.publication_revision,3);
  assert.equal(old.next.publication.snapshot_id,id(100));assert.equal(old.next.draft_revision,1);
  assert.equal(old.next.snapshots.length,2);assert.equal(old.effects.snapshots.length,0);
});
test('OFFLINE no-op save normalizes key order and entry ordering; absent locale differs from empty',async()=>{
  const s=await initial(),same=save();same.payload.entries[0].translations={en:'Draft only',zh:'纯文本'};
  const no=await plan(s,'save_text_draft',same);assert.equal(no.result.changed,false);
  const missing=save(18);delete missing.payload.entries[0].translations.en;
  const m=await plan(no.next,'save_text_draft',missing);assert.equal(m.next.draft_revision,1);
  const empty=save(19,1,'');const e=await plan(m.next,'save_text_draft',empty);assert.equal(e.next.draft_revision,2);
});
test('OFFLINE losing a committed response reconciles the same original request; absent/pending remain UNKNOWN',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  const r=await readTextPublicationOperation(p.next,actor,'publish_site',pub());
  assert.equal(r.status,'succeeded');assert.deepEqual(r.result,p.result);
  const absent=await readTextPublicationOperation(p.next,actor,'publish_site',pub(99));
  assert.deepEqual(absent,{mode:'OFFLINE_RECONCILIATION',status:'UNKNOWN',request_id:id(99),retry_with_new_id:false});
  for(const state of ['pending','unknown']){
    const uncertain=structuredClone(p.next);uncertain.operations[0].state=state;uncertain.operations[0].result=null;
    assert.equal((await readTextPublicationOperation(uncertain,actor,'publish_site',pub())).status,'UNKNOWN');
    await assert.rejects(plan(uncertain,'unpublish_site',unpub()),code('COMMIT_UNKNOWN'));
  }
});
test('OFFLINE discarded plan and simulated transaction failure do not switch publication or leave partial outbox',async()=>{
  let committed=await initial();const original=structuredClone(committed);
  // This is a local failure injection, not evidence of PostgreSQL rollback.
  await assert.rejects((async()=>{
    const p=await plan(committed,'publish_site',pub());
    assert.equal(p.effects.outbox.length,1);throw Error('SIMULATED_BEFORE_COMMIT');
  })(),/SIMULATED_BEFORE_COMMIT/);
  assert.deepEqual(committed,original);assert.equal(committed.snapshots.length,0);
  assert.equal(committed.publication.snapshot_id,null);assert.equal(committed.operations.length,0);
});
test('OFFLINE outbox delivery is pending; planning never invokes purge or presents it as delivered',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  assert.deepEqual(p.next.outbox.map(x=>[x.state,x.attempt_count]),[['pending',0]]);
  assert.equal('purge' in p.result,false);
});
test('OFFLINE Owner attribution denies other UID, and another site cannot borrow snapshot',async()=>{
  const s=await initial();
  await assert.rejects(planTextPublication(s,{uid:id(55),sid:id(56)},'publish_site',pub(),{now:1,snapshot_id:id(100)}),code('BUSINESS_DENIED'));
  await assert.rejects(plan(s,'publish_site',pub(10,0,0,id(999))),code('BUSINESS_DENIED'));
});
test('OFFLINE malformed source revision, cross-site snapshot, missing permanent row and reset revision fail',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  for(const mutate of [
    x=>{x.snapshots[0].site_id=id(90);},x=>{x.snapshots[0].source_draft_revision=99;},
    x=>{x.snapshots[0].payload.entries[0].translations.en='tampered';},
    x=>{x.publication=null;},x=>{x.draft_revision=99;},x=>{x.publication.snapshot_id=null;},
    x=>{x.publication={site_id:site,state:'unpublished',snapshot_id:null,publication_revision:0,changed_by:null,changed_at:null};},
    x=>{x.outbox.push(structuredClone(x.outbox[0]));}
  ]){
    const bad=structuredClone(p.next);mutate(bad);
    await assert.rejects(plan(bad,'unpublish_site',unpub()),e=>e instanceof BusinessError);
  }
});
test('OFFLINE corrupt success receipts cannot fabricate a replay PASS',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  for(const mutate of [
    x=>{x.operations[0].result=null;},x=>{x.operations[0].result.site_id=id(90);},
    x=>{x.operations[0].result.publication.snapshot_id=id(99);},
    x=>{x.operations[0].result.changed=null;},x=>{x.operations.push(structuredClone(x.operations[0]));}
  ]){
    const bad=structuredClone(p.next);mutate(bad);
    await assert.rejects(plan(bad,'publish_site',pub()),e=>e instanceof BusinessError);
    await assert.rejects(readTextPublicationOperation(bad,actor,'publish_site',pub()),e=>e instanceof BusinessError);
  }
});
test('OFFLINE review regression: success receipt must match audited publication, even if its shape is valid',async()=>{
  const p=await plan(await initial(),'publish_site',pub()),bad=structuredClone(p.next);
  bad.operations[0].result.publication.state='unpublished';
  bad.operations[0].result.publication.snapshot_id=null;bad.audits=[];
  await assert.rejects(readTextPublicationOperation(bad,actor,'publish_site',pub()),e=>e instanceof BusinessError);
});
test('OFFLINE review regression: clearing counters/receipts/outbox cannot reuse revision1 while old snapshot/audit remains',async()=>{
  const p=await plan(await initial(),'publish_site',pub()),bad=structuredClone(p.next);
  bad.publication={site_id:site,state:'unpublished',snapshot_id:null,publication_revision:0,changed_at:null,changed_by:null};
  bad.outbox=[];bad.operations=[];
  await assert.rejects(plan(bad,'publish_site',pub(90)),e=>e instanceof BusinessError);
});
test('OFFLINE review regression: each publication revision has one matching audit/receipt/outbox',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  const u=await plan(p.next,'unpublish_site',unpub());
  for(const mutate of [
    x=>{x.audits.pop();},x=>{x.audits[0].publication.snapshot_id=id(88);},
    x=>{x.outbox[0].event_type='unpublished';},x=>{x.audits[0].request_id=id(88);},
    x=>{x.audits[1].publication_revision=1;}
  ]){
    const bad=structuredClone(u.next);mutate(bad);
    await assert.rejects(plan(bad,'unpublish_site',unpub(91,2)),e=>e instanceof BusinessError);
  }
});
test('OFFLINE review regression: sparse entries cannot become a null text item',()=>{
  assert.throws(()=>textPayload({schema_version:1,entries:Array(1)}),code('INVALID_INPUT'));
});
test('OFFLINE review regression: no-op receipt cannot borrow a later valid publication version',async()=>{
  const no=await plan(await initial(),'unpublish_site',unpub(11,0));
  const published=await plan(no.next,'publish_site',pub());
  const bad=structuredClone(published.next);bad.operations[0].result.publication=structuredClone(published.next.publication);
  await assert.rejects(readTextPublicationOperation(bad,actor,'unpublish_site',unpub(11,0)),code('PUBLICATION_STATE_INVALID'));
  await assert.rejects(plan(bad,'unpublish_site',unpub(11,0)),code('PUBLICATION_STATE_INVALID'));
});
test('OFFLINE no-op draft receipt stays bound to the publication version observed by its own operation',async()=>{
  const c=save();c.payload=payload();
  const no=await plan(await initial(),'save_text_draft',c),published=await plan(no.next,'publish_site',pub());
  const bad=structuredClone(published.next);
  bad.operations[0].result.publication=structuredClone(published.next.publication);
  await assert.rejects(readTextPublicationOperation(bad,actor,'save_text_draft',c),code('PUBLICATION_STATE_INVALID'));
  await assert.rejects(plan(bad,'save_text_draft',c),code('PUBLICATION_STATE_INVALID'));
  bad.operations[0].basis.publication_revision=published.next.publication.publication_revision;
  await assert.rejects(readTextPublicationOperation(bad,actor,'save_text_draft',c),code('PUBLICATION_STATE_INVALID'));
  await assert.rejects(plan(bad,'save_text_draft',c),code('PUBLICATION_STATE_INVALID'));
  bad.operations.push(bad.operations.shift());
  await assert.rejects(readTextPublicationOperation(bad,actor,'save_text_draft',c),code('PUBLICATION_STATE_INVALID'));
  await assert.rejects(plan(bad,'save_text_draft',c),code('PUBLICATION_STATE_INVALID'));
});
test('OFFLINE invalid inputs never generate snapshots or change caller state',async()=>{
  const s=await initial();
  for(const c of [pub(10,-1),pub(10,0,NaN),{...pub(),ready:true},{...pub(),snapshot_id:''}]){
    await assert.rejects(plan(s,'publish_site',c),code('INVALID_INPUT'));
  }
  assert.equal(s.snapshots.length,0);
});
for(const field of ['assets','attachments','ready','signed_url','photo_asset_id','href'])test('OFFLINE refuses asset/URL field '+field,async()=>{
  const input=save();input.payload[field]=field==='ready'?true:'https://private.invalid/asset';
  await assert.rejects(plan(await initial(),'save_text_draft',input),code('INVALID_INPUT'));
});
test('OFFLINE nested asset references, invalid locales, duplicate entries and oversized payload reject',()=>{
  for(const mutate of [
    x=>{x.entries[0].asset_id=id(70);},x=>{x.entries[0].translations.fr='extra';},
    x=>{x.entries.push(structuredClone(x.entries[0]));},x=>{x.entries[0].translations.en='x'.repeat(20001);}
  ]){const p=payload();mutate(p);assert.throws(()=>textPayload(p),code('INVALID_INPUT'));}
});
test('OFFLINE literal text is not rendered, fetched, resolved, or promoted to any file capability',()=>{
  const literal='<img src="https://private.invalid/file"> https://other.invalid/a';
  assert.equal(textPayload(payload(literal)).entries[0].translations.en,literal);
});

test('OFFLINE replay and reconciliation bind a save receipt to its resulting draft payload',async()=>{
  for(const original of [save(),save(12,0,'Draft only')]){
    const p=await plan(await initial(),'save_text_draft',original);
    const otherCommand=save(12,0,'Different payload');
    const otherPlan=await plan(await initial(),'save_text_draft',otherCommand);
    const bad=structuredClone(p.next);
    bad.operations[0].payload_digest=otherPlan.next.operations[0].payload_digest;
    await assert.rejects(plan(bad,'save_text_draft',otherCommand),code('PUBLICATION_STATE_INVALID'));
    await assert.rejects(readTextPublicationOperation(bad,actor,'save_text_draft',otherCommand),code('PUBLICATION_STATE_INVALID'));
  }
});

test('OFFLINE snapshot history has at most one snapshot per source draft revision',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  const u=await plan(p.next,'unpublish_site',unpub());
  const again=pub(20,2);
  const republished=await plan(u.next,'publish_site',again);
  const bad=structuredClone(republished.next),duplicateId=id(102);
  bad.snapshots.push({...bad.snapshots[0],id:duplicateId});
  bad.publication.snapshot_id=duplicateId;
  bad.audits.at(-1).publication.snapshot_id=duplicateId;
  bad.operations.at(-1).result.publication.snapshot_id=duplicateId;
  await assert.rejects(readTextPublicationOperation(bad,actor,'publish_site',again),code('PUBLICATION_STATE_INVALID'));
});

test('OFFLINE actor must match the original plain UID/SID shape before copying',async()=>{
  const state=await initial(),input=save();
  class Actor {
    uid=owner;
    sid=id(3);
  }
  const invalidActor=new Actor();
  await assert.rejects(planTextPublication(state,invalidActor,'save_text_draft',input,{now:1}),code('INVALID_INPUT'));
  await assert.rejects(readTextPublicationOperation(state,invalidActor,'save_text_draft',input),code('INVALID_INPUT'));
});

test('OFFLINE text preserves valid Unicode and rejects strings PostgreSQL cannot represent',()=>{
  const text='内容 😀\n\\ "';
  assert.equal(textPayload(payload(text)).entries[0].translations.en,text);
  for(const invalid of ['embedded\u0000NUL','\ud800','\udc00']){
    assert.throws(()=>textPayload(payload(invalid)),code('INVALID_INPUT'));
  }
});

test('OFFLINE publish rejects draft rewrites even when the draft content digest was recomputed',async()=>{
  const saved=await plan(await initial(),'save_text_draft',save());
  const bad=structuredClone(saved.next),row=bad.draft_revisions[1];
  const altered=textPayload(payload('Rewritten history'));
  row.payload=altered;
  row.digest=await sha256(new TextEncoder().encode(JSON.stringify(altered)));
  await assert.rejects(plan(bad,'publish_site',pub(30,0,1)),code('PUBLICATION_STATE_INVALID'));
});

test('OFFLINE an explicit snapshot cannot be supplied by the operation that created it',async()=>{
  const p=await plan(await initial(),'publish_site',pub());
  const bad=structuredClone(p.next),explicit=pub(10,0,0,id(100));
  const request={operation:'publish_site',schema_version:1,request_id:explicit.request_id,
    expected_draft_revision:0,expected_publication_revision:0,snapshot_id:explicit.snapshot_id};
  bad.operations[0].payload_digest=await sha256(new TextEncoder().encode(JSON.stringify(request)));
  await assert.rejects(readTextPublicationOperation(bad,actor,'publish_site',explicit),code('PUBLICATION_STATE_INVALID'));
});

test('OFFLINE validates audited save content even when its receipt is unresolved',async()=>{
  const input=save(),saved=await plan(await initial(),'save_text_draft',input);
  const bad=structuredClone(saved.next);
  bad.operations[0].state='unknown';
  bad.operations[0].result=null;
  assert.equal((await readTextPublicationOperation(bad,actor,'save_text_draft',input)).status,'UNKNOWN');
  const row=bad.draft_revisions[1];
  row.payload=textPayload(payload('Different saved content'));
  row.digest=await sha256(new TextEncoder().encode(JSON.stringify(row.payload)));
  await assert.rejects(readTextPublicationOperation(bad,actor,'save_text_draft',input),code('PUBLICATION_STATE_INVALID'));
});
