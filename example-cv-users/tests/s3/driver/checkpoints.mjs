// Evidence-only checkpoints. NO dispatch/resume/capability is exported here.
import {need,same} from './state.mjs';
import {ALICE,BOB,CHARLIE} from './contract.mjs';
import {budget} from '../s34-budget.mjs';
import {uuid} from '../../../lib/business/protocol.mjs';
export const OLD_RUN='3be23b0a-fd44-45cd-bf6e-ecbddb84dbf1';
export const OLD_MANIFEST='e3d958d333c32f29cdb2d4f45c00d6368ccbbf834ab10692a4dd46ef26b9e1fe';
export function checkpoint({historical,prior,current,details,refs}){
 need(historical.runId===OLD_RUN&&historical.status==='UNKNOWN_PRESERVED_STOP_AFTER_WRITE'&&historical.cases.P04==='UNKNOWN','HISTORICAL_STATUS');
 need(historical.cases.P02==='COMPLETE'&&historical.cases.P03==='COMPLETE'&&historical.cases.P16==='VERIFIED_CLOSED'&&historical.safeClosure==='VERIFIED_CLOSED'&&historical.bobAllUnchanged===true,'HISTORICAL_COMMIT_EVIDENCE');
 need(['P04-login-A1','P04-register-A1','P04-apply-A1 COMMIT_RECONCILED','P04-get_my_site','P04-read_introduction'].every(x=>historical.subcasePass?.includes(x)),'HISTORICAL_SUBCASE_EVIDENCE');
 need(current.meta.read_only==='on'&&current.meta.system_identifier==='7706828727995158580'&&same(current.fingerprints,prior.fingerprints)&&Object.keys(current.fingerprints).length===46,'CHECKPOINT_STATE_DRIFT');
 need(!current.gates.enabled&&!current.gates.proof_verifier_ready,'CHECKPOINT_GATES');
 const alice=current.sessions.filter(s=>s.uid===ALICE||s.user_id===ALICE),charlie=current.users.find(u=>u.uid===CHARLIE),grant=current.grants.find(g=>g.id===historical.newGrantId);
 need(charlie&&!current.security_state.some(s=>s.auth_user_id===CHARLIE)&&grant&&grant.revoked_at===null,'CHECKPOINT_FIXTURE_DRIFT');
 const gf=details.grantFlags.find(g=>g.id===grant.id);need(gf?.generationRevoked&&gf.expired,'CHECKPOINT_GRANT_STATE');
 const proof=current.proof_receipts.find(p=>p.proof_id==='1084ab57-f716-4a2f-90db-c5aa315da34f'),generation=current.generations.find(g=>g.key_id==='s34-r3-clean-20261112-k5');
 need(grant.auth_user_id===ALICE&&proof?.uid===ALICE&&proof.sid===grant.auth_session_id&&proof.consumed_at&&proof.key_id===generation?.key_id&&generation.revoked_at&&grant.issuer_version==='r3-ticket-v1:'+generation.key_id,'CHECKPOINT_PROOF_BINDING');
 need(details.aliceReceipt?.state==='succeeded'&&details.aliceReceipt.defaultLocale==='en','CHECKPOINT_RECEIPT');
 need(Array.isArray(refs)&&refs.length>=3&&refs.every(r=>typeof r.path==='string'&&/^[a-f0-9]{64}$/.test(r.sha256)),'CHECKPOINT_REFERENCES');
 const operations=[
  ['P02-reset','PASS','NEVER_REDISPATCH','Alice password reset and old-session cascade committed'],
  ['P02-create','PASS','NEVER_REDISPATCH','Charlie user already exists'],
  ['P03-generation','PASS','NEVER_REDISPATCH','k5 created then permanently revoked'],
  ['P03-open','PASS','EVIDENCE_ONLY','historical open; current double gates closed'],
  ['P04-login-A1','PASS','EVIDENCE_ONLY','session row survives; original JWT/password unavailable'],
  ['P04-register-A1','PASS','NEVER_REDISPATCH','proof registered and intent consumed'],
  ['P04-apply-A1','PASS','NEVER_REDISPATCH','COMMIT_RECONCILED; current Grant unusable'],
  ['P04-get_my_site','PASS','REUSE_EVIDENCE','historical positive at recorded identity/state'],
  ['P04-read_introduction','PASS','REUSE_EVIDENCE','historical positive at recorded identity/state'],
  ['P04-read_create_operation','UNKNOWN','PRESERVE_UNKNOWN','400 parser mismatch; database permission NOT VERIFIED'],
  ...Array.from({length:11},(_,i)=>['P'+String(i+5).padStart(2,'0'),'NOT RUN','REQUIRE_FRESH_FIXTURE','requires a new authorized batch']),
  ['P16','PASS','EVIDENCE_ONLY','historical VERIFIED_CLOSED; repeat current closure check before new writes']
 ].map(([id,status,disposition,note])=>({id,status,disposition,note,runId:OLD_RUN,evidence:refs.map(r=>r.path),...(id.startsWith('P04')?{binding:{uid:ALICE,sid:grant.auth_session_id,grantId:grant.id,proofId:proof.proof_id,keyId:proof.key_id,targetSiteId:details.aliceReceipt.siteId,operationRequestId:details.aliceReceipt.requestId}}:{})}));
 return {version:1,status:'EVIDENCE_CHECKPOINT_NOT_EXECUTABLE',historicalRunId:OLD_RUN,operations,refs,identities:{aliceUid:ALICE,bobUid:BOB,charlieUid:CHARLIE,aliceSessions:alice.map(s=>s.sid),grantId:grant.id,grantRowRevokedAt:grant.revoked_at,generationRevoked:gf.generationRevoked,grantExpired:gf.expired,charlieSecurityState:'ABSENT',rawCredentials:'NOT_PERSISTED'},state:{fingerprints:current.fingerprints,receipt:details.aliceReceipt,proof,generation,usedProofIds:current.tickets.map(t=>t.proof_id),intentRecords:historical.intentRecords},charged:historical.budgetCharged,realExecution:'NOT AUTHORIZED',legacyFullRun:'BLOCKED_CONSUMED_FIXTURES'};
}
export function continuationBudget(plan,charged){
 const original=budget(plan),next={...original,normal_reads:original.normal_reads-2};
 // Skip only the two P04 positive reads already proved by the old run.
 for(const[k,n]of Object.entries({outer_business:2,auth_user_get:4,auth_client:4,auth_internal_hop:4,private_mtls:2,postgrest_uds:2,http_edges:12,explicit_database_transactions:2,auth_row_insert_cap:2}))next[k]-=n;
 const cumulative=Object.fromEntries(Object.entries(next).map(([k,n])=>[k,n+(charged[k]??0)]));
 const ceilings={http_edges:203,explicit_database_transactions:98,read_only_audit:50,local_intent:6,auth_row_insert_cap:32,outer_business:31,direct_db:4,proof_sign:3,registration_tx:3,grant_apply:3,auth_control:9,auth_user_get:61};
 // plan arithmetic exposes the RO cap separately rather than as a slot.
 next.read_only_audit=plan.read_only_audit_transaction_cap;next.local_intent=6;
 cumulative.read_only_audit=next.read_only_audit+(charged.read_only_audit??0);cumulative.local_intent=6+(charged.local_intent??0);
 const over=Object.keys(ceilings).filter(k=>cumulative[k]>ceilings[k]);
 need(Object.entries(ceilings).every(([k,v])=>Number.isSafeInteger(next[k])&&next[k]>=0&&next[k]<=v),'CONTINUATION_BATCH_OVER_LIMIT');
 return {status:'PROPOSED_NEW_BATCH_NOT_AUTHORIZED',next,cumulative,ceilings,overOldCumulativeCap:over,budgetCanResumeOldBatch:over.length===0,windowMs:1200000,cleanupReserveMs:90000,automaticRetries:0,newSites:0,authCreates:0,authPasswordUpdates:2,proofGroups:3,requirements:['new explicit batch allocation; old charges never refunded','Alice current A1 cascade must be explicitly accepted','Charlie existing-account password update; never create again','new generation, three new proof IDs and Intent namespace','implement and review state-aware execution profile before REAL use']};
}
export function continuationPlan(c,{runId,consumedRunIds,fixtureIds},b){
 need(c.status==='EVIDENCE_CHECKPOINT_NOT_EXECUTABLE'&&c.historicalRunId===OLD_RUN,'CHECKPOINT_REQUIRED');
 need(uuid(runId)&&runId!==OLD_RUN&&!consumedRunIds.includes(runId),'RUN_ALREADY_USED');
 need(Array.isArray(fixtureIds)&&fixtureIds.length===3&&new Set(fixtureIds).size===3&&fixtureIds.every(x=>uuid(x)&&!c.state.usedProofIds.includes(x)&&!['1084ab57-f716-4a2f-90db-c5aa315da34f','2822a7a9-e098-44c0-8e11-a4117152b5b1','d0d65720-4d52-4ee7-9aa4-2ed7776f445a'].includes(x)),'FRESH_PROOF_IDS');
 return {version:1,status:'PLAN_ONLY_NOT_EXECUTABLE',runId,fixtureIds,checkpointRefs:c.refs,budget:b,sequence:['fresh offline/CLI gate, P00, P01, dynamic gates','authorized Alice and Charlie credential reset; no Auth creation','new generation and gates; new A1N login/Proof/Grant','P04R corrected receipt read; preserve old P04 UNKNOWN; skip old mine/introduction positives','P05 A2, P06 C0 absent-state then initCharlie','P07 C1 Proof/Grant no site; P08 hold; P09 disabled','P10 real Recovery; P11 expire A1N; P12 delete only A1N','P13 epoch 0->1, C2 Proof/Grant; P14 race/revoke; P15 last fault/UNKNOWN','P16 close, revoke new generation, Charlie disabled+hold, restore roles/CHECK, stop, independent 46-table reconciliation'],blocks:['CURRENT AUTHORIZATION DOES NOT ALLOW WRITES','LEGACY ENGINE MUST NOT BE RUN FROM THIS CHECKPOINT','state-aware execution profile, new exact fixture/CAS baseline and budget authorization required'],historicalUnknown:'PRESERVED',dispatchEnabled:false};
}
