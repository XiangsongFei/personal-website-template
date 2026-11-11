import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelDatabase } from './business-model.mjs';
import { createCandidateHandler,createSiteService } from '../../lib/business/service.mjs';
import { createIdentityAdapter } from '../../lib/business/identity.mjs';
import { authIssuer } from './fixtures/binding.mjs';
import { siteBatch,people,siteBudget,siteRows } from './alice-bob-batch-plan.mjs';
const origin='https://site-model.example.invalid';
const now=1800000000;
const tokens=new Map(Object.entries(people).map(([name,{uid}],index)=>[name,{
  sub:uid,session_id:'ab000000-0000-4000-8000-00000000000'+(index+1),amr:[{method:'password'}],
  iss:authIssuer,role:'authenticated',aud:'authenticated',exp:now+60,is_anonymous:false
}]));

// In-memory handler to in-memory repository. No listener, fetch, file-backed credential or admin provider.
async function fixture() {
  const calls=[];
  const identity=createIdentityAdapter({issuer:authIssuer,clock:()=>now,auth:{
    getClaims:async key=>({data:{claims:tokens.get(key)}}),
    getUser:async key=>({data:{user:{id:tokens.get(key).sub,is_anonymous:false,email_confirmed_at:'2026-01-01'}}})
  }});
  const db=new ModelDatabase({clock:()=>now,keys:new Map(),
    users:new Map([...tokens.values()].map(c=>[c.sub,{confirmed:true}])),
    sessions:new Map([...tokens.values()].map(c=>[c.session_id,c.sub]))});
  const handles=new Map();
  for (const [name,c] of tokens) {
    handles.set(name,await identity.verifyAccount(name));
    // Deliberate site-only precondition. The M5 ticket/Grant suite owns qualification coverage.
    db.fixture(state=>{
      state.security.set(c.sub,{enabled:true,hold:false,reason:'none',epoch:1});
      state.grants.set(c.sub+':'+c.session_id,{purpose:'business',epoch:1,expires:now+1800,
        absolute:now+43200,issued:now,renewed:now,revoked:null});
    });
  }
  async function invoke(step) {
    if (step.kind==='READ_ONLY') {
      const s=db.snapshot();
      const tables=['sites','members','publications','domains','locales','settings','sections','entries','translations','revisions','operations','audits'];
      return {id:step.id,mode:'OFFLINE',rollback:true,readOnly:true,lock:'MODEL_SERIALIZATION_ONLY',conflict:'MODEL_ROLLBACK_ONLY',
        counts:Object.entries(siteRows).map(([relation,perSite],i)=>({relation,old_count:0,old_sha256:'0'.repeat(64),
          added_count:s[tables[i]].size*perSite})),
        owners:Object.entries(people).map(([actor,p])=>{
          const site=step.sites[actor];
          const owned_count=[...s.sites.values()].filter(row=>row.owner===p.uid).length;
          if (!site) return {actor,owned_count,owner_ok:[...s.sites.values()].some(row=>row.owner===p.uid)};
          return {actor,owned_count,owner_ok:s.sites.get(site)?.owner===p.uid,mirror_ok:s.members.get(site)?.uid===p.uid,
            unpublished_ok:s.publications.get(site)?.state==='unpublished',domain_ok:[...s.domains.values()].includes(site),
            locales_ok:s.locales.get(site)?.length===2,settings_ok:s.settings.get(site)?.default_locale==='en',
            section_ok:s.sections.get(site)?.introduction===0,entry_ok:s.entries.get(site)?.position===0,
            translations_ok:s.translations.get(site)?.en==='Add your introduction.',
            receipt_ok:[...s.operations.values()].some(row=>row.result.site_id===site),draft_ok:s.revisions.get(site)?.revision===0,
            audit_ok:s.audits.get(site)?.action==='create_site'};
        })};
    }
    calls.push(step.id);
    const handle=createCandidateHandler({origin,service:createSiteService({repository:db}),
      resolveAccount:async()=>handles.get(step.actor)});
    const response=await handle(new Request(origin+step.path,{
      method:step.method,headers:{Origin:origin,'Content-Type':'application/json'},
      body:step.body && JSON.stringify(step.body)
    }));
    return {id:step.id,complete:true,status:response.status,body:await response.json()};
  }
  return {calls,invoke,db};
}

