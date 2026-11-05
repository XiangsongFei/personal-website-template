import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createConnection} from 'node:net';
import {outgoingHeaders} from '../scripts/local-https-boundary.mjs';
import {safeError} from '../scripts/transport-diagnostics.mjs';
import {runtime} from './runtime.mjs';
import {realAuthority,TEST_PASSWORD,TEST_OTP,TEST_KEY} from './auth-fixture.mjs';
import {EXECUTOR,ORIGIN,AUTH,PROJECT,LIMITS,STEPS,bindings,createExecutor,validateBatch,approvalStateMatches,sha} from '../scripts/controlled-real.mjs';
const manifest={sourceSha256:'a'.repeat(64),artifactSha256:'b'.repeat(64),toolingSha256:'c'.repeat(64)};
const source=readFileSync(new URL('../lib/config.ts',import.meta.url),'utf8');
const code=source.slice(source.indexOf('export function configuration('),source.indexOf('export async function digest(')).replace('export function','function').replace('env: UsersEnv','env');
const configuration=new Function('TARGET',code+';return configuration;')(PROJECT);
const batchFor=auth=>({executor:EXECUTOR,id:'S2-USERS-REAL-OFFLINE-20261105',project:PROJECT,origin:ORIGIN,executionBuild:manifest.sourceSha256,
  artifactSha256:manifest.artifactSha256,toolingSha256:manifest.toolingSha256,maxUpstreamRequests:{...LIMITS},expiresAt:Date.now()+30*60000,
  authorization:'OFFLINE_TRANSPORT_TEST',currentPasswordPolicy:'ON',accounts:{A:{email:'user-a@example.invalid',userIdSha256:sha(auth.ids.A)},R:{email:'new-register@example.invalid',userIdSha256:null}}});
