import {MANUAL_POLICY,MANUAL_SOURCE,isManualBatchId} from './manual-dashboard-evidence.mjs';
import {APPROVAL_POLICY,claimApproval,checkRunContext,inspectApproval,usesReceipt} from './approval-receipt.mjs';
import {safeError,transportHeaders} from './transport-diagnostics.mjs';
// Local acceptance transport, not application authentication or recovery storage.
// Adapts the probe ledger's reserve-before-dispatch / exclusive-file / fsync pattern.
// No probe handlers, fixed campaign ledger, credentials or recovery Maps are reused.
import {openSync, closeSync, writeSync, fsyncSync, mkdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
export const EXECUTOR = 's2-users-real-v1';
export const ORIGIN = 'https://127.0.0.1:8787';
export const PROJECT = 'makwjnbubmrmopjhzror';
export const AUTH = `https://${PROJECT}.supabase.co`;
export const sha = value => createHash('sha256').update(value).digest('hex');
export const LIMITS = Object.freeze({signup:1,verifySignup:1,recover:1,verifyRecovery:1,passwordLogin:5,refresh:4,passwordUpdate:2,localLogout:9,getUser:54,jwks:6});
const ACCOUNT_LIMITS={A:{signup:0,verifySignup:0,recover:1,verifyRecovery:1,passwordLogin:5,refresh:4,passwordUpdate:2,localLogout:8,getUser:48},R:{signup:1,verifySignup:1,recover:0,verifyRecovery:0,passwordLogin:0,refresh:0,passwordUpdate:0,localLogout:1,getUser:6}};
// Every step requires an operator arm command; arm never sends a request.
export const STEPS = Object.freeze([
  ['r-register','register','R','signup'], ['r-verify','verify-email','R','verifySignup'], ['r-logout','logout','R','localLogout'],
  ['a-login0','login','A','passwordLogin'], ['a-refresh','refresh','A','refresh'], ['a-change','change-password','A','passwordUpdate'],
  ['a-logout1','logout','A','localLogout'], ['a-login1','login','A','passwordLogin'], ['a-logout2','logout','A','localLogout'],
  ['a-recover','recovery-otp-send','A','recover'], ['a-verify','recovery-otp-verify','A','verifyRecovery'], ['a-reset','reset-password','A','passwordUpdate'],
  ['a-login2','login','A','passwordLogin'], ['a-logout3','logout','A','localLogout'], ['a-old','login','A','passwordLogin'],
  ['chrome-login2','login','A','passwordLogin'], ['chrome-refresh','refresh','A','refresh'], ['chrome-logout','logout','A','localLogout'],
].map(([id,action,account,wire])=>Object.freeze({id,action,account,wire,browser:id.startsWith('chrome-')?'Chrome':'Safari'})));
export const REGISTRATION_PROFILE = 'registration-only-v1';
export const REGISTRATION_LIMITS = Object.freeze({signup:1,verifySignup:1,recover:0,verifyRecovery:0,passwordLogin:0,refresh:0,passwordUpdate:0,localLogout:2,getUser:4,jwks:2});
const REGISTRATION_STEPS = Object.freeze(STEPS.slice(0,3).map(s=>Object.freeze({...s,browser:'Chrome'})));
export const SESSION_PROFILE = 'login-refresh-only-v1';
export const SESSION_UID_SHA256 = '50052ae538f08dae6c0b5de4809009a8ec80b73c863c4b281a651964728202eb';
export const SESSION_BROWSER_LIMITS = Object.freeze({signup:0,verifySignup:0,recover:0,verifyRecovery:0,passwordLogin:1,refresh:1,passwordUpdate:0,localLogout:2,getUser:14,jwks:7});
export const SESSION_LIMITS = Object.freeze(Object.fromEntries(Object.entries(SESSION_BROWSER_LIMITS).map(([k,v])=>[k,v*2])));
const SESSION_STEPS = Object.freeze(['Chrome','Safari'].flatMap(browser=>[
  ['login','passwordLogin'],['refresh','refresh'],['logout','localLogout']
].map(([action,wire])=>Object.freeze({id:browser.toLowerCase()+'-'+action,action,wire,account:'R',browser}))));
export const CHANGE_PROFILE='change-password-only-v1', RECOVERY_PROFILE='recovery-only-v1';
export const MUTATION_PROFILES=Object.freeze({
  [CHANGE_PROFILE]:{emailSha256:'f61f9bed658d5c061d707d925740000ba4410ca3ab2804929f37b2c24b64db3f',uid:SESSION_UID_SHA256,identityCap:16,total:23,emails:1,
    limits:{signup:0,verifySignup:0,recover:0,verifyRecovery:0,passwordLogin:2,refresh:0,passwordUpdate:1,localLogout:4,getUser:16,jwks:8},
    ids:['a-login0','a-change','a-logout1','a-login1','a-logout2'],
    posts:['login','change-password','logout'],gets:['/','/login','/account','/change-password','/api/account/session','/favicon.ico']},
  [RECOVERY_PROFILE]:{emailSha256:'0f1d69486c4375c6c60f0dbebc32c4e2173f7b48a425ccef63784e20172c28af',uid:'656d2712217564e0900bb29b57942863750190364d7a76e6beaab20d42877f86',identityCap:10,total:18,emails:2,
    limits:{signup:0,verifySignup:0,recover:1,verifyRecovery:1,passwordLogin:1,refresh:0,passwordUpdate:1,localLogout:4,getUser:10,jwks:5},
    ids:['a-recover','a-verify','a-reset','a-login2','a-logout3'],
    posts:['recovery-otp-send','recovery-otp-verify','reset-password','recovery-logout','login','logout'],gets:['/','/login','/account','/forgot-password','/reset-password','/api/account/recovery-progress','/api/account/recovery-session','/favicon.ico']},
});
function executionPolicy(batch) {
  if(MUTATION_PROFILES[batch.profile]){const m=MUTATION_PROFILES[batch.profile];return {limits:m.limits,steps:m.ids.map(id=>({...STEPS.find(s=>s.id===id),browser:'Chrome'})),accounts:{A:m.limits},logoutPosts:4,mutation:m};}
  if(batch.profile===SESSION_PROFILE)return {limits:SESSION_LIMITS,steps:SESSION_STEPS,accounts:{R:SESSION_LIMITS},logoutPosts:4,sessionOnly:true};
  if(batch.profile===REGISTRATION_PROFILE)return {limits:REGISTRATION_LIMITS,steps:REGISTRATION_STEPS,accounts:{R:REGISTRATION_LIMITS},logoutPosts:2,mini:true};
  if(batch.profile!==undefined)throw Error('unknown_profile');
  return {limits:LIMITS,steps:STEPS,accounts:ACCOUNT_LIMITS,logoutPosts:8,mini:false};
}
export const POST_PATHS = new Set([...STEPS.map(s=>'/api/account/'+s.action),'/api/account/recovery-logout']);
const denied = () => Response.json({ok:false},{status:403,headers:{'Cache-Control':'private, no-store'}});
const email = s => typeof s === 'string' ? s.trim().toLowerCase() : '';
const jwt = token => {try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}catch{return null;}};
const countTotal = counts => Object.values(counts).reduce((a,b)=>a+b,0);
// Historical-format inspection only; never grants a live executor capability.
export function approvalStateMatches(batch, policy=executionPolicy(batch)) { return !(batch.authorization!=='APPROVED' || batch.executable!==true || batch.configurationLiveRead!=='VERIFIED' || (policy.mutation?batch.accountStatus!=='EXISTING_CONFIRMED_UID_BOUND':policy.sessionOnly?batch.accountStatus!=='EXISTING_CONFIRMED_UID_BOUND':batch.registrationStatus!=='USER_CONFIRMED_UNUSED')
    || batch.currentPasswordPolicy!=='ON' || !batch.approvalReference); }
