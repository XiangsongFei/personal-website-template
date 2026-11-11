// Pure acceptance program. It yields sealed request descriptions; it cannot send them.
// Feed complete responses from an independently approved harness, in the order issued.
import { isDeepStrictEqual } from 'node:util';
import { uuid, validateResult } from '../../lib/business/protocol.mjs';

export const sourcePlanSHA = '51eca6eaba70c6027fc1aff70fc7a59956788edc7ec43d3d595450f6b8253abe';
export const people = Object.freeze({
  alice: Object.freeze({uid:'a33b0000-0000-4000-8000-000000000001', email:'s33b-runtime-alice-20261109@example.test'}),
  bob: Object.freeze({uid:'a33b0000-0000-4000-8000-000000000002', email:'s33b-runtime-bob-20261109@example.test'})
});
const input = (suffix,slug) => Object.freeze({schema_version:1,request_id:'a33b0000-0000-4000-8000-000000000'+suffix,slug,default_locale:'en'});
export const alice = input('101','s33b-alice-main-20261109');
export const bob = input('102','s33b-bob-main-20261109');
const second = input('104','s33b-sameowner-a-20261109');
const collision = input('107',alice.slug);
const reserved = input('108','admin');

export const siteBudget = Object.freeze({externalRequests:18,maxPhysicalHttp:114,maxUserRpc:15,
  maxNewSiteRows:28,newAuthRows:0,newGrants:0,newRegistrations:0,mails:0});
const create = '/api/sites', mine = '/api/sites/mine', operation = '/api/sites/operations/read';
const intro = id => '/api/sites/'+id+'/introduction';

function step(id,actor,path,body) {
  return Object.freeze({id,actor,path,method:body === undefined ? 'GET' : 'POST',...(body && {body:Object.freeze(body)})});
}
function stop(id, reason) { throw new Error(id + '/' + reason); }
function equal(id,actual,want) { if (!isDeepStrictEqual(actual,want)) stop(id,'RESPONSE_MISMATCH'); }
function accept(responses, steps, expected) {
  if (!Array.isArray(responses) || responses.length !== steps.length) stop(steps[0].id,'INCOMPLETE_UNKNOWN');
  return responses.map((r,i)=>{
    const id=steps[i].id;
    if (!r || r.id!==id || r.complete!==true || !Number.isInteger(r.status) ||
        r.status>=500 || r.body?.code==='COMMIT_UNKNOWN' || r.body?.code==='RESULT_UNKNOWN') stop(id,'INCOMPLETE_UNKNOWN');
    equal(id,r.status,expected);
    return r.body;
  });
}
function* one(s,status=200) {
  const replies = yield Object.freeze([s]);
  return accept(replies,[s],status)[0];
}
function* denied(s,status,code) {
  equal(s.id,yield* one(s,status),{code});
}
function checkReceipt(id,value,args) {
  try {return validateResult(value,args);} catch {stop(id,'UNVERIFIED_CREATE_RESULT');}
}
function* ownerReads(actor,id) {
  equal(actor,yield* one(step(actor+'-mine',actor,mine)),{
    schema_version:1,site:{id,draft_revision:0},capabilities:{read:true,edit:false,publish:false}
  });
  const result=yield* one(step(actor+'-intro',actor,intro(id)));
  const entry=result?.entries?.[0]?.id;
  if(!uuid(entry)) stop(actor,'INTRO_ENTRY');
  equal(actor,result,{schema_version:1,site_id:id,section_revision:0,draft_revision:0,
    entries:[{id:entry,position:0,translations:{zh:'请填写个人介绍。',en:'Add your introduction.'}}]});
}
export const siteRows = Object.freeze({
  'site_data.sites':1, 'site_data.site_members':1, 'site_data.site_publications':1,
  'site_data.site_domains':1, 'site_data.site_locales':2, 'site_data.site_settings':1,
  'site_data.section_state':1, 'site_data.intro_entries':1, 'site_data.intro_translations':2,
  'site_data.draft_revisions':1, 'site_private.operation_requests':1, 'site_private.site_audit_events':1
});
const rowChecks=['owner_ok','mirror_ok','unpublished_ok','domain_ok','locales_ok','settings_ok',
  'section_ok','entry_ok','translations_ok','receipt_ok','draft_ok','audit_ok'];

