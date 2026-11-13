import{p14rRaceEvidence}from'./p14r.mjs';
import{maintenanceSQL}from'./sql.mjs';
// Complete P02-P16 state machine. No default adapter, sockets or auto-execution.
import {loadContract,costs,authRows,PROJECT,ALICE,CHARLIE,pins,REMAINING_SCOPE,TAIL_SCOPE,P14R_SCOPE,isContinuation} from './contract.mjs';
import {Meter,Journal,DriverStop,need,hash,canonical,same} from './state.mjs';
import {gates,readReceipt,invariant,bindIdentity,sessionInDb,grantInDb,databaseDenial,databaseSuccess,grantCommitted,transport} from './evidence.mjs';
import {uuid} from '../../../lib/business/protocol.mjs';
import {isLiveHost} from './live-host.mjs';
import {boundedOperation} from './deadline.mjs';
import {remainingContract,initialRemaining,credentialReconciled,dispatchId,historyReferences} from './remaining.mjs';
const triple=['get_my_site','read_introduction','read_create_operation'];
export async function executeDriver({host,journal,intents,runId,mode='OFFLINE',clock,startedAt,deadlineAt,timeWindow,limits={},sourceSha,operationTimeoutMs=20000,signal,profileScope}){
 need(host?.mode===mode&&(mode==='OFFLINE'||isLiveHost(host)),'REAL_HOST_REQUIRED');
const raceOnly=profileScope===P14R_SCOPE,tail=profileScope===TAIL_SCOPE||raceOnly,remaining=isContinuation(profileScope);need(profileScope===undefined||remaining,'EXECUTION_SCOPE');
need(mode!=='REAL'||host?.approval?.scope===(remaining?profileScope:'S34-P02-P16'),'BUSINESS_SCOPE_REQUIRED');
 need(Number.isSafeInteger(operationTimeoutMs)&&operationTimeoutMs>0&&operationTimeoutMs<=20000,'TIMEOUT_OVERRIDE');
 need(mode!=='REAL'||timeWindow===host.executionWindow,'TIME_CONTEXT_REQUIRED');
 const contract=remaining?remainingContract(profileScope):loadContract(),{plan,fixture}=contract;
 need(mode!=='REAL'||same(host.contract.fixture,fixture),'HOST_PROFILE_MISMATCH');const meter=new Meter(plan,{clock,startedAt,deadlineAt,timeWindow,limits});
 const state={fixture,remaining,tail,raceOnly,sessions:{},grants:{},proofs:{},resetIssued:false,charlieIssued:false};
 let deniedBefore=null,deniedIds=[];let initial,last,ready=false,position='P00',fatal=null,cleanup=null,expectedUnknown=false,failurePosition=null;
 const context={state,plan,fixture,runId,mode,intents,sourceSha,meter};
 if(remaining){need(runId===contract.profile.runId,'REMAINING_RUN_IDENTITY');journal.record('HISTORICAL-REFERENCES',historyReferences(contract));}
 function pub(r){return {outerStatus:r.outerStatus??null,postgrest:r.postgrest??null,database:r.database??null,transport:r.transport??null,requestBinding:r.requestBinding??null,udsEvidence:r.udsEvidence??null};}
 async function op(id,cost,action,check=()=>{},options={}){
  need(options.cleanup||!signal?.aborted,'SIGNAL_STOP');
  const counters=meter.reserve(id,position,cost,options);journal.issue(id,{step:position,action:action.action,slot:action.slot??null,rpc:action.rpc??null,...(remaining?{dispatchRequestId:dispatchId(runId,id),...(action.rpc==='read_create_operation'?{lookupOperationRequestId:fixture.alice_receipt_read.request_id,lookupOnly:true}:{})}:{}),uid:action.slot?state.sessions[action.slot]?.uid??null:null,sid:action.slot?state.sessions[action.slot]?.sid??null:null,jwtSha256:action.slot?state.sessions[action.slot]?.jwtSha256??null:null},counters);
  let r;
  try{
   need(ready||position==='P00'||options.cleanup,'WRITE_GATE_NOT_READY');
   if(['resetAlice','prepareAliceCredential'].includes(action.action))state.resetIssued=true;
   if(tail&&['prepareAliceCredential','prepareCharlieCredential'].includes(action.action)){const actor=action.action==='prepareAliceCredential'?'Alice':'Charlie';state.credentialCascadeSids??=[];state.credentialCascadeSids.push(...fixture.credential_cascades[actor].map(s=>s.sid));}
   if(action.action==='createCharlie')state.charlieIssued=true;
   if(action.action==='maintenance'&&action.kind==='deleteA1')state.a1DeleteIssued=true;
   if(['prepareAliceCredential','prepareCharlieCredential','resetAlice','createCharlie','login','recover','verifyRecovery'].includes(action.action)){const uid=action.action==='prepareCharlieCredential'?CHARLIE:action.slot?fixture.actors[fixture.session_slots[action.slot].actor].uid:ALICE;state.authEffect={action:action.action,uid};}
   if(action.action==='verifyRecovery')state.recoveryVerifyIssued=true;
   context.step=position;context.operationId=id;r=await boundedOperation(()=>host.execute(action,context),{meter,cleanup:options.cleanup,timeoutMs:options.cleanup&&remaining?Math.min(operationTimeoutMs,15000):operationTimeoutMs,signal});
   // Preserve the ACTUAL observation even when its invariant check fails.
   if(['observe','independentFinal'].includes(action.action))journal.record(id+'-snapshot',r);
   await check(r);
   journal.result(id,{status:r?.actualUnknown?'UNKNOWN':'COMPLETE',evidence:r?.safeReceipt??pub(r)});return r;
  }catch(e){
   const writes=['prepareAliceCredential','prepareCharlieCredential','resetAlice','createCharlie','login','recover','verifyRecovery','maintenance','close','signRegister','apply','approveIntent','race'].includes(action.action);
   const rollbackKnown=r?.rollback===true&&r?.committed===false;
   const unknown=e?.unknown===true||!(e instanceof DriverStop)||writes&&!rollbackKnown;journal.result(id,{status:unknown?'UNKNOWN':'STOP',code:e instanceof DriverStop?e.code:'ADAPTER_UNKNOWN',evidence:r?.safeReceipt??e?.safeReceipt??pub(r??{})});
   if(unknown)throw new DriverStop(e instanceof DriverStop?e.code:'ADAPTER_UNKNOWN',true);throw e;
  }
 }
 async function observe(label,{final=false,cleanup=false}={}){
  const r=await op(label,costs.audit,{action:'observe'},s=>{readReceipt(s);if(initial)invariant(s,initial,state,plan,{final});},{cleanup});
  if(deniedBefore){need(same(r.base.fingerprints,deniedBefore),'DENIAL_SIDE_EFFECT');journal.record(label+'-denials-reconciled',{outcome:'NO_WRITE_RECONCILED',operations:deniedIds,observationSha256:hash(canonical(r))});deniedBefore=null;deniedIds=[];}if(!initial)initial=r;last=r;context.last=r;return r;
 }
 async function maintenance(id,kind,extraCost={}){
  const before=structuredClone(last.base);
  if(kind==='deleteA1'){
   const s=before.sessions.find(s=>s.sid===bound('A1').sid);
   need(s?.refresh_count===1&&s.password_amr_count===1&&s.amr_count===1,'A1_DELETE_CASCADE_SCOPE');
  }
  const r=await op(id,{...costs.maintenance,...extraCost},{action:'maintenance',kind},r=>need(r?.committed===true&&r.exitCode===0&&r.roleDelta===0,'MAINTENANCE_COMMIT_UNKNOWN',true));
  if(kind==='generation')state.generationCreated=true;if(kind==='initCharlie')state.charlieStateCreated=true;
  await observe(id+'-observe');
  const after=last.base,old=before.security_state.find(s=>s.auth_user_id===CHARLIE),next=after.security_state.find(s=>s.auth_user_id===CHARLIE);
  const strip=row=>Object.fromEntries(Object.entries(row??{}).filter(([k])=>k!=='updated_at'));
  const changes={reactivateCharlie:{business_enabled:true,security_hold:false,hold_reason:'none'},hold:{security_hold:true},clearHold:{security_hold:false},disable:{business_enabled:false},enable:{business_enabled:true},epoch:{security_epoch:1}};
  if(kind==='reactivateCharlie')need(old?.security_epoch===0&&!old.business_enabled&&old.security_hold&&old.hold_reason==='administrative','TAIL_CHARLIE_CAS');
  if(kind in changes){need(old&&same(strip(next),{...strip(old),...changes[kind]}),'MAINTENANCE_PREDICATE_MISMATCH');if(kind==='epoch')need(old.security_epoch===0,'EPOCH_NOT_ZERO');}
  if(kind==='initCharlie')for(const [k,v]of Object.entries(fixture.charlie_initial_state))need(next?.[k]===v,'CHARLIE_INITIAL_STATE');
  if(kind==='expireA1'){const s=after.sessions.find(x=>x.sid===bound('A1').sid);const ms=Date.parse(s?.not_after)-Date.parse(after.meta.snapshot_time);need(ms>0&&ms<=5000,'A1_EXPIRY_NOT_FUTURE');}
  if(kind==='deleteA1')sessionInDb(last,'A1',state,{missing:true});
  return r;
 }
 function bound(slot){need(state.sessions[slot],'SESSION_SLOT_MISSING');return state.sessions[slot];}
 function scope(slot,rpc){const s=bound(slot);return {uid:s.uid,sid:s.sid,rpc};}
 function beforeRead(slot,branch){
  const sessionBranch=branch==='session';
  sessionInDb(last,slot,state,{missing:sessionBranch&&!last.base.sessions.some(x=>x.sid===bound(slot).sid)});
  if(sessionBranch)grantInDb(last,slot,state);
 }
 async function login(slot){
  await op(position+'-login-'+slot,{...costs.login,...authRows.login},{action:'login',slot},r=>{
   const identity=bindIdentity(r,slot,fixture,state,Math.floor(Date.parse(last.base.meta.snapshot_time)/1000));
   need(identity.purpose==='password','PASSWORD_PURPOSE');
  });
  await observe(position+'-login-observe-'+slot);sessionInDb(last,slot,state);
 }
 async function issue(slot){
  const p=fixture.proof_slots.find(p=>p.session_slot===slot);const s=bound(slot);
  const security=last.base.security_state.find(x=>x.auth_user_id===s.uid);need(security?.business_enabled&&!security.security_hold&&security.hold_reason==='none','ISSUE_QUALIFICATION');
  const intent={project:PROJECT,action:'issue',uid:s.uid,session_id:s.sid,epoch:security.security_epoch,proof_id:p.proof_id,key_id:fixture.key_id};
  await op(position+'-approve-'+slot,costs.intent,{action:'approveIntent',slot,intent},r=>need(r.approved===true,'INTENT_APPROVAL_UNKNOWN',true));
  const reg=await op(position+'-register-'+slot,{...costs.registration,business_insert_registered_business_tickets:1},{action:'signRegister',slot,intent},r=>{
   const p=r.proof;need(p?.proof_id===intent.proof_id&&p.uid===s.uid&&p.session_id===s.sid&&p.epoch===intent.epoch&&p.key_id===intent.key_id&&p.action==='issue'&&p.purpose==='business'&&p.event==='password-login','PROOF_BINDING');
   need(r.nativeVerified===true&&r.registration?.committed===true&&r.registration.command==='SELECT'&&r.registration.rowCount===1&&r.registration.registered===true&&r.registration.peerVerified===true&&r.registration.inputEof&&r.registration.outputEof&&r.registration.exitCode===0,'REGISTRATION_UNKNOWN',true);
   state.proofs[slot]=p;
  });
  await observe(position+'-registered-observe-'+slot);
  need((last.base.tickets??[]).some(t=>t.proof_id===intent.proof_id&&t.uid===s.uid&&t.sid===s.sid),'TICKET_COMMIT_UNCONFIRMED',true);
  const grant=await op(position+'-apply-'+slot,{...costs.apply,business_insert_business_session_grants:1,business_insert_grant_proofs:1},{action:'apply',slot},r=>{
   databaseSuccess(r,scope(slot,'apply_business_grant'));need(uuid(r.data?.grant_id)&&r.data.status==='active'&&!Object.values(state.grants).some(g=>g.id===r.data.grant_id),'GRANT_RESPONSE');
   state.grants[slot]={id:r.data.grant_id,expiresAt:r.data.expires_at};
  });
  await observe(position+'-applied-observe-'+slot);grantCommitted(last,slot,state,reg.proof);
  journal.record(position+'-grant-reconciled-'+slot,{proofId:reg.proof.proof_id,grantId:state.grants[slot].id,outcome:'COMMIT_RECONCILED',observationSha256:hash(canonical(last))});
 }
 async function read(slot,rpc,{deny=false,direct=false,branch='qualification',fault=false}={}){
  const s=scope(slot,rpc);{deniedBefore??=structuredClone(last.base.fingerprints);deniedIds.push(position+':'+slot+':'+rpc);}if(!fault)beforeRead(slot,branch);
  return op(position+'-'+(fault?'fault-':direct?'direct-':'read-')+slot+'-'+rpc+(deny?'-deny':'-positive'),direct?costs.direct:costs.normal,{action:fault?'faultRead':direct?'direct':'read',slot,rpc},r=>{
   if(fault){need(r.actualUnknown===true&&r.intentionalFault===true&&r.clientStatus===503&&r.transport?.complete===false,'FAULT_NOT_UNKNOWN',true);databaseDenial(r,'qualification',s,{requireTransport:false});expectedUnknown=true;return;}
   if(deny){databaseDenial(r,branch,s);return;}
   databaseSuccess(r,s);const data=r.data;
   if(rpc==='get_my_site')need(data?.schema_version===1&&(slot.startsWith('C')?data.site===null:data.site?.id===fixture.actors.Alice.site&&data.capabilities?.read===true),'OWNER_RESULT');
   else if(rpc==='read_introduction')need(data?.schema_version===1&&data.site_id===fixture.actors.Alice.site&&Array.isArray(data.entries)&&data.entries.length===1&&data.entries[0].translations?.en==='Add your introduction.'&&data.entries[0].translations?.zh==='请填写个人介绍。','INTRODUCTION_RESULT');
   else need(data?.status==='succeeded'&&data.result?.site_id===fixture.actors.Alice.site&&data.result.request_id===fixture.alice_receipt_read.request_id,'RECEIPT_RESULT');
  });
 }
 async function group(slot,deny){for(const rpc of triple)await read(slot,rpc,{deny});await observe(position+'-reads-observe');}
 try{
  // P00 before external P01 is part of this SAME frozen 20-minute batch. Its
  // already-issued read-only observations consume, rather than add to, quota.
  const carried=host.preflightUsage??{read_only_audit:0,explicit_database_transactions:0};
  need(Number.isSafeInteger(carried.read_only_audit)&&carried.read_only_audit===carried.explicit_database_transactions&&carried.read_only_audit>=0&&carried.read_only_audit<=3,'PREFLIGHT_USAGE');
  need(mode!=='REAL'||carried.read_only_audit>=2,'PREFLIGHT_USAGE');need(!remaining||carried.read_only_audit===2,'REMAINING_P00_BUDGET');
  meter.reserve('P00-before-P01','P00',carried);journal.record('P00-carried-usage',{mode,counters:carried,receiptSha256:host.preflightReceiptSha256??null});
  // Gate adapter cannot substitute a supplied JSON PASS for live checks. The
  // REAL entry constructs the pinned LiveHost; the exported test entry forces OFFLINE.
  const g=await boundedOperation(()=>host.checkGates(context),{meter,timeoutMs:120000,signal});gates(g,mode);
  await observe('P00-baseline');
  const catalog=await op('P00-catalog',costs.audit,{action:'catalog'},r=>need(r.readOnly&&r.rollback&&r.exactMatch&&r.closed&&r.roleDelta===0,'CATALOG_GATE'));
  if(remaining){initialRemaining(last,contract);state.baselineSids=last.base.sessions.map(s=>s.sid);}else need(last.base.gates.enabled===false&&last.base.gates.proof_verifier_ready===false&&Object.values(last.base.absences).every(Boolean),'INITIAL_CLOSED_GATE');
  need(last.authLifecycleAcl?.sessionUpdate===true&&last.authLifecycleAcl.sessionDelete===true,'AUTH_LIFECYCLE_ACL_UNAVAILABLE');
  ready=true;context.initial=initial;
  if(remaining){
   position='RSETUP';
   for(const [actor,uid,action]of (raceOnly?[['Alice',ALICE,'prepareAliceCredential']]:[['Alice',ALICE,'prepareAliceCredential'],['Charlie',CHARLIE,'prepareCharlieCredential']])){
    const before=last;need(!state.sessions.A1,'CREDENTIAL_AFTER_SESSION');
    if(actor==='Charlie'&&!tail)need(!last.base.sessions.some(s=>s.uid===CHARLIE),'CHARLIE_CREDENTIAL_CASCADE_SCOPE');
    await op('RSETUP-credential-'+actor,{...costs.control,...(tail?{auth_insert_audit_log_entries:1,...Object.fromEntries(['sessions','refresh_tokens','mfa_amr_claims'].map(k=>['auth_delete_'+k,fixture.credential_cascades[actor].length]))}:actor==='Alice'?authRows.reset:{auth_insert_audit_log_entries:1})},{action},r=>{transport(r.transport);need(r.status===200&&r.uid===uid,'CREDENTIAL_RESULT');});
    await observe('RSETUP-credential-observe-'+actor);credentialReconciled(before,last,uid,contract);
   }
  }else{
  position='P02';
  if(!host.hasAliceCredential()){
   const a=last.base.sessions.filter(s=>s.uid===ALICE);need(a.length===1&&a[0].sid===fixture.actors.Alice.historical_sid&&a[0].refresh_count===1&&a[0].password_amr_count===1,'RESET_CASCADE_SCOPE');
   need(last.base.fingerprints.find(x=>x.name==='auth.one_time_tokens').row_count===0,'RESET_ONE_TIME_SCOPE');
   await op('P02-reset',{...costs.control,...authRows.reset},{action:'resetAlice'},r=>{transport(r.transport);need(r.status===200&&r.uid===ALICE,'RESET_RESULT');});await observe('P02-reset-observe');
   need(!last.base.sessions.some(s=>s.uid===ALICE),'RESET_CASCADE_UNCONFIRMED',true);
  }else journal.record('P02-reset-skipped',{mode,reason:'original volatile credential available; unused slots are not transferable'});
  await op('P02-create',{...costs.control,...authRows.create},{action:'createCharlie'},r=>{transport(r.transport);need(r.status===200&&r.uid===CHARLIE,'CREATE_CHARLIE_RESULT');});await observe('P02-create-observe');
  }
  position=remaining?'RQUALIFY':'P03';await maintenance(position+'-generation','generation',{business_insert_proof_generations:1});await maintenance(position+'-open','open');
  need(last.base.gates.enabled&&last.base.gates.proof_verifier_ready,'GATES_NOT_OPEN');
  if(raceOnly){position='RFIXTURE';await login('A1');await issue('A1');await read('A1','get_my_site');await observe('RFIXTURE-positive-observe');}
  else{
  if(tail){await maintenance('RQUALIFY-reactivate','reactivateCharlie');position='RFIXTURE';await login('A1');await issue('A1');await login('C1');await issue('C1');}
  else{
  position=remaining?'P04R':'P04';await login('A1');await issue('A1');if(remaining){await read('A1','read_create_operation');await observe('P04R-read-observe');}else await group('A1',false);
  position='P05';await login('A2');need(!(last.base.grants??[]).some(x=>x.auth_session_id===bound('A2').sid),'A2_HAS_GRANT');grantInDb(last,'A1',state);await group('A2',true);
  position='P06';await login('C0');need(!last.base.security_state.some(x=>x.auth_user_id===CHARLIE),'C0_STATE_EXISTS');await group('C0',true);await maintenance('P06-init','initCharlie',{business_insert_user_security_state:1});
  position='P07';await login('C1');await issue('C1');await read('C1','get_my_site');await observe('P07-positive-observe');
  position='P08';await maintenance('P08-hold','hold');grantInDb(last,'C1',state);await group('C1',true);await maintenance('P08-clear','clearHold');await read('C1','get_my_site');await observe('P08-positive-observe');
  position='P09';await maintenance('P09-disable','disable');grantInDb(last,'C1',state);await group('C1',true);await maintenance('P09-enable','enable');await read('C1','get_my_site');await observe('P09-positive-observe');
  }
  position=tail?'P10R':'P10';
  await op(position+'-mail-before',costs.mail,{action:'mailMetadata',when:'before'},r=>need(r.complete&&r.before===true,'MAIL_METADATA_UNKNOWN',true));
  await op(position+'-recover',{...costs.control,...authRows.recover},{action:'recover'},r=>{transport(r.transport);need(r.status===200,'RECOVER_RESULT');});await observe(position+'-recover-observe');
  await op(position+'-mail-after',costs.mail,{action:'mailMetadata',when:'after'},r=>need(r.complete&&r.newCount===1,'MAIL_COUNT'));
  await op(position+'-mail-body',costs.mail,{action:'mailBody'},r=>need(r.complete&&r.recipientUid===ALICE&&r.newMessage===true,'RECOVERY_MAIL_SCOPE'));
  await op(position+'-verify',{...costs.control,...authRows.verify},{action:'verifyRecovery',slot:'AR'},r=>bindIdentity(r,'AR',fixture,state,Math.floor(Date.parse(last.base.meta.snapshot_time)/1000)));await observe(position+'-verify-observe');sessionInDb(last,'AR',state);
  deniedBefore??=structuredClone(last.base.fingerprints);deniedIds.push(position+'-purpose-read-group');
  for(const rpc of triple)await op(position+'-purpose-'+rpc,costs.recovery,{action:'outerRecovery',slot:'AR',rpc},r=>{transport(r.transport);need(r.outerStatus===403&&r.layer==='identity-purpose'&&r.postgrest===null,'OUTER_RECOVERY_SOURCE');});await observe(position+'-purpose-observe');
  grantInDb(last,'A1',state);await read('A1','read_introduction',{direct:true});await read('AR','read_introduction',{direct:true,deny:true,branch:'purpose'});await observe(position+'-direct-observe');
  position='P11';grantInDb(last,'A1',state);need(bound('A1').exp>Date.parse(last.base.meta.snapshot_time)/1000+10,'JWT_EXPIRY_CONFOUND');await maintenance('P11-expire','expireA1');await boundedOperation(()=>host.waitUntil(Date.parse(last.base.sessions.find(s=>s.sid===bound('A1').sid).not_after),context),{meter,timeoutMs:6500,signal});await read('A1','get_my_site',{direct:true,deny:true,branch:'session'});await observe('P11-denial-observe');sessionInDb(last,'A1',state,{expired:true});
  position='P12';await maintenance('P12-delete','deleteA1',{auth_delete_sessions:1,auth_delete_refresh_tokens:1,auth_delete_mfa_amr_claims:1});await read('A1','get_my_site',{direct:true,deny:true,branch:'session'});await observe('P12-denial-observe');sessionInDb(last,'A1',state,{missing:true});
  position='P13';await maintenance('P13-epoch','epoch');grantInDb(last,'C1',state,{stale:true});await group('C1',true);await login('C2');await issue('C2');await read('C2','get_my_site');await observe('P13-positive-observe');
  }
  position=raceOnly?'P14R':'P14';const raceSlot=raceOnly?'A1':'C2',raceBefore=structuredClone(last.base);
  const raceResult=await op(position+'-race',{...costs.normal,maintenance_tx:1,fence_tx:1,read_only_audit:1,explicit_database_transactions:4},{action:'race',slot:raceSlot,rpc:'get_my_site'},r=>{
   databaseSuccess(r.read,scope(raceSlot,'get_my_site'));
   if(raceOnly){need(r.read.data?.site?.id===fixture.actors.Alice.site,'P14R_OWNER_RESULT');p14rRaceEvidence(r,{...bound('A1'),dispatchId:dispatchId(runId,'P14R-race'),revocationSqlSha256:hash(maintenanceSQL('revoke',context)),siteId:fixture.actors.Alice.site});}
   const q=r.queue;need(q?.readOnly&&q.rollback&&q.classid===3303&&q.objid===5&&q.objsubid===2&&q.readMode==='ShareLock'&&q.revokeMode==='ExclusiveLock'&&q.readPid!==q.revokePid&&q.readQueuedFirst&&q.bothBlocked&&q.waitBoundMs<=3000,'RACE_NOT_PROVEN');
   need(r.revoke?.committed&&r.revoke.roleDelta===0&&r.fence?.rollback&&r.databaseReadBeforeRevoke===true&&r.orderingSource==='shared-before-exclusive-queue-and-verified-results','RACE_COMMIT_UNKNOWN',true);
  });
  if(raceOnly){const saved=journal.readResult('P14R-race');need(saved.runId===runId&&saved.status==='COMPLETE','P14R_ARCHIVE_READBACK');const archive=p14rRaceEvidence({...raceResult,safeReceipt:saved.evidence},{...bound('A1'),dispatchId:dispatchId(runId,'P14R-race'),revocationSqlSha256:hash(maintenanceSQL('revoke',context)),siteId:fixture.actors.Alice.site});journal.record('P14R-ARCHIVE-VERIFIED',archive);}
  await observe(position+'-race-observe');
  if(remaining){need(same(last.base.fingerprints.filter(x=>x.name!=='site_private.proof_generations'),raceBefore.fingerprints.filter(x=>x.name!=='site_private.proof_generations')),'RACE_UNEXPECTED_SIDE_EFFECT');const before=raceBefore.generations.find(g=>g.key_id===fixture.key_id),after=last.base.generations.find(g=>g.key_id===fixture.key_id),strip=g=>Object.fromEntries(Object.entries(g??{}).filter(([k])=>k!=='revoked_at'));need(before?.revoked_at===null&&after?.revoked_at&&same(strip(before),strip(after)),'RACE_GENERATION_MUTATION');}
  need(last.base.generations.find(g=>g.key_id===fixture.key_id)?.revoked_at,'GENERATION_NOT_REVOKED');await read(raceSlot,'get_my_site',{deny:true});await observe(position+'-denial-observe');
  if(!raceOnly){position='P15';await read('C2','get_my_site',{fault:true});await observe('P15-final-read-observe');}
 }catch(e){failurePosition=position;fatal={status:e?.unknown?'UNKNOWN':'STOP',code:e instanceof DriverStop?e.code:'DRIVER_UNKNOWN'};if(!(e instanceof DriverStop))fatal.status='UNKNOWN';meter.stop();}
 finally{
  position='P16';meter.stop();if(deniedBefore){journal.record('denials-unreconciled',{outcome:'NOT_VERIFIED',operations:deniedIds});deniedBefore=null;deniedIds=[];}
  if(ready){
   try{
    const closed=await op('P16-close',costs.maintenance,{action:'close'},r=>need(r.committed===true&&r.roleDelta===0&&r.gatesClosed===true&&r.hardCheck===true,'CLOSE_UNKNOWN',true),{cleanup:true});
    // Optional containment failure never rolls back the primary closed gates.
    if(closed.containmentOk!==true)cleanup={status:'FAIL',code:'OPTIONAL_CONTAINMENT_FAILED'};
    await observe('P16-final-observe',{final:true,cleanup:true});
    const c=await op('P16-final-catalog',costs.audit,{action:'catalog'},r=>need(r.readOnly&&r.rollback&&r.exactMatch&&r.closed&&r.roleDelta===0,'FINAL_CATALOG_UNKNOWN',true),{cleanup:true});
    const charlie=last.base.security_state.find(x=>x.auth_user_id===CHARLIE),gen=last.base.generations.find(x=>x.key_id===fixture.key_id);
    need(!charlie||!charlie.business_enabled&&charlie.security_hold&&charlie.hold_reason==='administrative','CHARLIE_NOT_CONTAINED',true);
    need(!gen||gen.revoked_at,'GENERATION_NOT_CONTAINED',true);
    if(remaining){need(!state.generationCreated||!!gen?.revoked_at,'OWNED_GENERATION_NOT_CONTAINED',true);need(!state.charlieStateCreated||!!charlie,'OWNED_CHARLIE_STATE_MISSING',true);}
    if(!fatal)need(charlie?.security_epoch===1,'FINAL_EPOCH');
    cleanup??={status:'VERIFIED_CLOSED',charlieEpoch:charlie?.security_epoch??null,generationRevoked:!!gen?.revoked_at};
   }catch(e){cleanup={status:e?.unknown?'UNKNOWN':'FAIL',code:e instanceof DriverStop?e.code:'CLEANUP_UNKNOWN'};}
  }else cleanup={status:'NOT RUN',reason:'No trusted complete P00/P01/driver capability; no write allowed'};
  if(ready||host.trustedCandidate===true)try{await op('P16-stop',{candidate_stop:1},{action:'stopCandidate'},r=>need(r.stopped===true,'CANDIDATE_STOP_UNKNOWN',true),{cleanup:true});}catch{cleanup={...cleanup,status:'UNKNOWN',stopCandidate:'UNKNOWN'};}
  if(remaining&&ready)try{
   await op('P16-independent-final',costs.audit,{action:'independentFinal'},v=>{
    need(v?.readOnly===true&&v.rollback===true,'INDEPENDENT_OBSERVATION_UNKNOWN',true);readReceipt(v);invariant(v,initial,state,plan,{final:true});
    need(v.pid!==initial.pid&&v.pid!==last.pid&&v.independent?.catalogExact===true&&v.independent.closed===true&&v.independent.physicalId==='7706828727995158580','INDEPENDENT_FINAL_NOT_VERIFIED',true);
    need(same(v.base.fingerprints,last.base.fingerprints),'INDEPENDENT_FINAL_STATE_DRIFT',true);
    const ch=v.base.security_state.find(x=>x.auth_user_id===CHARLIE),g=v.base.generations.find(x=>x.key_id===fixture.key_id);
    need(!ch||!ch.business_enabled&&ch.security_hold&&ch.hold_reason==='administrative','CHARLIE_NOT_CONTAINED',true);
    need(!state.generationCreated||!!g?.revoked_at,'OWNED_GENERATION_NOT_CONTAINED',true);need(!state.charlieStateCreated||!!ch,'OWNED_CHARLIE_STATE_MISSING',true);
    if(!fatal)need(ch?.security_epoch===1,'FINAL_EPOCH');last=v;context.last=v;
    journal.record('INDEPENDENT-FINAL-RECONCILED',{pid:v.pid,fingerprints:v.base.fingerprints,readOnly:true,rollback:true,...v.independent});
   },{cleanup:true});
  }catch(e){cleanup={...cleanup,status:'UNKNOWN',code:e instanceof DriverStop?e.code:'INDEPENDENT_FINAL_UNKNOWN'};}
  host.destroySecrets?.();
 }
 const caseResults=Object.fromEntries(plan.steps.filter(s=>!['P00','P01'].includes(s.id)).map(s=>[s.id,s.id==='P16'?cleanup.status:failurePosition?(plan.steps.findIndex(x=>x.id===s.id)<plan.steps.findIndex(x=>x.id===failurePosition)?'COMPLETE':s.id===failurePosition?fatal.status:'NOT RUN'):s.id==='P15'&&expectedUnknown?'UNKNOWN':'COMPLETE']));
 const result={mode,runId,status:cleanup?.status==='UNKNOWN'?'UNKNOWN':fatal?.status??(cleanup?.status==='VERIFIED_CLOSED'?(expectedUnknown?'COMPLETED_EXPECTED_UNKNOWN':'COMPLETE'):'STOP'),failure:fatal,cleanup,usage:meter.used,stepUsage:meter.stepUsed,caseResults,expectedUnknown,p15Request:expectedUnknown?'UNKNOWN':'NOT RUN',realAcceptance:mode==='REAL'?'ONLY_CURRENT_RECEIPTS':'NOT RUN',historicalEvidenceModified:false,...(remaining?{profileScope,oldP04:'UNKNOWN_PRESERVED',...(tail?{oldP10:'UNKNOWN_PRESERVED'}:{}),...(raceOnly?{oldP14:'RUNTIME_COMPLETE_ARCHIVAL_NOT_VERIFIED_PRESERVED',oldP15:'EXPECTED_UNKNOWN_PRESERVED'}:{}),historicalCharged:contract.profile.historicalCharged,newBatchAllocation:true}:{})};
 journal.record('FINAL',result);return result;
}
