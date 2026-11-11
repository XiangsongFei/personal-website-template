import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createIdentityAdapter} from '../../lib/business/identity.mjs';
import {BusinessError,grantBytes,sha256} from '../../lib/business/protocol.mjs';
import {PROJECT} from './fixtures/binding.mjs';
import {authIssuer,registrarHost} from './fixtures/binding.mjs';
import {prepareR3Batch,r3Sequence} from './r3-batch-program.mjs';

// Offline only. The grant/ticket store emulates M5. Real Worker signer/verifier and
// identity adapter execute in-process; all network, database, time, and peers are fake.
const fakeId=n=>'a33b0000-0000-4000-8000-'+String(n).padStart(12,'0');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const deny=()=>{throw new BusinessError('BUSINESS_DENIED',403);};
async function fixture() {
  const f={now:1800000000,tickets:new Map(),receipts:new Map(),grants:new Map(),
    permits:new Set(),intents:new Set(),rpc:0,reads:0,signs:0,connections:0};
  const clock=()=>f.now;
  const slot={id:'offline',project:PROJECT,revoked:false,notBefore:f.now-30,signUntil:f.now+5000,verifyUntil:f.now+5100,
    macKey:await crypto.subtle.importKey('raw',new Uint8Array(32).fill(41),{name:'HMAC',hash:'SHA-256'},false,['sign'])};
  const identity=createIdentityAdapter({issuer:authIssuer,clock,auth:{
    getClaims:async n=>({data:{claims:{iss:authIssuer,aud:'authenticated',role:'authenticated',sub:fakeId(+n),session_id:fakeId(+n+100),
      exp:f.now+10000,is_anonymous:false,amr:[{method:f.recovery?'recovery':'password'}]}}}),
    getUser:async n=>({data:{user:{id:fakeId(+n),email:n+'@example.test',is_anonymous:false,email_confirmed_at:'2026-01-01'}}}),
    signInWithPassword:async({email})=>{const n=email.split('@')[0],user={id:fakeId(+n)};return {data:{session:{user,access_token:n},user}};}
  }});
  const logins=new Map();
  const registrar={credentials:async()=>({ca:'mock',cert:'mock',key:'mock'}),Client:class {
    constructor(config){this.config=config;}
    async connect(){f.connections++;assert.equal(this.config.user,'ecv_s3_registration_login');
      assert.equal(this.config.ssl.checkServerIdentity(registrarHost,{subjectaltname:'DNS:'+registrarHost}),undefined);}
    async query(sql,[raw]){assert.equal(sql,'SELECT site_private.register_business_ticket($1::jsonb) AS registered');
      const p=JSON.parse(raw);assert(!f.tickets.has(p.proof_id));f.tickets.set(p.proof_id,p);
      if(f.loseRegistration)throw new Error('sensitive');
      return {command:'SELECT',rowCount:1,rows:[{registered:true}]};}
    async end(){}
  }};
  const reject=(branch)=>{f.denial=branch;deny();};
  const repo={async grant(h,{proof:p}){
    f.rpc++;const g=f.grants.get(p.uid);
    assert.equal(p.payload_digest,await sha256(grantBytes(p)));
    if(!f.bypassMissing && !f.tickets.has(p.proof_id))reject('ticket_absent');
    if(f.tickets.has(p.proof_id) && hash(f.tickets.get(p.proof_id))!==hash(p))reject('binding_mismatch');
    if(p.epoch!==1)reject('epoch_mismatch');
    if(clock()>=p.expires_at)reject('ticket_expired');
    if(!f.bypassConsumed && f.receipts.has(p.proof_id))reject('already_consumed');
    const current=f.grants.get(p.uid);
    if(p.action==='issue' && current)reject('duplicate_issue');
    if(p.action!=='issue' && !current)reject('missing_grant');
    if(current?.revoked)reject('revoked_grant');
    if(current?.exp<=clock())reject('grant_expired');
    const updated={id:g?.id??fakeId(300+f.grants.size),revoked:p.action==='revoke',exp:p.action==='revoke'?g.exp:clock()+1800,
      action:p.action,renewal:clock()};
    f.grants.set(p.uid,updated); f.receipts.set(p.proof_id,p);
    if(f.loseConsume) throw new Error('sensitive');
    return {grant_id:updated.id,status:updated.revoked?'revoked':'active',expires_at:new Date(updated.exp*1000).toISOString()};
  },async mine(){f.rpc++;if(f.grants.get(fakeId(2))?.exp<=clock())reject('grant_expired');return {leak:true};}};
  f.context=async name=>{
    const n=name.startsWith('bob')?2:1;
    if(!logins.has(n))logins.set(n,await identity.passwordLogin({email:n+'@example.test',password:'mock'}));
    const login=logins.get(n);
    return {identity,handle:login.handle,loginReceipt:login.receipt,clock,sessionId:fakeId(n+100),epoch:1,keyId:'offline',
      proofId:fakeId(1000+(name==='aliceReplay'?0:r3Sequence.indexOf(name))),registrar,repository:repo,
      lookupVerificationKey:async()=>slot,lookupSigningKey:async()=>{f.signs++;return slot;},
      intents:{idFromName:x=>x,get:()=>({claimOnce:async plan=>{
        if(f.intents.has(plan.proof_id))return false; f.intents.add(plan.proof_id);
        return {proofId:plan.proof_id,validFrom:clock()-1,expiresAt:clock()+60};
      }})}};
  };
  f.observe=async({uid,id},p)=>{
    f.reads++;const t=f.tickets.get(id),r=f.receipts.get(id),g=f.grants.get(uid);
    const others=(map,key)=>[...map].filter(([k])=>key!==k);
    return {backendPid:f.reads,rollback:!f.missingRollback,readOnly:true,dbNow:clock(),currentEpoch:1,sessionActive:true,
      gatesOpen:!f.closed,generationActive:true,grantExpired:g?g.exp<=clock():null,
      tickets:+!!t,receipts:+!!r,grants:+!!g,grantSha:g?hash(g):null,grantId:g?.id??null,grantExpiry:g?.exp??null,revoked:g?.revoked??null,
      ticketMatches:!!p && !!t && hash(t)===hash(p),receiptMatches:!!p && !!r && hash(r)===hash(p),
      protectedSha:hash([others(f.tickets,id),others(f.receipts,id),others(f.grants,uid),f.drift&&f.rpc>0])};
  };
  f.waitUntil=async t=>{f.now=t;};
  f.claimOnce=async({name})=>{if(f.permits.has(name))return false;f.permits.add(name);return true;};
  const applyBody='abe8ebce29746194320a6388ac10063de34cc8dd883dbc761958c56d5cf5c767';
  const raiseSites={already_consumed:[applyBody,18],duplicate_issue:[applyBody,24],revoked_grant:[applyBody,31],
    epoch_mismatch:[applyBody,13],ticket_absent:['9cc69d4ca9f4d377188d5a17e93f4c1f070c753d1621b35ad82b13aa4af9f0e1',14],
    ticket_expired:['d02ff32f8978a8f1f50f3a1915b122e06b06aecf1c0d558d3d383deb055df897',43],
    grant_expired:['325f872316c35321a81ba343321dfda9143074fa035b9f4132e7937fb6aa3db3',7]};
  f.denialEvidence=async obs=>({...obs,state:'42501',pid:123,branch:f.wrongDenial?'unrelated_denial':f.denial,
    bodySha:f.driftBody?'0'.repeat(64):raiseSites[f.denial][0],raiseLine:f.wrongLine?24:raiseSites[f.denial][1]});
  f.raceEvidence=async({id,uid,sid})=>({id,waitEventType:'Lock',observedMs:1005,
    legs:[124,123].map((pid,i)=>({id,uid,sid,ordinal:i+1,pid,role:'authenticated',login:'ecv_s3_internal_api_login',
      rpc:'apply_business_grant',state:i?'42501':'00000',issuedMs:f.lateWait?1006:1000,completedMs:1010})),waiter:123,blocker:124,reason:'transactionid',loserPid:f.wrongBackend?999:123,winnerPid:124,observedBlocked:!f.missingLock,readOnly:true,rollback:true});
  return f;
}
test('full offline sequence enforces exact footprints, grants, denials and timing',async()=>{
  const f=await fixture(),run=prepareR3Batch(f);
  for(const name of r3Sequence){
    f.now++;
    if(name==='bobExpiredGrant')f.now=f.grants.get(fakeId(2)).exp+1;
    assert.deepEqual(await run.next(name),{name,result:'ACCEPTED'},name);
  }
  assert.deepEqual([f.signs,f.connections,f.tickets.size,f.receipts.size,f.grants.size,f.rpc,f.reads],[7,7,7,4,2,11,20]);
});
for(const [flag,outcome,rpc,tickets] of [
  ['closed','STOP',0,0],['missingRollback','STOP',0,0],['missingLock','STOP',2,1],['drift','STOP',2,1],
  ['wrongLine','STOP',2,1],['driftBody','STOP',2,1],['lateWait','STOP',2,1],['wrongDenial','STOP',2,1],['wrongBackend','STOP',2,1],['bypassConsumed','STOP',2,1],
  ['loseRegistration','UNKNOWN',0,1],['loseConsume','UNKNOWN',2,1],['recovery','STOP',0,0]
]){
  test('fail closed: '+flag,async()=>{
    const f=await fixture();f[flag]=true;const run=prepareR3Batch(f);
    assert.equal((await run.next('aliceIssueRace')).result,outcome);
    await assert.rejects(run.next('aliceIssueRace'),/NOT_READY/);
    assert.deepEqual([f.rpc,f.tickets.size],[rpc,tickets]);
    assert(!JSON.stringify(run.receipt()).includes('sensitive'));
  });
}
test('out-of-order, unconfigured port or consumed approval cannot dispatch',async()=>{
  await assert.rejects(prepareR3Batch().next('aliceIssueRace'),/NOT_READY/);
  const f=await fixture();f.permits.add('aliceIssueRace');const run=prepareR3Batch(f);
  await assert.rejects(run.next('aliceRevoke'),/NOT_READY/);
  assert.equal((await run.next('aliceIssueRace')).result,'STOP');assert.equal(f.signs,0);assert.equal(f.rpc,0);
});

test('uncertain durable approval remains UNKNOWN and never signs or dispatches',async()=>{
  const f=await fixture();f.claimOnce=async()=>{throw Error('mock lost acknowledgement');};
  const run=prepareR3Batch(f);assert.equal((await run.next('aliceIssueRace')).result,'UNKNOWN');
  await assert.rejects(run.next('aliceIssueRace'),/NOT_READY/);assert.equal(f.signs+f.rpc,0);
});

test('unregistered but otherwise eligible renew exposes missing registration guard',async()=>{
  const f=await fixture(),run=prepareR3Batch(f);
  for(const name of ['aliceIssueRace','aliceReplay'])assert.equal((await run.next(name)).result,'ACCEPTED');
  f.bypassMissing=true;
  assert.equal((await run.next('unregistered')).result,'STOP');
  await assert.rejects(run.next('bobIssue'),/NOT_READY/);
});
