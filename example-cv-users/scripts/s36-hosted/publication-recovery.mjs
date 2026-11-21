import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {withCredential} from '../../lib/business/identity.mjs';
import {uuid} from '../../lib/business/protocol.mjs';
import {textPayload} from '../../lib/business/text-publication.mjs';
import {textCommand} from './compat/command.mjs';
import {dropPublicationReplyOnce} from './drop-save-reply.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const publish='publish_site', withdraw='unpublish_site';

export function recoveryCommands(site,keys) {
  assert.deepEqual([site.draft_revision,site.publication.publication_revision,site.publication.state],[5,9,'unpublished']);
  assert.ok(site.payload.entries.length>0);
  const payload=textPayload({schema_version:1,entries:site.payload.entries.map((entry,index)=>index?entry:{
    ...entry,translations:{...entry.translations,en:'Synthetic recovery '+keys.save}
  })});
  const save=textCommand('save_text_draft',{schema_version:1,request_id:keys.save,expected_draft_revision:5,payload});
  const move=(operation,key)=>textCommand(operation,{schema_version:1,request_id:key,
    ...(operation===publish?{expected_draft_revision:6,snapshot_id:null}:{}),expected_publication_revision:operation===publish?9:10});
  return {save,faultPublish:move(publish,keys.faultPublish),publish:move(publish,keys.publish),
    faultWithdraw:move(withdraw,keys.faultWithdraw),withdraw:move(withdraw,keys.withdraw)};
}

export function publicationFaultFixture(actor,commands) {
  assert.ok([actor.site,actor.uid,actor.sid,commands.faultPublish.request_id,commands.faultWithdraw.request_id].every(uuid));
  const cases=[[publish,commands.faultPublish,10,'published'],[withdraw,commands.faultWithdraw,11,'unpublished']];
  const binding=cases.map(([operation,input,rev,state])=>`('${operation}'::text,'${input.request_id}'::uuid,
    '${sha(JSON.stringify({operation,...input}))}'::text,${rev}::bigint,'${state}'::text)`).join(',\n');
  const body=`
DECLARE matched record;
BEGIN
 IF NEW.site_id<>'${actor.site}' OR NEW.actor_auth_user_id<>'${actor.uid}'
   OR NEW.actor_session_id<>'${actor.sid}' OR NEW.draft_revision<>6 THEN RETURN NULL; END IF;
 SELECT o.id,b.rev,b.state,b.operation INTO matched
 FROM site_private.operation_requests o JOIN (VALUES ${binding}) b(operation,request_id,digest,rev,state)
   ON o.operation=b.operation AND o.request_id=b.request_id AND o.payload_digest=b.digest
 WHERE o.id=NEW.operation_id AND o.site_id=NEW.site_id AND o.actor_auth_user_id=NEW.actor_auth_user_id
   AND o.actor_session_id=NEW.actor_session_id AND o.basis_draft_revision=6
   AND o.basis_publication_revision=b.rev-1 AND o.state='succeeded'
   AND o.digest_encoding='js-json-stringify-v1';
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NEW.action<>matched.operation OR NEW.publication_revision<>matched.rev
 OR NOT EXISTS(SELECT FROM site_data.site_publications p
   JOIN site_private.publication_revisions h ON h.site_id=p.site_id AND h.publication_revision=p.publication_revision
   JOIN site_private.publication_outbox e ON e.site_id=h.site_id AND e.publication_revision=h.publication_revision
   WHERE p.site_id=NEW.site_id AND p.publication_revision=matched.rev AND p.state=matched.state
     AND h.operation_id=matched.id AND h.state=p.state AND h.snapshot_id IS NOT DISTINCT FROM p.snapshot_id
     AND e.operation_id=matched.id AND e.event_type=p.state AND e.state='pending' AND e.attempt_count=0
     AND (p.state='unpublished' AND p.snapshot_id IS NULL OR p.state='published' AND EXISTS(
       SELECT FROM site_data.published_snapshots s WHERE s.site_id=p.site_id AND s.id=p.snapshot_id
         AND s.source_draft_revision=6 AND s.published_by=NEW.actor_auth_user_id)))
 THEN RAISE EXCEPTION 'S36_PUBLICATION_WITNESS_MISSING' USING ERRCODE='PZ366'; END IF;
 RAISE EXCEPTION 'S36_PUBLICATION_EFFECTS_ROLLBACK' USING ERRCODE='PZ365';
END;`;
  const name='s36_test_abort_publication', signature='site_private.'+name+'()';
  const grant='GRANT ecv_s3_owner,ecv_s3_integrity TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;';
  const revoke='REVOKE ecv_s3_owner,ecv_s3_integrity FROM postgres GRANTED BY postgres RESTRICT;';
  const check=`DO $guard$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_trigger t JOIN pg_proc f ON t.tgfoid=f.oid
     WHERE t.tgrelid='site_private.text_publication_audit'::regclass AND t.tgname='${name}'
     AND t.tgfoid=to_regprocedure('${signature}') AND t.tgconstraint<>0 AND t.tgdeferrable AND t.tginitdeferred
     AND t.tgtype=5 AND t.tgenabled='O' AND f.prosecdef AND f.proowner='ecv_s3_integrity'::regrole
     AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')='${sha(body)}'
     AND NOT EXISTS(SELECT FROM aclexplode(f.proacl) a WHERE a.grantee<>f.proowner))
    THEN RAISE EXCEPTION 'S36_PUBLICATION_FAULT_IDENTITY'; END IF; END;$guard$;`;
  return {bodySha:sha(body),install:`
    DO $guard$ BEGIN IF to_regprocedure('${signature}') IS NOT NULL
      OR EXISTS(SELECT FROM pg_trigger WHERE tgname='${name}')
      OR has_schema_privilege('ecv_s3_integrity','site_private','CREATE')
      OR pg_has_role('postgres','ecv_s3_owner','SET') OR pg_has_role('postgres','ecv_s3_integrity','SET')
    THEN RAISE EXCEPTION 'S36_PUBLICATION_FAULT_SCOPE'; END IF; END;$guard$;
    ${grant}
    GRANT CREATE ON SCHEMA site_private TO ecv_s3_integrity;
    CREATE FUNCTION ${signature} RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $publication_fault$${body}$publication_fault$;
    ALTER FUNCTION ${signature} OWNER TO ecv_s3_integrity;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated,authenticator,service_role;
    CREATE CONSTRAINT TRIGGER ${name} AFTER INSERT ON site_private.text_publication_audit
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${signature};
    REVOKE CREATE ON SCHEMA site_private FROM ecv_s3_integrity;
    ${revoke}
    ${check}`,remove:`
    ${grant}
    LOCK TABLE site_private.text_publication_audit IN ACCESS EXCLUSIVE MODE;
    ${check}
    DROP TRIGGER ${name} ON site_private.text_publication_audit RESTRICT;
    DROP FUNCTION ${signature} RESTRICT;
    ${revoke}`};
}