test('18 case-limited site requests, independent tenant identities, 2 complete sites',async()=>{
  const f=await fixture(), batch=siteBatch('OFFLINE');
  let next=batch.next();
  while (!next.done) next=batch.next(await Promise.all(next.value.map(f.invoke)));
  assert.equal(next.value.status,'OFFLINE_PASS');
  assert.equal(f.calls.length,siteBudget.externalRequests);
  assert.equal(new Set(f.calls).size,18);
  const s=f.db.snapshot();
  for(const [name,p] of Object.entries(people)){
    const id=next.value[name+'Site'];
    assert.equal(s.sites.get(id).owner,p.uid); assert.equal(s.members.get(id).uid,p.uid);
    assert.deepEqual(s.locales.get(id),['zh','en']);
    assert.deepEqual(s.publications.get(id),{state:'unpublished',snapshot_id:null,publication_revision:0});
    assert.equal(s.domains.get('s33b-'+name+'-main-20261109.sites.example.test'),id);
  }
  for (const key of ['sites','members','locales','settings','publications','domains','sections','entries',
        'translations','revisions','operations','audits']) assert.equal(s[key].size,2,key);
});
test('loss after modeled commit keeps the original site and ends the batch with no reissue',async()=>{
  const f=await fixture();f.db.loseResponse=true;
  const batch=siteBatch('OFFLINE'), race=batch.next(await Promise.all(batch.next().value.map(f.invoke))).value;
  const received=await Promise.all(race.map(f.invoke));
  assert.throws(()=>batch.next(received),/INCOMPLETE_UNKNOWN/); assert.equal(batch.next().done,true);
  assert.equal(f.calls.length,2);assert.equal(f.db.snapshot().sites.size,1);
});
test('ambiguous or incomplete second racing receipt stops before Bob',async()=>{
  const f=await fixture(); const batch=siteBatch('OFFLINE'); const race=batch.next(await Promise.all(batch.next().value.map(f.invoke))).value;
  const r=await Promise.all(race.map(f.invoke));r[1].complete=false;
  assert.throws(()=>batch.next(r),/INCOMPLETE_UNKNOWN/);assert.equal(f.calls.length,2);
});
test('unexpected success on occupied hostname fails without issuing the next step',async()=>{
  const f=await fixture(); const batch=siteBatch('OFFLINE'); let next=batch.next();
  while (!next.done && next.value[0].id!=='occupied-host') next=batch.next(await Promise.all(next.value.map(f.invoke)));
  assert.throws(()=>batch.next([{id:'occupied-host',status:200,complete:true,body:{}}]),/RESPONSE_MISMATCH/);
  assert.equal(f.calls.includes('bob-create'),false);assert.equal(batch.next().done,true);
});
test('two receipts with distinct site IDs cannot satisfy same-idempotency-key contract',async()=>{
  const f=await fixture();const batch=siteBatch('OFFLINE'), race=batch.next(await Promise.all(batch.next().value.map(f.invoke))).value;
  const r=await Promise.all(race.map(f.invoke));r[1].body.site_id=crypto.randomUUID();
  assert.throws(()=>batch.next(r),/RESPONSE_MISMATCH/);
});

test('independent observation rejects stale digest even when HTTP and row counts match',async()=>{
  const f=await fixture(), batch=siteBatch('OFFLINE');
  let n=batch.next();
  while(n.value[0].id!=='after-collision') n=batch.next(await Promise.all(n.value.map(f.invoke)));
  const receipts=await Promise.all(n.value.map(f.invoke));
  receipts[0].counts[0].old_sha256='f'.repeat(64);
  assert.throws(()=>batch.next(receipts),/RESPONSE_MISMATCH/);assert.ok(!f.calls.includes('bob-create'));
});
test('default observation contract cannot accept mock receipts or claim real PG lock proof',async()=>{
  const f=await fixture();
  const fresh=siteBatch(), receipts=await Promise.all(fresh.next().value.map(f.invoke));
  assert.throws(()=>fresh.next(receipts),/NO_INDEPENDENT_RECEIPT/);
});

test('two unrelated backend PIDs cannot attest the same-key site race',async()=>{
  const f=await fixture(), batch=siteBatch();
  let n=batch.next();
  const rr=await Promise.all(n.value.map(f.invoke));rr[0].mode='OBSERVATIONS';n=batch.next(rr);
  n=batch.next(await Promise.all(n.value.map(f.invoke)));
  const r=await Promise.all(n.value.map(f.invoke));r[0].mode='OBSERVATIONS';
  r[0].lock={blocker:10,blocked:11,eventType:'Lock',event:'transactionid',blockingPids:[10]};
  assert.throws(()=>batch.next(r),/WAIT_NOT_OBSERVED/);assert.equal(f.calls.length,2);
});

test('generic 409, another actor or different private command cannot prove Bob collision reached create_site',async()=>{
  async function conflictEvidence(override) {
    const f=await fixture(), batch=siteBatch();
    let n=batch.next();
    while(n.value[0].id!=='after-collision'){
      const replies=await Promise.all(n.value.map(f.invoke));
      if(n.value[0].kind==='READ_ONLY'){
        replies[0].mode='OBSERVATIONS';
        if(n.value[0].id==='after-race'){
          replies[0].lock={blocker:10,blocked:11,eventType:'Lock',event:'transactionid',blockingPids:[10],observedMs:2,
            participants:['A','B'].map((tag,i)=>({case:'alice-create-'+tag,backendPid:10+i,requestId:'a33b0000-0000-4000-8000-000000000101',
              principal:'ecv_s3_internal_api_login',rpc:'create_site',issuedMs:1,ackMs:3}))};
        }
      }
      n=batch.next(replies);
    }
    const r=await Promise.all(n.value.map(f.invoke));
    Object.assign(r[0],{mode:'OBSERVATIONS',conflict:override});
    return batch.next(r).value[0].id;
  }
  const c={case:'occupied-host',source:'PRIVATE_PGRST_ORIGIN',rpc:'site_api.create_site(jsonb)',sqlstate:'PT409',
    principal:'ecv_s3_internal_api_login',actor:people.bob.uid,requestId:'a33b0000-0000-4000-8000-000000000107',
    slug:'s33b-alice-main-20261109',issuerBound:true};
  assert.equal(await conflictEvidence(c),'bob-create');
  for(const invalid of [undefined,{...c,source:'APPLICATION'},{...c,rpc:'get_my_site'},{...c,actor:people.alice.uid}])
    await assert.rejects(conflictEvidence(invalid),/CONFLICT_ORIGIN_UNVERIFIED/);
});
