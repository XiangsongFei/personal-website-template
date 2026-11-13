import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {stageRegistration} from './driver/registration.mjs';
import {FileIntents} from './driver/state.mjs';
import {boundedOperation,checkIo} from './driver/deadline.mjs';
import {binding} from './clean-candidate/service.mjs';
import {ALICE,ISSUER,PROJECT} from './driver/contract.mjs';
import {createIdentityAdapter} from '../../lib/business/identity.mjs';
import {claimApprovedIntent,ledgerName} from '../../lib/business/r3-intent-ledger.mjs';
async function fixture(fault){
 const now=1800000000,sid=randomUUID(),counts={connect:0,query:0,end:0,grant:0};
 const claims={iss:ISSUER,aud:'authenticated',role:'authenticated',sub:ALICE,session_id:sid,amr:[{method:'password'}],is_anonymous:false,exp:now+3600},user={id:ALICE,email:'offline@example.test',email_confirmed_at:'2026-01-01',is_anonymous:false};
 const identity=createIdentityAdapter({issuer:ISSUER,clock:()=>now,auth:{signInWithPassword:async()=>({data:{user,session:{user,access_token:'offline-token'}}}),verifyTokenAndUser:async()=>({data:{claims,user}})}});
 const login=await identity.passwordLogin({email:user.email,password:'offline'});
 const intent={project:PROJECT,action:'issue',uid:ALICE,session_id:sid,epoch:0,proof_id:randomUUID(),key_id:'s34-r3-clean-20261112-k5'};
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'ecv-s34-register-'))),ledger=new FileIntents(join(directory,'intents'),{runId:randomUUID(),sourceSha:'a'.repeat(64),create:true});ledger.approve(intent,now-1,now+60);
 const intentNamespace={idFromName:n=>n,get:n=>{assert.equal(n,ledgerName(PROJECT));return {claimOnce:p=>claimApprovedIntent(ledger.storage(),p,()=>now,binding)};}};
 const key={id:intent.key_id,project:PROJECT,revoked:false,notBefore:now-1,signUntil:now+60,verifyUntil:now+120,macKey:await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify'])};
 class Client{constructor(c){this.config=c;}async connect(){counts.connect++;if(fault==='connect-hang')return new Promise(()=>{});const c=this.config;assert.equal(c.user,'ecv_s3_registration_login');assert.equal(c.host,binding.registrarHost);const e=c.ssl.checkServerIdentity(c.host,{subjectaltname:'DNS:'+(fault==='peer'?'wrong.invalid':c.host)});if(e)throw e;}async query(sql,args){counts.query++;assert.equal(sql,'SELECT site_private.register_business_ticket($1::jsonb) AS registered');const proof=JSON.parse(args[0]);assert.equal(proof.proof_id,intent.proof_id);if(fault==='lost-query')throw Error('lost');return {command:'SELECT',rowCount:1,rows:[{registered:true}]};}async end(){counts.end++;if(fault==='close')throw Error('lost close');}}
 const options={binding,identity,...login,intent,intentNamespace,key,clock:()=>now,registrar:{Client,timeoutMs:20,credentials:async()=>({ca:'fake-ca',cert:'fake-cert',key:'fake-key'})}};
 const grant=async proof=>{checkIo();counts.grant++;assert.equal(proof.proof_id,intent.proof_id);return {grant_id:randomUUID(),status:'active',expires_at:'2027-01-01T00:00:00Z'};};
 return {options,counts,grant,identity,login};
}
test('real branded issuer + native HMAC + persistent Intent + registrar stage does not apply early',async()=>{
 const f=await fixture(),meter={deadline:Date.now()+120000,clock:Date.now};
 const s=await boundedOperation(()=>stageRegistration(f.options),{meter});
 assert(s.nativeVerified);assert(Object.isFrozen(s.proof));assert.deepEqual(f.counts,{connect:1,query:1,end:1,grant:0});
 // The signRegister ALS scope is now aborted. Only this NEW apply scope can
 // perform I/O; the old pipeline receives just the already-obtained DTO.
 const r=await boundedOperation(()=>s.apply(f.grant),{meter});assert.equal(r.status,'active');assert.equal(f.counts.grant,1);
 await assert.rejects(s.apply(f.grant),/GRANT_STAGE_ONCE/);assert.equal(f.counts.grant,1);
});
test('cancelling staged registration performs no Grant and cannot later release it',async()=>{const f=await fixture(),s=await stageRegistration(f.options);s.cancel();s.cancel();await assert.rejects(s.apply(f.grant),/GRANT_STAGE_ONCE/);await new Promise(r=>setImmediate(r));assert.equal(f.counts.grant,0);});
test('a lost Grant result or invalid DTO stays UNKNOWN and is never redispatched',async t=>{
 for(const fault of ['network','dto'])await t.test(fault,async()=>{const f=await fixture(),s=await stageRegistration(f.options);let calls=0;await assert.rejects(s.apply(async()=>{calls++;if(fault==='network')throw Error('lost commit');return {status:'active'};}),e=>e.code==='COMMIT_UNKNOWN'&&e.proofId===s.proof.proof_id);await assert.rejects(s.apply(f.grant),/GRANT_STAGE_ONCE/);assert.equal(calls,1);});
});
test('registration network, EOF, peer and connect-timeout failures never stage a Grant',async t=>{
 for(const fault of ['lost-query','close','peer','connect-hang'])await t.test(fault,async()=>{const f=await fixture(fault);await assert.rejects(stageRegistration(f.options),e=>['REGISTRATION_UNKNOWN','REGISTRAR_UNAVAILABLE'].includes(e.code));assert.equal(f.counts.grant,0);assert.equal(f.counts.connect,1);assert.equal(f.counts.end,1);assert.equal(f.counts.query,['peer','connect-hang'].includes(fault)?0:1);});
});
test('consumed persistent Intent refuses a newly observed login without another registration',async()=>{const f=await fixture(),s=await stageRegistration(f.options);s.cancel();const login=await f.identity.passwordLogin({email:'offline@example.test',password:'offline'});await assert.rejects(stageRegistration({...f.options,...login}),e=>e.code==='INTENT_ALREADY_USED');assert.equal(f.counts.connect,1);assert.equal(f.counts.query,1);});