async function context({send,authOptions={},timeoutMs}={}) {
  const auth=await realAuthority({url:AUTH,...authOptions}),batch=batchFor(auth),dir=mkdtempSync(resolve('.runtime/controlled-offline-'));
  let intercepted=0,escaped=0;
  const executor=createExecutor({batch,manifest,dir,key:TEST_KEY,offline:true,...(timeoutMs?{timeoutMs}:{}),send:async r=>{intercepted++;assert.equal(new URL(r.url).origin,AUTH);return send?send(r,auth):auth.fetch(r);}});
  const options={bindings:bindings(batch,TEST_KEY),resourcePersistencePath:resolve(dir,'state'),serviceBindings:{USERS_CONTROLLED_EGRESS:r=>executor.outbound(r)},outboundService:()=>{escaped++;throw Error('NETWORK_FORBIDDEN');}};
  const ctx={auth,batch,dir,executor,options,mf:runtime(options),jar:new Map(),counts:()=>({intercepted,escaped})};
  ctx.close=async()=>{await executor.cleanup();const port=Number((await ctx.mf.ready).port);await ctx.mf.dispose();executor.close();assert.equal(escaped,0);
    await new Promise((ok,no)=>{const socket=createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();no(Error('owned_port_still_open'));});socket.once('error',e=>e.code==='ECONNREFUSED'?ok():no(e));});};return ctx;
}
async function request(ctx,action,data,extra={}) {
  const r=new Request(ORIGIN+'/api/account/'+action,{method:data===undefined?'GET':'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Cookie:[...ctx.jar].map(([k,v])=>k+'='+v).join('; '),...extra.headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const worker=async r=>ctx.mf.dispatchFetch(r.url,{method:r.method,headers:r.headers,...(r.method==='POST'?{body:await r.arrayBuffer()}:{}),redirect:'manual'});
  const res=await ctx.executor.dispatch(r,worker);outgoingHeaders(res);
  for(const line of res.headers.getSetCookie()) {assert.match(line,/; Secure; HttpOnly; SameSite=Lax/);assert.doesNotMatch(line,/Domain=/i);const p=line.split(';')[0],i=p.indexOf('=');if(/Max-Age=0(?:;|$)/.test(line))ctx.jar.delete(p.slice(0,i));else ctx.jar.set(p.slice(0,i),p.slice(i+1));}
  return {status:res.status,body:await res.json(),cookies:res.headers.getSetCookie().length};
}
const P1='SYNTHETIC_PASSWORD_PHASE_ONE',P2='SYNTHETIC_PASSWORD_PHASE_TWO';
const payload=(ctx,step)=>({
  register:{email:ctx.batch.accounts.R.email,password:TEST_PASSWORD,confirmPassword:TEST_PASSWORD},
  'verify-email':{email:ctx.batch.accounts.R.email,token:TEST_OTP},
  login:{email:ctx.batch.accounts.A.email,password:['a-login0','a-old'].includes(step.id)?step.id==='a-old'?P1:TEST_PASSWORD:step.id==='a-login1'?P1:P2},
  'change-password':{currentPassword:TEST_PASSWORD,newPassword:P1,confirmNewPassword:P1},
  'recovery-otp-send':{email:ctx.batch.accounts.A.email},'recovery-otp-verify':{email:ctx.batch.accounts.A.email,token:TEST_OTP},
  'reset-password':{newPassword:P2,confirmNewPassword:P2},logout:{},refresh:{}
}[step.action]);
async function until(ctx,last){for(const step of STEPS){ctx.executor.arm(step.id);const r=await request(ctx,step.action,payload(ctx,step));assert.equal(r.status,step.id==='a-old'?400:200,step.id+': '+JSON.stringify(r.body)+' '+JSON.stringify(ctx.executor.snapshot()));if(step.id===last)return;}}

test('default/production/isolated remain closed to local real target; controlled config requires all exact trusted bindings',()=>{
 const batch=batchFor({ids:{A:'synthetic-id'}}),env={...bindings(batch,TEST_KEY),USERS_CONTROLLED_EGRESS:{fetch(){}}};
 assert.equal(configuration(env).project,PROJECT);
 for(const patch of [{USERS_MODE:'disabled'},{USERS_MODE:'production'},{USERS_MODE:'isolated'},{USERS_CONTROLLED_EXECUTOR:undefined},{USERS_CONTROLLED_BATCH:undefined},{USERS_CONTROLLED_APPROVAL:undefined},{USERS_CONTROLLED_BUILD:undefined},{USERS_CONTROLLED_EGRESS:undefined},{USERS_CONTROLLED_EXPIRES_AT:'0'},
  {USERS_APP_ORIGIN:'https://localhost:8787'},{USERS_APP_ORIGIN:'https://127.0.0.1:8788'},{USERS_APP_ORIGIN:'http://127.0.0.1:8787'},{USERS_PROJECT_REF:'tkehttvppaqkybqehjbn'},{USERS_SUPABASE_URL:'https://wrong.supabase.co'}]) assert.throws(()=>configuration({...env,...patch}));
 assert.equal(configuration({...env,USERS_MODE:'production',USERS_APP_ORIGIN:'https://admin.example-cv.com'}).project,PROJECT);
 assert.equal(configuration({...env,USERS_MODE:'isolated',USERS_PROJECT_REF:'isolated-users',USERS_SUPABASE_URL:'https://users.auth.example.invalid'}).project,'isolated-users');
 assert.throws(()=>validateBatch({...batch,authorization:'NOT_GRANTED'},manifest),/live_approval_missing/);
 // Pure validation only: deliberately fictitious hashes, no executor or transport is created.
 const live={...batch,authorization:'APPROVED',executable:true,configurationLiveRead:'VERIFIED',registrationStatus:'USER_CONFIRMED_UNUSED',approvalReference:'offline-validation-only',accounts:{A:{email:'unapproved-recovery@example.invalid',userIdSha256:'656d2712217564e0900bb29b57942863750190364d7a76e6beaab20d42877f86'},R:{email:'approved-register@example.invalid',userIdSha256:null}}};
 assert.equal(approvalStateMatches(live),true);assert.throws(()=>validateBatch(live,manifest),/live_approval_missing/);
 for(const patch of [{executable:false},{authorization:'NOT_GRANTED'},{configurationLiveRead:'PENDING_LIVE_RECHECK'},{registrationStatus:'PENDING_CONFIRMATION'},{currentPasswordPolicy:'UNVERIFIED'}])assert.equal(approvalStateMatches({...live,...patch}),false);
});
test('actual real-target Worker branch runs signup/login/refresh/change/recovery through API and SQLite DO; no external network',async t=>{
 const ctx=await context();try{
  await until(ctx,'a-verify');
  const storage=await ctx.mf.unsafeGetDurableObjectStorage('example-cv-users','RecoveryState',{name:'account:v1:'+sha(PROJECT+'\0'+ctx.batch.accounts.A.email)});
  const rows=await storage.exec("SELECT value FROM state WHERE key LIKE 'grant:%'");assert.equal(rows.length,1);assert.ok(JSON.parse(rows[0].value).expires>Date.now()+590000);
  // Destroy/recreate workerd against the actual SQLite directory, not an in-memory stub.
  await ctx.mf.dispose();ctx.mf=runtime(ctx.options);assert.equal((await request(ctx,'recovery-session')).status,200);
  for(const step of STEPS.slice(STEPS.findIndex(s=>s.id==='a-reset'))){ctx.executor.arm(step.id);const result=await request(ctx,step.action,payload(ctx,step));assert.equal(result.status,step.id==='a-old'?400:200,step.id+JSON.stringify(result.body));}
  assert.equal(ctx.executor.snapshot().next,'complete');assert.equal(ctx.executor.snapshot().openSessions,0);
  assert.equal(ctx.executor.snapshot().counts.passwordUpdate,2);assert.equal(ctx.executor.snapshot().counts.refresh,2);
  assert.equal(ctx.auth.events.filter(e=>e.path==='/auth/v1/verify'&&e.otpType==='recovery').length,1);
  assert.equal(ctx.counts().escaped,0);t.diagnostic(JSON.stringify({actualConfigOrigin:ORIGIN,actualAuthTarget:AUTH,intercepted:ctx.counts().intercepted,externalRequests:ctx.counts().escaped,ledger:ctx.dir}));
 }finally{await ctx.close();}
});
test('wrong account/op/Origin and concurrent extra submission are refused before Auth; only one signup crosses transport',async t=>{
 const ctx=await context();try{
  ctx.executor.arm('r-register');
  for(const [action,data,extra] of [['register',{email:'wrong@example.invalid',password:TEST_PASSWORD}],['recovery-otp-send',{email:ctx.batch.accounts.A.email}],['register',payload(ctx,STEPS[0]),{headers:{Origin:'https://evil.invalid'}}]])assert.equal((await request(ctx,action,data,extra)).status,403);
  assert.equal(ctx.counts().intercepted,0);
  const results=await Promise.all([1,2,3].map(()=>request(ctx,'register',payload(ctx,STEPS[0]))));assert.deepEqual(results.map(x=>x.status).sort(),[200,403,403]);
  assert.equal(ctx.counts().intercepted,1);assert.equal((await request(ctx,'register',payload(ctx,STEPS[0]))).status,403);assert.equal(ctx.counts().intercepted,1);
  assert.throws(()=>ctx.executor.arm('a-change'),/stage_denied/);
  assert.throws(()=>createExecutor({batch:ctx.batch,manifest,dir:ctx.dir,key:TEST_KEY,offline:true,send:()=>{throw Error('should_not_send');}}),/EEXIST/);
  t.diagnostic('3 rejected scope requests -> 0 calls; 3 simultaneous signup clicks -> exactly 1 Auth call; spent batch cannot restart.');
 }finally{await ctx.close();}
});
test('UNKNOWN update consumes wire budget and SQLite grant; cleanup remains permitted, no duplicate update or automatic resend',async t=>{
 const ctx=await context();try{
  await until(ctx,'a-verify');ctx.auth.controls.update='lost';ctx.executor.arm('a-reset');const jar=new Map(ctx.jar);
  const results=await Promise.all([1,2].map(()=>request(ctx,'reset-password',payload(ctx,STEPS.find(s=>s.id==='a-reset')))));
  assert.deepEqual(results.map(r=>r.status).sort(),[403,503]);assert.ok(results.some(r=>r.body.code==='updateUnknown'));
  assert.equal(ctx.auth.events.filter(e=>e.method==='PUT').length,2); // One earlier ordinary change, one recovery attempt.
  assert.equal(ctx.executor.snapshot().counts.passwordUpdate,2);assert.equal(ctx.executor.snapshot().openSessions,0);
  ctx.jar=jar;assert.equal((await request(ctx,'reset-password',{newPassword:P2})).status,403);
  await ctx.mf.dispose();ctx.mf=runtime(ctx.options);
  const db=await ctx.mf.unsafeGetDurableObjectStorage('example-cv-users','RecoveryState',{name:'account:v1:'+sha(PROJECT+'\0'+ctx.batch.accounts.A.email)});
  const row=JSON.parse((await db.exec("SELECT value FROM state WHERE key LIKE 'grant:%'"))[0].value);assert.equal(row.status,'unknown');
  assert.equal(ctx.auth.events.filter(e=>e.method==='PUT').length,2);assert.equal(ctx.executor.snapshot().counts.recover,1);
  ctx.jar.clear();ctx.executor.permitUnknownCheck();assert.equal(ctx.executor.snapshot().next,'a-login2');
  for(const id of ['a-login2','a-logout3','a-old']){const step=STEPS.find(s=>s.id===id);ctx.executor.arm(id);assert.equal((await request(ctx,step.action,payload(ctx,step))).status,id==='a-old'?400:200);}
  assert.equal(ctx.executor.snapshot().next,'complete');t.diagnostic('Original update UNKNOWN preserved, current password check independently succeeds; no Chrome/second mutation extension.');
  assert.throws(()=>ctx.executor.permitUnknownCheck(),/unknown_branch_denied/);
 }finally{await ctx.close();}
});
test('transport timeout never refunds a reservation and has no automatic retry',async()=>{
 const ctx=await context({timeoutMs:50,send:()=>new Promise(()=>{})});try{
  ctx.executor.arm('r-register');assert.equal((await request(ctx,'register',payload(ctx,STEPS[0]))).status,503);
  assert.equal(ctx.executor.snapshot().counts.signup,1);assert.equal(ctx.counts().intercepted,1);
  assert.equal((await request(ctx,'register',payload(ctx,STEPS[0]))).status,403);assert.equal(ctx.counts().intercepted,1);
 }finally{await ctx.close();}
});
test('returned mixed identity cannot be issued to the browser; cleanup scope remains available',async()=>{
 const ctx=await context();try{
  await until(ctx,'r-logout');ctx.auth.controls.user='mixed';ctx.executor.arm('a-login0');const result=await request(ctx,'login',payload(ctx,STEPS.find(s=>s.id==='a-login0')));
  assert.equal(result.status,503);assert.equal(result.cookies,0);assert.equal(ctx.executor.snapshot().openSessions,0);
  assert.equal(ctx.executor.snapshot().halted,true);
 }finally{await ctx.close();}
});
test('SDK refresh network retries do not create a second upstream request; scoped cleanup is still permitted',async()=>{
 const ctx=await context();try{
  await until(ctx,'a-login0');ctx.auth.controls.refresh='network';ctx.executor.arm('a-refresh');
  const result=await request(ctx,'refresh',{});assert.equal(result.status,503);
  assert.equal(ctx.executor.snapshot().counts.refresh,1);
  assert.equal(ctx.auth.events.filter(e=>e.grant==='refresh_token').length,1);
  assert.equal(await ctx.executor.cleanup(),true);assert.equal(ctx.executor.snapshot().openSessions,0);
 }finally{await ctx.close();}
});
test('update timeout spends exactly one update slot; no retry and no quota refund',async()=>{
 let timeoutUpdate=false;
 const ctx=await context({timeoutMs:50,send:(r,auth)=>timeoutUpdate&&r.method==='PUT'?new Promise(()=>{}):auth.fetch(r)});try{
  await until(ctx,'a-refresh');timeoutUpdate=true;ctx.executor.arm('a-change');
  const step=STEPS.find(s=>s.id==='a-change');const response=await request(ctx,step.action,payload(ctx,step));
  assert.equal(response.body.code,'updateUnknown');assert.equal(ctx.executor.snapshot().counts.passwordUpdate,1);
  const before=ctx.counts().intercepted;assert.equal((await request(ctx,step.action,payload(ctx,step))).status,403);
  assert.equal(ctx.counts().intercepted,before);assert.equal(ctx.executor.snapshot().openSessions,0);
 }finally{await ctx.close();}
});
test('identity query budget exhaustion cannot consume the reserved local logout budget',async()=>{
 const ctx=await context();try{
  await until(ctx,'a-login0');
  while((ctx.executor.snapshot().accountCounts.A.getUser??0)<48)assert.equal((await request(ctx,'session')).status,200);
  const before=ctx.counts().intercepted;assert.equal((await request(ctx,'session')).status,503);assert.equal(ctx.counts().intercepted,before);
  assert.equal(await ctx.executor.cleanup(),true);assert.equal(ctx.counts().intercepted,before+1);
 }finally{await ctx.close();}
});
test('controlled service binding preserves the application 18-second update timeout and never accepts a late response as success',async()=>{
 const ctx=await context();try{
  await until(ctx,'a-refresh');ctx.auth.controls.update='timeout';ctx.executor.arm('a-change');
  const step=STEPS.find(s=>s.id==='a-change'),start=Date.now();const result=await request(ctx,step.action,payload(ctx,step));
  assert.equal(result.body.code,'updateUnknown');assert.ok(Date.now()-start<19000,'18-second app deadline must precede the delayed upstream receipt');
  assert.equal(ctx.executor.snapshot().counts.passwordUpdate,1);assert.equal(ctx.auth.events.filter(e=>e.method==='PUT').length,1);
  assert.equal((await request(ctx,step.action,payload(ctx,step))).status,403);
  await ctx.executor.cleanup();const events=readFileSync(resolve(ctx.dir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e=>e.kind==='late_http_receipt'&&e.category==='passwordUpdate'&&e.status===200&&e.appOutcomeUnchanged));
  assert.ok(events.some(e=>e.kind==='result'&&e.category==='passwordUpdate'&&e.outcome==='UNKNOWN'));
 }finally{await ctx.close();}
});

test('native network boundary diagnosis',async t=>{
 const {createServer}=await import('node:http');let hits=0,authRef;
 const server=createServer(async(q,r)=>{hits++;const chunks=[];for await(const c of q)chunks.push(c);const out=await authRef.fetch(new Request(AUTH+q.url,{method:q.method,headers:q.headers,body:Buffer.concat(chunks)}));r.writeHead(out.status,{'content-type':'application/json'});r.end(await out.text());});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const ctx=await context({send:async(r,auth)=>{authRef=auth;assert.equal(r.headers.get('content-length'),null);assert.equal(r.headers.get('host'),null);try{return await fetch(new Request('http://127.0.0.1:'+server.address().port+new URL(r.url).pathname,{method:r.method,headers:r.headers,body:await r.arrayBuffer(),signal:r.signal}),{redirect:'manual'});}catch(e){t.diagnostic(JSON.stringify(safeError(e)));throw e;}}});
 try{ctx.executor.arm('r-register');const result=await request(ctx,'register',payload(ctx,STEPS[0]));t.diagnostic(JSON.stringify({result,hits}));assert.equal(result.status,200);}finally{await ctx.close();await new Promise(ok=>server.close(ok));}
});


test('diagnostic phases distinguish construction, network, body and parse failures without secrets',async()=>{
 const variants=[
  ['network',()=>{throw new TypeError('PRIVATE_SENTINEL',{cause:Object.assign(new Error('PRIVATE_SENTINEL'),{code:'ECONNRESET'})});},'network_call',null],
  ['parse',()=>new Response('PRIVATE_SENTINEL',{status:200}),'response_parse',200],
  ['body',()=>new Response(new ReadableStream({start(c){c.error(new TypeError('PRIVATE_SENTINEL'));}}),{status:200}),'response_body',200],
 ];
 for(const [label,send,stage,status] of variants){const ctx=await context({send});try{
  ctx.executor.arm('r-register');assert.equal((await request(ctx,'register',payload(ctx,STEPS[0]))).status,503);
  assert.equal((await request(ctx,'register',payload(ctx,STEPS[0]))).status,403);assert.equal(ctx.counts().intercepted,1);assert.equal(ctx.executor.snapshot().counts.signup,1);
  assert.equal(await ctx.executor.cleanup(),true);
  const raw=readFileSync(resolve(ctx.dir,'events.jsonl'),'utf8');assert.ok(!raw.includes('PRIVATE_SENTINEL'));assert.ok(!raw.includes(TEST_PASSWORD));
  const event=raw.trim().split('\n').map(JSON.parse).find(e=>e.kind==='transport_failure');assert.equal(event.stage,stage,label);assert.equal(event.httpStatus,status);assert.equal(event.networkEntered,true);
 }finally{await ctx.close();}}
 const ctx=await context();try{await ctx.executor.outbound({get url(){throw new TypeError('PRIVATE_SENTINEL');}});assert.equal(ctx.counts().intercepted,0);assert.equal(ctx.executor.snapshot().total,0);const events=readFileSync(resolve(ctx.dir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.ok(events.some(e=>e.kind==='transport_failure'&&e.stage==='construct'&&!e.networkEntered));}finally{await ctx.close();}
 assert.deepEqual(safeError({name:'PRIVATE_SENTINEL',code:'PRIVATE_SENTINEL',cause:{name:'PRIVATE_SENTINEL',code:'PRIVATE_SENTINEL'}}),{errorName:'Other',errorCode:null,causeName:null,causeCode:null});
});

test('TLS adapter preserves only owned SDK flow cookies and rejects foreign names',()=>{
 for(const name of ['__Host-ecv-users-session-flow-'+ 'a'.repeat(32)+'-code-verifier','__Host-ecv-users-session-flows-code-verifier']){
 const r=new Response(null,{headers:{'set-cookie':name+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'}});assert.equal(outgoingHeaders(r)['set-cookie'].length,1);
 }
 for(const name of ['sb-old-cms-auth-token','__Host-ecv-users-session-flow-evil-code-verifier'])assert.throws(()=>outgoingHeaders(new Response(null,{headers:{'set-cookie':name+'=x'}})));
});
