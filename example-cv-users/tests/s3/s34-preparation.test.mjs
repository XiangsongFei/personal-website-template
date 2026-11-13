import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {budget} from './s34-budget.mjs';
import {createHash} from 'node:crypto';
const plan=JSON.parse(readFileSync(new URL('./s34-execution-plan.json',import.meta.url)));
test('sealed per-step request and transaction slots sum without transferable spare budget',()=>{
 assert.deepEqual(budget(plan),{normal_reads:25,recovery_reads:3,grant_apply:3,direct_db:4,auth_control:9,auth_user_fresh:5,
  proof_sign:3,registration_tx:3,maintenance_tx:12,mail_http:3,fence_tx:1,
  outer_business:31,auth_user_get:61,auth_client:70,auth_internal_hop:70,private_mtls:28,postgrest_uds:32,http_edges:203,
  explicit_database_transactions:98,auth_row_insert_cap:32,business_row_insert_cap:11});
 assert.equal(plan.steps.length,17);assert.equal(plan.steps.at(-2).id,'P15');assert.equal(plan.steps.at(-1).id,'P16');
 assert.equal(plan.site_create_cap,0);assert.equal(plan.retry_cap,0);assert.equal(plan.renew_cap,0);
 assert.equal(plan.status,'PREPARED_NOT_AUTHORIZED');assert.equal(plan.current_live,'NOT RUN');
 assert.equal(plan.docker.existing_resource_mutation_cap,0);
 assert.equal(plan.docker.image_import_cap,0);assert.equal(plan.docker.image_pull_cap,0);
 assert.equal(plan.docker.new_host_port_cap,1);assert.equal(plan.docker.new_endpoint_on_existing_api_network_cap,1);
 assert.equal(plan.intent_ledger.preapproval_transaction_cap+plan.intent_ledger.claim_transaction_cap,6);
 const invalid=structuredClone(plan);invalid.steps[0].slots.normal_reads=-1;assert.throws(()=>budget(invalid),/BUDGET_INVALID/);
});
test('fixture identities, one-shot proof slots and late-bound SID rules are frozen',()=>{
 const raw=readFileSync(new URL('./s34-fixture-contract.json',import.meta.url));
 assert.equal(createHash('sha256').update(raw).digest('hex'),plan.fixture_contract.sha256);
 const fixture=JSON.parse(raw);
 assert.equal(fixture.target,plan.target);assert.equal(fixture.status,'PREPARED_NOT_AUTHORIZED');
 assert.equal(fixture.actors.Charlie.uid,'a33c0000-0000-4000-8000-000000000003');
 assert.equal(fixture.actors.Bob.mutation_cap,0);assert.equal(fixture.destructive_bounds.explicit_session_delete_slot,'A1');
 assert.deepEqual(fixture.new_sid_binding.preallocated_sids,[]);
 assert.equal(Object.keys(fixture.session_slots).length,6);
 assert.equal(fixture.proof_slots.length,3);assert.equal(new Set(fixture.proof_slots.map(x=>x.proof_id)).size,3);
 assert.deepEqual(fixture.proof_slots.map(x=>x.session_slot),['A1','C1','C2']);
 for(const slot of fixture.proof_slots)assert.match(slot.proof_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(fixture.key_id,plan.new_key_id);assert.equal(fixture.secrets_in_file,0);
 assert.deepEqual(fixture.charlie_initial_state,{security_epoch:0,business_enabled:true,security_hold:false,hold_reason:'none'});
 assert.equal(fixture.single_predicate_cases.P08.hold_reason,'none');
 assert.deepEqual(plan.maintenance_role_scope.roles,['ecv_s3_owner','ecv_s3_grant_writer']);
 assert.equal(plan.maintenance_role_scope.persistent_membership_delta_cap,0);
 assert.equal(plan.maintenance_role_scope.admin_option,false);assert.equal(plan.maintenance_role_scope.set_option,false);
});
test('new lifecycle destructive effects remain specifically bounded, historical evidence is not relabelled',()=>{
 assert.equal(plan.auth_row_delete_caps.sessions,2);assert.equal(plan.business_insert_caps.proof_generations,1);
 assert(plan.historical_immutable.some(x=>x.includes('UNKNOWN/CONSUMED')));
 assert(plan.special_approval.some(x=>x.includes('old SID')));
 assert(plan.special_approval.some(x=>x.includes('newly created Alice A1')));
 assert(plan.special_approval.some(x=>x.includes('final enabled=false hold=true')));
 assert.equal(plan.certificate_gate.require_remaining_seconds,1200);
 assert(plan.deferred_not_pass.some(x=>x.includes('fault atomicity')));
});
