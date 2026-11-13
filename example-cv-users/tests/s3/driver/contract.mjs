import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {hash,need} from './state.mjs';
export const root=new URL('../../../',import.meta.url);
export const pins=JSON.parse(readFileSync(new URL('./pins.json',import.meta.url)));
export const WORK_ROOT=resolve(fileURLToPath(root),pins.fixture_mode==='OFFLINE_SYNTHETIC_NOT_EXECUTION_AUTHORITY'?'.s34-fixtures/work':'../..');
const read=n=>readFileSync(new URL(n,root));
export const P14R_SCOPE='S34-P14R-P16';
export const TAIL_SCOPE='S34-TAIL-P10R-P16';
export const isContinuation=scope=>[REMAINING_SCOPE,TAIL_SCOPE,P14R_SCOPE].includes(scope);
export const profilePin=scope=>scope===P14R_SCOPE?pins.p14r_profile_sha256:scope===TAIL_SCOPE?pins.tail_profile_sha256:pins.remaining_profile_sha256;
export const REMAINING_SCOPE='S34-REMAINING-P04R-P16';
export function loadContract(scope){
 const planRaw=read('tests/s3/s34-execution-plan.json'),fixtureRaw=read('tests/s3/s34-fixture-contract.json'),frozenRaw=read('tests/s3/clean-candidate/frozen.json');
 need(hash(planRaw)===pins.plan_sha256&&hash(fixtureRaw)===pins.fixture_sha256&&hash(frozenRaw)===pins.candidate_frozen_sha256,'CONTRACT_CHANGED');
 const result={plan:JSON.parse(planRaw),fixture:JSON.parse(fixtureRaw),frozen:JSON.parse(frozenRaw),launch:JSON.parse(read('tests/s3/clean-candidate/launch.json')),baselineSha256:pins.baseline_sha256,intentDirectory:pins.intent_directory};
 if(isContinuation(scope)){const raw=read(scope===P14R_SCOPE?'tests/s3/driver/p14r-profile.json':scope===TAIL_SCOPE?'tests/s3/driver/tail-profile.json':'tests/s3/driver/remaining-profile.json');need(hash(raw)===profilePin(scope),'REMAINING_PROFILE_CHANGED');const profile=JSON.parse(raw);need(profile.version===1&&profile.scope===scope&&profile.status==='PREPARED_NOT_AUTHORIZED','REMAINING_PROFILE');return {...result,profile,plan:profile.plan,fixture:profile.fixture,launch:profile.launch,baselineSha256:profile.baseline.sha256,intentDirectory:profile.intentDirectory};}
 need(scope===undefined||['S34-P02-P16','S34-P01-ONLY'].includes(scope),'EXECUTION_SCOPE');return result;
}
export const PROJECT='ecv-r3-clean-20261111-e449c25f';
export const DB='cfde27517d74c30716cdd6e71d520ef2a040c13d40da60677dfe5a5ce5324e2e';
export const API='e78a596419e51174a5a03c572a3b0d48b9fa2f40ad3fbf280c231d898867c2e8';
export const AUTH='56835f2ef26b2fe0169d913ce7a8d9cbdd5b42b633688e73f650e34e8719d034';
export const REG='45e0e7f1ba82f652431bf853e87650d40d06d0fff8537d3618e03eeb59457a85';
export const GATEWAY='1fd87092095c9e42691082ad091092a70c0dce88b79d99fe92731245c61d72ac';
export const OLD_NODE='b75d0aeea7e5b66287c1b526289297d877cb5113759448a908c079c3ae3d63cf';
export const ISSUER='http://gateway.'+PROJECT+'.internal.test:8000/auth/v1';
export const ALICE='a33c0000-0000-4000-8000-000000000001',BOB='a33c0000-0000-4000-8000-000000000002',CHARLIE='a33c0000-0000-4000-8000-000000000003';
export const costs={
 login:{auth_control:1,auth_user_fresh:1,auth_user_get:1,auth_client:2,auth_internal_hop:2,http_edges:4},
 normal:{normal_reads:1,outer_business:1,auth_user_get:2,auth_client:2,auth_internal_hop:2,private_mtls:1,postgrest_uds:1,http_edges:6,explicit_database_transactions:1},
 recovery:{recovery_reads:1,outer_business:1,auth_user_get:1,auth_client:1,auth_internal_hop:1,http_edges:2},
 direct:{direct_db:1,postgrest_uds:1,http_edges:1,explicit_database_transactions:1},
 control:{auth_control:1,auth_client:1,auth_internal_hop:1,http_edges:2},
 apply:{grant_apply:1,outer_business:1,auth_user_get:1,auth_client:1,auth_internal_hop:1,private_mtls:1,postgrest_uds:1,http_edges:4,explicit_database_transactions:1},
 registration:{proof_sign:1,registration_tx:1,explicit_database_transactions:1,local_intent:1},
 maintenance:{maintenance_tx:1,explicit_database_transactions:1},audit:{read_only_audit:1,explicit_database_transactions:1},
 mail:{mail_http:1,http_edges:1},fence:{fence_tx:1,explicit_database_transactions:1},intent:{local_intent:1}
};
export const authRows={reset:{auth_insert_audit_log_entries:1,auth_delete_sessions:1,auth_delete_refresh_tokens:1,auth_delete_mfa_amr_claims:1},create:{auth_insert_users:1,auth_insert_identities:1,auth_insert_audit_log_entries:1},login:{auth_insert_sessions:1,auth_insert_refresh_tokens:1,auth_insert_mfa_amr_claims:1,auth_insert_audit_log_entries:1},recover:{auth_insert_audit_log_entries:1,auth_insert_one_time_tokens:1},verify:{auth_insert_sessions:1,auth_insert_refresh_tokens:1,auth_insert_mfa_amr_claims:2,auth_insert_audit_log_entries:2,auth_delete_one_time_tokens:1}};
