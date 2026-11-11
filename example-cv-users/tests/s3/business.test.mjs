import {createGrantService} from './fixtures/legacy-grant-service.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessError, createInput, createBytes, parseCreate, sha256} from '../../lib/business/protocol.mjs';
import {PROJECT} from './fixtures/binding.mjs';
import { createIdentityAdapter } from '../../lib/business/identity.mjs';
import { createTestSigner, verifyTestProof } from './fixtures/test-proof.mjs';
import { createSiteService, createCandidateHandler } from '../../lib/business/service.mjs';
import { createRpcRepository } from './fixtures/repository.mjs';
import { ModelDatabase } from './business-model.mjs';

globalThis.fetch = () => { throw Error('OFFLINE_SUITE_NETWORK_FORBIDDEN'); };

const ids={alice:'b3310000-0000-4000-8000-000000000001',bob:'b3310000-0000-4000-8000-000000000002',charlie:'b3310000-0000-4000-8000-000000000003'};
const sids={alice:'b3320000-0000-4000-8000-000000000001',bob:'b3320000-0000-4000-8000-000000000002',charlie:'b3320000-0000-4000-8000-000000000003',recovery:'b3320000-0000-4000-8000-000000000004'};
const input=(slug='alice-site',n=1)=>({schema_version:1,request_id:`b3330000-0000-4000-8000-${String(n).padStart(12,'0')}`,slug,default_locale:'zh'});
async function fixture() {
  let now=1800000000;const clock=()=>now;
  const users=new Map(Object.values(ids).map(id=>[id,{confirmed:true,banned:false,anonymous:false}]));
  const sessions=new Map(Object.entries(sids).map(([name,sid])=>[sid,ids[name==='recovery'?'alice':name]]));
  const records=new Map(Object.keys(sids).map(name=>{
    const uid=ids[name==='recovery'?'alice':name];return [name,{claims:{iss:'http://127.0.0.1:56321/auth/v1',aud:'authenticated',role:'authenticated',
      sub:uid,session_id:sids[name],exp:now+86400,is_anonymous:false,amr:[{method:name==='recovery'?'otp':'password',timestamp:now}]},
      user:{id:uid,email:`${name}@example.test`,email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false}}];
  }));
  // Synthetic adapter. These strings are NOT JWTs and no Auth server is contacted.
  const auth={getClaims:async token=>({data:{claims:records.get(token)?.claims}}),getUser:async token=>({data:{user:records.get(token)?.user}}),
    signInWithPassword:async({email})=>{const name=email.split('@')[0],r=records.get(name);return {data:{user:r?.user,session:{access_token:name,user:r?.user}}};}};
  const identity=createIdentityAdapter({auth,issuer:'http://127.0.0.1:56321/auth/v1',clock});
  const keys=new Map([['offline-k1',{bytes:new Uint8Array(32).fill(7),not_before:now-100,sign_until:now+90000,verify_until:now+90100,revoked:false}]]);
  const signer=createTestSigner({mode:'offline-test',keys,activeKeyId:'offline-k1',clock});
  const db=new ModelDatabase({keys,clock,sessions,users});
  const site=createSiteService({repository:db}),grants=createGrantService({signer,repository:db});
  const login={};for(const name of ['alice','bob','charlie'])login[name]=await identity.passwordLogin({email:`${name}@example.test`,password:'FICTIONAL-UNUSED'});
  return {clock,tick:n=>{now+=n;},users,sessions,records,identity,keys,signer,db,site,grants,login,
    issue:async name=>grants.issue(login[name].receipt,0),handle:name=>login[name].handle};
}
const privateEndpoint = 'https://api.ecv-s33a-20261109-7dd22a81.internal.test';
function privateRepo(f, fetch, timeoutMs) {
  return createRpcRepository({ enabled:true, project:PROJECT, endpoint:privateEndpoint, identity:f.identity,
    mtls:{ fetch }, timeoutMs });
}
const code=c=>e=>e instanceof BusinessError && e.code===c;
test('Owner positive: full initialization, bilingual content, unpublished, one receipt/audit/baseline',async()=>{
  const f=await fixture();await f.issue('alice');const result=await f.site.create(f.handle('alice'),input());
  assert.deepEqual(result.publication,{state:'unpublished',snapshot_id:null,publication_revision:0});
  const s=f.db.snapshot();for(const key of ['sites','members','publications','settings','sections','entries','translations','revisions','operations','audits'])assert.equal(s[key].size,1,key);
  assert.deepEqual(s.locales.get(result.site_id),['zh','en']);assert.equal(s.members.get(result.site_id).uid,ids.alice);
  assert.deepEqual((await f.site.introduction(f.handle('alice'),result.site_id)).entries[0].translations,{zh:'请填写个人介绍。',en:'Add your introduction.'});
});
test('Alice/Bob own positives then mutual private access denied',async()=>{
  const f=await fixture();await f.issue('alice');await f.issue('bob');
  const a=await f.site.create(f.handle('alice'),input()),b=await f.site.create(f.handle('bob'),input('bob-site',2));
  await f.db.readIntroduction(f.handle('bob'),b.site_id);
  await assert.rejects(f.db.readIntroduction(f.handle('alice'),b.site_id),code('BUSINESS_DENIED'));
  await assert.rejects(f.db.readIntroduction(f.handle('bob'),a.site_id),code('BUSINESS_DENIED'));
  assert.equal((await f.site.readOperation(f.handle('bob'),input())).status,'UNKNOWN');
});
test('anonymous/forged identity object cannot access service',async()=>{
  const f=await fixture();for(const handle of [null,{}, {uid:ids.alice,session_id:sids.alice}])await assert.rejects(f.site.create(handle,input()),code('IDENTITY_REQUIRED'));
});
test('Charlie authenticated without grant is denied, registration/login creates no site',async()=>{
  const f=await fixture();assert.equal(f.db.snapshot().sites.size,0);
  await assert.rejects(f.site.create(f.handle('charlie'),input()),code('BUSINESS_DENIED'));
});
for(const kind of ['expired','revoked','epoch','hold','hold-unknown','hold-reason','disabled','purpose'])test(`grant/state denial: ${kind}`,async()=>{
  const f=await fixture();await f.issue('alice');
  f.db.fixture(s=>{const state=s.security.get(ids.alice),g=s.grants.get(ids.alice+':'+sids.alice);
    if(kind==='expired')g.expires=f.clock();if(kind==='revoked')g.revoked=f.clock();if(kind==='epoch')state.epoch++;
    if(kind==='hold')state.hold=true;if(kind==='hold-unknown')state.hold=undefined;if(kind==='hold-reason')state.reason='unclassified';
    if(kind==='disabled')state.enabled=false;if(kind==='purpose')g.purpose='recovery';});
  await assert.rejects(f.site.create(f.handle('alice'),input()),code('BUSINESS_DENIED'));assert.equal(f.db.snapshot().sites.size,0);
});
test('Recovery session and ordinary cookie cannot obtain password-login proof',async()=>{
  const f=await fixture(),recovery=await f.identity.verifyAccount('recovery');await f.issue('alice');
  await assert.rejects(f.signer.sign({action:'issue',epoch:0,handle:recovery,receipt:{}}),code('FRESH_PASSWORD_LOGIN_REQUIRED'));
  await assert.rejects(f.identity.passwordLogin({email:'recovery@example.test',password:'FICTIONAL-UNUSED'}),code('FRESH_PASSWORD_LOGIN_REQUIRED'));
  await assert.rejects(f.site.create(recovery,input()),code('BUSINESS_DENIED'));
  const cookie=await f.identity.verifyAccount('alice');await assert.rejects(f.grants.issue(cookie,0),code('FRESH_PASSWORD_LOGIN_REQUIRED'));
});
test('changed session ID does not borrow another session grant',async()=>{
  const f=await fixture();await f.issue('alice');f.records.get('alice').claims.session_id=sids.recovery;
  const changed=await f.identity.verifyAccount('alice');await assert.rejects(f.site.create(changed,input()),code('BUSINESS_DENIED'));
});
for(const kind of ['issuer','audience','sub','session','expired-token','anonymous','unconfirmed','banned','wrong-user'])test(`identity rejects ${kind}`,async()=>{
  const f=await fixture(),r=f.records.get('alice');
  if(kind==='issuer')r.claims.iss='https://wrong.invalid/auth/v1';if(kind==='audience')r.claims.aud='anon';if(kind==='sub')r.claims.sub='not-a-uuid';
  if(kind==='session')r.claims.session_id='';if(kind==='expired-token')r.claims.exp=f.clock();if(kind==='anonymous')r.claims.is_anonymous=true;
  if(kind==='unconfirmed')r.user.email_confirmed_at=null;if(kind==='banned')r.user.banned_until='2099-01-01T00:00:00Z';if(kind==='wrong-user')r.user.id=ids.bob;
  await assert.rejects(f.identity.verifyAccount('alice'),code('IDENTITY_REQUIRED'));
});
test('upstream session removal/user disable is checked on every model operation',async()=>{
  const f=await fixture();await f.issue('alice');f.sessions.delete(sids.alice);
  await assert.rejects(f.site.create(f.handle('alice'),input()),code('BUSINESS_DENIED'));
});
test('proof replay is idempotent: one grant and one consumed proof',async()=>{
  const f=await fixture();const proof=await f.signer.sign({action:'issue',epoch:0,receipt:f.login.alice.receipt});
  const a=await f.db.grant(f.handle('alice'),proof),b=await f.db.grant(f.handle('alice'),structuredClone(proof));
  assert.deepEqual(a,b);assert.equal(f.db.snapshot().proofs.size,1);assert.equal(f.db.snapshot().grants.size,1);
});
for(const kind of ['uid','session_id','epoch','action','purpose','project','key_id','signature','event','expired','future','unknown-field'])test(`tampered proof rejects ${kind}`,async()=>{
  const f=await fixture();let e=structuredClone(await f.signer.sign({action:'issue',epoch:0,receipt:f.login.alice.receipt}));
  if(kind==='uid')e.proof.uid=ids.bob;if(kind==='session_id')e.proof.session_id=sids.bob;if(kind==='epoch')e.proof.epoch++;
  if(kind==='action')e.proof.action='renew';if(kind==='purpose')e.proof.purpose='recovery';if(kind==='project')e.proof.project='wrong';
  if(kind==='key_id')e.proof.key_id='other';if(kind==='signature')e.signature='0'.repeat(64);if(kind==='event')e.proof.event='account-session';
  if(kind==='expired')f.tick(61);if(kind==='future')e.proof.issued_at++;if(kind==='unknown-field')e.proof.actor=ids.alice;
  await assert.rejects(f.db.grant(f.handle('alice'),e));assert.equal(f.db.snapshot().grants.size,0);assert.equal(f.db.snapshot().proofs.size,0);
});
test('same proof id with newly signed different action is denied',async()=>{
  const f=await fixture();const old=await f.signer.sign({action:'issue',epoch:0,receipt:f.login.alice.receipt});await f.db.grant(f.handle('alice'),old);
  const signer=createTestSigner({mode:'offline-test',keys:f.keys,activeKeyId:'offline-k1',clock:f.clock,randomUUID:()=>old.proof.proof_id});
  await assert.rejects(f.db.grant(f.handle('alice'),await signer.sign({action:'renew',epoch:0,handle:f.handle('alice')})),code('BUSINESS_DENIED'));
});
test('no implicit hold release on fresh successful login',async()=>{
  const f=await fixture();f.db.fixture(s=>s.security.set(ids.alice,{epoch:0,enabled:true,hold:true,reason:'administrative'}));
  await assert.rejects(f.issue('alice'),code('BUSINESS_DENIED'));assert.equal(f.db.snapshot().security.get(ids.alice).hold,true);
});
test('expired/revoked grants cannot be resurrected under the same session',async()=>{
  for(const kind of ['expired','revoked']){
    const f=await fixture();await f.issue('alice');if(kind==='expired')f.tick(1801);else await f.grants.revoke(f.handle('alice'),0);
    const fresh=await f.identity.passwordLogin({email:'alice@example.test',password:'FICTIONAL-UNUSED'});
    await assert.rejects(f.grants.issue(fresh.receipt,0),code('BUSINESS_DENIED'));
    await assert.rejects(f.grants.renew(f.handle('alice'),0),code('BUSINESS_DENIED'));
  }
});
test('renew extends sliding expiry but never absolute expiry',async()=>{
  const f=await fixture();await f.issue('alice');f.tick(1000);await f.grants.renew(f.handle('alice'),0);
  const g=[...f.db.snapshot().grants.values()][0];assert.equal(g.expires,g.issued+2800);assert.equal(g.absolute,g.issued+43200);
});
test('offline key rotation: verify overlap, stop old signing, immediate revoked-key rejection',async()=>{
  const f=await fixture();const e=await f.signer.sign({action:'issue',epoch:0,receipt:f.login.alice.receipt});
  f.keys.get('offline-k1').sign_until=f.clock()+1;f.tick(2);
  await verifyTestProof(e,{uid:ids.alice,session_id:sids.alice},f);
  await assert.rejects(f.signer.sign({action:'issue',epoch:0,receipt:f.login.alice.receipt}),code('NOT_CONFIGURED'));
  f.keys.get('offline-k1').revoked=true;await assert.rejects(f.db.grant(f.handle('alice'),e),code('INVALID_PROOF'));
});
test('production/unconfigured signer and repository never dispatch',async()=>{
  const f=await fixture();await assert.rejects(createTestSigner({mode:'production'}).sign({}),code('NOT_CONFIGURED'));
  let calls=0;const repo=createRpcRepository({enabled:true,project:PROJECT,endpoint:'https://production.invalid',publishableKey:'sb_publishable_offline',fetcher:()=>{calls++;}});
  await assert.rejects(repo.mine(f.handle('alice')),code('NOT_CONFIGURED'));assert.equal(calls,0);
});
test('same request and digest returns exact original result, no repeated successful side effect',async()=>{
  const f=await fixture();await f.issue('alice');const a=await f.site.create(f.handle('alice'),input()),b=await f.site.create(f.handle('alice'),input());
  assert.deepEqual(a,b);assert.equal(f.db.snapshot().sites.size,1);assert.equal(f.db.snapshot().audits.size,1);
});
test('same key different digest and second request site quota reject',async()=>{
  const f=await fixture();await f.issue('alice');await f.site.create(f.handle('alice'),input());
  await assert.rejects(f.site.create(f.handle('alice'),input('changed-site')),code('REQUEST_CONFLICT'));
  await assert.rejects(f.site.create(f.handle('alice'),input('second-site',2)),code('REQUEST_CONFLICT'));
});
for(const stage of ['publication','audit'])test(`model transaction rolls back every initialization row at ${stage}`,async()=>{
  const f=await fixture();await f.issue('alice');const before=f.db.snapshot();f.db.failAt=stage;
  await assert.rejects(f.site.create(f.handle('alice'),input()),code('COMMIT_UNKNOWN'));assert.deepEqual(f.db.snapshot(),before);
});
test('COMMIT response loss resolves by original request; absence remains UNKNOWN',async()=>{
  const f=await fixture();await f.issue('alice');f.db.loseResponse=true;
  await assert.rejects(f.site.create(f.handle('alice'),input()),code('COMMIT_UNKNOWN'));
  const recovered=await f.site.readOperation(f.handle('alice'),input());assert.equal(recovered.status,'succeeded');assert.equal(f.db.snapshot().sites.size,1);
  assert.deepEqual(await f.site.readOperation(f.handle('alice'),input('not-seen',2)),{status:'UNKNOWN',request_id:input('not-seen',2).request_id,retry_with_new_id:false});
});
test('revoke beats renew: simulated serialized race cannot revive',async()=>{
  const f=await fixture();await f.issue('alice');
  const revoke=await f.signer.sign({action:'revoke',epoch:0,handle:f.handle('alice')}),renew=await f.signer.sign({action:'renew',epoch:0,handle:f.handle('alice')});
  const outcomes=await Promise.allSettled([f.db.grant(f.handle('alice'),revoke),f.db.grant(f.handle('alice'),renew)]);
  assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].status,'rejected');assert.notEqual([...f.db.snapshot().grants.values()][0].revoked,null);
});
test('renew then revoke: final state revoked',async()=>{
  const f=await fixture();await f.issue('alice');
  const renew=await f.signer.sign({action:'renew',epoch:0,handle:f.handle('alice')}),revoke=await f.signer.sign({action:'revoke',epoch:0,handle:f.handle('alice')});
  const result=await Promise.all([f.db.grant(f.handle('alice'),renew),f.db.grant(f.handle('alice'),revoke)]);
  assert.equal(result[1].status,'revoked');
});
test('simulated concurrent same request, distinct request, and hostname arbitration',async()=>{
  const f=await fixture();await f.issue('alice');await f.issue('bob');
  const same=await Promise.all([f.site.create(f.handle('alice'),input()),f.site.create(f.handle('alice'),input())]);assert.deepEqual(same[0],same[1]);
  const distinct=await Promise.allSettled([f.site.create(f.handle('bob'),input('shared-site',2)),f.site.create(f.handle('bob'),input('other-site',3))]);
  assert.equal(distinct.filter(x=>x.status==='fulfilled').length,1);
  const g=await fixture();await g.issue('alice');await g.issue('bob');
  const domain=await Promise.allSettled([g.site.create(g.handle('alice'),input('shared-site')),g.site.create(g.handle('bob'),input('shared-site',2))]);
  assert.equal(domain.filter(x=>x.status==='fulfilled').length,1);assert.equal(g.db.snapshot().sites.size,1);
});
test('canonical digest stable; duplicate/unknown/owner fields and reserved slugs rejected',async()=>{
  assert.equal(new TextDecoder().decode(createBytes(input())),'ecv.create_site.v1\nalice-site\nzh\n');
  assert.equal(await sha256(createBytes(input())),await sha256(createBytes({...input(),request_id:input('',9).request_id})));
  for(const text of ['{"schema_version":1,"schema_version":1}',JSON.stringify({...input(),owner_id:ids.alice}),JSON.stringify({...input(),slug:'admin'}),JSON.stringify({...input(),slug:'Alice'}),'{}','null','{"schema_version":1,}'])assert.throws(()=>parseCreate(text));
  assert.deepEqual({...parseCreate(JSON.stringify(input()))},input());
});
test('HTTP adapter CSRF/body/identity rejection, no credentials in response',async()=>{
  const f=await fixture();await f.issue('alice');const origin='https://offline.business.example.invalid';
  const handler=createCandidateHandler({origin,resolveAccount:async()=>f.handle('alice'),service:f.site});
  const request=(body=JSON.stringify(input()),extra={})=>new Request(origin+'/api/sites',{method:'POST',headers:{origin,'content-type':'application/json',...extra},body});
  assert.equal((await handler(request(undefined,{origin:'https://evil.invalid'}))).status,403);
  assert.equal((await handler(request(JSON.stringify({...input(),actor:ids.bob})))).status,400);
  const r=await handler(request());assert.equal(r.headers.get('Cache-Control'),'private, no-store');const body=await r.text();assert.ok(!/password|access_token|Bearer|FICTIONAL/.test(body));
});
test('RPC errors are sanitized and UNKNOWN is never automatically retried',async()=>{
  const f=await fixture();let calls=0;
  const repo=privateRepo(f,async()=>{calls++;throw Error('credential=DO_NOT_EXPOSE');});
  const service=createSiteService({repository:repo});await assert.rejects(service.create(f.handle('alice'),input()),code('COMMIT_UNKNOWN'));assert.equal(calls,1);
});
test('escaped duplicate keys, non-JSON whitespace and oversized body reject',()=>{
  assert.throws(()=>parseCreate('{"schema_version":1,"schema_vers\\u0069on":1}'));
  assert.throws(()=>parseCreate('\u00a0'+JSON.stringify(input())));
  assert.throws(()=>parseCreate(' '.repeat(2049)));
});
test('RPC transport enforces profile/origin, sanitizes server details and rejects empty success',async()=>{
  const f=await fixture();let calls=0;
  const repo=privateRepo(f,async(url,options)=>{
    calls++;assert.equal(url,privateEndpoint+'/rpc/create_site');assert.equal(options.redirect,'manual');
    assert.deepEqual(Object.keys(options.headers).sort(),['Authorization','Content-Type']);
    return Response.json(calls===1?{code:'PT409',message:'DO_NOT_EXPOSE password/Token'}:[],{status:calls===1?409:200});
  });
  await assert.rejects(repo.create(f.handle('alice'),input()),e=>e.code==='REQUEST_CONFLICT'&&!e.message.includes('DO_NOT_EXPOSE'));
  await assert.rejects(repo.create(f.handle('alice'),input()),code('COMMIT_UNKNOWN'));assert.equal(calls,2);
});
test('HTTP cross-tenant intro and unconfigured identity deny, without existence disclosure',async()=>{
  const f=await fixture();await f.issue('alice');await f.issue('bob');const b=await f.site.create(f.handle('bob'),input('bob-site',2));
  const origin='https://offline.business.example.invalid';
  const handler=createCandidateHandler({origin,resolveAccount:async()=>f.handle('alice'),service:f.site});
  const denied=await handler(new Request(origin+`/api/sites/${b.site_id}/introduction`));assert.equal(denied.status,403);
  const absent=await handler(new Request(origin+'/api/sites/b3390000-0000-4000-8000-000000000001/introduction'));assert.deepEqual(await absent.json(),await denied.json());
  const anonymous=createCandidateHandler({origin,resolveAccount:async()=>null,service:f.site});
  assert.equal((await anonymous(new Request(origin+'/api/sites/mine'))).status,401);
});
test('new signing key issues a valid proof independently of old verification overlap',async()=>{
  const f=await fixture();f.keys.set('offline-k2',{bytes:new Uint8Array(32).fill(8),not_before:f.clock(),sign_until:f.clock()+120,verify_until:f.clock()+180});
  const signer=createTestSigner({mode:'offline-test',keys:f.keys,activeKeyId:'offline-k2',clock:f.clock});
  const e=await signer.sign({action:'issue',epoch:0,receipt:f.login.bob.receipt});
  assert.equal((await f.db.grant(f.handle('bob'),e)).status,'active');
});
test('wait barrier rechecks removed upstream session; model cannot commit stale qualification',async()=>{
  const f=await fixture();await f.issue('alice');await f.issue('bob');let opened,release;
  const ready=new Promise(r=>{opened=r;}),gate=new Promise(r=>{release=r;});
  f.db.beforeCommit=async()=>{f.db.beforeCommit=null;opened();await gate;};
  const a=f.site.create(f.handle('alice'),input());await ready;
  const b=f.site.create(f.handle('bob'),input('bob-site',2));f.sessions.delete(sids.bob);release();
  await a;await assert.rejects(b,code('BUSINESS_DENIED'));assert.equal(f.db.snapshot().sites.size,1);
});
test('revoked grant also blocks original successful receipt replay',async()=>{
  const f=await fixture();await f.issue('alice');await f.site.create(f.handle('alice'),input());await f.grants.revoke(f.handle('alice'),0);
  await assert.rejects(f.site.create(f.handle('alice'),input()),code('BUSINESS_DENIED'));
  await assert.rejects(f.site.readOperation(f.handle('alice'),input()),code('BUSINESS_DENIED'));
});
test('JSON null/default-locale and extra sensitive success fields cannot become false success',async()=>{
  assert.throws(()=>createInput({...input(),default_locale:null}));
  const f=await fixture();await f.issue('alice');const r=await f.site.create(f.handle('alice'),input());
  const service=createSiteService({repository:{create:async()=>({...r,access_token:'FICTIONAL-NOT-A-TOKEN'})}});
  await assert.rejects(service.create(f.handle('alice'),input()),code('COMMIT_UNKNOWN'));
});
test('same key/different digest under concurrent model requests cannot be treated as replay success',async()=>{
  const f=await fixture();await f.issue('alice');
  const r=await Promise.allSettled([f.site.create(f.handle('alice'),input()),f.site.create(f.handle('alice'),input('changed-site'))]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.code,'REQUEST_CONFLICT');
  assert.equal(f.db.snapshot().operations.size,1);
});
test('soft deletion keeps Owner quota and does not enable second site',async()=>{
  const f=await fixture();await f.issue('alice');const a=await f.site.create(f.handle('alice'),input());
  f.db.fixture(s=>{s.sites.get(a.site_id).status='deleted';});
  await assert.rejects(f.site.create(f.handle('alice'),input('second-site',2)),code('REQUEST_CONFLICT'));
});
test('independent Python hashlib/hmac public vectors match candidate encoding and Web Crypto',async()=>{
  assert.equal(await sha256(createBytes(input())),'384a3f7c63d3b4103c2004587e68b653ee60313fc71515bb27ce007a802808bf');
  const f=await fixture(),signer=createTestSigner({mode:'offline-test',keys:f.keys,activeKeyId:'offline-k1',clock:f.clock,
    randomUUID:()=> 'b3340000-0000-4000-8000-000000000001'});
  const e=await signer.sign({action:'issue',epoch:0,receipt:f.login.alice.receipt});
  assert.equal(e.signature,'a8d0a4c226a5044dd1a260f363bccb689bc05096305432cc38ba77a13e492193');
});
test('Recovery purpose stays denied even when a synthetic token repeats the normal session id',async()=>{
  const f=await fixture();await f.issue('alice');f.records.get('recovery').claims.session_id=sids.alice;
  const recovery=await f.identity.verifyAccount('recovery');await assert.rejects(f.site.create(recovery,input()),code('BUSINESS_DENIED'));
});
test('stalled injected transport is bounded and produces one UNKNOWN, never a retry',async()=>{
  const f=await fixture();let calls=0;const repo=privateRepo(f,()=>{calls++;return new Promise(()=>{});},5);
  await assert.rejects(repo.create(f.handle('alice'),input()),code('COMMIT_UNKNOWN'));assert.equal(calls,1);
});
test('fresh password session can receive a new grant without reviving the revoked session',async()=>{
  const f=await fixture();await f.issue('alice');await f.grants.revoke(f.handle('alice'),0);
  const sid='b3320000-0000-4000-8000-000000000009';f.records.get('alice').claims.session_id=sid;f.sessions.set(sid,ids.alice);
  const fresh=await f.identity.passwordLogin({email:'alice@example.test',password:'FICTIONAL-UNUSED'});
  assert.equal((await f.grants.issue(fresh.receipt,0)).status,'active');
  const g=f.db.snapshot().grants;assert.equal(g.size,2);assert.notEqual(g.get(ids.alice+':'+sids.alice).revoked,null);
});