export async function expectPublicationRollback(socketPath,actor,operation,input) {
  assert.ok([publish,withdraw].includes(operation));
  const body=JSON.stringify({target:actor.site,input,canonical_request:JSON.stringify({operation,...input})});
  return withCredential(actor.login.handle, token=>new Promise((yes,no)=>{
    const req=request({socketPath,path:'/rpc/'+operation,method:'POST',agent:false,signal:AbortSignal.timeout(9000),
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Profile':'site_api','Accept-Profile':'site_api',
        'Content-Length':Buffer.byteLength(body)}},response=>{
      let data='';
      response.setEncoding('utf8');
      response.on('error',no);
      response.on('data',chunk=>{data+=chunk;if(data.length>131072)response.destroy(Error('S36_FAULT_RESPONSE_LIMIT'));});
      response.on('end',()=>{try{yes({status:response.statusCode,body:JSON.parse(data)});}catch(e){no(e);}});
    });
    req.on('error',no);req.end(body);
  }));
}

export function verifyDraftRecovery(before,after,actor,input,result) {
  const old=before.sites.find(row=>row.id===actor.site), current=after.sites.find(row=>row.id===actor.site);
  assert.deepEqual(result,{schema_version:1,request_id:input.request_id,site_id:actor.site,changed:true,draft_revision:6,publication:old.publication});
  assert.deepEqual([current.draft_revision,current.section_revision,current.payload,current.digest],[6,6,input.payload,sha(JSON.stringify(input.payload))]);
  assert.deepEqual(after.sites.map(s=>s.id===actor.site?{...s,draft_revision:old.draft_revision,section_revision:old.section_revision,
    payload:old.payload,digest:old.digest}:s),before.sites);
  for(const key of ['domains','members','site_total','user_total','acl','snapshots','history','outbox']) assert.deepEqual(after[key],before[key]);
  const added=key=>{
    const ids=new Set(before[key].map(row=>row.id));
    assert.deepEqual(after[key].filter(row=>ids.has(row.id)),before[key],key);
    const extra=after[key].filter(row=>!ids.has(row.id));
    assert.equal(extra.length,1);
    return extra[0];
  };
  const op=added('operations'), draft=added('drafts'), audit=added('audits');
  const canonical=JSON.stringify({operation:'save_text_draft',...input});
  assert.deepEqual([op.operation,op.site_id,op.actor_auth_user_id,op.actor_session_id,op.request_id,op.canonical_request,op.payload_digest,op.result],
    ['save_text_draft',actor.site,actor.uid,actor.sid,input.request_id,canonical,sha(canonical),result]);
  assert.deepEqual([draft.site_id,draft.site_revision,draft.previous_revision,draft.payload,draft.digest,draft.operation_id],
    [actor.site,6,5,input.payload,current.digest,op.id]);
  assert.deepEqual([audit.action,audit.operation_id,audit.site_id,audit.actor_session_id,audit.draft_revision,audit.publication_revision],
    ['save_text_draft',op.id,actor.site,actor.sid,6,9]);
}

export async function reconcilePublicationLoss(actor,operation,input,{transport,origin,repositoryFor,receipt,label}) {
  let discarded=false;
  const service=repositoryFor(dropPublicationReplyOnce(transport,{origin,target:actor.site,input,onDiscard:info=>{
    receipt(label+'-dropped-app-reply',info); discarded=true;
  }},operation));
  let failure;
  try {await service[operation===publish?'publish':'unpublish'](actor.login.handle,actor.site,input);}
  catch(error) {failure=error;}
  const reconciliation=await service.readPublicationOperation(operation,actor.login.handle,actor.site,input);
  receipt(label+'-same-key',reconciliation);
  assert.deepEqual([discarded,failure?.code,reconciliation.status],[true,'COMMIT_UNKNOWN','succeeded']);
  return reconciliation.result;
}
