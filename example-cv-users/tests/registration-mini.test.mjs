import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runtime} from './runtime.mjs';
import {realAuthority,TEST_PASSWORD,TEST_OTP,TEST_KEY} from './auth-fixture.mjs';
import {outgoingHeaders} from '../scripts/local-https-boundary.mjs';
import {EXECUTOR,ORIGIN,AUTH,PROJECT,LIMITS,REGISTRATION_PROFILE,REGISTRATION_LIMITS,bindings,createExecutor,validateBatch,approvalStateMatches} from '../scripts/controlled-real.mjs';
const manifest={sourceSha256:'a'.repeat(64),artifactSha256:'b'.repeat(64),toolingSha256:'c'.repeat(64)};
const makeBatch=()=>({executor:EXECUTOR,id:'S2-USERS-REAL-REGISTRATION-OFFLINE',profile:REGISTRATION_PROFILE,primaryBrowser:'Chrome',maxRegistrationEmails:1,project:PROJECT,origin:ORIGIN,executionBuild:manifest.sourceSha256,artifactSha256:manifest.artifactSha256,toolingSha256:manifest.toolingSha256,maxUpstreamRequests:{...REGISTRATION_LIMITS},expiresAt:Date.now()+20*60000,authorization:'OFFLINE_TRANSPORT_TEST',currentPasswordPolicy:'ON',accounts:{R:{email:'new-register@example.invalid',userIdSha256:null}}});
async function setup({lost=false,verifyLost=false,timeout=false}={}){
 const auth=await realAuthority({url:AUTH}),batch=makeBatch(),dir=mkdtempSync(resolve('.runtime/registration-mini-'));let hits=0,escaped=0,loseLogout=false;
 const server=createServer(async(q,r)=>{hits++;const chunks=[];for await(const c of q)chunks.push(c);if(timeout)return;if(lost||verifyLost&&q.url.startsWith('/auth/v1/verify')||loseLogout&&q.url.startsWith('/auth/v1/logout')){q.socket.destroy();return;}
 const out=await auth.fetch(new Request(AUTH+q.url,{method:q.method,headers:q.headers,...(!['GET','HEAD'].includes(q.method)?{body:Buffer.concat(chunks)}:{})}));r.writeHead(out.status,{'content-type':'application/json'});r.end(await out.text());});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const port=server.address().port;
 const executor=createExecutor({batch,manifest,dir,key:TEST_KEY,offline:true,...(timeout?{timeoutMs:50}:{}),send:async r=>{assert.equal(new URL(r.url).origin,AUTH);assert.equal(r.headers.get('content-length'),null);assert.equal(r.headers.get('host'),null);return fetch(new Request('http://127.0.0.1:'+port+new URL(r.url).pathname+new URL(r.url).search,{method:r.method,headers:r.headers,...(!['GET','HEAD'].includes(r.method)?{body:await r.arrayBuffer()}:{}),signal:r.signal}),{redirect:'manual'});}});
 const mf=runtime({bindings:bindings(batch,TEST_KEY),resourcePersistencePath:resolve(dir,'state'),serviceBindings:{USERS_CONTROLLED_EGRESS:r=>executor.outbound(r)},outboundService:()=>{escaped++;throw Error('forbidden');}}),jar=new Map();
 async function request(path,data,browser='Chrome'){
 const r=new Request(ORIGIN+path,{method:data===undefined?'GET':'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const res=await executor.dispatch(r,async r=>mf.dispatchFetch(r.url,{method:r.method,headers:r.headers,...(r.method==='POST'?{body:await r.arrayBuffer()}:{}),redirect:'manual'}),browser);
 const h=outgoingHeaders(res);for(const line of h['set-cookie']??[]){const p=line.split(';')[0],i=p.indexOf('=');if(/Max-Age=0(?:;|$)/.test(line))jar.delete(p.slice(0,i));else jar.set(p.slice(0,i),p.slice(i+1));}
 const body=await res.text();return {status:res.status,location:h.location,body};
 }
 return {auth,batch,dir,executor,request,hits:()=>hits,loseLogout:()=>{loseLogout=true;},close:async()=>{await executor.cleanup();await mf.dispose();executor.close();await new Promise(ok=>server.close(ok));assert.equal(server.listening,false);assert.equal(escaped,0);}};
}
const signup=c=>({email:c.batch.accounts.R.email,password:TEST_PASSWORD,confirmPassword:TEST_PASSWORD});
async function registerVerify(c){c.executor.arm('r-register');assert.equal((await c.request('/api/account/register',signup(c))).status,200);c.executor.arm('r-verify');assert.equal((await c.request('/api/account/verify-email',{email:c.batch.accounts.R.email,token:TEST_OTP})).status,200);}
test('mini profile rejects widened limits, extra accounts, wrong browser and approval without any network',()=>{
 const b=makeBatch();assert.equal(validateBatch(b,manifest,{offline:true}),b);
 for(const patch of [{maxUpstreamRequests:LIMITS},{accounts:{...b.accounts,A:{email:'other@example.invalid',userIdSha256:null}}},{primaryBrowser:'Safari'},{maxRegistrationEmails:2},{profile:'other'}])assert.throws(()=>validateBatch({...b,...patch},manifest,{offline:true}));
 const live={...b,authorization:'APPROVED',executable:true,configurationLiveRead:'VERIFIED',registrationStatus:'USER_CONFIRMED_UNUSED',approvalReference:'offline-pure-validation',accounts:{R:{email:'approved-register@example.invalid',userIdSha256:null}}};assert.equal(approvalStateMatches(live),true);assert.throws(()=>validateBatch(live,manifest),/live_approval_missing/);assert.throws(()=>validateBatch({...live,executable:false},manifest));
});
test('Chrome registration only through real workerd, native fetch loopback and response cookies; extra concurrent actions blocked before upstream',async t=>{
 const c=await setup();try{c.executor.arm('r-register');
 for(const action of ['login','refresh','change-password','reset-password','recovery-otp-send','recovery-otp-verify','resend-confirmation','recovery-logout'])assert.equal((await c.request('/api/account/'+action,{})).status,403);
 assert.equal((await c.request('/change-password')).status,403);assert.equal((await c.request('/api/account/register',signup(c),'Safari')).status,403);assert.equal((await c.request('/api/account/register',{...signup(c),email:'unapproved-recovery@example.invalid'})).status,403);assert.equal(c.hits(),0);
 const results=await Promise.all([1,2,3].map(()=>c.request('/api/account/register',signup(c))));assert.deepEqual(results.map(r=>r.status).sort(),[200,403,403]);assert.equal(c.hits(),1);
 c.executor.arm('r-verify');assert.equal((await c.request('/api/account/verify-email',{email:c.batch.accounts.R.email,token:TEST_OTP})).status,200);
 assert.equal((await c.request('/account')).status,200);assert.equal(c.executor.snapshot().openSessions,1);
 c.executor.arm('r-logout');assert.equal((await c.request('/api/account/logout',{})).status,200);assert.equal((await c.request('/account')).status,303);assert.equal(c.executor.snapshot().next,'complete');assert.throws(()=>c.executor.arm('a-login0'));
 const snap=c.executor.snapshot();assert.equal(snap.counts.refresh,0);assert.equal(snap.counts.passwordLogin,0);assert.equal(snap.counts.passwordUpdate,0);assert.equal(snap.counts.localLogout,1);assert.equal(snap.counts.getUser,2);assert.ok(snap.counts.jwks<=2);assert.equal(snap.openSessions,0);t.diagnostic(JSON.stringify({counts:snap.counts,localReceiverHits:c.hits(),evidence:c.dir}));
 }finally{await c.close();}
});
test('registration UNKNOWN spends its only slot; retries and other stages cannot reach upstream',async()=>{
 const c=await setup({lost:true});try{c.executor.arm('r-register');assert.equal((await c.request('/api/account/register',signup(c))).status,503);assert.equal(c.hits(),1);assert.equal(c.executor.snapshot().counts.signup,1);assert.equal((await c.request('/api/account/register',signup(c))).status,403);assert.throws(()=>c.executor.arm('r-verify'));assert.equal(c.hits(),1);assert.equal(await c.executor.cleanup(),true);}finally{await c.close();}
});
test('identity quota exhaustion preserves independent scoped logout; failed cleanup cannot exceed two attempts',async()=>{
 const c=await setup();try{await registerVerify(c);while(c.executor.snapshot().counts.getUser<4)assert.equal((await c.request('/api/account/session')).status,200);const hits=c.hits();assert.equal((await c.request('/api/account/session')).status,503);assert.equal(c.hits(),hits);c.loseLogout();assert.equal(await c.executor.cleanup(),false);assert.equal(await c.executor.cleanup(),false);assert.equal(await c.executor.cleanup(),false);assert.equal(c.executor.snapshot().counts.localLogout,2);assert.equal(c.hits(),hits+2);}finally{await c.close();}
});

test('mini timeout and verification UNKNOWN keep spent slots; no second send or verification',async()=>{
 for(const mode of ['timeout','verifyLost']){const c=await setup({[mode]:true});try{
 c.executor.arm('r-register');const result=await c.request('/api/account/register',signup(c));
 if(mode==='timeout'){assert.equal(result.status,503);assert.equal(c.executor.snapshot().counts.signup,1);assert.equal((await c.request('/api/account/register',signup(c))).status,403);}
 else{assert.equal(result.status,200);c.executor.arm('r-verify');const data={email:c.batch.accounts.R.email,token:TEST_OTP};assert.equal((await c.request('/api/account/verify-email',data)).status,503);assert.equal(c.executor.snapshot().counts.verifySignup,1);assert.equal((await c.request('/api/account/verify-email',data)).status,403);}
 assert.equal(c.hits(),mode==='timeout'?1:2);assert.equal(await c.executor.cleanup(),true);
 }finally{await c.close();}}
});
