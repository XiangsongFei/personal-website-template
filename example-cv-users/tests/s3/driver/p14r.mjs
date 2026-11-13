import{fenceSQL,queueSQL}from'./sql.mjs';
import{raceReadReceipt}from'./race.mjs';
// Minimal independent P14R opportunity. No network or execution at import.
import{resolve}from'node:path';
import{P14R_SCOPE,loadContract,pins,ALICE,CHARLIE}from'./contract.mjs';
import{readEvidence}from'./remaining.mjs';
import{need,same,hash,canonical}from'./state.mjs';
import{budget}from'../s34-budget.mjs';
import{uuid}from'../../../lib/business/protocol.mjs';
import{databaseSuccess}from'./evidence.mjs';
import{utcNanoseconds}from'./time-window.mjs';
export function p14rContract(){
 const c=loadContract(P14R_SCOPE),p=c.profile;for(const ref of p.refs)readEvidence(ref);
 const baseline=readEvidence(p.baseline),extra=readEvidence(p.extra),history=readEvidence(p.historyManifest);
 for(const f of history.files)readEvidence({path:resolve(p.historyManifest.path,'..',f.path),sha256:f.sha256},{json:false});
 const row=history.files.find(f=>f.path==='INTENT-SHA256.json');need(row,'P14R_OLD_INTENTS');const old=readEvidence({path:resolve(p.historyManifest.path,'..',row.path),sha256:row.sha256});for(const f of old.files)readEvidence({path:resolve(old.directory,f.path),sha256:f.sha256},{json:false});
 need(uuid(p.runId)&&p.runId!==p.historyRunId&&c.fixture.key_id==='s34-r3-clean-20261113-k8'&&!baseline.generations.some(g=>g.key_id===c.fixture.key_id),'P14R_NEW_OPPORTUNITY');
 need(c.fixture.proof_slots.length===1&&uuid(c.fixture.proof_slots[0].proof_id)&&c.fixture.proof_slots[0].session_slot==='A1'&&!baseline.tickets.some(t=>t.proof_id===c.fixture.proof_slots[0].proof_id),'P14R_PROOF_REPLAY');
 need(same(Object.keys(c.fixture.session_slots),['A1'])&&c.fixture.session_slots.A1.actor==='Alice'&&c.fixture.preserve_security_state===true,'P14R_ACTOR_SCOPE');
 const b=budget(c.plan);for(const[k,v]of Object.entries({http_edges:28,explicit_database_transactions:27,auth_row_insert_cap:5,auth_control:2,auth_user_get:8,proof_sign:1,registration_tx:1,grant_apply:1,outer_business:4,direct_db:0,maintenance_tx:4,fence_tx:1}))need(b[k]===v,'P14R_BUDGET_'+k);
 need(c.plan.read_only_audit_transaction_cap===17&&c.plan.local_intent_transaction_cap===2&&c.plan.auth_row_insert_caps.users===0&&c.plan.auth_row_insert_caps.identities===0&&c.plan.business_insert_caps.user_security_state===0,'P14R_BUDGET');
 need(c.launch.publish_ports.length===0&&c.plan.docker.new_host_port_cap===0&&c.plan.retry_cap===0&&c.plan.site_create_cap===0,'P14R_BOUNDARY');
 return {...c,baseline,extra};
}
export function initialP14R(snapshot,c){
 const b=snapshot.base;need(same(b.fingerprints,c.baseline.fingerprints)&&same(b.inventories,c.baseline.inventories)&&same(snapshot.authRows,c.extra.authRows)&&same(snapshot.authUserFields,c.extra.authUserFields),'P14R_BASELINE_DRIFT');
 need(same(b.sessions,c.baseline.sessions),'P14R_SESSION_BASELINE_DRIFT');
 need(!b.gates.enabled&&!b.gates.proof_verifier_ready&&b.meta.system_identifier==='7706828727995158580','P14R_CLOSED_BASELINE');
 const a=b.sessions.filter(s=>s.uid===ALICE);need(a.length===1&&a[0].sid===c.fixture.actors.Alice.historical_sid&&a[0].not_after===null&&a[0].refresh_count===1&&a[0].amr_count===1&&a[0].password_amr_count===0,'P14R_ALICE_CASCADE');
 need(same(a.map(s=>Object.fromEntries(['sid','refresh_count','amr_count','password_amr_count'].map(k=>[k,s[k]]))),c.fixture.credential_cascades.Alice),'P14R_CASCADE_SCOPE');
 const state=b.security_state.find(s=>s.auth_user_id===ALICE),ch=b.security_state.find(s=>s.auth_user_id===CHARLIE);
 need(state?.security_epoch===0&&state.business_enabled&&!state.security_hold&&state.hold_reason==='none'&&ch?.security_epoch===1&&!ch.business_enabled&&ch.security_hold&&ch.hold_reason==='administrative','P14R_QUALIFICATION_BASELINE');
 need(b.generations.find(g=>g.key_id==='s34-r3-clean-20261113-k7')?.revoked_at&&b.fingerprints.find(f=>f.name==='auth.one_time_tokens')?.row_count===0,'P14R_PRIOR_TERMINAL');
}
export function p14rAuthority(a,c){
 need(a.scope===P14R_SCOPE&&a.runId===c.profile.runId&&a.remainingProfileSha256===pins.p14r_profile_sha256&&a.intentDirectory===c.intentDirectory&&a.candidateName===c.launch.container_name&&a.baselinePath===c.profile.baseline.path&&a.baselineSha256===c.baselineSha256,'P14R_AUTHORITY');
 need(a.budgetAllocation==='NEW_P14R_BATCH_NO_HISTORY_REFUND','P14R_BUDGET_AUTHORIZATION');
 need(a.acceptedEffects?.preserveCharlieAndBob===true&&a.acceptedEffects?.exactAliceRecoveryCascade===true&&a.acceptedEffects?.existingCharlieCredentialUpdate===false&&a.acceptedEffects?.charlieFixtureAndContainment===false,'P14R_EFFECT_AUTHORIZATION');
}
export function p14rRaceEvidence(r,{uid,sid,jwtSha256,dispatchId,revocationSqlSha256,siteId}){
 const a=r.safeReceipt,q=a?.queue,b=a?.read?.requestBinding,t=a?.read?.udsEvidence;
 need(a&&same(a.read,raceReadReceipt(r.read)),'P14R_READ_ARCHIVE');
 need(a.read.resultSummary?.schemaVersion===1&&a.read.resultSummary.siteId===siteId&&a.read.resultSummary.canRead===true,'P14R_OWNER_ARCHIVE');
 databaseSuccess(a.read,{uid,sid,rpc:'get_my_site'});
 need(b?.uid===uid&&b.sid===sid&&b.rpc==='get_my_site'&&b.dispatchId===dispatchId&&b.jwtSha256===jwtSha256&&b.requestSha256===hash('{}')&&t?.complete===true&&t.dispatchId===dispatchId&&t.jwtSha256===jwtSha256&&t.uid===uid&&t.sid===sid&&t.rpc==='get_my_site'&&t.requestSha256===hash('{}')&&t.status===200&&t.requestBytes===2&&t.socketPath==='/run/clean-internal/postgrest.sock'&&t.contentType==='application/json'&&Number.isSafeInteger(t.seq)&&t.seq>0&&Number.isFinite(t.startedAt)&&Number.isFinite(t.finishedAt)&&t.finishedAt>=t.startedAt&&a.read.postgrest.responseSha256===t.responseSha256&&t.responseBytes>=2&&/^[a-f0-9]{64}$/.test(t.responseSha256??''),'P14R_READ_BINDING');
 const locked=q?.observedLocks,read=locked?.find(x=>x.pid===q.readPid),revoke=locked?.find(x=>x.pid===q.revokePid);
 need(q?.readOnly&&q.rollback&&[q.observerPid,q.fencePid,q.readPid,q.revokePid].every(x=>Number.isSafeInteger(x)&&x>0)&&new Set([q.fencePid,q.observerPid,q.readPid,q.revokePid]).size===4&&q.classid===3303&&q.objid===5&&q.objsubid===2&&locked?.length===3&&locked.some(x=>x.pid===q.fencePid&&x.role==='postgres'&&x.mode==='ExclusiveLock'&&x.granted===true)&&read?.role==='ecv_s3_internal_api_login'&&read.mode==='ShareLock'&&!read.granted&&read.blockers.includes(q.fencePid)&&revoke?.role==='postgres'&&revoke.mode==='ExclusiveLock'&&!revoke.granted&&revoke.blockers.includes(q.fencePid),'P14R_QUEUE_ARCHIVE');
 need(read.waitstart===q.readWaitStart&&revoke.waitstart===q.revokeWaitStart&&utcNanoseconds(read.waitstart)<utcNanoseconds(revoke.waitstart)&&q.readQueuedFirst&&q.bothBlocked&&q.waitBoundMs<=3000,'P14R_LOCK_ORDER');
 need(a.revoke?.committed&&a.revoke.roleDelta===0&&same(a.revoke.nativePrepared,{prepared:true,roleDelta:0,pid:q.revokePid})&&a.revoke.pid===q.revokePid&&a.revoke.carrier?.code===0&&a.revoke.carrier.stderrSha256===hash('')&&a.revoke.prepared===true&&a.revoke.commandTags?.at(-1)==='COMMIT'&&a.revoke.commandTags.includes('REVOKE ROLE')&&a.revoke.commandTags.includes('UPDATE 1')&&a.revoke.commandTags.includes('GRANT ROLE')&&a.revoke.sqlSha256===revocationSqlSha256&&hash(a.revoke.sqlText??'')===revocationSqlSha256&&/^[a-f0-9]{64}$/.test(a.revoke.responseSha256??'')&&a.fence?.rollback&&a.fence.pid===q.fencePid&&a.observer?.pid===q.observerPid&&a.fence.code===0&&a.fence.commandTags?.at(-1)==='ROLLBACK'&&a.fence.stderrSha256===hash('')&&a.fence.sqlText===fenceSQL&&hash(a.fence.sqlText??'')===a.fence.sqlSha256&&a.observer?.rollback&&a.observer.code===0&&a.observer.commandTags?.at(-1)==='ROLLBACK'&&a.observer.stderrSha256===hash('')&&a.observer.snapshotSql===queueSQL&&hash(a.observer.snapshotSql??'')===a.observer.snapshotSqlSha256,'P14R_REVOKE_COMMIT_ARCHIVE');
 return {status:'PASS',binding:b,readPid:q.readPid,revokePid:q.revokePid,observerPid:q.observerPid,fencePid:q.fencePid,receiptSha256:hash(canonical(a)),databaseOrdering:'shared-lock-held-before-exclusive-revoke-with-native-commit-and-independent-state'};
}