export function validateBatch(batch, manifest, {offline=false, now=Date.now(),approvalContext,prepared=false}={}) {
  const receiptMode=offline?false:usesReceipt(batch);
  const policy=executionPolicy(batch);
  if(policy.mutation&&(Object.keys(batch.accounts??{}).join(',')!=='A'||!batch.accounts.A.userIdSha256||batch.primaryBrowser!=='Chrome'||batch.maxEmails!==policy.mutation.emails||batch.maxUpstreamTotal!==policy.mutation.total||batch.identityRequests!==policy.mutation.identityCap))throw Error('mutation_scope_denied');
  if(policy.sessionOnly && (Object.keys(batch.accounts??{}).join(',')!=='R'||!batch.accounts.R.userIdSha256||JSON.stringify(batch.browserOrder)!==JSON.stringify(['Chrome','Safari'])||batch.maxEmails!==0||batch.maxUpstreamTotal!==36||batch.identityRequestsPerBrowser!==14||JSON.stringify(batch.perBrowserLimits)!==JSON.stringify(SESSION_BROWSER_LIMITS)))throw Error('session_scope_denied');
  if(policy.mini && (Object.keys(batch.accounts??{}).join(',')!=='R'||batch.accounts.R.userIdSha256!==null||batch.primaryBrowser!=='Chrome'||batch.maxRegistrationEmails!==1))throw Error('registration_scope_denied');
  if(batch.executor!==EXECUTOR || batch.project!==PROJECT || batch.origin!==ORIGIN
    || !/^S2-USERS-REAL-[A-Za-z0-9-]{8,80}$/.test(batch.id??'')
    || batch.executionBuild!==manifest.sourceSha256 || !/^[a-f0-9]{64}$/.test(batch.executionBuild??'')
    || batch.artifactSha256!==manifest.artifactSha256 || batch.toolingSha256!==manifest.toolingSha256
    || JSON.stringify(batch.maxUpstreamRequests)!==JSON.stringify(policy.limits)
    || !Number.isSafeInteger(batch.expiresAt) || batch.expiresAt<=now || batch.expiresAt>now+(receiptMode?12*60:40)*60000)
    throw Error('batch_binding_denied');
  if(offline) {
    if(batch.authorization!=='OFFLINE_TRANSPORT_TEST' || !Object.values(batch.accounts).every(a=>a.email.endsWith('@example.invalid')))throw Error('offline_batch_denied');
  } else if(!(prepared || checkRunContext(approvalContext,batch,now))
    || policy.mutation&&(sha(batch.accounts.A.email??'')!==policy.mutation.emailSha256||batch.accounts.A.userIdSha256!==policy.mutation.uid)
    || policy.sessionOnly&&batch.accounts.R.userIdSha256!==SESSION_UID_SHA256
    || !policy.mutation&&sha(batch.accounts?.R?.email??'')!=='f61f9bed658d5c061d707d925740000ba4410ca3ab2804929f37b2c24b64db3f'
    || !policy.mutation&&!policy.mini&&!policy.sessionOnly&&(sha(batch.accounts?.A?.email??'')!=='0f1d69486c4375c6c60f0dbebc32c4e2173f7b48a425ccef63784e20172c28af'||batch.accounts.A.userIdSha256!=='656d2712217564e0900bb29b57942863750190364d7a76e6beaab20d42877f86')) throw Error('live_approval_missing');
  for(const a of Object.values(batch.accounts)) if(!a.email || a.userIdSha256!==null&&!/^[a-f0-9]{64}$/.test(a.userIdSha256))throw Error('account_binding_denied');
  if(receiptMode && (batch.authorization!=='PREPARED_NOT_APPROVED'||batch.executable!==false||batch.configurationLiveRead!==(batch.approvalPolicy===MANUAL_POLICY?MANUAL_SOURCE:'LIVE_READ')||(!policy.sessionOnly&&batch.profile!==RECOVERY_PROFILE)))throw Error('receipt_candidate_denied');
  if(batch.approvalPolicy===MANUAL_POLICY&&(!isManualBatchId(batch.id)||batch.profile!==RECOVERY_PROFILE))throw Error('manual_batch_scope_denied');
  return batch;
}
export function bindings(batch, key) {
  return {USERS_MODE:'controlled-real',USERS_PROJECT_REF:PROJECT,USERS_SUPABASE_URL:AUTH,USERS_APP_ORIGIN:ORIGIN,
    USERS_PUBLISHABLE_KEY:key,USERS_CURRENT_PASSWORD_POLICY:batch.currentPasswordPolicy,
    USERS_CONTROLLED_EXECUTOR:EXECUTOR,USERS_CONTROLLED_BATCH:batch.id,USERS_CONTROLLED_BUILD:batch.executionBuild,
    USERS_CONTROLLED_APPROVAL:sha(JSON.stringify(batch)),USERS_CONTROLLED_EXPIRES_AT:String(batch.expiresAt)};
}
export function checkManifest(root, manifest) {
  for(const list of [manifest.source,manifest.artifacts,manifest.tooling]) {
    if(!Array.isArray(list))throw Error('manifest_invalid');
    for(const file of list) if(sha(readFileSync(resolve(root,file.path)))!==file.sha256)throw Error('build_or_tool_mismatch');
  }
  for(const [files,hash] of [[manifest.source,manifest.sourceSha256],[manifest.artifacts,manifest.artifactSha256],[manifest.tooling,manifest.toolingSha256]])
    if(sha(JSON.stringify(files))!==hash)throw Error('manifest_hash_invalid');
}
// The HTTPS caller claims once and passes an opaque process-local run capability.
// Direct executor callers use the same coordinator; neither entry can replay a receipt.
export function inspectRunApproval({batch,manifest,...input}) {
  checkManifest(resolve('.'),manifest);
  validateBatch(batch,manifest,{prepared:true});
  return inspectApproval({batch,...input});
}
export function authorizeRun(input) {
  inspectRunApproval(input);
  return claimApproval(input,resolve('.runtime/approval-leases'));
}
export function createExecutor({batch,manifest,dir,key,send,offline=false,timeoutMs=19500,approvalContext,approvalInput}) {
  if(!offline&&usesReceipt(batch)){
    approvalContext??=authorizeRun({batch,manifest,...approvalInput});
    checkRunContext(approvalContext,batch,Date.now(),true);
  }
  validateBatch(batch,manifest,{offline,approvalContext});
  const executionExpiresAt=approvalContext?.expiresAt??batch.expiresAt;
  const policy=executionPolicy(batch), limits=policy.limits, steps=policy.steps;
  if(typeof send!=='function')throw Error('explicit_transport_required');
  // Never resume a spent batch. A crash leaves its exclusive lease and reservations intact.
  mkdirSync(dir,{recursive:true,mode:0o700});
  const lease=openSync(resolve(dir,'batch.lease'),'wx',0o600); writeSync(lease,JSON.stringify({pid:process.pid,batch:batch.id}));fsyncSync(lease);closeSync(lease);
  const fd=openSync(resolve(dir,'events.jsonl'),'wx',0o600);
  const directory=openSync(dir,'r');try{fsyncSync(directory);}finally{closeSync(directory);}
  let closed=false,halted=false,busy=false,cleaning=false,cleanupPromise=null,unconfirmedAtClose=0,armed=null,next=steps[0].id,unknownStep=null,unknownCheckUsed=false,active=null,queue=Promise.resolve(),sequence=0,logoutPosts=0;
  const counts=Object.fromEntries(Object.keys(limits).map(k=>[k,0])), sessions=new Map(), accesses=new Map(), refreshes=new Map();
  const accounts=structuredClone(batch.accounts), logoutRequests=new Map(), pending=new Set(),stepsUsed=new Set(),accountCounts={A:{},R:{}}, browserCounts=Object.fromEntries(['Chrome','Safari'].map(b=>[b,Object.fromEntries(Object.keys(limits).map(k=>[k,0]))]));
  function emit(kind,data={}) {if(closed)throw Error('executor_closed');const bytes=Buffer.from(JSON.stringify({seq:++sequence,at:new Date().toISOString(),kind,...data})+'\n');let offset=0;while(offset<bytes.length){const written=writeSync(fd,bytes,offset,bytes.length-offset);if(written<=0)throw Error('ledger_write_failed');offset+=written;}fsyncSync(fd);}
  emit('begin',{runId:approvalContext?.runId??null,executionExpiresAt,batch:batch.id,mode:offline?'intercepted-offline':'approved-live',build:batch.executionBuild,approvalSha256:sha(JSON.stringify(batch))});
  function reserve(category,step,account,browser) {
    if(policy.mutation&&(countTotal(counts)>=policy.mutation.total||['getUser','jwks'].includes(category)&&counts.getUser+counts.jwks>=policy.mutation.identityCap))throw Error('combined_budget_exhausted');
    if(policy.sessionOnly&&(countTotal(counts)>=36||['getUser','jwks'].includes(category)&&(browserCounts[browser]?.getUser??0)+(browserCounts[browser]?.jwks??0)>=14))throw Error('combined_budget_exhausted');
    if(policy.sessionOnly&&(!browserCounts[browser]||browserCounts[browser][category]>=SESSION_BROWSER_LIMITS[category]))throw Error('browser_budget_exhausted');
    if(!Object.hasOwn(limits,category)||counts[category]>=limits[category])throw Error('budget_exhausted');
    if(category!=='jwks'&&(!account||!policy.accounts[account]||(accountCounts[account][category]??0)>=policy.accounts[account]?.[category]))throw Error('account_budget_exhausted');
    // Synchronous disk publication occurs before any await/send. No refund exists.
    const id=sequence+1;emit('reserve',{id,category,account:account??null,step:step??null,...(policy.sessionOnly?{browser}:{})});counts[category]++;if(policy.sessionOnly)browserCounts[browser][category]++;if(account)accountCounts[account][category]=(accountCounts[account][category]??0)+1;return id;
  }
  const hasSession = () => [...sessions.values()].some(s=>!s.closed);
  function arm(id) {
    if(closed||busy||pending.size||armed||halted||stepsUsed.has(id)||Date.now()>=executionExpiresAt||id!==next)throw Error('stage_denied');
    const step=steps.find(s=>s.id===id);if(!step)throw Error('stage_denied');
    if(['login','register','recovery-otp-send'].includes(step.action)&&hasSession())throw Error('prior_session_not_closed');
    armed=step;emit('armed',{step:id});
  }
  function captureSession(data,account,recovery=false) {
    const u=data.user, c=jwt(data.access_token);
    // If Auth created a session but identity fails, retain it for scoped cleanup only.
    const orphan={account,browser:active?.browser,recovery,closed:false,cleanupOnly:true,access:data.access_token,sessionId:'orphan:'+sha(data.access_token??'')};
    if(typeof data.access_token==='string'){sessions.set(orphan.sessionId,orphan);accesses.set(sha(data.access_token),orphan);}
    const identityHash=u?.id&&sha(u.id.trim().toLowerCase());
    if(!u?.email||email(u.email)!==accounts[account].email||identityHash!==accounts[account].userIdSha256
      ||!c||c.iss!==AUTH+'/auth/v1'||c.aud!=='authenticated'||c.sub!==u.id||typeof c.session_id!=='string'
      ||!Number.isFinite(c.exp)||c.exp*1000<=Date.now()||typeof data.refresh_token!=='string')throw Error('identity_mismatch');
    const previous=sessions.get(c.session_id);
    const browser=active?.browser;
    if(policy.sessionOnly&&(!browserCounts[browser]||previous&&previous.browser!==browser||active?.step?.wire==='passwordLogin'&&previous))throw Error('session_browser_mismatch');
    const generation=previous?(previous.generation??0)+1:0;
    const accessChanged=previous?previous.access!==data.access_token:null;
    const refreshChanged=previous?previous.refreshDigest!==sha(data.refresh_token):null;
    sessions.delete(orphan.sessionId);
    const record=Object.assign(previous??{},{account,recovery:previous?.recovery??recovery,closed:false,access:data.access_token,sessionId:c.session_id,...(policy.sessionOnly?{browser,generation,refreshDigest:sha(data.refresh_token)}:{})});
    sessions.set(c.session_id,record);accesses.set(sha(data.access_token),record);refreshes.set(sha(data.refresh_token),record);
    if(policy.sessionOnly)emit('session_generation',{browser,generation,accessChanged,refreshChanged,identityMatched:true});
    return record;
  }
  function outbound(input) {
    const p=wire(input);pending.add(p);p.finally(()=>pending.delete(p));return p;
  }
  async function wire(input) {
    const context=active;
    let request,category,record,id,step=context?.step;
    const started=Date.now();let stage='construct',networkEntered=false,httpStatus=null,timeoutFired=false;
    const mark=(value)=>{stage=value;emit('transport_stage',{batch:batch.id,id:id??null,category:category??null,step:step?.id??null,stage,elapsedMs:Date.now()-started,networkEntered,httpStatus});};
    try {
      if(closed)throw Error('closed');
      request=new Request(input.url,{method:input.method,headers:transportHeaders(input.headers),...(!['GET','HEAD'].includes(input.method)?{body:await input.arrayBuffer()}:{}),redirect:'manual'});
      const url=new URL(request.url), route=request.method+' '+url.pathname+url.search;
      if(url.origin!==AUTH||request.headers.get('apikey')!==key||request.headers.has('cookie')||!context||context.finished)throw Error('egress_denied');
      const body=['POST','PUT'].includes(request.method)?await request.clone().json().catch(()=>({})):{};
      const bearer=(request.headers.get('authorization')??'').replace(/^Bearer /,'');
      record=accesses.get(sha(bearer));
      if(route==='POST /auth/v1/token?grant_type=refresh_token')record=refreshes.get(sha(body.refresh_token??''));
      const routes={'POST /auth/v1/signup':'signup','POST /auth/v1/recover':'recover','POST /auth/v1/token?grant_type=password':'passwordLogin',
        'POST /auth/v1/token?grant_type=refresh_token':'refresh','POST /auth/v1/logout?scope=local':'localLogout','GET /auth/v1/user':'getUser',
        'PUT /auth/v1/user':'passwordUpdate','GET /auth/v1/.well-known/jwks.json':'jwks'};
      category=route==='POST /auth/v1/verify'?body.type==='signup'?'verifySignup':body.type==='recovery'?'verifyRecovery':null:routes[route];
      if(!category)throw Error('operation_denied');
      const cleanup=category==='localLogout';
      if(!cleanup&&(halted||Date.now()>=executionExpiresAt))throw Error('business_stopped');
      if(['signup','verifySignup','recover','verifyRecovery','passwordLogin'].includes(category)) {
        if(!step||category!==step.wire||context.primary||email(body.email)!==accounts[step.account].email)throw Error('primary_scope_denied');
      } else if(category==='jwks') {
        if(!hasSession())throw Error('jwks_without_batch_session');
      } else {
        if(policy.sessionOnly&&record&&(!cleanup||context.browser)&&record.browser!==context.browser)throw Error('session_browser_mismatch');
        if(policy.sessionOnly&&record&&!cleanup&&category!=='refresh'&&record.access!==bearer)throw Error('stale_access');
        if(!record||record.closed||record.cleanupOnly&&!cleanup)throw Error('unowned_session');
        if(step&&record.account!==step.account)throw Error('account_scope_denied');
        if(category==='passwordUpdate'&&(!step||step.wire!==category||context.primary||record.account!=='A'
          ||(step.action==='reset-password')!==record.recovery
          ||(step.action==='change-password'?(typeof body.current_password!=='string'):(body.current_password!==undefined))
          ||Object.keys(body).some(k=>!['password','current_password','code_challenge','code_challenge_method'].includes(k))
          ||body.code_challenge!=null||body.code_challenge_method!=null))throw Error('update_scope_denied');
        if(policy.mutation&&category==='refresh')throw Error('refresh_not_approved');
        if(category==='refresh') {
          if(policy.sessionOnly&&(!step||step.wire!=='refresh'||record.generation!==0))throw Error('refresh_stage_denied');
          if(context.refreshed)throw Error('duplicate_refresh');
          // No refresh-token reuse, including SDK retry after a lost response.
          if(!refreshes.delete(sha(body.refresh_token)))throw Error('spent_refresh');
          context.refreshed=true;
        }
        if(cleanup&&logoutRequests.has(record.sessionId))throw Error('logout_already_attempted');
      }
      const primary=step?.wire===category&&category!=='getUser'&&category!=='jwks';
      if(primary&&context.primary)throw Error('duplicate_primary');
      id=reserve(category,step?.id,record?.account??step?.account,record?.browser??context.browser);mark('reserved');
      if(category==='localLogout'){
        logoutRequests.set(record.sessionId,{id,outcome:'IN_FLIGHT',status:null});
        emit('logout_state',{id,account:record.account,recovery:record.recovery,outcome:'IN_FLIGHT',status:null});
      }
      if(primary)context.primary={id,category,outcome:'UNKNOWN',status:null};
      const controller=new AbortController();let timer;
      const {response,text}=await Promise.race([
        (async()=>{mark('network_request_construct');const outgoing=new Request(request,{signal:controller.signal});networkEntered=true;mark('network_call');const response=await send(outgoing);httpStatus=response.status;mark(context.finished?'late_response_headers':'response_headers');
          mark('response_body');let size=0,text='';const reader=response.body?.getReader(),decoder=new TextDecoder();
          if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144)throw Error('response_too_large');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
          return {response,text};})(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{timeoutFired=true;controller.abort();reject(Error('upstream_timeout'));},timeoutMs);})
      ]).finally(()=>clearTimeout(timer));
      if(response.status>=300&&response.status<400)throw Error('upstream_redirect');
      mark('response_parse');const data=response.status===204?{}:JSON.parse(text);mark('response_validate');
      if(response.ok) {
        if(category==='signup') {
          const u=data.user??data;
          if(data.access_token)captureSession(data,'R');
          if(email(u.email)!==accounts.R.email||!u.id||!Array.isArray(u.identities)||u.identities.length===0||data.access_token)throw Error('registration_identity_unconfirmed');
          accounts.R.userIdSha256=sha(u.id.trim().toLowerCase());emit('registered_binding',{account:'R',userIdSha256:accounts.R.userIdSha256});
        }
        if(['passwordLogin','verifySignup','verifyRecovery','refresh'].includes(category)) {
          const expected=record?.account??step.account;
          captureSession(data,expected,category==='verifyRecovery');
          emit('identity_bound',{account:expected,category,matched:true});
        }
        if(['getUser','passwordUpdate'].includes(category)) {
          const u=data.user??data;
          if(email(u.email)!==accounts[record.account].email||sha((u.id??'').trim().toLowerCase())!==accounts[record.account].userIdSha256)throw Error('identity_mismatch');
          emit('identity_checked',{account:record.account,category,matched:true,...(policy.sessionOnly?{browser:record.browser,generation:record.generation,stage:step?.id??'protected_read'}:{})});
        }
      }
      // A late transport receipt cannot turn an already-completed UNKNOWN app request into success.
      if(context.finished){emit('late_http_receipt',{id,category,status:response.status,appOutcomeUnchanged:true});throw Error('late_receipt_after_dispatch');}
      if(category==='localLogout'){
        Object.assign(logoutRequests.get(record.sessionId),{outcome:'HTTP',status:response.status});
        emit('logout_state',{id,account:record.account,recovery:record.recovery,outcome:'HTTP',status:response.status});
        if(response.ok){record.closed=true;emit('session_closed',{account:record.account,recovery:record.recovery});}
      }
      const errorCode=!response.ok&&data.code==='invalid_credentials'?'invalid_credentials':null;
      emit('result',{id,category,outcome:'HTTP',status:response.status,errorCode});
      if(primary)Object.assign(context.primary,{outcome:'HTTP',status:response.status,errorCode});
      if(!response.ok&&!(step?.id==='a-old'&&errorCode==='invalid_credentials'&&response.status===400))halted=true;
      if(step?.id==='a-old'&&response.ok)halted=true;
      return new Response(response.status===204?null:text,{status:response.status,headers:{'Content-Type':'application/json','X-Supabase-Api-Version':'2024-01-01'}});
    } catch(error) {
      if(category==='localLogout'&&id!==undefined){
        Object.assign(logoutRequests.get(record.sessionId),{outcome:'UNKNOWN',status:null});
        emit('logout_state',{id,account:record.account,recovery:record.recovery,outcome:'UNKNOWN',status:null});
      }
      emit('transport_failure',{batch:batch.id,id:id??null,category:category??null,stage,elapsedMs:Date.now()-started,networkEntered,httpStatus,cancelReason:timeoutFired?'executor_deadline':null,...safeError(error)});
      halted=true;
      if(id!==undefined) {halted=true;emit('result',{id,category,outcome:'UNKNOWN',status:null});}
      else emit('rejected_before_upstream',{category:category??null,step:step?.id??null});
      return Response.json({code:'controlled_request_denied',message:'Request unavailable'},{status:503});
    }
  }
  async function dispatch(request,worker,browser='local-check') {
    const url=new URL(request.url);let step,cleanup=false;
    try {
      if(closed||cleaning||url.origin!==ORIGIN||!['GET','HEAD','POST'].includes(request.method))throw Error('request_denied');
      if(policy.mutation){const m=policy.mutation;if(browser!=='Chrome'||(request.method==='POST'?!m.posts.some(a=>url.pathname==='/api/account/'+a):!m.gets.includes(url.pathname)&&!url.pathname.startsWith('/_next/static/')))throw Error('mutation_path_denied');}
      if(policy.sessionOnly) {
        const posts=['/api/account/login','/api/account/refresh','/api/account/logout'];
        const gets=['/','/login','/account','/change-password','/api/account/session','/favicon.ico'];
        if(!browserCounts[browser]||(request.method==='POST'?!posts.includes(url.pathname):!gets.includes(url.pathname)&&!url.pathname.startsWith('/_next/static/')))throw Error('session_path_denied');
      }
      if(policy.mini) {
        const allowedPost=['/api/account/register','/api/account/verify-email','/api/account/logout'];
        const allowedGet=['/','/login','/register','/verify-email','/account','/api/account/session','/favicon.ico'];
        if(browser!=='Chrome'||(request.method==='POST'?!allowedPost.includes(url.pathname):!allowedGet.includes(url.pathname)&&!url.pathname.startsWith('/_next/static/')))throw Error('registration_path_denied');
      }
      if(request.method==='POST') {
        if(request.headers.get('origin')!==ORIGIN||request.headers.get('content-type')?.split(';')[0]!=='application/json'||request.headers.get('sec-fetch-site')==='cross-site'||url.search)throw Error('origin_denied');
        cleanup=['/api/account/logout','/api/account/recovery-logout'].includes(url.pathname);
        if(busy||pending.size)throw Error('inflight_business');
        step=armed;
        if(!cleanup&&(!step||halted||Date.now()>=executionExpiresAt))throw Error('unarmed');
        if(step&&(url.pathname!=='/api/account/'+step.action||((!offline||policy.sessionOnly||policy.mutation)&&browser!==step.browser)))throw Error('stage_denied');
        if(!step&&!cleanup)throw Error('stage_denied');
        const body=await request.clone().json();
        if(body.email!==undefined&&(!step||email(body.email)!==accounts[step.account].email))throw Error('account_denied');
        // Recheck after reading the body: simultaneous requests cannot share a slot.
        if(cleaning||closed||busy||step&&(armed!==step||stepsUsed.has(step.id)))throw Error('concurrent_request');
        if(cleanup&&logoutPosts>=policy.logoutPosts)throw Error('logout_ingress_limit');
        emit('ingress_claim',{step:step?.id??'cleanup',action:url.pathname,browser});
        if(step)stepsUsed.add(step.id);if(cleanup)logoutPosts++;
        busy=true;armed=null;
      }
    } catch {emit('ingress_rejected',{path:url.pathname,method:request.method});return denied();}
    const execute=async()=>{
      active={step,browser,primary:null,refreshed:false};
      try {
        const response=await worker(request);
        if(step) {
          const p=active.primary;
          const ok=p?.outcome==='HTTP'&&(step.id==='a-old'?p.status===400&&p.errorCode==='invalid_credentials'&&response.status===400:p.status>=200&&p.status<300&&response.ok);
          // Recovery must actually close its newly-created session before the next login.
          const closedEnough=step.id!=='a-reset'||!hasSession();
          if(ok&&closedEnough&&!halted){next=!policy.mutation&&unknownStep==='a-change'&&step.id==='a-logout2'||!policy.mutation&&unknownStep==='a-reset'&&step.id==='a-old'?'complete':steps[steps.indexOf(step)+1]?.id??'complete';emit('step_complete',{step:step.id,next});}
          else {halted=true;next=null;const body=await response.clone().json().catch(()=>({}));if(p&&['a-change','a-reset'].includes(step.id)&&(p.outcome==='UNKNOWN'||body.code==='updateUnknown'))unknownStep=step.id;emit('step_stopped',{step:step.id,upstream:p?.outcome??'NOT_SENT',appStatus:response.status});}
        }
        return response;
      } catch {halted=true;next=null;emit('dispatch_unknown',{step:step?.id??null});return new Response(null,{status:503});}
      finally {active.finished=true;active=null;if(request.method==='POST')busy=false;}
    };
    const promise=queue.then(execute);queue=promise.catch(()=>{});return promise;
  }
  function permitUnknownCheck() {
    if(cleaning||busy||pending.size||hasSession()||!unknownStep||unknownCheckUsed)throw Error('unknown_branch_denied');
    unknownCheckUsed=true;
    next=unknownStep==='a-change'?'a-login1':'a-login2';halted=false;
    emit('unknown_check_enabled',{originalStep:unknownStep,next});
  }
  function cleanup() {
    if(closed)return Promise.resolve(unconfirmedAtClose===0);
    if(cleanupPromise)return cleanupPromise;
    halted=true;armed=null;cleaning=true;
    cleanupPromise=(async()=>{
      await queue;await Promise.allSettled([...pending]);
      active={step:null,primary:null,refreshed:false};
      try {for(const s of sessions.values())if(!s.closed){
        const prior=logoutRequests.get(s.sessionId);
        if(prior){emit('cleanup_skipped',{id:prior.id,account:s.account,recovery:s.recovery,reason:'logout_already_attempted',outcome:prior.outcome});continue;}
        await outbound(new Request(AUTH+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+s.access,'Content-Type':'application/json'},body:'{}'}));
      }}finally{active.finished=true;active=null;}
      const confirmed=!hasSession();emit('cleanup',{confirmed});return confirmed;
    })().finally(()=>{cleaning=false;cleanupPromise=null;});
    return cleanupPromise;
  }
  function snapshot(){return {counts:{...counts},accountCounts:structuredClone(accountCounts),...(policy.sessionOnly?{browserCounts:structuredClone(browserCounts)}:{}),total:countTotal(counts),logoutPosts,next,halted,busy,closed,armed:armed?.id??null,openSessions:closed?unconfirmedAtClose:[...sessions.values()].filter(s=>!s.closed).length,logoutOutcomes:Object.fromEntries(['IN_FLIGHT','HTTP','UNKNOWN'].map(outcome=>[outcome,[...logoutRequests.values()].filter(r=>r.outcome===outcome).length])),unknownStep};}
  function close(){if(!closed){unconfirmedAtClose=snapshot().openSessions;emit('close',{openSessions:unconfirmedAtClose});fsyncSync(fd);closeSync(fd);closed=true;sessions.clear();accesses.clear();refreshes.clear();}}
  return {arm,outbound,dispatch,cleanup,close,snapshot,permitUnknownCheck};
}
