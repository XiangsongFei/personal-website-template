import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createIdentityAdapter} from '../../lib/business/identity.mjs';
import {BusinessError,grantBytes,sha256} from '../../lib/business/protocol.mjs';
import {PROJECT} from './fixtures/binding.mjs';
import {authIssuer,registrarHost} from './fixtures/binding.mjs';
import {prepareFirstGrant,prepareGrantFollowup,firstGrantSequence,firstBudget,followupBudget} from './r3-first-grant-program.mjs';

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
    if(p.epoch!==(f.epoch??1))reject('epoch_mismatch');
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
  let start;
  f.connectionEvidence=async()=>{
    const proof=(role,mode)=>({project:PROJECT,sessionUser:role,database:'postgres',version:170011,session_ok:true,
      database_ok:true,transport_ok:true,readonly:true,rollback:true,transport:mode});
    return {project:PROJECT,m7Sha:'44cbfa6ef26f681abc1604a29bed4f3f15d884533bec5b3043fe919a397018a6',
      publicSchemas:'public',privateIngressVerified:true,api:proof('ecv_s3_internal_api_login','peer'),
      registrar:{...proof('ecv_s3_registration_login',f.badTls?'peer':'verify-full'),host:registrarHost,clientCertificateVerified:true}};
  };
  f.meterEvidence=async scope=>{
    const rpc=f.rpc-start.rpc;
    // Modeled hop projection only. No sockets are opened.
    return {...scope,signatures:f.signs-start.signs,intentClaims:f.intents.size-start.intents,
      registerSql:f.connections-start.connections,userRpc:rpc,outer:rpc,workerAuth:2*rpc,
      privateIngress:rpc,ingressAuth:f.skipAuth?0:2*rpc,postgrest:rpc,physicalHttp:rpc*(f.skipAuth?5:7),retries:f.retry?1:0,
      authWrites:0,siteWrites:0,unclassifiedHops:0};
  };
  f.context=async name=>{
    start={rpc:f.rpc,connections:f.connections,signs:f.signs,intents:f.intents.size};
    const n=name.startsWith('bob')?2:1;
    if(!logins.has(n))logins.set(n,await identity.passwordLogin({email:n+'@example.test',password:'mock'}));
    const login=logins.get(n);
    return {identity,handle:login.handle,loginReceipt:login.receipt,clock,sessionId:fakeId(n+100),epoch:f.epoch??1,keyId:'offline',
      proofId:fakeId(1000+(name==='bobReplay'?1:firstGrantSequence.indexOf(name))),registrar,repository:repo,
      lookupVerificationKey:async()=>slot,lookupSigningKey:async()=>{f.signs++;return slot;},
      intents:{idFromName:x=>x,get:()=>({claimOnce:async plan=>{
        if(f.intents.has(plan.proof_id))return false; f.intents.add(plan.proof_id);
        return {proofId:plan.proof_id,validFrom:clock()-1,expiresAt:clock()+60};
      }})}};
  };
  f.observe=async({uid,id},p)=>{
    f.reads++;const t=f.tickets.get(id),r=f.receipts.get(id),g=f.grants.get(uid);
    const others=(map,key)=>[...map].filter(([k])=>key!==k);
    return {backendPid:f.reads,rollback:!f.missingRollback,readOnly:true,dbNow:clock(),currentEpoch:f.epoch??1,sessionActive:true,
      gatesOpen:!f.closed,generationActive:true,grantExpired:g?g.exp<=clock():null,
      tickets:+!!t,receipts:+!!r,grants:+!!g,grantSha:g?hash(g):null,grantId:g?.id??null,grantExpiry:g?.exp??null,revoked:g?.revoked??null,
      ticketMatches:!!p && !!t && hash(t)===hash(p),receiptMatches:!!p && !!r && hash(r)===hash(p),
      retainedSha:hash(['catalog',f.driftCatalog && f.rpc>0]),
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
test('one registered ticket, one RPC and a confirmed active Alice grant end the minimal phase',async()=>{
  const f=await fixture(), first=prepareFirstGrant(f);
  await assert.rejects(first.next('aliceIssueRace'),/NOT_READY/);
  assert.deepEqual(await first.next('aliceIssue'),{name:'aliceIssue',result:'ACCEPTED'});
  assert.equal(first.receipt()[0].finalRead,'ROLLBACK');
  assert.deepEqual([f.intents.size,f.signs,f.connections,f.rpc,f.tickets.size,f.receipts.size,f.grants.size,f.reads],
    [1,1,1,1,1,1,1,2]);
  const cp=first.checkpoint();
  assert.deepEqual(Object.keys(cp).sort(),['grantId','name','project','proof','version']);
  assert.equal(cp.proof.uid,fakeId(1));assert.equal(cp.proof.session_id,fakeId(101));
  assert.equal(cp.proof.proof_id,fakeId(1000));
  await assert.rejects(first.next('aliceIssue'),/NOT_READY/);
  await assert.rejects(first.next('bobIssueRace'),/NOT_READY/);
});

test('versioned continuation re-attests the initial commit and shifts only the two-call race to Bob',async()=>{
  const f=await fixture(),first=prepareFirstGrant(f);
  assert.equal((await first.next('aliceIssue')).result,'ACCEPTED');
  f.now+=120; // First Alice ticket is now expired. It must never be used to test replay.
  f.verifiedFirstGrant=async()=>first.checkpoint();
  const follow=await prepareGrantFollowup(f);
  await assert.rejects(follow.next('aliceIssue'),/NOT_READY/);
  for(const name of firstGrantSequence.slice(1)){
    f.now++;
    if(name==='bobExpiredGrant') f.now=f.grants.get(fakeId(2)).exp+1;
    assert.deepEqual(await follow.next(name),{name,result:'ACCEPTED'});
  }
  assert.deepEqual([f.intents.size,f.connections,f.rpc,f.receipts.size,f.grants.size,f.reads],[7,7,11,4,2,21]);
  assert.equal(firstBudget.physicalHttp+followupBudget.physicalHttp,77);
  assert.equal(firstBudget.rpc+followupBudget.rpc,f.rpc);
  assert.equal(follow.receipt()[0].rpcCalls,2);
});
for(const [flag,outcome,rpc,signs] of [
  ['badTls','STOP',0,0],['closed','STOP',0,0],['missingRollback','STOP',0,0],
  ['recovery','STOP',0,0],['drift','STOP',1,1],['driftCatalog','STOP',1,1],['retry','STOP',1,1],['skipAuth','STOP',1,1],
  ['loseRegistration','UNKNOWN',0,1],['loseConsume','UNKNOWN',1,1]
]){
  test('no continuation or reissue after '+flag,async()=>{
    const f=await fixture(); f[flag]=true;
    const first=prepareFirstGrant(f);
    assert.equal((await first.next('aliceIssue')).result,outcome);
    assert.equal(first.checkpoint(),null);
    assert.equal(f.rpc,rpc);assert.equal(f.signs,signs);
    await assert.rejects(first.next('aliceIssue'),/NOT_READY/);
  });
}
test('altered handoff or lost DB session prevents Bob and any subsequent dispatch',async()=>{
  const f=await fixture(),first=prepareFirstGrant(f);
  assert.equal((await first.next('aliceIssue')).result,'ACCEPTED');
  const cp=first.checkpoint();
  f.verifiedFirstGrant=async()=>({...cp,grantId:fakeId(899)});
  await assert.rejects(prepareGrantFollowup(f));
  f.verifiedFirstGrant=async()=>cp;
  const observe=f.observe;
  f.observe=async(...args)=>({...await observe(...args),sessionActive:false});
  await assert.rejects(prepareGrantFollowup(f));
  assert.equal(f.signs,1);assert.equal(f.rpc,1);
});
test('lost approval acknowledgment cannot reach signing and cannot be retried',async()=>{
  const f=await fixture(),run=prepareFirstGrant(f);
  f.claimOnce=async()=>{throw new Error('sensitive material must not appear in receipt');};
  assert.equal((await run.next('aliceIssue')).result,'UNKNOWN');
  assert.equal(f.rpc+f.signs,0);
  assert(!JSON.stringify(run.receipt()).includes('sensitive'));
  await assert.rejects(run.next('aliceIssue'),/NOT_READY/);
});

test('a legitimate epoch zero can finish the minimum without authorizing an impossible stale-epoch control',async()=>{
  const f=await fixture();f.epoch=0;
  const run=prepareFirstGrant(f);
  assert.equal((await run.next('aliceIssue')).result,'ACCEPTED');
  f.verifiedFirstGrant=async()=>run.checkpoint();
  await assert.rejects(prepareGrantFollowup(f));
  assert.equal(f.rpc,1);
});