// Observations come from a separately gated auditor, not from the HTTP transport.
// Its actual pinned transcript must accompany the projected results in a future run.
function* observe(id,actors,baseline,mode) {
  const result=yield Object.freeze([Object.freeze({id,kind:'READ_ONLY',sites:Object.freeze({...actors})})]);
  const r=result?.[0];
  if(result?.length!==1 || r?.id!==id || r.rollback!==true || r.readOnly!==true || r.mode!==mode)
    stop(id,'NO_INDEPENDENT_RECEIPT');
  equal(id,r.owners?.map(x=>x.actor),['alice','bob']);
  for (const row of r.owners) {
    equal(id,row.owned_count,actors[row.actor] ? 1 : 0);
    if (actors[row.actor]) {
      if (!rowChecks.every(k=>row[k]===true)) stop(id,'INCOMPLETE_SITE');
    } else if(row.owner_ok!==false) stop(id,'UNEXPECTED_OWNER');
  }
  if (id==='after-collision') {
    if (mode==='OFFLINE') equal(id,r.conflict,'MODEL_ROLLBACK_ONLY');
    else {
      const c=r.conflict;
      if (!c || c.case!=='occupied-host' || c.source!=='PRIVATE_PGRST_ORIGIN' ||
          c.rpc!=='site_api.create_site(jsonb)' || c.sqlstate!=='PT409' ||
          c.actor!==people.bob.uid || c.requestId!==collision.request_id || c.slug!==collision.slug ||
          c.principal!=='ecv_s3_internal_api_login' || c.issuerBound!==true)
        stop(id,'CONFLICT_ORIGIN_UNVERIFIED');
    }
  }
  if (id==='after-race') {
    if (mode==='OFFLINE') equal(id,r.lock,'MODEL_SERIALIZATION_ONLY');
    else {
      const l=r.lock;
      const windows=l?.participants;
      const names=['alice-create-A','alice-create-B'];
      if (!Array.isArray(windows) || windows.length!==2 ||
          !names.every(name=>windows.some(w=>w.case===name)) ||
          !windows.every(w=>w.requestId===alice.request_id && w.principal==='ecv_s3_internal_api_login' &&
            w.rpc==='create_site' && Number.isSafeInteger(w.issuedMs) && Number.isSafeInteger(w.ackMs) &&
            Number.isSafeInteger(l.observedMs) && w.issuedMs<=l.observedMs && l.observedMs<=w.ackMs) ||
          !windows.some(w=>w.backendPid===l.blocker) || !windows.some(w=>w.backendPid===l.blocked) ||
          !Number.isSafeInteger(l.blocker) || !Number.isSafeInteger(l.blocked) ||
          l.blocker<=0 || l.blocked<=0 || l.blocker===l.blocked || l.eventType!=='Lock' ||
          l.event!=='transactionid' || !Array.isArray(l.blockingPids) || !l.blockingPids.includes(l.blocker))
        stop(id,'WAIT_NOT_OBSERVED');
    }
  }
  if(!Array.isArray(r.counts) || r.counts.length!==Object.keys(siteRows).length) stop(id,'RELATION_COUNT');
  const next={};
  for(const t of r.counts) {
    if(!Object.hasOwn(siteRows,t.relation) || Object.hasOwn(next,t.relation) ||
        !Number.isSafeInteger(t.old_count) || t.old_count<0 || typeof t.old_sha256!=='string' || !/^[0-9a-f]{64}$/.test(t.old_sha256))
      stop(id,'INVALID_BASELINE');
    equal(id,t.added_count,Object.keys(actors).length*siteRows[t.relation]);
    next[t.relation]={count:t.old_count,digest:t.old_sha256};
  }
  if (baseline) equal(id,next,baseline);
  return next;
}

export function* siteBatch(mode='OBSERVATIONS') {
  if (!['OBSERVATIONS','OFFLINE'].includes(mode)) stop('setup','INVALID_MODE');
  const baseline=yield* observe('before-sites',{},null,mode);
  // Two planned requests referencing the same sealed body, never a retry.
  const race=Object.freeze([step('alice-create-A','alice',create,alice),step('alice-create-B','alice',create,alice)]);
  const values=accept(yield race,race,200);
  const a=structuredClone(checkReceipt(race[0].id,values[0],alice));
  equal(race[1].id,values[1],a);
  yield* observe('after-race',{alice:a.site_id},baseline,mode);
  yield* denied(step('reserved','bob',create,reserved),400,'INVALID_INPUT');
  yield* denied(step('occupied-host','bob',create,collision),409,'REQUEST_CONFLICT');
  yield* observe('after-collision',{alice:a.site_id},baseline,mode);
  const b=structuredClone(checkReceipt('bob-create',yield* one(step('bob-create','bob',create,bob)),bob));
  if(a.site_id===b.site_id) stop('bob-create','SHARED_SITE');
  yield* observe('after-bob',{alice:a.site_id,bob:b.site_id},baseline,mode);
  yield* ownerReads('alice',a.site_id); yield* ownerReads('bob',b.site_id);
  yield* denied(step('alice-new-key','alice',create,second),409,'REQUEST_CONFLICT');
  yield* denied(step('same-key-other-digest','alice',create,{...alice,default_locale:'zh'}),409,'REQUEST_CONFLICT');
  equal('read-original',yield* one(step('read-original','alice',operation,alice)),{status:'succeeded',result:a});
  for (const [actor,target,otherInput,otherID] of [['alice','bob',bob,b.site_id],['bob','alice',alice,a.site_id]]) {
    yield* denied(step(actor+'-cross-intro',actor,intro(otherID)),403,'BUSINESS_DENIED');
    equal(actor,yield* one(step(actor+'-cross-operation',actor,operation,otherInput)),{
      status:'UNKNOWN', request_id:otherInput.request_id, retry_with_new_id:false
    });
    // Request-shape rejection by the Worker. A content UPDATE/DELETE RPC does not exist.
    yield* denied(step(actor+'-spoof-owner',actor,create,{...otherInput,owner_auth_user_id:people[target].uid}),
      400,'INVALID_INPUT');
  }
  yield* observe('final-sites',{alice:a.site_id,bob:b.site_id},baseline,mode);
  return Object.freeze({exactViolatedConstraint:'NOT_OBSERVABLE',status:mode==='OFFLINE'?'OFFLINE_PASS':'SITE_CONTRACT_OBSERVED',aliceSite:a.site_id,bobSite:b.site_id,
    required:['independent_rows','historical_digests','two_backend_lock_wait','session_bindings','rollback']});
}
