import {need,same,hash} from './state.mjs';
import {pins,ALICE,BOB,CHARLIE,ISSUER,PROJECT} from './contract.mjs';
import {uuid} from '../../../lib/business/protocol.mjs';
const map=a=>Object.fromEntries((a??[]).map(x=>[x.name,x]));
export function candidatePrivileges(c){
 const h=c.HostConfig,empty=v=>v==null||Array.isArray(v)&&v.length===0;
 need(h.Privileged===false&&empty(h.CapAdd)&&empty(h.Devices)&&empty(h.DeviceRequests)&&empty(h.DeviceCgroupRules)&&empty(h.VolumesFrom)&&!h.AutoRemove&&!h.PublishAllPorts,'P01_EXTRA_PRIVILEGE');
 need((h.PidMode??'')===''&&(h.UTSMode??'')===''&&(h.UsernsMode??'')===''&&['','private'].includes(h.IpcMode??'')&&['','private'].includes(h.CgroupnsMode??''),'P01_HOST_NAMESPACE');
 need(same((h.SecurityOpt??[]).map(s=>/^no-new-privileges(?::true|=true)?$/.test(s)?'no-new-privileges':s),['no-new-privileges']),'P01_SECURITY_OPTION');
 need(same([...c.Config.Env].sort(),['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','NODE_VERSION=24.22.1','YARN_VERSION=1.22.22','NODE_ENV=production','TZ=UTC'].sort()),'P01_ENVIRONMENT');
}
export function transport(r){const stream=r?.protocol==='http-uds'?r.stream:r?.tls;need(r?.complete===true&&stream?.readEnd===true&&stream.writeFinish===true&&stream.closed===true&&stream.hadError===false,'TRANSPORT_UNKNOWN',true);}
export function gates(g,mode){
 need(g?.mode===mode&&g.project===PROJECT&&g.physicalId==='7706828727995158580'&&g.daemon==='d47715b7-0a23-49e0-a063-32f98fe1753c','TARGET_GATE');
 for(const k of ['p00','p01','driverReview','image','source','tls','uds','resourceBudget','noHistoricalReplay','serviceBindings'])need(g[k]===true,'GATE_'+k);
 need(g.sourceSha===pins.source_sha&&g.configDigest==='sha256:7514f117ac7ae4c1e8b6e2b6fd3238157322e967eae9c0d53daf6174fe465a76'&&g.imageId==='sha256:49e909c0ea90b04854a897e81f28d3e77ccc697324c2eb9d58ba45521f672fc5','IMAGE_GATE');
}
export function readReceipt(s){need(s?.readOnly===true&&s.rollback===true&&Number.isSafeInteger(s.pid)&&s.pid>0,'READ_RECEIPT_REQUIRED');need(s.base?.meta?.system_identifier==='7706828727995158580'&&s.base.meta.server_version_num==='170011','DATABASE_IDENTITY');}
export function bindIdentity(value,slot,fixture,state,dbNow){
 need(value?.authVerified===true&&value.originalToken===true,'JWT_AUTH_BINDING');transport(value.transport);
 const parts=value.token?.split('.');need(parts?.length===3,'ORIGINAL_JWT_REQUIRED');let header,c;
 try{header=JSON.parse(Buffer.from(parts[0],'base64url'));c=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{need(false,'JWT_FORMAT');}
 const target=fixture.actors[fixture.session_slots[slot].actor];
 need(header.alg==='HS256'&&header.typ==='JWT'&&c.iss===ISSUER&&c.aud==='authenticated'&&c.role==='authenticated'&&c.sub===target.uid&&uuid(c.session_id)&&c.is_anonymous===false&&Number.isSafeInteger(c.exp)&&c.exp>dbNow+30,'JWT_CLAIMS');
 need(value.user?.id===c.sub&&value.user.is_anonymous===false&&!!value.user.email_confirmed_at,'JWT_USER_MISMATCH');
 need(!Object.values(fixture.actors).some(a=>a.historical_sid===c.session_id)&&!Object.values(state.sessions).some(a=>a.sid===c.session_id),'SID_REUSED');
 const methods=c.amr?.map(x=>x.method);need(Array.isArray(methods),'JWT_PURPOSE');
 const recovery=fixture.session_slots[slot].method==='recovery';need(recovery?methods.some(x=>['otp','recovery'].includes(x)):methods.includes('password')&&!methods.some(x=>['otp','recovery'].includes(x)),'JWT_PURPOSE');
 need(!(state.baselineSids??[]).includes(c.session_id),'BASELINE_SID_REUSED');
 const result={uid:c.sub,sid:c.session_id,exp:c.exp,purpose:recovery?'recovery':'password',jwtSha256:hash(value.token)};
 state.sessions[slot]=result;return result;
}
export function invariant(snapshot,initial,state,plan,{final=false}={}){
 readReceipt(snapshot);const b=snapshot.base,old=initial.base;
 if(state.raceOnly){need(same(b.security_state,old.security_state),'P14R_SECURITY_STATE_CHANGED');for(const session of b.sessions){const prior=old.sessions.find(x=>x.sid===session.sid);need(prior?same(session,prior):session.uid===ALICE&&session.not_after===null,'P14R_SESSION_METADATA_CHANGED');}}
 need(b.fingerprints?.length===46&&same(b.inventories,old.inventories),'TABLE_INVENTORY');
 const before=map(old.fingerprints),after=map(b.fingerprints);
 const mutableAuth=new Set(['auth.users','auth.identities','auth.sessions','auth.refresh_tokens','auth.mfa_amr_claims','auth.audit_log_entries','auth.one_time_tokens']);
 for(const [name,value]of Object.entries(before))if(name.startsWith('site_data.')||['site_private.operation_requests','site_private.site_audit_events','site_private.business_proof_keys'].includes(name)||name.startsWith('auth.')&&!mutableAuth.has(name))need(same(after[name],value),'PROTECTED_TABLE_'+name);
 need(same(b.protected_auth?.filter(x=>x.actor==='Bob'),old.protected_auth?.filter(x=>x.actor==='Bob')),'BOB_CHANGED');
 need(same(snapshot.protectedBusiness,initial.protectedBusiness)&&same(snapshot.authStable,initial.authStable),'HISTORICAL_ROW_CHANGED');
 need(Array.isArray(snapshot.authRows)&&snapshot.authUserFields,'AUTH_ROW_RECEIPTS_REQUIRED');
 state.authSeen??=new Map(initial.authRows.map(r=>[r.table+'/'+r.id,{...r,original:true}]));state.authBirths??={};state.authDeletes??={};
 const current=new Map(snapshot.authRows.map(r=>[r.table+'/'+r.id,r]));need(current.size===snapshot.authRows.length,'DUPLICATE_AUTH_ROW');
 const oldSid=state.fixture.actors.Alice.historical_sid,newA1=state.sessions.A1?.sid;
 for(const [key,seen]of state.authSeen){const r=current.get(key);
  if(!r){const allowed=(seen.sid===oldSid&&state.resetIssued)||(state.tail===true&&state.credentialCascadeSids?.includes(seen.sid))||(seen.sid===newA1&&state.a1DeleteIssued)||(seen.table==='one_time_tokens'&&state.recoveryVerifyIssued);need(allowed,'UNAUTHORIZED_AUTH_DELETE');if(!seen.deleted){state.authDeletes[seen.table]=(state.authDeletes[seen.table]??0)+1;need(state.authDeletes[seen.table]<=(plan.auth_row_delete_caps[seen.table]??0),'GROSS_AUTH_DELETE_CAP');seen.deleted=true;}continue;}
  need(!seen.deleted,'AUTH_ROW_RESURRECTED');
  if(state.raceOnly&&['users','identities'].includes(r.table)&&r.uid!==ALICE)need(r.sha===seen.sha,'P14R_OTHER_AUTH_CHANGED');
  if(!['users','identities'].includes(r.table))need(r.sha===seen.sha,'AUTH_ROW_CHANGED');
 }
 for(const [key,r]of current)if(!state.authSeen.has(key)){
  need(r.table in plan.auth_row_insert_caps,'UNEXPECTED_AUTH_TABLE');state.authBirths[r.table]=(state.authBirths[r.table]??0)+1;need(state.authBirths[r.table]<=plan.auth_row_insert_caps[r.table],'GROSS_AUTH_INSERT_CAP');
  if(['users','identities'].includes(r.table))need(r.uid===CHARLIE,'NEW_AUTH_ACTOR_SCOPE');
  else if(r.table==='audit_log_entries')need((state.raceOnly?[ALICE,null,'00000000-0000-0000-0000-000000000000']:[ALICE,CHARLIE,null,'00000000-0000-0000-0000-000000000000']).includes(r.uid),'NEW_AUDIT_ACTOR_SCOPE');
  else if(r.table==='one_time_tokens')need(r.uid===ALICE,'NEW_TOKEN_ACTOR_SCOPE');
  else need(Object.values(state.sessions).some(s=>s.sid===r.sid&&s.uid===r.uid),'NEW_AUTH_SESSION_SCOPE');
  state.authSeen.set(key,{...r,original:false});
 }
 const priorFields=state.authUserFields??initial.authUserFields;
 for(const [uid,fields]of Object.entries(priorFields)){
  const next=snapshot.authUserFields[uid];need(next&&same(Object.keys(fields).sort(),Object.keys(next).sort()),'AUTH_USER_FIELD_INVENTORY');
  const effect=state.authEffect,credentialFields=['encrypted_password','updated_at','recovery_token','recovery_sent_at','reauthentication_token','reauthentication_sent_at','confirmation_token'],allowed=new Set(effect?.uid===uid?({prepareAliceCredential:credentialFields,prepareCharlieCredential:credentialFields,resetAlice:['encrypted_password','updated_at','recovery_token','recovery_sent_at','reauthentication_token','reauthentication_sent_at','confirmation_token'],login:['last_sign_in_at','updated_at'],recover:['recovery_token','recovery_sent_at','updated_at'],verifyRecovery:['recovery_token','recovery_sent_at','updated_at','last_sign_in_at']}[effect.action]??[]):[]);
  for(const [name,digest]of Object.entries(fields))need(digest===next[name]||allowed.has(name),'UNAUTHORIZED_AUTH_USER_FIELD');
 }
 state.authUserFields=structuredClone(snapshot.authUserFields);state.authEffect=null;
 if((b.users??[]).some(u=>u.uid===CHARLIE)){need(/^[a-f0-9]{64}$/.test(snapshot.charlieIdentityStable??''),'CHARLIE_IDENTITY_EVIDENCE');state.charlieIdentityStable??=snapshot.charlieIdentityStable;need(snapshot.charlieIdentityStable===state.charlieIdentityStable,'CHARLIE_IDENTITY_CHANGED');}
 need(same(b.operation_receipts,old.operation_receipts),'HISTORICAL_RECEIPT_CHANGED');
 for(const [table,cap]of Object.entries(plan.auth_row_insert_caps))need((after['auth.'+table]?.row_count??0)-(before['auth.'+table]?.row_count??0)<=cap,'AUTH_ROW_CAP_'+table);
 for(const [table,cap]of Object.entries(plan.auth_row_delete_caps))need((before['auth.'+table]?.row_count??0)-(after['auth.'+table]?.row_count??0)<=cap,'AUTH_DELETE_CAP_'+table);
 for(const [table,cap]of Object.entries(plan.business_insert_caps))need(after['site_private.'+table].row_count-before['site_private.'+table].row_count<=cap,'BUSINESS_ROW_CAP_'+table);
 const allowedSid=new Map(Object.values(state.sessions).map(x=>[x.sid,x.uid]));
 for(const s of b.sessions??[]){if((old.sessions??[]).some(x=>x.sid===s.sid))continue;need(allowedSid.get(s.sid)===s.uid,'UNBOUND_DB_SESSION');}
 for(const [slot,who]of Object.entries(state.sessions)){
  const s=(b.sessions??[]).find(s=>s.sid===who.sid&&s.uid===who.uid);
  if(slot==='A1'&&state.a1DeleteIssued)continue;
  need(s&&s.refresh_count===1&&s.amr_count>=1&&s.amr_count<=(slot==='AR'?2:1)&&s.password_amr_count===(slot==='AR'?0:1),'NEW_SESSION_DEPENDENCIES');
 }
 const oldSessionIds=new Set((old.sessions??[]).map(x=>x.sid));
 for(const s of old.sessions??[])if(!(b.sessions??[]).some(x=>x.sid===s.sid))need(state.tail===true?state.credentialCascadeSids?.includes(s.sid)&&[ALICE,CHARLIE].includes(s.uid):state.resetIssued&&s.uid===ALICE,'HISTORICAL_SESSION_DELETED');
 for(const u of b.users??[])need([ALICE,BOB,CHARLIE].includes(u.uid)&&u.confirmed&&!u.anonymous&&!u.banned_until&&!u.deleted_at,'AUTH_USER_SCOPE');
 need(!(b.users??[]).some(u=>u.uid===CHARLIE)||state.charlieIssued||state.remaining===true&&(old.users??[]).some(u=>u.uid===CHARLIE),'UNEXPECTED_CHARLIE');
 const originals=new Set((old.grants??[]).map(x=>x.id));
 for(const grant of b.grants??[])if(!originals.has(grant.id))need(allowedSid.get(grant.auth_session_id)===grant.auth_user_id&&grant.issuer_version==='r3-ticket-v1:'+plan.new_key_id&&grant.purpose==='business','UNSCOPED_NEW_GRANT');
 for(const g of Object.values(state.grants))need((b.grants??[]).some(x=>x.id===g.id),'NEW_GRANT_DISAPPEARED');
 const proofIds=new Set(state.fixture.proof_slots.map(x=>x.proof_id));
 for(const row of b.tickets??[])if(!(old.tickets??[]).some(x=>x.proof_id===row.proof_id))need(proofIds.has(row.proof_id)&&row.key_id===plan.new_key_id&&allowedSid.get(row.sid)===row.uid,'UNSCOPED_TICKET');
 for(const row of b.proof_receipts??[])if(!(old.proof_receipts??[]).some(x=>x.proof_id===row.proof_id))need(proofIds.has(row.proof_id)&&row.key_id===plan.new_key_id&&row.action==='issue'&&allowedSid.get(row.sid)===row.uid,'UNSCOPED_PROOF');
 for(const row of b.security_state??[])if(!(old.security_state??[]).some(x=>x.auth_user_id===row.auth_user_id))need(row.auth_user_id===CHARLIE&&[0,1].includes(row.security_epoch),'SECURITY_STATE_SCOPE');
 const observedCharlie=b.security_state?.find(x=>x.auth_user_id===CHARLIE);
 if(observedCharlie){need(state.observedCharlieEpoch===undefined||observedCharlie.security_epoch>=state.observedCharlieEpoch,'CHARLIE_EPOCH_REGRESSION');state.observedCharlieEpoch=observedCharlie.security_epoch;}else need(state.observedCharlieEpoch===undefined,'CHARLIE_STATE_DISAPPEARED');
 if(final)need(b.gates.enabled===false&&b.gates.proof_verifier_ready===false,'GATES_NOT_CLOSED');
}
export function sessionInDb(s,slot,state,{missing=false,expired=false}={}){
 const bound=state.sessions[slot];const actual=(s.base.sessions??[]).find(x=>x.sid===bound.sid&&x.uid===bound.uid);
 if(missing){need(!actual,'SESSION_STILL_EXISTS');return;}
 need(actual,'SESSION_NOT_BOUND');const t=Date.parse(s.base.meta.snapshot_time)/1000;
 if(expired)need(actual.not_after&&Date.parse(actual.not_after)/1000<=t,'SESSION_NOT_EXPIRED');
 else need(!actual.not_after||Date.parse(actual.not_after)/1000>t,'SESSION_EXPIRED');
}
export function grantInDb(s,slot,state,{stale=false}={}){
 const who=state.sessions[slot],expected=state.grants[slot];
 const g=(s.base.grants??[]).find(x=>x.id===expected?.id);
 const security=(s.base.security_state??[]).find(x=>x.auth_user_id===who.uid);
 need(g&&g.auth_user_id===who.uid&&g.auth_session_id===who.sid&&g.issuer_version==='r3-ticket-v1:'+state.fixture.key_id&&g.revoked_at===null,'GRANT_BINDING');
 const now=Date.parse(s.base.meta.snapshot_time);need(Date.parse(g.expires_at)>now&&Date.parse(g.absolute_expires_at)>now,'GRANT_EXPIRED');
 need(security&&(stale?security.security_epoch>g.security_epoch:security.security_epoch===g.security_epoch),'GRANT_EPOCH');return g;
}
export function databaseDenial(r,branch,scope,{requireTransport=true}={}){
 if(requireTransport)transport(r.transport);
 need(r.postgrest?.status===403&&(requireTransport?r.outerStatus===403:r.outerStatus===503&&r.clientStatus===503&&r.actualUnknown===true),'NOT_DATABASE_DENIAL');
 need(r.postgrest.code==='42501'&&r.postgrest.codeOrigin==='uds-response-body'&&r.postgrest.udsObserved===true,'POSTGREST_ERROR_SOURCE');
 need(r.requestBinding?.source==='observed-original-jwt-and-uds'&&r.requestBinding.uid===scope.uid&&r.requestBinding.sid===scope.sid&&r.requestBinding.rpc===scope.rpc&&/^[a-f0-9]{64}$/.test(r.requestBinding.jwtSha256??''),'JWT_REQUEST_EVIDENCE');
 const e=r.database;const name=['purpose','session'].includes(branch)?'auth_source_identity':'lock_business_qualification';const pin=pins.frames[name];
 need(e?.source==='postgres-log'&&e.sqlstate==='42501'&&e.function==='site_private.'+name&&e.bodySha256===pin.body_sha256&&e.raiseLine===pin[branch+'_line']&&e.sessionUser==='ecv_s3_internal_api_login'&&e.rpcContextObserved===true&&e.rpc===scope.rpc&&e.uid===scope.uid&&e.sid===scope.sid&&e.unique===true&&Number.isSafeInteger(e.pid)&&e.pid>0,'DB_ATTRIBUTION_UNCONFIRMED');
 need(e.outcome==='DENIED_RESPONSE_OBSERVED','DB_OUTCOME_UNCONFIRMED');
}
export function databaseSuccess(r,scope){
 transport(r.transport);need(r.postgrest?.udsObserved===true&&r.requestBinding?.source==='observed-original-jwt-and-uds'&&r.requestBinding.uid===scope.uid&&r.requestBinding.sid===scope.sid&&r.requestBinding.rpc===scope.rpc,'UDS_SUCCESS_UNCONFIRMED');need(r.outerStatus===200&&r.postgrest?.status===200&&r.database?.source==='postgrest-original-jwt'&&r.database.outcome===(scope.rpc==='apply_business_grant'?'RESPONSE_COMPLETE_AWAITING_RECONCILIATION':'READ_COMPLETED')&&r.database.uid===scope.uid&&r.database.sid===scope.sid&&r.database.rpc===scope.rpc,'DB_SUCCESS_UNCONFIRMED');
}
export function grantCommitted(snapshot,slot,state,proof){
 const g=grantInDb(snapshot,slot,state);const detail=snapshot.receiptMatches?.[proof.proof_id];
 need(detail?.ticketExact===true&&detail.receiptExact===true&&detail.claimsExact===true&&detail.resultExact===true&&detail.consumed===true&&detail.grantId===g.id&&detail.uid===proof.uid&&detail.sid===proof.session_id&&detail.epoch===proof.epoch&&detail.keyId===proof.key_id&&Date.parse(g.expires_at)===Date.parse(state.grants[slot].expiresAt),'GRANT_COMMIT_UNCONFIRMED',true);
}
