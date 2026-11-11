import assert from 'node:assert/strict';
// 'workerd test' calls the exported test handler; Node uses its native test runner.
const workerTests = [];
const test = globalThis.navigator?.userAgent === 'Cloudflare-Workers'
  ? ((name, run) => workerTests.push({ name, run }))
  : (await import('node:test')).default;
export default { async test() {
  assert(workerTests.length > 0);
  for (const { name, run } of workerTests) {
    try { await run(); } catch (error) { throw new Error(name, { cause: error }); }
  }
} };
import { createIdentityAdapter } from '../../lib/business/identity.mjs';
import { createTestSigner } from './fixtures/test-proof.mjs';
import {grantBytes, sha256, proofBytes} from '../../lib/business/protocol.mjs';
import {PROJECT} from './fixtures/binding.mjs';
import { createIntentClaim, claimApprovedIntent, ledgerName } from './fixtures/ledger.mjs';
import { createRegisteredGrantService, createR3Issuer } from './fixtures/verifier.mjs';

// Public offline test vectors only. There is no network-capable database client in this suite.
globalThis.fetch = () => { throw Error('offline test'); };
const uid = '00000000-0000-4000-8000-000000000001', sid = '00000000-0000-4000-8000-000000000002';
const pid = '00000000-0000-4000-8000-000000000003', gid = '00000000-0000-4000-8000-000000000004';
const reject = (...codes) => e => codes.includes(e.code);
async function fixture(issuer='http://127.0.0.1:56321/auth/v1') {
  const f = { now: 1800000000, connect: 0, registered: [], applied: [], pending: new Set(), creds: 0 };
  const clock = () => f.now;
  const claims = { iss: issuer, role: 'authenticated', aud: 'authenticated', exp: f.now + 500,
    amr: [{ method: 'password' }], is_anonymous: false, sub: uid, session_id: sid };
  const user = { id: uid, email: 'offline@example.test', email_confirmed_at: '2026-01-01', is_anonymous: false };
  f.identity = createIdentityAdapter({ issuer: claims.iss, clock, auth: {
    async signInWithPassword() { return { data: { user, session: { user, access_token: 'mock token' } } }; },
    async getClaims() { return { data: { claims } }; }, async getUser() { return { data: { user } }; }
  } });
  f.login = await f.identity.passwordLogin({ email: user.email, password: 'mock' });
  f.claims = claims;
  const bytes = new Uint8Array(32).fill(0xa5);
  f.signer = createTestSigner({ mode: 'offline-test', clock, activeKeyId: 'test-v1', randomUUID: () => pid,
    keys: new Map([['test-v1',{ bytes, revoked: false, not_before: f.now-1, sign_until: f.now+60, verify_until: f.now+120 }]]) });
  f.slot = { id: 'test-v1', project: PROJECT, revoked: false, notBefore: f.now-1, signUntil: f.now+60, verifyUntil: f.now+120,
    macKey: await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) };
  f.Client = class {
    constructor(config) { this.config = config; }
    async connect() {
      f.connect++;
      if (f.onConnect) await f.onConnect();
      const { host, port, database, user, ssl, password } = this.config;
      assert.deepEqual([host, port, database, user],['pg.ecv-s33a-20261109-7dd22a81.internal.test',5432,'postgres','ecv_s3_registration_login']);
      assert.equal(ssl.rejectUnauthorized,true);
      assert.throws(password,reject('REGISTRAR_UNAVAILABLE'));
      if (f.skipVerification) return;
      const err = ssl.checkServerIdentity(host, { subjectaltname:'DNS:'+(f.wrongPeer?'other.invalid':host) });
      if (err) throw err;
      assert.throws(password,reject('REGISTRAR_UNAVAILABLE'));
      assert.equal(ssl.servername,host); assert.equal(ssl.minVersion,'TLSv1.2');
    }
    async query(sql, params) {
      assert.equal(sql,'SELECT site_private.register_business_ticket($1::jsonb) AS registered');
      assert.equal(params.length,1);
      const p = JSON.parse(params[0]); assert.equal(Object.keys(p).length,13);
      f.registered.push(p);
      if (f.onQuery) await f.onQuery();
      if (f.serverError) throw f.serverError;
      if (f.pending.has(p.proof_id)) throw Object.assign(Error('TICKET_ALREADY_REGISTERED'),{severity:'ERROR',code:'PT409'});
      f.pending.add(p.proof_id);
      if (f.lostRegistration) throw Error('connection unavailable');
      return { command:'SELECT',rowCount:1,rows:[{ registered:true }] };
    }
    async end() { if (f.endError) throw Error('private driver details'); }
  };
  f.repository = { async grant(handle, ticket) {
    assert.equal(handle,f.login.handle); assert.deepEqual(Object.keys(ticket),['proof']);
    assert.ok(f.pending.has(ticket.proof.proof_id)); f.applied.push(ticket);
    if (f.lostConsume) throw Error('mock lost response');
    return { grant_id: gid, status: ticket.proof.action==='revoke'?'revoked':'active', expires_at: '2027-01-01T00:00:00Z' };
  } };
  f.service = createRegisteredGrantService({ enabled:true,project:PROJECT,identity:f.identity,clock, lookupKey:async kid=>f.lookup ? f.lookup(kid) : f.slot,
    repository:f.repository,registrar:{ get timeoutMs() { return f.timeoutMs; }, Client:f.Client, credentials:async()=>{ f.creds++;return f.material ?? { cert:'mock client certificate', key:'mock private material', ca:'mock private CA' }; } } });
  f.envelope = async (action='issue') => structuredClone(await f.signer.sign({ action, epoch:0, ...f.login }));
  f.issue = e => f.service.issue(f.login.handle,f.login.receipt,e);
  return f;
}

