// Deterministic OFFLINE model with controllable faults. No network/process API.
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {root,pins,PROJECT,ISSUER,ALICE,BOB,CHARLIE} from './contract.mjs';
import {hash,need,DriverStop,same,canonical} from './state.mjs';
import {claimApprovedIntent} from '../../../lib/business/r3-intent-ledger.mjs';
import {binding} from '../clean-candidate/service.mjs';
import {grantBytes,sha256} from '../../../lib/business/protocol.mjs';
export const complete=()=>({protocol:'https',complete:true,tls:{readEnd:true,writeFinish:true,closed:true,hadError:false}});
const uuid=(prefix,n)=>prefix+'0000-0000-4000-8000-'+String(n).padStart(12,'0');
export class MockHost {
 constructor({faults={},credential=false}={}){
  this.mode='OFFLINE';this.now=1800000000000;this.clock=()=>this.now;this.calls=[];this.faults=faults;this.credential=credential;this.trustedCandidate=false;this.stops=0;this.serial=100;this.tokens={};this.receiptMatches={};this.signatureCalls=0;this.authRows=[];
  const f=JSON.parse(readFileSync(new URL('../s34-fixture-contract.json',import.meta.url)));
  this.base={meta:{system_identifier:'7706828727995158580',server_version_num:'170011',database:'postgres'},users:[{uid:ALICE,email:'alice.r3-clean-20261111@example.test',confirmed:true,anonymous:false,banned_until:null,deleted_at:null},{uid:BOB,email:'bob.r3-clean-20261111@example.test',confirmed:true,anonymous:false,banned_until:null,deleted_at:null}],sessions:[ALICE,BOB].map((uid,i)=>({uid,sid:i?f.actors.Bob.historical_sid:f.actors.Alice.historical_sid,not_after:null,created_at:new Date(this.now-60000).toISOString(),refresh_count:1,amr_count:1,password_amr_count:1})),gates:{singleton:true,enabled:false,proof_verifier_ready:false,project_ref:PROJECT,auth_issuer:ISSUER},security_state:[ALICE,BOB].map((uid,i)=>({auth_user_id:uid,security_epoch:i,business_enabled:true,security_hold:false,hold_reason:'none',created_at:new Date(this.now-60000).toISOString(),updated_at:new Date(this.now-60000).toISOString()})),grants:[],generations:[{key_id:'old-key',revoked_at:null,not_before:new Date(this.now-60000).toISOString(),sign_until:new Date(this.now-30000).toISOString(),verify_until:new Date(this.now-1000).toISOString()}],tickets:[],proof_receipts:[],operation_receipts:[{request_id:f.alice_receipt_read.request_id,site_id:f.actors.Alice.site}],protected_auth:[{actor:'Bob',name:'auth.users',row_count:1,data_sha256:hash('bob')}],absences:{charlie_user:true,charlie_state:true,new_generation:true,new_proofs_and_tickets:true}};
  for(const u of this.base.users){this.add('users',u.uid,u.uid);this.add('identities',randomUUID(),u.uid);}
  for(const s of this.base.sessions){this.add('sessions',s.sid,s.uid,s.sid);this.add('refresh_tokens',String(++this.serial),s.uid,s.sid);this.add('mfa_amr_claims',randomUUID(),s.uid,s.sid);}
  for(let n=0;n<16;n++)this.add('audit_log_entries',randomUUID(),n%2?ALICE:BOB);
  this.historyGrants=[];this.protectedBusiness={oldBusiness:hash('immutable-business')};this.authStable={alice_user:hash('stable-alice'),alice_identity:hash('stable-alice-identity')};
 }
 add(table,id,uid=null,sid=null){this.authRows.push({table,id,uid,sid,sha:hash(table+id+uid+sid)});}
 audit(uid,n=1){for(let i=0;i<n;i++)this.add('audit_log_entries',randomUUID(),uid);}
 removeSession(sid){this.base.sessions=this.base.sessions.filter(s=>s.sid!==sid);this.authRows=this.authRows.filter(r=>r.sid!==sid);}
 addSession(slot,ctx,recovery=false){
  const actor=ctx.fixture.session_slots[slot].actor,uid=ctx.fixture.actors[actor].uid,sid=uuid('d34a',++this.serial);
  this.base.sessions.push({sid,uid,created_at:new Date(this.now).toISOString(),not_after:null,refresh_count:1,amr_count:recovery?2:1,password_amr_count:recovery?0:1});
  this.add('sessions',sid,uid,sid);this.add('refresh_tokens',String(++this.serial),uid,sid);this.add('mfa_amr_claims',randomUUID(),uid,sid);if(recovery)this.add('mfa_amr_claims',randomUUID(),uid,sid);this.audit(uid,recovery?2:1);
  const claims={iss:ISSUER,aud:'authenticated',role:'authenticated',sub:uid,session_id:sid,is_anonymous:false,exp:Math.floor(this.now/1000)+3600,amr:[{method:recovery?'otp':'password'}]};const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const token=enc({alg:'HS256',typ:'JWT'})+'.'+enc(claims)+'.offline';this.tokens[slot]=token;
  return {token,user:{id:uid,is_anonymous:false,email_confirmed_at:new Date(this.now-1000).toISOString()},authVerified:true,originalToken:true,transport:complete()};
 }
 async checkGates(){if(this.faults.p01Gates)throw new DriverStop('P01_SYNTHETIC_STOP',this.faults.p01Gates==='unknown');this.trustedCandidate=!Object.values(this.faults.gates??{}).includes(false);return {mode:'OFFLINE',project:PROJECT,physicalId:'7706828727995158580',daemon:'d47715b7-0a23-49e0-a063-32f98fe1753c',sourceSha:pins.source_sha,imageId:'sha256:49e909c0ea90b04854a897e81f28d3e77ccc697324c2eb9d58ba45521f672fc5',configDigest:'sha256:7514f117ac7ae4c1e8b6e2b6fd3238157322e967eae9c0d53daf6174fe465a76',p00:true,p01:true,driverReview:true,image:true,source:true,tls:true,uds:true,resourceBudget:true,noHistoricalReplay:true,serviceBindings:true,...this.faults.gates};}
 async observe(ctx){return this.snapshot(ctx);}
 async catalog(){return {readOnly:true,rollback:true,exactMatch:true,closed:true,roleDelta:0};}
 async p01HealthMail(){this.calls.push('P01-health-mail');if(this.faults.p01Health)throw Error('MOCK_HEALTH_STOP');return {auth:{status:200,mutation:false},mail:{complete:true}};}
 async p01Registrar(){return {authorized:true,inputEof:true,outputEof:true,exitCode:0,sqlSent:false,postgresStartupSent:false};}
 async p01ErrorObserver(){return {readOnly:true,rollback:true,source:'postgres-log',sqlstate:'22012',unique:true};}
 hasAliceCredential(){return this.credential;}
 snapshot(ctx){
  this.base.meta={...this.base.meta,snapshot_time:new Date(this.now).toISOString()};
  const business=JSON.parse(readFileSync(new URL('../m7-permissions-contract.json',import.meta.url))).tables;
  const authNames=['audit_log_entries','custom_oauth_providers','flow_state','identities','instances','mfa_amr_claims','mfa_challenges','mfa_factors','mfa_recovery_code_sets','mfa_recovery_codes','oauth_authorizations','oauth_client_states','oauth_clients','oauth_consents','one_time_tokens','refresh_tokens','saml_providers','saml_relay_states','schema_migrations','scim_tokens','scim_users','sessions','sso_domains','sso_providers','users','webauthn_challenges','webauthn_credentials'];
  this.base.inventories={site_data:Object.keys(business).filter(x=>x.startsWith('site_data.')),site_private:Object.keys(business).filter(x=>x.startsWith('site_private.')),auth:authNames.map(x=>'auth.'+x)};
  const names=[...Object.keys(business),...authNames.map(x=>'auth.'+x)].sort();
  this.base.fingerprints=names.map(name=>{
   let rows;if(name.startsWith('auth.'))rows=this.authRows.filter(r=>r.table===name.slice(5));
   else if(name==='site_private.business_runtime')rows=[this.base.gates];
   else if(name==='site_private.user_security_state')rows=this.base.security_state;
   else if(name==='site_private.business_session_grants')rows=this.base.grants;
   else if(name==='site_private.proof_generations')rows=this.base.generations;
   else if(name==='site_private.registered_business_tickets')rows=this.base.tickets;
   else if(name==='site_private.grant_proofs')rows=this.base.proof_receipts;
   else rows=[{immutable:name}];return {name,row_count:rows.length,data_sha256:hash(canonical(rows))};
  });
  return {readOnly:true,rollback:true,pid:++this.serial,base:structuredClone(this.base),protectedBusiness:structuredClone(this.protectedBusiness),authStable:structuredClone(this.authStable),charlieIdentityStable:hash('stable-charlie-identity'),authRows:structuredClone(this.authRows),authUserFields:Object.fromEntries(this.base.users.map(u=>[u.uid,Object.fromEntries(Object.entries(u).map(([k,v])=>[k,hash(canonical(v))]))])),receiptMatches:structuredClone(this.receiptMatches),authLifecycleAcl:{sessionUpdate:true,sessionDelete:true},diagnosticSettings:{errorParameters:'0'}};
 }
 maintenance(kind,ctx){const b=this.base,f=ctx.fixture,s=b.security_state.find(s=>s.auth_user_id===CHARLIE);
  if(kind==='generation')b.generations.push({key_id:f.key_id,revoked_at:null,not_before:new Date(this.now-5000).toISOString(),sign_until:new Date(this.now+1200000).toISOString(),verify_until:new Date(this.now+1260000).toISOString()});
  else if(kind==='open'){b.gates.enabled=true;b.gates.proof_verifier_ready=true;}
  else if(kind==='initCharlie')b.security_state.push({auth_user_id:CHARLIE,...f.charlie_initial_state,created_at:new Date(this.now).toISOString(),updated_at:new Date(this.now).toISOString()});
  else if(kind==='hold')s.security_hold=true;else if(kind==='clearHold')s.security_hold=false;
  else if(kind==='disable')s.business_enabled=false;else if(kind==='enable')s.business_enabled=true;else if(kind==='epoch')s.security_epoch=1;
  else if(kind==='expireA1')b.sessions.find(s=>s.sid===ctx.state.sessions.A1.sid).not_after=new Date(this.now+5000).toISOString();
  else if(kind==='deleteA1')this.removeSession(ctx.state.sessions.A1.sid);
  else if(kind==='revoke')b.generations.find(g=>g.key_id===f.key_id).revoked_at=new Date(this.now).toISOString();
  else if(kind==='close'){b.gates.enabled=false;b.gates.proof_verifier_ready=false;if(s){s.business_enabled=false;s.security_hold=true;s.hold_reason='administrative';}const gen=b.generations.find(g=>g.key_id===f.key_id);if(gen&&!gen.revoked_at)gen.revoked_at=new Date(this.now).toISOString();return {committed:true,exitCode:0,roleDelta:0,gatesClosed:true,hardCheck:true,containmentOk:true};}
  else need(false,'MOCK_MAINTENANCE_SCOPE');return {committed:true,exitCode:0,roleDelta:0};
 }
 read(a,ctx){
  const who=ctx.state.sessions[a.slot],s=this.base.sessions.find(s=>s.sid===who.sid),security=this.base.security_state.find(s=>s.auth_user_id===who.uid),grant=this.base.grants.find(g=>g.auth_session_id===who.sid),gen=this.base.generations.find(g=>g.key_id===ctx.fixture.key_id);
  const branch=who.purpose==='recovery'?'purpose':!s||s.not_after&&Date.parse(s.not_after)<=this.now?'session':!security||security.security_hold||!security.business_enabled||!grant||security.security_epoch!==grant.security_epoch||gen?.revoked_at?'qualification':null;
  const denied=branch!==null;const data=denied?{code:'BUSINESS_DENIED'}:a.rpc==='get_my_site'?{schema_version:1,site:who.uid===CHARLIE?null:{id:ctx.fixture.actors.Alice.site,draft_revision:0},capabilities:{read:true,edit:false,publish:false}}:a.rpc==='read_introduction'?{schema_version:1,site_id:ctx.fixture.actors.Alice.site,entries:[{translations:{en:'Add your introduction.',zh:'请填写个人介绍。'}}]}:{status:'succeeded',result:{site_id:ctx.fixture.actors.Alice.site,request_id:ctx.fixture.alice_receipt_read.request_id}};
  let database;if(denied){const name=branch==='qualification'?'lock_business_qualification':'auth_source_identity';database={source:'postgres-log',sqlstate:'42501',function:'site_private.'+name,bodySha256:pins.frames[name].body_sha256,raiseLine:pins.frames[name][branch+'_line'],sessionUser:'ecv_s3_internal_api_login',rpcContextObserved:true,rpc:a.rpc,uid:who.uid,sid:who.sid,unique:true,pid:1234,outcome:'DENIED_RESPONSE_OBSERVED'};}else database={source:'postgrest-original-jwt',outcome:'READ_COMPLETED',uid:who.uid,sid:who.sid,rpc:a.rpc};
  const r={outerStatus:denied?403:200,postgrest:{status:denied?403:200,code:denied?'42501':null,codeOrigin:'uds-response-body',udsObserved:true},requestBinding:{source:'observed-original-jwt-and-uds',uid:who.uid,sid:who.sid,rpc:a.rpc,jwtSha256:hash(this.tokens[a.slot])},transport:complete(),database,data};
  if(a.action==='faultRead')Object.assign(r,{actualUnknown:true,outerStatus:503,clientStatus:503,intentionalFault:true,transport:{complete:false,protocol:'https'}});
  return r;
 }
 async execute(a,ctx){
  const id=ctx.step+':'+a.action+(a.kind?':'+a.kind:'')+(a.slot?':'+a.slot:'');this.calls.push(id);const fault=this.faults[id];
  if(fault==='unknown')throw new DriverStop('INJECTED_UNKNOWN',true);if(fault==='stop')throw new DriverStop('INJECTED_STOP');
  let r;
  if(a.action==='observe')r=this.snapshot(ctx);
  else if(a.action==='catalog')r={readOnly:true,rollback:true,exactMatch:true,closed:!this.base.gates.enabled,roleDelta:0};
  else if(a.action==='maintenance'||a.action==='close')r=this.maintenance(a.kind??'close',ctx);
  else if(a.action==='resetAlice'){this.removeSession(ctx.fixture.actors.Alice.historical_sid);this.audit(ALICE);r={status:200,uid:ALICE,transport:complete()};}
  else if(a.action==='createCharlie'){this.base.users.push({uid:CHARLIE,email:ctx.fixture.actors.Charlie.email,confirmed:true,anonymous:false,banned_until:null,deleted_at:null});this.add('users',CHARLIE,CHARLIE);this.add('identities',randomUUID(),CHARLIE);this.audit(CHARLIE);r={status:200,uid:CHARLIE,transport:complete()};}
  else if(a.action==='login')r=this.addSession(a.slot,ctx);
  else if(a.action==='approveIntent'){ctx.intents.approve(a.intent,Math.floor(this.now/1000),Math.floor(this.now/1000)+60);r={approved:true,safeReceipt:{proofId:a.intent.proof_id,state:'approved'}};}
  else if(a.action==='signRegister'){
   const admitted=await claimApprovedIntent(ctx.intents.storage(),a.intent,()=>Math.floor(this.now/1000),binding);need(admitted,'INTENT_REJECTED');this.signatureCalls++;
   const p={version:1,project:PROJECT,action:'issue',purpose:'business',uid:a.intent.uid,session_id:a.intent.session_id,epoch:a.intent.epoch,proof_id:a.intent.proof_id,issued_at:Math.floor(this.now/1000),expires_at:Math.floor(this.now/1000)+60,payload_digest:'',key_id:a.intent.key_id,event:'password-login'};p.payload_digest=await sha256(grantBytes(p));
   this.base.tickets.push({proof_id:p.proof_id,uid:p.uid,sid:p.session_id,key_id:p.key_id});r={proof:p,nativeVerified:true,registration:{committed:true,command:'SELECT',rowCount:1,registered:true,peerVerified:true,inputEof:true,outputEof:true,exitCode:0},safeReceipt:{proofId:p.proof_id}};
  }else if(a.action==='apply'){
   const who=ctx.state.sessions[a.slot],p=ctx.state.proofs[a.slot],id=uuid('934a',++this.serial),expires=new Date(this.now+1800000).toISOString();
   this.base.grants.push({id,auth_user_id:who.uid,auth_session_id:who.sid,security_epoch:p.epoch,purpose:'business',issuer_version:'r3-ticket-v1:'+p.key_id,revoked_at:null,expires_at:expires,absolute_expires_at:new Date(this.now+43200000).toISOString()});
   this.base.proof_receipts.push({proof_id:p.proof_id,uid:p.uid,sid:p.session_id,key_id:p.key_id,action:'issue',epoch:p.epoch,consumed_at:new Date(this.now).toISOString()});this.receiptMatches[p.proof_id]={ticketExact:true,receiptExact:true,claimsExact:true,resultExact:true,consumed:true,grantId:id,uid:p.uid,sid:p.session_id,epoch:p.epoch,keyId:p.key_id};
   r={outerStatus:200,postgrest:{status:200,udsObserved:true},requestBinding:{source:'observed-original-jwt-and-uds',uid:who.uid,sid:who.sid,rpc:'apply_business_grant'},transport:complete(),database:{source:'postgrest-original-jwt',outcome:'RESPONSE_COMPLETE_AWAITING_RECONCILIATION',uid:who.uid,sid:who.sid,rpc:'apply_business_grant'},data:{grant_id:id,status:'active',expires_at:expires}};
  }else if(['read','direct','faultRead'].includes(a.action))r=await this.read(a,ctx);
  else if(a.action==='outerRecovery')r={outerStatus:403,layer:'identity-purpose',postgrest:null,transport:complete()};
  else if(a.action==='mailMetadata')r=a.when==='before'?{complete:true,before:true}:{complete:true,newCount:1};
  else if(a.action==='mailBody')r={complete:true,recipientUid:ALICE,newMessage:true};
  else if(a.action==='recover'){this.add('one_time_tokens',randomUUID(),ALICE);this.audit(ALICE);r={status:200,transport:complete()};}
  else if(a.action==='verifyRecovery'){this.authRows=this.authRows.filter(r=>r.table!=='one_time_tokens');r=this.addSession('AR',ctx,true);}
  else if(a.action==='race'){
   const read=await this.read({action:'read',slot:'C2',rpc:'get_my_site'},ctx);this.maintenance('revoke',ctx);r={read,revoke:{committed:true,roleDelta:0},fence:{rollback:true},databaseReadBeforeRevoke:true,orderingSource:'shared-before-exclusive-queue-and-verified-results',queue:{readOnly:true,rollback:true,classid:3303,objid:5,objsubid:2,readMode:'ShareLock',revokeMode:'ExclusiveLock',readPid:1234,revokePid:1235,readQueuedFirst:true,bothBlocked:true,waitBoundMs:100}};
  }else if(a.action==='stopCandidate'){this.stops++;r={stopped:true};}
  else need(false,'MOCK_OPERATION_SCOPE');
  if(typeof fault==='function')await fault(r,this,ctx,a);return r;
 }
 async waitUntil(ms){this.now=ms+10;}
 destroySecrets(){this.tokens={};}
}
