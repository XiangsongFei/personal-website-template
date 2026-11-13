// A new execution opportunity, never a resume of either consumed run.
import{resolve}from'node:path';
import{TAIL_SCOPE,loadContract,ALICE,CHARLIE,pins}from'./contract.mjs';
import{readEvidence}from'./remaining.mjs';
import{need,same}from'./state.mjs';
import{budget}from'../s34-budget.mjs';
export function tailContract(){
 const c=loadContract(TAIL_SCOPE),p=c.profile;for(const ref of p.refs)readEvidence(ref);
 const baseline=readEvidence(p.baseline),extra=readEvidence(p.extra),history=readEvidence(p.historyManifest);
 for(const row of history.files)readEvidence({path:resolve(p.historyManifest.path,'..',row.path),sha256:row.sha256},{json:false});
 const row=history.files.find(f=>f.path==='INTENT-FILES-SHA256.json');need(row,'TAIL_INTENT_MANIFEST');
 const ledger=readEvidence({path:resolve(p.historyManifest.path,'..',row.path),sha256:row.sha256});
 for(const f of ledger.files)readEvidence({path:resolve(ledger.root,f.path),sha256:f.sha256},{json:false});
 need(p.runId!==p.historyRunId&&c.fixture.key_id==='s34-r3-clean-20261113-k7','TAIL_OPPORTUNITY');
 need(!baseline.generations.some(g=>g.key_id===c.fixture.key_id)&&c.fixture.proof_slots.length===3&&new Set(c.fixture.proof_slots.map(p=>p.proof_id)).size===3&&c.fixture.proof_slots.every(p=>!baseline.tickets.some(t=>t.proof_id===p.proof_id)),'TAIL_PROOF_REPLAY');
 const b=budget(c.plan);for(const[k,v]of Object.entries({http_edges:87,auth_row_insert_cap:22,auth_control:7,auth_user_get:23,proof_sign:3,registration_tx:3,grant_apply:3,outer_business:13,direct_db:4}))need(b[k]===v,'TAIL_BUDGET_'+k);
 need(c.plan.read_only_audit_transaction_cap===36&&b.explicit_database_transactions===62&&c.plan.auth_row_insert_caps.users===0&&c.plan.auth_row_insert_caps.identities===0,'TAIL_BUDGET');
 need(c.launch.publish_ports.length===0&&c.plan.docker.new_host_port_cap===0,'TAIL_NO_HOST_PUBLISH');
 return {...c,baseline,extra};
}
export function initialTail(snapshot,c){
 const b=snapshot.base;need(same(b.fingerprints,c.baseline.fingerprints)&&same(b.inventories,c.baseline.inventories)&&same(snapshot.authRows,c.extra.authRows)&&same(snapshot.authUserFields,c.extra.authUserFields),'TAIL_BASELINE_DRIFT');
 need(b.meta.system_identifier==='7706828727995158580'&&!b.gates.enabled&&!b.gates.proof_verifier_ready,'TAIL_INITIAL_GATES');
 for(const[actor,uid]of [['Alice',ALICE],['Charlie',CHARLIE]]){
  const actual=b.sessions.filter(s=>s.uid===uid).map(s=>Object.fromEntries(['sid','refresh_count','amr_count','password_amr_count'].map(k=>[k,s[k]])));
  need(same(actual,c.fixture.credential_cascades[actor])&&b.sessions.filter(s=>s.uid===uid).every(s=>s.not_after===null),'TAIL_CASCADE_SCOPE');
 }
 const ch=b.security_state.find(s=>s.auth_user_id===CHARLIE);need(ch&&ch.security_epoch===0&&!ch.business_enabled&&ch.security_hold&&ch.hold_reason==='administrative','TAIL_CHARLIE_CONTAINED');
 need(b.generations.find(g=>g.key_id==='s34-r3-clean-20261113-k6')?.revoked_at&&b.fingerprints.find(f=>f.name==='auth.one_time_tokens')?.row_count===0,'TAIL_PRIOR_TERMINAL');
}
export function tailAuthority(a,c){
 need(a.scope===TAIL_SCOPE&&a.runId===c.profile.runId&&a.remainingProfileSha256===pins.tail_profile_sha256&&a.intentDirectory===c.intentDirectory&&a.candidateName===c.launch.container_name&&a.baselinePath===c.profile.baseline.path&&a.baselineSha256===c.baselineSha256,'TAIL_AUTHORITY');
 need(a.budgetAllocation==='NEW_TAIL_BATCH_NO_HISTORY_REFUND','TAIL_BUDGET_AUTHORIZATION');
 need(a.acceptedEffects?.exactBaselineCredentialCascades===true&&a.acceptedEffects?.reactivateContainedCharlie===true,'TAIL_EFFECT_AUTHORIZATION');
}
