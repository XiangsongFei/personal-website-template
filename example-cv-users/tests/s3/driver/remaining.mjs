import{p14rContract,initialP14R,p14rAuthority}from'./p14r.mjs';
import{tailContract,initialTail,tailAuthority}from'./tail.mjs';
// Immutable, source-pinned continuation contract. This file performs no I/O
// other than reading existing evidence, and never grants execution authority.
import{readFileSync,lstatSync,realpathSync}from'node:fs';import{resolve}from'node:path';
import{loadContract,REMAINING_SCOPE,ALICE,BOB,CHARLIE,pins,TAIL_SCOPE,P14R_SCOPE,isContinuation,profilePin}from'./contract.mjs';import{hash,need,same,canonical}from'./state.mjs';import{budget}from'../s34-budget.mjs';import{uuid}from'../../../lib/business/protocol.mjs';
export function readEvidence(ref,{json=true}={}){const s=lstatSync(ref.path);need(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.uid===process.getuid()&&s.size<=4*1024*1024&&realpathSync(ref.path)===resolve(ref.path),'REMAINING_EVIDENCE_FILE');const raw=readFileSync(ref.path);need(hash(raw)===ref.sha256,'REMAINING_EVIDENCE_CHANGED');return json?JSON.parse(raw):raw;}
export function remainingContract(scope=REMAINING_SCOPE){
 if(scope===P14R_SCOPE)return p14rContract();
 if(scope===TAIL_SCOPE)return tailContract();
 const c=loadContract(REMAINING_SCOPE),p=c.profile;for(const ref of p.refs)readEvidence(ref);
 const baseline=readEvidence(p.baseline),extra=readEvidence(p.extra),history=readEvidence(p.historyManifest);
 const legacyIntentsRef=history.files.find(f=>f.path==='INTENT-SHA256.json');need(legacyIntentsRef,'HISTORICAL_INTENT_MANIFEST_REQUIRED');
 const legacyIntents=readEvidence({path:resolve(p.historyManifest.path,'..',legacyIntentsRef.path),sha256:legacyIntentsRef.sha256});
 for(const f of legacyIntents.files)readEvidence({path:resolve(legacyIntents.directory,f.path),sha256:f.sha256},{json:false});
 for(const f of history.files)readEvidence({path:resolve(p.historyManifest.path,'..',f.path),sha256:f.sha256},{json:false});
 need(uuid(p.runId)&&p.runId!==p.historyRunId&&c.fixture.key_id==='s34-r3-clean-20261113-k6','REMAINING_RUN_IDENTITY');
 need(c.fixture.proof_slots.length===3&&new Set(c.fixture.proof_slots.map(s=>s.proof_id)).size===3&&c.fixture.proof_slots.every(s=>uuid(s.proof_id)&&!(baseline.tickets??[]).some(t=>t.proof_id===s.proof_id)),'REMAINING_PROOF_REPLAY');
 need(!baseline.generations.some(g=>g.key_id===c.fixture.key_id)&&c.fixture.actors.Charlie.must_be_absent===false,'REMAINING_QUALIFICATION');
 const b=budget(c.plan);for(const[k,v]of Object.entries({http_edges:191,explicit_database_transactions:96,auth_row_insert_cap:30,auth_control:9,auth_user_get:57,proof_sign:3,registration_tx:3,grant_apply:3,outer_business:29,direct_db:4}))need(b[k]===v,'REMAINING_BUDGET');
 need(c.plan.read_only_audit_transaction_cap===50&&c.plan.auth_row_insert_caps.users===0&&c.plan.auth_row_insert_caps.identities===0,'REMAINING_BUDGET');
 return {...c,baseline,extra};
}
export function initialRemaining(snapshot,c){
 if(c.profile.scope===P14R_SCOPE)return initialP14R(snapshot,c);
 if(c.profile.scope===TAIL_SCOPE)return initialTail(snapshot,c);
 const b=snapshot.base,old=c.baseline;need(same(b.fingerprints,old.fingerprints)&&same(b.inventories,old.inventories),'REMAINING_BASELINE_DRIFT');
 need(b.meta.system_identifier==='7706828727995158580'&&!b.gates.enabled&&!b.gates.proof_verifier_ready,'REMAINING_INITIAL_GATES');
 const a=b.sessions.filter(s=>s.uid===ALICE);need(a.length===1&&a[0].sid===c.fixture.actors.Alice.historical_sid&&a[0].not_after===null&&a[0].refresh_count===1&&a[0].amr_count===1&&a[0].password_amr_count===1,'REMAINING_ALICE_CASCADE');
 need(b.users.filter(u=>u.uid===CHARLIE&&u.confirmed&&!u.anonymous&&!u.deleted_at&&!u.banned_until).length===1&&!b.sessions.some(s=>s.uid===CHARLIE)&&!b.security_state.some(s=>s.auth_user_id===CHARLIE)&&!b.grants.some(g=>g.auth_user_id===CHARLIE),'REMAINING_CHARLIE_STATE');
 need(!b.generations.some(g=>g.key_id===c.fixture.key_id)&&!b.tickets.some(t=>c.fixture.proof_slots.some(p=>p.proof_id===t.proof_id)),'REMAINING_ALREADY_CONSUMED');
 need(b.fingerprints.find(x=>x.name==='auth.one_time_tokens')?.row_count===0,'REMAINING_TOKEN_STATE');
 need(same(snapshot.authUserFields,c.extra.authUserFields)&&same(snapshot.authRows,c.extra.authRows),'REMAINING_AUTH_ROW_DRIFT');
}
export function credentialReconciled(before,after,uid,c){
 const a=before.authUserFields[uid],b=after.authUserFields[uid];need(a&&b&&a.encrypted_password!==b.encrypted_password,'CREDENTIAL_UPDATE_UNCONFIRMED',true);
 need(!after.base.sessions.some(s=>s.uid===uid),'CREDENTIAL_SESSION_CASCADE_UNCONFIRMED',true);
 const other=uid===ALICE?CHARLIE:ALICE;need(same(before.authUserFields[other],after.authUserFields[other]),'OTHER_CREDENTIAL_CHANGED');
 need(!after.base.sessions.some(s=>s.uid===uid&&s.sid===c.fixture.actors.Bob.historical_sid),'CREDENTIAL_SCOPE');
}
export function dispatchId(runId,operation){need(uuid(runId)&&typeof operation==='string','DISPATCH_ID');const s=hash(runId+'\n'+operation).slice(0,32);return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
export function remainingAuthority(a,c){
 if(c.profile.scope===P14R_SCOPE)return p14rAuthority(a,c);
 if(c.profile.scope===TAIL_SCOPE)return tailAuthority(a,c);
 need(a.scope===REMAINING_SCOPE&&a.runId===c.profile.runId&&a.remainingProfileSha256===pins.remaining_profile_sha256&&a.intentDirectory===c.intentDirectory&&a.candidateName===c.launch.container_name&&a.baselinePath===c.profile.baseline.path&&a.baselineSha256===c.baselineSha256,'REMAINING_AUTHORITY');
 need(a.budgetAllocation==='NEW_BATCH_191_96_NO_HISTORY_REFUND','REMAINING_BUDGET_AUTHORIZATION');
}
export function historyReferences(c){if(c.profile.scope===P14R_SCOPE)return{runId:c.profile.historyRunId,manifest:c.profile.historyManifest,reuse:c.profile.reuse,oldP04:'UNKNOWN_PRESERVED',oldP10:'UNKNOWN_PRESERVED',oldP14:'RUNTIME_COMPLETE_ARCHIVAL_NOT_VERIFIED_PRESERVED',oldP15:'EXPECTED_UNKNOWN_PRESERVED',newCase:'P14R',historicalCharged:c.profile.historicalCharged};return {...(c.profile.scope===TAIL_SCOPE?{reuse:c.profile.reuse,oldP10:'UNKNOWN_PRESERVED',newCase:'P10R'}:{}),runId:c.profile.historyRunId,manifest:c.profile.historyManifest,checkpoint:c.profile.checkpoint,reuse:c.profile.scope===TAIL_SCOPE?c.profile.reuse:['P02','P03','P04-login-A1','P04-register-A1','P04-apply-A1','P04-get_my_site','P04-read_introduction'],oldP04:'UNKNOWN_PRESERVED',newCase:c.profile.scope===TAIL_SCOPE?'P10R':'P04R',lookupOnly:c.fixture.alice_receipt_read.request_id,createSiteDispatch:0,historicalCharged:c.profile.historicalCharged};}