test('valid MAC registers only the signed public fields; user applies the same immutable proof', async()=>{
  const f=await fixture(),e=await f.envelope(); const result=await f.issue(e);
  assert.equal(result.grant_id,gid);
  assert.deepEqual(f.registered,[e.proof]);assert.deepEqual(f.applied,[{ proof:e.proof }]);
  assert(Object.isFrozen(f.applied[0].proof));
});
test('default service and missing registrar/key dependencies are closed',async()=>{
  const f=await fixture();
  for(const cfg of [{},{ enabled:true,project:PROJECT }]){
    await assert.rejects(createRegisteredGrantService(cfg).issue(f.login.handle,f.login.receipt,await f.envelope()),reject('NOT_CONFIGURED'));
  }
});
for(const [label,mutate] of Object.entries({
  'first byte':e=>{e.signature=(e.signature.startsWith('00')?'ff':'00')+e.signature.slice(2);},
  'last byte':e=>{e.signature=e.signature.slice(0,-2)+(e.signature.endsWith('00')?'ff':'00');},
  'wrong encoding':e=>{e.signature=e.signature.toUpperCase();},
  'truncated':e=>{e.signature=e.signature.slice(2);},
  'wrong uid':e=>{e.proof.uid=pid;},'wrong session':e=>{e.proof.session_id=pid;},
  'wrong project':e=>{e.proof.project='other';},'wrong purpose':e=>{e.proof.purpose='other';},
  'different action':e=>{e.proof.action='renew';e.proof.event='account-session';},
  'epoch modified':e=>{e.proof.epoch=1;},'wrong digest':e=>{e.proof.payload_digest='0'.repeat(64);},
  'unbound verified flag':e=>{e.verified=true;}, 'expired':(e,f)=>{f.now+=60;},
  'missing active key':(_e,f)=>{f.slot=null;}, 'revoked key':(_e,f)=>{f.slot.revoked=true;},
  'unknown revocation':(_e,f)=>{delete f.slot.revoked;}, 'different signing generation':(_e,f)=>{f.slot.id='other';},
  'disabled window':(_e,f)=>{f.slot.verifyUntil=f.now+1;},
  'wrong key bytes':async(_e,f)=>{f.slot.macKey=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(0xa6),{name:'HMAC',hash:'SHA-256'},false,['sign']);}
})){
  test('reject before registration: '+label, async()=>{
    const f=await fixture(),e=await f.envelope();await mutate(e,f);
    await assert.rejects(f.issue(e),reject('INVALID_PROOF','INVALID_INPUT'));
    assert.equal(f.creds,0);assert.equal(f.applied.length,0);
  });
}
test('trusted action cannot be selected by modifying a signed proof or passing a renewal proof to issue',async()=>{
  const f=await fixture();
  await assert.rejects(f.issue(await f.envelope('renew')),reject('INVALID_PROOF'));
});
test('even a valid MAC over a wrong public payload digest is denied',async()=>{
  const f=await fixture(),e=await f.envelope();
  e.proof.payload_digest=await sha256(grantBytes({...e.proof,epoch:1}));
  e.signature=Buffer.from(await crypto.subtle.sign('HMAC',f.slot.macKey,proofBytes(e.proof))).toString('hex');
  await assert.rejects(f.issue(e),reject('INVALID_PROOF'));assert.equal(f.creds,0);
});
test('changing caller object while key retrieval is suspended cannot substitute registered claims',async()=>{
  const f=await fixture(),e=await f.envelope();
  f.lookup=async()=>{e.proof.uid=pid;e.proof.action='revoke';e.signature='0'.repeat(64);return f.slot;};
  await f.issue(e);assert.equal(f.registered[0].uid,uid);assert.equal(f.registered[0].action,'issue');
});
test('a forged, reused or unrelated login receipt/handle fails, including a second handle with the same claims',async()=>{
  const f=await fixture(),e=await f.envelope(),other=await f.identity.verifyAccount('mock');
  for(const [handle,receipt] of [[{},f.login.receipt],[f.login.handle,{}],[other,f.login.receipt]]){
    await assert.rejects(f.service.issue(handle,receipt,e),reject('FRESH_PASSWORD_LOGIN_REQUIRED','IDENTITY_REQUIRED'));
  }
  const outcomes=await Promise.allSettled([f.issue(e),f.issue(e)]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(f.connect,1);
});
test('recovery with password and recovery AMR cannot renew or issue',async()=>{
  const f=await fixture(),e=await f.envelope('renew');
  f.claims.amr.push({method:'recovery'});
  const handle=await f.identity.verifyAccount('mock');
  await assert.rejects(f.service.renew(handle,e),reject('BUSINESS_DENIED'));
  await assert.rejects(f.identity.passwordLogin({ email:'offline@example.test',password:'mock' }),reject('FRESH_PASSWORD_LOGIN_REQUIRED'));
  assert.equal(f.connect,0);
});
for (const cause of ['skipVerification','wrongPeer']){
  test('TLS peer verification denied: '+cause,async()=>{
    const f=await fixture();f[cause]=true;await assert.rejects(f.issue(await f.envelope()),reject('REGISTRAR_UNAVAILABLE'));
    assert.equal(f.registered.length,0);assert.equal(f.applied.length,0);
  });
}
test('registry rejection stops apply; replayed renew does not run apply twice',async()=>{
  const f=await fixture(),e=await f.envelope('renew');
  await f.service.renew(f.login.handle,e);
  await assert.rejects(f.service.renew(f.login.handle,e),reject('TICKET_CONFLICT'));
  assert.equal(f.applied.length,1);
});
for (const cause of ['lostRegistration','lostConsume']){
  test('unknown outcome retains nonsecret proof_id and never retries: '+cause,async()=>{
    const f=await fixture(),e=await f.envelope();f[cause]=true;
    const code=cause==='lostRegistration'?'REGISTRATION_UNKNOWN':'COMMIT_UNKNOWN';
    await assert.rejects(f.issue(e),err=>err.code===code && err.proofId===pid && !String(err).includes(e.signature));
    assert.equal(f.connect,1);assert.equal(f.registered.length,1);assert.equal(f.applied.length,cause==='lostConsume'?1:0);
    await assert.rejects(f.issue(e),reject('FRESH_PASSWORD_LOGIN_REQUIRED'));
    assert.equal(f.connect,1);
  });
}

for (const [sqlstate,message,severity,expected] of [
  ['42501','BUSINESS_DENIED','ERROR','BUSINESS_DENIED'],
  ['PT503','NOT_CONFIGURED','ERROR','NOT_CONFIGURED'],
  ['23505','other unique constraint','ERROR','REGISTRATION_UNKNOWN'],
  ['PT409','unclassified error','ERROR','REGISTRATION_UNKNOWN'],
  ['PT409','TICKET_ALREADY_REGISTERED',undefined,'REGISTRATION_UNKNOWN'],
  ['08006','private connection details','FATAL','REGISTRATION_UNKNOWN']
]) {
  test('registrar diagnostic classification '+sqlstate+' '+(severity||'driver')+' '+expected, async()=>{
    const f=await fixture(); f.serverError=Object.assign(Error(message),{code:sqlstate,severity});
    await assert.rejects(f.issue(await f.envelope()),error=>error.code===expected && error.message===expected);
    assert.equal(f.registered.length,1);assert.equal(f.applied.length,0);
  });
}
test('registration reply followed by a connection teardown error cannot start consumption',async()=>{
  const f=await fixture();f.endError=true;
  await assert.rejects(f.issue(await f.envelope()),err=>err.code==='REGISTRATION_UNKNOWN' && err.proofId===pid);
  assert.equal(f.applied.length,0);assert.equal(f.registered.length,1);
});

test('different adapter with identical issuer, user and session cannot introduce an account',async()=>{
  const first=await fixture(),other=await fixture();
  await assert.rejects(first.service.issue(other.login.handle,other.login.receipt,await other.envelope()),reject('IDENTITY_REQUIRED'));
  assert.equal(first.creds,0);
});
test('a real opaque handle from a misconfigured issuer fails even when the adapter instance matches',async()=>{
  const f=await fixture('https://foreign.invalid/auth/v1');
  await assert.rejects(f.issue(await f.envelope()),reject('IDENTITY_REQUIRED'));assert.equal(f.creds,0);
});
test('v1 transcript uses fixed ASCII order, LF boundaries and includes all thirteen fields',async()=>{
  const f=await fixture(),{proof}=await f.envelope();
  const fields=[1,PROJECT,'issue','business',uid,sid,0,pid,f.now,f.now+60,proof.payload_digest,'test-v1','password-login'];
  assert.deepEqual(proofBytes(proof),new TextEncoder().encode(['ecv.proof.v1',...fields,''].join('\n')));
});

function namespaceFixture(claimOnce) {
  return { idFromName(name){assert.equal(name,ledgerName);return name;},
    get(id){assert.equal(id,ledgerName);return {claimOnce};} };
}

function issuerFixture(f, action='issue', changes={}) {
  const history=new Set(), calls={ claim:0, key:0 };
  const intent={ project:PROJECT,action,uid,session_id:sid,epoch:0,proof_id:pid,key_id:'test-v1' };
  const options={ enabled:true,project:PROJECT,identity:f.identity,intent,verifier:f.service,clock:()=>f.now,
    intentNamespace:namespaceFixture(async planned=>{
      assert.ok(Object.isFrozen(planned));calls.claim++;
      if(history.has(planned.proof_id))return false;
      history.add(planned.proof_id);return { proofId:planned.proof_id,validFrom:f.now-1,expiresAt:f.now+60 };
    }),
    lookupSigningKey:async kid=>{calls.key++;assert.equal(kid,'test-v1');return f.slot;},
    ...changes };
  return { options,calls,history,issuer:createR3Issuer(options) };
}

for(const action of ['issue','renew','revoke']){
  test('bound issuer → native verifier → mock private registration → mock user consumption: '+action,async()=>{
    const f=await fixture(), {issuer,calls}=issuerFixture(f,action);
    const vector=(await f.envelope(action)).proof;
    const result=await issuer[action](f.login.handle,f.login.receipt);
    assert.deepEqual(f.registered,[vector]);assert.deepEqual(f.applied,[{proof:vector}]);
    assert.equal(result.grant_id,gid);assert.deepEqual(calls,{claim:1,key:1});
  });
}
test('issuer cannot be constructed with an injected verifier that could extract a signature', async()=>{
  const f=await fixture(), bundle=issuerFixture(f,'issue',{verifier:{ issue(){ throw Error('unreachable'); } }});
  await assert.rejects(bundle.issuer.issue(f.login.handle,f.login.receipt),reject('NOT_CONFIGURED'));
  assert.deepEqual(bundle.calls,{claim:0,key:0});
  await assert.rejects(createR3Issuer().issue(f.login.handle,f.login.receipt),reject('NOT_CONFIGURED'));
});
test('misbound issuer context, caller-selected action and forged password event cannot claim intent',async()=>{
  const f=await fixture(), other=await fixture(), bundle=issuerFixture(f);
  await assert.rejects(bundle.issuer.issue(other.login.handle,other.login.receipt),reject('IDENTITY_REQUIRED'));
  await assert.rejects(bundle.issuer.renew(f.login.handle),reject('INVALID_INTENT'));
  await assert.rejects(bundle.issuer.issue(f.login.handle,{}),reject('FRESH_PASSWORD_LOGIN_REQUIRED'));
  await assert.rejects(bundle.issuer.issue(f.login.handle,other.login.receipt),reject('FRESH_PASSWORD_LOGIN_REQUIRED'));
  assert.deepEqual(bundle.calls,{claim:0,key:0});
});
test('only stable server intent is signed, including across a mutable source change',async()=>{
  const f=await fixture(),bundle=issuerFixture(f,'renew');
  bundle.options.intent.uid=pid;bundle.options.intent.epoch=912;bundle.options.intent.proof_id=gid;
  await bundle.issuer.renew(f.login.handle);
  assert.equal(f.registered[0].uid,uid);assert.equal(f.registered[0].epoch,0);assert.equal(f.registered[0].proof_id,pid);
});
test('concurrent uses of one login receipt cannot sign two issue proofs',async()=>{
  const f=await fixture(), first=issuerFixture(f),second=issuerFixture(f);
  const both=await Promise.allSettled([first,second].map(x=>x.issuer.issue(f.login.handle,f.login.receipt)));
  assert.equal(both.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(first.calls.claim+second.calls.claim,1);assert.equal(first.calls.key+second.calls.key,1);
});
for(const cause of ['lostRegistration','lostConsume']){
  test('issuer does not re-sign with another ID after '+cause+'; reconstruction checks durable reservation',async()=>{
    const f=await fixture(),bundle=issuerFixture(f,'renew');f[cause]=true;
    await assert.rejects(bundle.issuer.renew(f.login.handle),e=>e.proofId===pid && e.code===(cause==='lostRegistration'?'REGISTRATION_UNKNOWN':'COMMIT_UNKNOWN'));
    await assert.rejects(bundle.issuer.renew(f.login.handle),reject('INTENT_ALREADY_USED'));
    await assert.rejects(createR3Issuer(bundle.options).renew(f.login.handle),reject('INTENT_ALREADY_USED'));
    assert.deepEqual(bundle.calls,{claim:2,key:1});assert.equal(f.registered.length,1);
  });
}
test('unknown intent receipt is sticky and stops all access to the signing key',async()=>{
  const f=await fixture(),bundle=issuerFixture(f,'renew',{intentNamespace:namespaceFixture(async()=>{throw Error('lost ACK');})});
  await assert.rejects(bundle.issuer.renew(f.login.handle),e=>e.code==='INTENT_UNKNOWN' && e.proofId===pid);
  await assert.rejects(bundle.issuer.renew(f.login.handle),reject('INTENT_ALREADY_USED'));
  assert.equal(bundle.calls.key,0);assert.equal(f.creds,0);
});
test('signer and verifier resolve keys independently; disagreement cannot open registrar',async()=>{
  const f=await fixture();
  const macKey=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(0x3e),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bundle=issuerFixture(f,'renew',{lookupSigningKey:async()=>({...f.slot,macKey})});
  await assert.rejects(bundle.issuer.renew(f.login.handle),reject('INVALID_PROOF'));assert.equal(f.creds,0);
});

function ledgerFixture(f,plan) {
  const key=ledgerName+'/'+plan.proof_id;
  const record={state:'approved',validFrom:f.now-1,expiresAt:f.now+60,intent:{...plan}};
  const data=new Map([[key,record]]);
  const counters={writes:0};
  // Serializable copy-on-write only for this offline fixture. No real storage binding.
  let previous=Promise.resolve();
  const storage={transaction(fn){
    const promise=previous.then(async()=>{
      const draft=new Map(data), result=await fn({
        get: async k=>structuredClone(draft.get(k)),
        put: async(k,v)=>{counters.writes++;draft.set(k,structuredClone(v));}
      });
      data.clear();for(const [k,v] of draft)data.set(k,v);
      if(f.lostLedgerReply)throw Error('mock lost receipt');
      return result;
    });
    previous=promise.catch(()=>{});return promise;
  }};
  const namespace=namespaceFixture(intent=>claimApprovedIntent(storage,intent,()=>f.now));
  return {key,data,counters,namespace,claim:createIntentClaim(namespace)};
}
test('only one of two independent calls claims the same preauthorized exact intent',async()=>{
  const f=await fixture(),{options}=issuerFixture(f,'renew'),ledger=ledgerFixture(f,options.intent);
  const values=await Promise.all([ledger.claim(options.intent),createIntentClaim(ledger.namespace)(options.intent)]);
  assert.deepEqual(values,[{proofId:pid,validFrom:f.now-1,expiresAt:f.now+60},false]);
  assert.equal(ledger.data.get(ledger.key).state,'consumed');assert.equal(ledger.counters.writes,1);
});
for(const reason of ['absent','expired','future','overlong','consumed','stale epoch','different session','extra claim']){
  test('intent storage denies '+reason+' without changing any row',async()=>{
    const f=await fixture(),{options}=issuerFixture(f),ledger=ledgerFixture(f,options.intent);
    const saved=ledger.data.get(ledger.key);
    if(reason==='absent')ledger.data.clear();
    if(reason==='expired')saved.expiresAt=f.now;
    if(reason==='future')saved.validFrom=f.now+1;
    if(reason==='overlong')saved.expiresAt=saved.validFrom+7201;
    if(reason==='consumed')saved.state='consumed';
    if(reason==='stale epoch')saved.intent.epoch=1;
    if(reason==='different session')saved.intent.session_id=gid;
    if(reason==='extra claim')saved.intent.verified=true;
    assert.equal(await ledger.claim(options.intent),false);assert.equal(ledger.counters.writes,0);
  });
}
test('issuer reaches native signing only after protected ledger transaction commits',async()=>{
  const f=await fixture(),{ options }=issuerFixture(f,'renew'),ledger=ledgerFixture(f,options.intent);
  const issuer=createR3Issuer({...options,intentNamespace:ledger.namespace,lookupSigningKey:async()=>{
    assert.equal(ledger.data.get(ledger.key).state,'consumed');return f.slot;
  }});
  assert.equal((await issuer.renew(f.login.handle)).grant_id,gid);assert.equal(ledger.counters.writes,1);
});
test('lost ledger commit ACK cannot cause signing through a new service instance',async()=>{
  const f=await fixture(),bundle=issuerFixture(f,'renew'),ledger=ledgerFixture(f,bundle.options.intent);
  const options={...bundle.options,intentNamespace:ledger.namespace};
  f.lostLedgerReply=true;
  await assert.rejects(createR3Issuer(options).renew(f.login.handle),e=>e.proofId===pid && e.code==='INTENT_UNKNOWN');
  f.lostLedgerReply=false;
  await assert.rejects(createR3Issuer(options).renew(f.login.handle),reject('INTENT_ALREADY_USED'));
  assert.equal(bundle.calls.key,0);assert.equal(f.registered.length,0);assert.equal(ledger.counters.writes,1);
});
test('Python stdlib cross-implementation known answer for static, public HMAC test vector',async()=>{
  const f=await fixture(),e=await f.envelope();
  // Independent hashlib.sha256/hmac.digest input: explicit 13 fields and LF-terminated ASCII,
  // key = 32 publicly specified 0xa5 bytes. Store only the digest of the synthetic MAC.
  assert.equal(e.proof.payload_digest,'7dd428afcee7ede06813d19e56ed37918b4beea6403ef379c1f038ccf491c36a');
  assert.equal(await sha256(Uint8Array.from(e.signature.match(/../g),s=>parseInt(s,16))),
    'faa189eec425006c558401c470bb2347bb3c3314455ebb27037a6cd2a5f6e7e4');
  await f.issue(e);assert.deepEqual(f.registered,[e.proof]);
});
test('RPC-only Durable Object class declares no approval, reset or fetch method',async()=>{
  if (globalThis.navigator?.userAgent==='Cloudflare-Workers') {
    const {R3IntentLedger}=await import('../../lib/business/r3-intent-object.mjs');
    assert.deepEqual(Object.getOwnPropertyNames(R3IntentLedger.prototype).sort(),['claimOnce','constructor']);
  } else {
    const source=await (await import('node:fs/promises')).readFile(new URL('../../lib/business/r3-intent-object.mjs',import.meta.url),'utf8');
    assert.doesNotMatch(source,/\b(?:fetch|approve|reset)\s*\(/);
  }
});

test('ticket expiry never exceeds stored operator deadline, including after asynchronous key retrieval',async()=>{
  const f=await fixture(),{options}=issuerFixture(f,'renew'),ledger=ledgerFixture(f,options.intent);
  ledger.data.get(ledger.key).expiresAt=f.now+3;
  const issuer=createR3Issuer({...options,intentNamespace:ledger.namespace});
  await issuer.renew(f.login.handle);assert.equal(f.registered[0].expires_at,f.now+3);
});
test('approval expiring during signing-key retrieval leaves the intent spent and no registration',async()=>{
  const f=await fixture(),{options}=issuerFixture(f,'renew'),ledger=ledgerFixture(f,options.intent);
  const issuer=createR3Issuer({...options,intentNamespace:ledger.namespace,lookupSigningKey:async()=>{
    f.now+=60;return f.slot;
  }});
  await assert.rejects(issuer.renew(f.login.handle),reject('INTENT_EXPIRED'));
  assert.equal(ledger.counters.writes,1);assert.equal(f.creds,0);
});

for(const mixed of [false,true]){
  test('generic claim callback must never replace or accompany the ledger namespace: '+mixed,async()=>{
    const f=await fixture(),bundle=issuerFixture(f),options={...bundle.options};
    if(!mixed)delete options.intentNamespace;
    let invoked=false;
    options.claimIntentOnce=async()=>{invoked=true;return {proofId:pid,validFrom:f.now-1,expiresAt:f.now+60};};
    await assert.rejects(createR3Issuer(options).issue(f.login.handle,f.login.receipt),reject('NOT_CONFIGURED'));
    assert.equal(invoked,false);assert.deepEqual(bundle.calls,{claim:0,key:0});assert.equal(f.connect,0);
  });
}

test('an expired ledger acknowledgement cannot cause a signing-key read',async()=>{
  const f=await fixture(),bundle=issuerFixture(f,'renew',{
    intentNamespace:namespaceFixture(async()=>{const expiresAt=f.now+1;f.now=expiresAt;return {proofId:pid,validFrom:expiresAt-61,expiresAt};})
  });
  await assert.rejects(bundle.issuer.renew(f.login.handle),reject('INTENT_EXPIRED'));
  assert.equal(bundle.calls.key,0);assert.equal(f.creds,0);
});

for (const shift of [-1,60]) {
  test('outside proof validity window, verifier key reads stay zero: '+shift,async()=>{
    const f=await fixture(),e=await f.envelope('renew');let reads=0;
    f.lookup=async()=>{reads++;return f.slot;};f.now+=shift;
    await assert.rejects(f.service.renew(f.login.handle,e),reject('INVALID_PROOF'));
    assert.equal(reads,0);assert.equal(f.creds,0);
  });
}

test('certificate connection refuses password, legacy and missing certificate material before SQL', async () => {
  for (const material of [{ca:'test',password:'legacy'}, {ca:'test',cert:'test',key:''}]) {
    const f=await fixture(); f.material=material;
    await assert.rejects(f.issue(await f.envelope()),reject('REGISTRAR_UNAVAILABLE'));
    assert.equal(f.connect,0); assert.equal(f.applied.length,0);
  }
});
test('proof expires during connect and no registration is dispatched',async()=>{
  const f=await fixture(), envelope=await f.envelope();
  f.onConnect=async()=>{f.now=envelope.proof.expires_at;};
  await assert.rejects(f.issue(envelope),reject('INVALID_PROOF'));
  assert.equal(f.registered.length,0);
});
test('timed-out connection cannot dispatch later; uncertain SQL is never repeated',async()=>{
  for (const phase of ['onConnect','onQuery']) {
    const f=await fixture();
    const envelope=await f.envelope();
    let release; f.timeoutMs=10; f[phase]=()=>new Promise(resolve=>{ release=resolve; });
    await assert.rejects(f.issue(envelope),reject(phase==='onConnect'?'REGISTRAR_UNAVAILABLE':'REGISTRATION_UNKNOWN'));
    release(); await Promise.resolve();
    assert.equal(f.registered.length,phase==='onConnect'?0:1); assert.equal(f.applied.length,0);
  }
});

// Delivery binding/admission regressions. All clients and credentials are offline fixtures.
import {binding as testBinding} from './fixtures/binding.mjs';
import {createBusinessBinding} from '../../lib/business/binding.mjs';
import {admitSecurityEnvelope as admission} from '../../lib/business/r3-verifier.mjs';
function admissionOptions(f){return {binding:testBinding,enabled:true,identity:f.identity,lookupKey:async()=>f.slot,clock:()=>f.now,registrar:{Client:f.Client,credentials:async()=>({cert:'mock client certificate',key:'mock private material',ca:'mock private CA'})}};}
test('disabled admission never spends a fresh login receipt',async()=>{
 const f=await fixture(),proof=await f.envelope();
 await assert.rejects(admission('issue',f.login.handle,f.login.receipt,proof,{...admissionOptions(f),enabled:false}),reject('NOT_CONFIGURED'));
 await f.issue(proof);assert.equal(f.registered.length,1);
});
test('admission freezes project, target and registrar before asynchronous key lookup',async()=>{
 const f=await fixture(),proof=await f.envelope();let alternate=0;const options=admissionOptions(f);
 options.lookupKey=async()=>{options.binding=createBusinessBinding({project:'other-project',authIssuer:'https://auth.other.invalid/auth/v1',privateOrigin:'https://private.other.invalid',registrarHost:'pg.other.invalid'});options.registrar={Client:class{constructor(){alternate++;}},credentials:async()=>{alternate++;}};return f.slot;};
 await admission('issue',f.login.handle,f.login.receipt,proof,options);assert.equal(alternate,0);assert.equal(f.registered.length,1);
});
for(const jump of [61,501])test('admission rejects authentication freshness lost during key lookup '+jump,async()=>{
 const f=await fixture(),proof=await f.envelope(),options=admissionOptions(f);
 // Keep proof time valid separately: this exercises the opaque account/login clocks.
 options.clock=()=>1800000000;options.lookupKey=async()=>{f.now+=jump;return f.slot;};
 await assert.rejects(admission('issue',f.login.handle,f.login.receipt,proof,options),reject('FRESH_PASSWORD_LOGIN_REQUIRED','IDENTITY_REQUIRED'));
 assert.equal(f.registered.length,0);
});
test('issuer refuses an otherwise valid verifier from a different frozen target binding',async()=>{
 const f=await fixture(),bundle=issuerFixture(f,'issue');
 const other=createBusinessBinding({project:PROJECT,authIssuer:'http://127.0.0.1:56321/auth/v1',privateOrigin:'https://other.internal.test',registrarHost:'other.internal.test',testOnly:true});
 const issuer=createR3Issuer({...bundle.options,binding:other});
 await assert.rejects(issuer.issue(f.login.handle,f.login.receipt),reject('NOT_CONFIGURED'));assert.equal(bundle.calls.key,0);assert.equal(f.registered.length,0);
});
