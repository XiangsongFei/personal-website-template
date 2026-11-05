import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runtime} from './runtime.mjs';
import {realAuthority,TEST_PASSWORD,TEST_OTP,TEST_KEY} from './auth-fixture.mjs';
import {outgoingHeaders} from '../scripts/local-https-boundary.mjs';
import {EXECUTOR,ORIGIN,AUTH,PROJECT,LIMITS,SESSION_PROFILE,SESSION_LIMITS,SESSION_BROWSER_LIMITS,SESSION_UID_SHA256,sha,bindings,createExecutor,validateBatch,approvalStateMatches} from '../scripts/controlled-real.mjs';
const manifest={sourceSha256:'a'.repeat(64),artifactSha256:'b'.repeat(64),toolingSha256:'c'.repeat(64)};
const makeBatch=id=>({executor:EXECUTOR,id:'S2-USERS-REAL-SESSION-OFFLINE',profile:SESSION_PROFILE,browserOrder:['Chrome','Safari'],maxEmails:0,maxUpstreamTotal:36,identityRequestsPerBrowser:14,perBrowserLimits:{...SESSION_BROWSER_LIMITS},project:PROJECT,origin:ORIGIN,executionBuild:manifest.sourceSha256,artifactSha256:manifest.artifactSha256,toolingSha256:manifest.toolingSha256,maxUpstreamRequests:{...SESSION_LIMITS},expiresAt:Date.now()+20*60000,authorization:'OFFLINE_TRANSPORT_TEST',currentPasswordPolicy:'ON',accounts:{R:{email:'user-a@example.invalid',userIdSha256:sha(id)}}});
async function setup({fault,phase='refresh',algorithm='ES256'}={}){
 let syntheticNow=Date.now();const auth=await realAuthority({url:AUTH,algorithm,now:()=>syntheticNow}),batch=makeBatch(auth.ids.A),dir=mkdtempSync(resolve('.runtime/session-mini-'));let hits=0,escaped=0;
 const server=createServer(async(q,r)=>{try{hits++;const chunks=[];for await(const c of q)chunks.push(c);const targeted=q.url.includes('grant_type='+ (phase==='login'?'password':'refresh_token'));
 if(targeted&&fault==='timeout')return;
 if(targeted&&fault==='limited'){r.writeHead(429,{'content-type':'application/json'});r.end(JSON.stringify({code:'over_request_rate_limit'}));return;}
 const out=await auth.fetch(new Request(AUTH+q.url,{method:q.method,headers:q.headers,...(!['GET','HEAD'].includes(q.method)?{body:Buffer.concat(chunks)}:{})}));
 if(targeted&&fault==='lost'){q.socket.destroy();return;}
 r.writeHead(out.status,{'content-type':'application/json'});r.end(await out.text());}catch{q.socket.destroy();}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const port=server.address().port;
 const executor=createExecutor({batch,manifest,dir,key:TEST_KEY,offline:true,...(fault==='timeout'?{timeoutMs:50}:{}),send:async r=>{assert.equal(new URL(r.url).origin,AUTH);assert.equal(r.headers.get('content-length'),null);assert.equal(r.headers.get('host'),null);return fetch(new Request('http://127.0.0.1:'+port+new URL(r.url).pathname+new URL(r.url).search,{method:r.method,headers:r.headers,...(!['GET','HEAD'].includes(r.method)?{body:await r.arrayBuffer()}:{}),signal:r.signal}),{redirect:'manual'});}});
 const mf=runtime({bindings:bindings(batch,TEST_KEY),resourcePersistencePath:resolve(dir,'state'),serviceBindings:{USERS_CONTROLLED_EGRESS:r=>executor.outbound(r)},outboundService:()=>{escaped++;throw Error('forbidden');}}),jars={Chrome:new Map(),Safari:new Map()};
 async function request(path,data,browser='Chrome',override){const jar=jars[browser]??new Map();
 const req=new Request(ORIGIN+path,{method:data===undefined?'GET':'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Cookie:override??[...jar].map(([k,v])=>k+'='+v).join('; ')},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const res=await executor.dispatch(req,async r=>mf.dispatchFetch(r.url,{method:r.method,headers:r.headers,...(r.method==='POST'?{body:await r.arrayBuffer()}:{}),redirect:'manual'}),browser);
 const h=outgoingHeaders(res);for(const line of h['set-cookie']??[]){const p=line.split(';')[0],i=p.indexOf('=');if(/Max-Age=0(?:;|$)/.test(line))jar.delete(p.slice(0,i));else jar.set(p.slice(0,i),p.slice(i+1));}
 return {status:res.status,location:h.location,body:await res.text(),cookieWritten:!!h['set-cookie']?.length};
 }
 return {auth,batch,dir,executor,request,jars,hits:()=>hits,advance:()=>{syntheticNow+=2000;},close:async()=>{await executor.cleanup();await mf.dispose();executor.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));assert.equal(server.listening,false);assert.equal(escaped,0);}};
}
const login=c=>({email:c.batch.accounts.R.email,password:TEST_PASSWORD});
async function signIn(c,browser='Chrome'){c.executor.arm(browser.toLowerCase()+'-login');assert.equal((await c.request('/api/account/login',login(c),browser)).status,200);}
test('exact session profile binds UID, browser caps, zero mail and live project; draft and scope expansion denied without network',()=>{
 const b=makeBatch('synthetic-id');assert.equal(validateBatch(b,manifest,{offline:true}),b);
 for(const patch of [{maxUpstreamRequests:LIMITS},{maxEmails:1},{maxUpstreamTotal:44},{identityRequestsPerBrowser:15},{browserOrder:['Safari','Chrome']},{perBrowserLimits:{...SESSION_BROWSER_LIMITS,refresh:2}},{accounts:{R:{email:b.accounts.R.email,userIdSha256:null}}}])assert.throws(()=>validateBatch({...b,...patch},manifest,{offline:true}));
 const live={...b,authorization:'APPROVED',executable:true,configurationLiveRead:'VERIFIED',accountStatus:'EXISTING_CONFIRMED_UID_BOUND',approvalReference:'pure-offline-config-validation',accounts:{R:{email:'approved-register@example.invalid',userIdSha256:SESSION_UID_SHA256}}};assert.equal(approvalStateMatches(live),true);assert.throws(()=>validateBatch(live,manifest),/live_approval_missing/);assert.throws(()=>validateBatch({...live,executable:false},manifest));assert.throws(()=>validateBatch({...live,accounts:{R:{...live.accounts.R,userIdSha256:'0'.repeat(64)}}},manifest));
});
test('two independent browser jars: login, protected navigation, real application proactive refresh, new cookie, identity and scoped logout',async t=>{
 for(const algorithm of ['ES256','HS256']){const c=await setup({algorithm});try{
 const seenCookies=[];
 for(const browser of ['Chrome','Safari']){c.executor.arm(browser.toLowerCase()+'-login');const before=c.hits();
 for(const action of ['register','verify-email','resend-confirmation','recovery-otp-send','recovery-otp-verify','reset-password','change-password','recovery-logout'])assert.equal((await c.request('/api/account/'+action,{},browser)).status,403);
 assert.equal((await c.request('/api/account/login',login(c),browser==='Chrome'?'Safari':'Chrome')).status,403);
 assert.equal((await c.request('/api/account/login',{...login(c),email:'other@example.invalid'},browser)).status,403);assert.equal(c.hits(),before);
 const starts=await Promise.all([1,2,3].map(()=>c.request('/api/account/login',login(c),browser)));assert.deepEqual(starts.map(r=>r.status).sort(),[200,403,403]);
 for(const path of ['/account','/account','/change-password','/account'])assert.equal((await c.request(path,undefined,browser)).status,200);
 seenCookies.push([...c.jars[browser].values()].join(''));const oldCookie=seenCookies.at(-1);c.advance();c.executor.arm(browser.toLowerCase()+'-refresh');
 const renews=await Promise.all([1,2,3].map(()=>c.request('/api/account/refresh',{},browser)));assert.deepEqual(renews.map(r=>r.status).sort(),[200,403,403]);assert.ok(renews.find(r=>r.status===200).cookieWritten);assert.notEqual([...c.jars[browser].values()].join(''),oldCookie);
 assert.equal((await c.request('/account',undefined,browser)).status,200);
 c.executor.arm(browser.toLowerCase()+'-logout');assert.equal((await c.request('/api/account/logout',{},browser)).status,200);assert.equal(c.jars[browser].size,0);assert.equal((await c.request('/account',undefined,browser)).status,303);
 }
 assert.notEqual(seenCookies[0],seenCookies[1]);const snap=c.executor.snapshot();assert.equal(snap.next,'complete');assert.equal(snap.counts.passwordLogin,2);assert.equal(snap.counts.refresh,2);assert.equal(snap.counts.localLogout,2);assert.equal(snap.openSessions,0);assert.ok(snap.counts.getUser<=28);assert.ok(snap.counts.jwks<=14);
 const ev=readFileSync(resolve(c.dir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);for(const browser of ['Chrome','Safari']){assert.ok(ev.some(e=>e.kind==='session_generation'&&e.browser===browser&&e.generation===1&&e.refreshChanged));assert.ok(ev.some(e=>e.kind==='identity_checked'&&e.browser===browser&&e.generation===1&&e.stage==='protected_read'));assert.equal(snap.browserCounts[browser].passwordLogin,1);assert.equal(snap.browserCounts[browser].refresh,1);}
 t.diagnostic(JSON.stringify({algorithm,counts:snap.counts,receiverHits:c.hits(),evidence:c.dir}));
 }finally{await c.close();}}
});
test('login and refresh 429, response loss and timeout never refund or retry; known-session cleanup remains possible',async()=>{
 for(const phase of ['login','refresh'])for(const fault of ['limited','lost','timeout']){const c=await setup({phase,fault});try{
 if(phase==='refresh'){await signIn(c);c.executor.arm('chrome-refresh');}else c.executor.arm('chrome-login');
 const path='/api/account/'+phase;const res=await c.request(path,phase==='login'?login(c):{});assert.ok(res.status>=400);const before=c.hits();assert.equal((await c.request(path,phase==='login'?login(c):{})).status,403);assert.equal(c.hits(),before);assert.throws(()=>c.executor.arm('safari-login'));assert.equal(c.executor.snapshot().counts[phase==='login'?'passwordLogin':'refresh'],1);
 const closed=await c.executor.cleanup();assert.equal(closed,true);assert.equal(c.executor.snapshot().counts.localLogout,phase==='refresh'?1:0);
 }finally{await c.close();}}
});
test('copied browser cookie and stale pre-refresh cookie are denied before identity upstream; independent cleanup retained',async()=>{
 for(const mode of ['cross-browser','stale']){const c=await setup();try{await signIn(c);const cookie=[...c.jars.Chrome].map(([k,v])=>k+'='+v).join('; ');
 if(mode==='stale'){c.advance();c.executor.arm('chrome-refresh');assert.equal((await c.request('/api/account/refresh',{})).status,200);}
 const before=c.hits();assert.equal((await c.request('/account',undefined,mode==='stale'?'Chrome':'Safari',cookie)).status,503);assert.equal(c.hits(),before);assert.equal(await c.executor.cleanup(),true);
 }finally{await c.close();}}
});

test('combined identity budget cannot consume independent per-browser cleanup; no third logout reaches upstream',async()=>{
 const c=await setup();try{await signIn(c);while(c.executor.snapshot().browserCounts.Chrome.getUser+c.executor.snapshot().browserCounts.Chrome.jwks<14)assert.equal((await c.request('/api/account/session')).status,200);const hits=c.hits();assert.equal((await c.request('/api/account/session')).status,503);assert.equal(c.hits(),hits);c.auth.controls.logout='unknown';assert.equal(await c.executor.cleanup(),false);assert.equal(await c.executor.cleanup(),false);assert.equal(await c.executor.cleanup(),false);assert.equal(c.executor.snapshot().browserCounts.Chrome.localLogout,2);assert.equal(c.hits(),hits+2);
 }finally{await c.close();}
});
