// Request descriptors and evidence rules only. No fetch, database, signer,
// password, token, live executor, resource setup or consumed S3.3 operation.
import {businessBinding} from '../../lib/business/binding.mjs';
import {uuid,createInput} from '../../lib/business/protocol.mjs';

const facts=Object.freeze({
 'recovery':['real Auth Recovery/OTP JWT (never a fabricated JWT)','same-project confirmed user','approved mail and recovery budgets'],
 'no-grant':['normal password JWT and live Session','explicit enabled/no-hold security state','no Grant for this UID/SID'],
 'cross-sid':['two independently authenticated normal Sessions of the SAME user','Grant belongs only to S1','invoke with S2; do not edit JWT claims'],
 'session-gone':['original signed unexpired normal JWT','previously qualified Grant','Auth Session absent by separately approved lifecycle operation'],
 'session-expired':['original signed unexpired normal JWT','Auth Session not_after elapsed','Grant and other qualification still valid'],
 'hold':['normal live Session and active Grant','security_hold=true by separately approved maintenance','epoch and other predicates unchanged'],
 'state-missing':['normal live Session','no user_security_state row','no implicit initialization or hold release'],
 'stale-epoch':['normal live Session and unexpired unrevoked Grant','state epoch strictly above Grant epoch','approved maintenance does not regress epoch'],
 'business-disabled':['normal live Session and active Grant','business_enabled=false','no other refusal predicate changed'],
 'qualified-no-site':['normal live Session and valid Grant','enabled/no-hold matching epoch','no owned site'],
 'owner':['normal live Session and valid Grant','complete active Owner mirror and existing site','original existing request/input for receipt read'],
 'cross-site':['qualified A Owner positive','existing B owned by another real Auth user','B introduction/operation inputs; no create']
});
export const authorizationCases=Object.freeze([
  ['AUTH-RECOVERY','recovery','identity',403],
  ['AUTH-NO-GRANT','no-grant','database',403],
  ['AUTH-CROSS-SID','cross-sid','database',403],
  ['AUTH-SESSION-GONE','session-gone','database',403],
  ['AUTH-SESSION-EXPIRED','session-expired','database',403],
  ['AUTH-HOLD','hold','database',403],
  ['AUTH-STATE-MISSING','state-missing','database',403],
  ['AUTH-EPOCH','stale-epoch','database',403],
  ['AUTH-DISABLED','business-disabled','database',403],
  ['AUTH-NO-SITE','qualified-no-site','database',200],
  ['AUTH-OWNER','owner','database',200],
  ['AUTH-CROSS-SITE','cross-site','database',403]
].map(([id,scenario,layer,status])=>Object.freeze({id,scenario,layer,status,fixtureFacts:Object.freeze(facts[scenario]),
  currentLive:'NOT RUN',persistentBusinessChanges:0})));

export function prepareAuthorizationPlan({binding,caseId,targetSite,operationInput}={}) {
  const scope=businessBinding(binding),c=authorizationCases.find(c=>c.id===caseId);
  if(!scope||!c||!uuid(targetSite))throw Error('PLAN_INVALID');
  const calls=[{name:'get_my_site',args:{},expectedStatus:c.scenario==='cross-site'?200:c.status}];
  if(c.scenario!=='qualified-no-site') {
    calls.push({name:'read_introduction',args:{target:targetSite},expectedStatus:c.status});
    if(operationInput) {
      // Reuse the production whitelist; no arbitrary UID or actor is accepted.
      // A receipt read locks state in PostgreSQL, so is NOT a READ ONLY audit.
      calls.push({name:'read_create_operation',args:{input:createInput(operationInput)},
        expectedStatus:c.scenario==='cross-site'?200:c.status,
        expectedResult:c.scenario==='cross-site'?'UNKNOWN':'per-case'});
    }
  }
  return Object.freeze({caseId:c.id,project:scope.project,privateOrigin:scope.privateOrigin,
    status:'PREPARED_NOT_AUTHORIZED',currentLive:c.currentLive,
    fixtureFacts:c.fixtureFacts,
    required:['fresh target/catalog/role/gate baseline','real signed JWT and Auth Session',
      'owner positive in same configuration','per-case request/registration/Auth budgets',
      'trusted refusal attribution and independent before/after state','BEGIN/ROLLBACK and transport receipts'],
    calls:Object.freeze(calls.map(call=>Object.freeze({...call,args:deepFreeze(call.args)}))),
    effects:Object.freeze({siteCreate:0,proofSign:0,grantApply:0,authMutation:0,resourceChange:0})});
}
function deepFreeze(value){for(const v of Object.values(value))if(v&&typeof v==='object')deepFreeze(v);return Object.freeze(value);}

// The normal application rejects Recovery before PostgreSQL. This separate
// descriptor requires an approved test host on the ALREADY protected PostgREST
// boundary and its original-JWT verifier. It supplies no executable transport.
export function prepareDatabaseRecoveryPlan({binding,targetSite}={}) {
  const scope=businessBinding(binding);
  if(!scope||!uuid(targetSite))throw Error('PLAN_INVALID');
  return deepFreeze({caseId:'AUTH-RECOVERY-DB',status:'PREPARED_NOT_AUTHORIZED',currentLive:'NOT RUN',
    channel:'approved-private-postgrest-original-jwt',socketPath:scope.socketPath,project:scope.project,
    method:'POST',path:'/rpc/read_introduction',profile:'site_api',args:{target:targetSite},
    expected:{layer:'database',status:403,sqlstate:'42501',privateData:false,businessChanges:0},
    required:['separately approved host access to existing protected PostgREST boundary',
      'original real Recovery/OTP JWT verified by PostgREST; no fabricated claims/GUC',
      'exact M7 session_user and authenticated role',
      'same-channel normal Owner positive','trusted auth_source_identity refusal attribution',
      'independent before/after state and transport receipts'],
    effects:{siteCreate:0,proofSign:0,grantApply:0,authMutation:0,resourceChange:0}});
}

// Verdicts are prepared for a later trusted, separately approved observation
// adapter. A caller-authored object is never itself live acceptance evidence.
export function evaluateAuthorizationObservation(caseId,observation) {
  const c=authorizationCases.find(c=>c.id===caseId);
  if(!c||!observation||observation.mode!=='OFFLINE')throw Error('LIVE_ADAPTER_REQUIRED');
  if(observation.complete!==true||observation.unknown===true)return 'UNKNOWN';
  if(observation.ownerPositive!==true||observation.status!==c.status||observation.layer!==c.layer||
     observation.businessChanges!==0)return 'FAIL';
  if(c.status===403&&observation.privateData!==false)return 'FAIL';
  if(c.scenario==='qualified-no-site'&&observation.site!==null)return 'FAIL';
  return 'OFFLINE_PASS';
}
