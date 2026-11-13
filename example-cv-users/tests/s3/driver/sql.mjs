// Fixed isolated maintenance/observer SQL builders. Never execute at import.
import {readFileSync} from 'node:fs';
import {need} from './state.mjs';
import {root,ALICE,BOB,CHARLIE,PROJECT} from './contract.mjs';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const arr=values=>values.length?'ARRAY['+values.map(q).join(',')+']::uuid[]':"ARRAY[]::uuid[]";
const h=expr=>`encode(sha256(convert_to((${expr})::text,'UTF8')),'hex')`;
const aggregate=(table,where='true',expr='to_jsonb(t)')=>`(SELECT ${h("coalesce(jsonb_agg(d ORDER BY d::text),'[]'::jsonb)")} FROM (SELECT ${expr} AS d FROM ${table} t WHERE ${where}) x)`;
export function observationSQL(ctx){
 const f=ctx.fixture,history=ctx.history;
 const proofs=f.proof_slots.map(p=>p.proof_id),oldGrants=history.grants.map(g=>g.id);
 const privateHash={
  state:aggregate('site_private.user_security_state',ctx.state.raceOnly?'true':`t.auth_user_id<>${q(CHARLIE)}::uuid`),
  grants:aggregate('site_private.business_session_grants',`t.id=ANY(${arr(oldGrants)})`),
  generations:aggregate('site_private.proof_generations',`t.key_id<>${q(f.key_id)}`),
  tickets:aggregate('site_private.registered_business_tickets',`NOT(t.proof_id=ANY(${arr(proofs)}))`),
  receipts:aggregate('site_private.grant_proofs',`NOT(t.proof_id=ANY(${arr(proofs)}))`),
  runtime:aggregate('site_private.business_runtime','true',"to_jsonb(t)-'enabled'-'proof_verifier_ready'")
 };
 const stable={alice_user:aggregate('auth.users',`t.id=${q(ALICE)}::uuid`,"to_jsonb(t)-ARRAY['encrypted_password','updated_at','recovery_token','recovery_sent_at','last_sign_in_at']"),alice_identity:aggregate('auth.identities',`t.user_id=${q(ALICE)}::uuid`,"to_jsonb(t)-ARRAY['updated_at','last_sign_in_at']")};
 const pairs=obj=>Object.entries(obj).map(([k,v])=>q(k)+','+v).join(',');
 const expected=Object.values(ctx.state.proofs??{});
 const authRows=[
  ['users','id','id','NULL::uuid','to_jsonb(t)'],['identities','id','user_id','NULL::uuid','to_jsonb(t)'],
  ['sessions','id','user_id','id',"to_jsonb(t)-'not_after'"],['refresh_tokens','id','user_id::uuid','session_id','to_jsonb(t)'],
  ['mfa_amr_claims','id',"(SELECT user_id FROM auth.sessions s WHERE s.id=t.session_id)",'session_id','to_jsonb(t)'],
  ['one_time_tokens','id','user_id','NULL::uuid','to_jsonb(t)'],['audit_log_entries','id',"NULLIF(payload->>'actor_id','')",'NULL::uuid','to_jsonb(t)']
 ].map(([table,id,uid,sid,expr])=>`SELECT jsonb_build_object('table','${table}','id',t.${id}::text,'uid',${uid==='id'?'t.id':uid==='user_id'?'t.user_id':uid==='id'?uid:uid},'sid',${sid},'sha',${h(expr)}) AS row FROM auth.${table} t`).join(' UNION ALL ');
 let sql=readFileSync(new URL('tests/s3/s34-baseline-observe.sql',root),'utf8').replace(/ROLLBACK;\s*$/,'');
 need(/^[A-Za-z0-9_-]{1,40}$/.test(f.key_id)&&proofs.length>=1&&proofs.length<=3&&proofs.every(p=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p)),'OBSERVER_PROFILE_IDS');
 sql=sql.replaceAll('s34-r3-clean-20261112-k5',f.key_id);
 ['1084ab57-f716-4a2f-90db-c5aa315da34f','2822a7a9-e098-44c0-8e11-a4117152b5b1','d0d65720-4d52-4ee7-9aa4-2ed7776f445a'].forEach((old,i)=>{sql=sql.replaceAll(old,proofs[i]??proofs[0]);});
 return sql+`\nWITH expected AS (SELECT value AS proof FROM jsonb_array_elements(${q(JSON.stringify(expected))}::jsonb))
SELECT jsonb_build_object(
 'protectedBusiness',jsonb_build_object(${pairs(privateHash)}),
 'authStable',jsonb_build_object(${pairs(stable)}),
 'charlieIdentityStable',${aggregate('auth.identities',`t.user_id=${q(CHARLIE)}::uuid`,"to_jsonb(t)-ARRAY['updated_at','last_sign_in_at']")},
 'authUserFields',(SELECT coalesce(jsonb_object_agg(uid,fields),'{}') FROM (SELECT u.id::text AS uid,jsonb_object_agg(k,${h('v')}) AS fields FROM auth.users u CROSS JOIN LATERAL jsonb_each(to_jsonb(u)) e(k,v) GROUP BY u.id) u),
 'authLifecycleAcl',jsonb_build_object('sessionUpdate',has_column_privilege('postgres','auth.sessions','not_after','UPDATE'),'sessionDelete',has_table_privilege('postgres','auth.sessions','DELETE')),
 'diagnosticSettings',jsonb_build_object('errorParameters',current_setting('log_parameter_max_length_on_error')),
 'authRows',(SELECT coalesce(jsonb_agg(row ORDER BY row->>'table',row->>'id'),'[]') FROM (${authRows}) a),
 'receiptMatches',(SELECT coalesce(jsonb_object_agg(p.proof->>'proof_id',jsonb_build_object(
  'ticketExact',t.proof=p.proof,'receiptExact',r.proof_fingerprint=${h("jsonb_build_object('proof',p.proof)")}
    AND r.auth_user_id=t.auth_user_id AND r.auth_session_id=t.auth_session_id AND r.key_id=t.key_id
    AND r.security_epoch=(p.proof->>'epoch')::bigint AND r.request_digest=p.proof->>'payload_digest'
    AND g.security_epoch=r.security_epoch AND g.issuer_version='r3-ticket-v1:'||r.key_id,
  'consumed',r.consumed_at IS NOT NULL AND r.consumed_at BETWEEN r.issued_at AND r.expires_at,
  'claimsExact',r.project_ref=${q(PROJECT)} AND r.action=p.proof->>'action' AND r.issued_at=to_timestamp((p.proof->>'issued_at')::bigint) AND r.expires_at=to_timestamp((p.proof->>'expires_at')::bigint),
  'resultExact',r.grant_result->>'grant_id'=g.id::text AND r.grant_result->>'status'=CASE WHEN g.revoked_at IS NULL THEN 'active' ELSE 'revoked' END AND (r.grant_result->>'expires_at')::timestamptz=g.expires_at,
  'grantId',g.id,'uid',t.auth_user_id,'sid',t.auth_session_id,'epoch',r.security_epoch,'keyId',t.key_id)),'{}')
  FROM expected p LEFT JOIN site_private.registered_business_tickets t ON t.proof_id=(p.proof->>'proof_id')::uuid
  LEFT JOIN site_private.grant_proofs r ON r.proof_id=t.proof_id LEFT JOIN site_private.business_session_grants g ON g.id=(r.grant_result->>'grant_id')::uuid));
ROLLBACK;\n`;
}
// One independent final snapshot: preserve both complete observers and all
// hashed row metadata, while reserving only one PG transaction from 98/50.
export function finalObservationSQL(ctx){
 const data=observationSQL(ctx),catalog=readFileSync(new URL('tests/s3/m7-catalog-observe.sql',root),'utf8');
 const start=catalog.indexOf('WITH\nns AS '),header=catalog.slice(0,start);
 need(start>0&&header.endsWith("BEGIN READ ONLY;\nSET LOCAL search_path = pg_catalog;\nSET LOCAL statement_timeout = '15s';\n")&&/ROLLBACK;\s*$/.test(data)&&/ROLLBACK;\s*$/.test(catalog),'FINAL_OBSERVER_FRAME');
 return data.replace(/ROLLBACK;\s*$/,'')+'\n'+catalog.slice(start).replace(/ROLLBACK;\s*$/,'')+"\nSELECT jsonb_build_object('observer_pid',pg_backend_pid(),'observer_read_only',current_setting('transaction_read_only'),'observer_isolation',current_setting('transaction_isolation'));\nROLLBACK;\n";
}
const begin=`\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='5s';
DO $target$ BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR current_database()<>'postgres'
 OR current_setting('server_version_num')<>'170011' OR (pg_control_system()).system_identifier::text<>'7706828727995158580'
 THEN RAISE EXCEPTION 'TARGET'; END IF;
END $target$;
GRANT ecv_s3_owner,ecv_s3_grant_writer TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET FALSE GRANTED BY postgres;
`;
const end=`
REVOKE ecv_s3_owner,ecv_s3_grant_writer FROM postgres GRANTED BY postgres RESTRICT;
SELECT jsonb_build_object('prepared',true,'roleDelta',0,'pid',pg_backend_pid());
COMMIT;
`;
function assertion(condition){return `DO $cas$ BEGIN IF NOT(${condition}) THEN RAISE EXCEPTION 'S34_CAS'; END IF; END $cas$;\n`;}
export function maintenanceSQL(kind,ctx){
 const kid=q(ctx.fixture.key_id),uid=q(CHARLIE)+'::uuid',charlie=`auth_user_id=${uid}`;
 const state=ctx.state,slot=state.sessions.A1;
 let body;
 if(kind==='generation'){
  const w=ctx.keyWindow;need(w&&[w.notBefore,w.signUntil,w.verifyUntil].every(Number.isSafeInteger),'KEY_WINDOW');
  body=`INSERT INTO site_private.proof_generations(key_id,not_before,sign_until,verify_until) VALUES(${kid},to_timestamp(${w.notBefore}),to_timestamp(${w.signUntil}),to_timestamp(${w.verifyUntil}));`;
 }else if(kind==='reactivateCharlie'){
  need(ctx.state.tail===true,'TAIL_MAINTENANCE_SCOPE');
  body=assertion(`EXISTS(SELECT FROM site_private.user_security_state WHERE ${charlie} AND security_epoch=0 AND NOT business_enabled AND security_hold AND hold_reason='administrative')`)+`UPDATE site_private.user_security_state SET business_enabled=true,security_hold=false,hold_reason='none' WHERE ${charlie};`;
 }else if(kind==='open')body=`ALTER TABLE site_private.business_runtime DROP CONSTRAINT business_runtime_proof_verifier_ready_check;
UPDATE site_private.business_runtime SET enabled=true,proof_verifier_ready=true WHERE singleton AND NOT enabled AND NOT proof_verifier_ready;
`+assertion(`EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND enabled AND proof_verifier_ready)`);
 else if(kind==='initCharlie')body=`INSERT INTO site_private.user_security_state(auth_user_id,security_epoch,business_enabled,security_hold,hold_reason) VALUES(${uid},0,true,false,'none');`;
 else if(['hold','clearHold','disable','enable','epoch'].includes(kind)){
  const values={hold:['security_hold','true','false'],clearHold:['security_hold','false','true'],disable:['business_enabled','false','true'],enable:['business_enabled','true','false'],epoch:['security_epoch','1','0']};
  const [column,next,old]=values[kind];
  body=assertion(`EXISTS(SELECT FROM site_private.user_security_state WHERE ${charlie} AND ${column}=${old} AND hold_reason='none')`)+`UPDATE site_private.user_security_state SET ${column}=${next} WHERE ${charlie} AND ${column}=${old};`;
 }else if(kind==='expireA1'){
  need(slot?.uid===ALICE,'SESSION_UPDATE_SCOPE');body=assertion(`EXISTS(SELECT FROM auth.sessions WHERE id=${q(slot.sid)}::uuid AND user_id=${q(ALICE)}::uuid AND not_after IS NULL)`)+`UPDATE auth.sessions SET not_after=clock_timestamp()+interval '5 seconds' WHERE id=${q(slot.sid)}::uuid AND user_id=${q(ALICE)}::uuid;`;
 }else if(kind==='deleteA1'){
  need(slot?.uid===ALICE,'SESSION_DELETE_SCOPE');const sid=q(slot.sid)+'::uuid';
  body=assertion(`EXISTS(SELECT FROM auth.sessions WHERE id=${sid} AND user_id=${q(ALICE)}::uuid) AND (SELECT count(*) FROM auth.refresh_tokens WHERE session_id=${sid})=1 AND (SELECT count(*) FROM auth.mfa_amr_claims WHERE session_id=${sid} AND authentication_method='password')=1 AND (SELECT count(*) FROM auth.mfa_amr_claims WHERE session_id=${sid})=1`)+`DELETE FROM auth.sessions WHERE id=${sid} AND user_id=${q(ALICE)}::uuid;`;
 }else if(kind==='revoke')body=assertion(`EXISTS(SELECT FROM site_private.proof_generations WHERE key_id=${kid} AND revoked_at IS NULL)`)+`UPDATE site_private.proof_generations SET revoked_at=clock_timestamp() WHERE key_id=${kid} AND revoked_at IS NULL;`;
 else if(kind==='close'){
  body=`UPDATE site_private.business_runtime SET enabled=false,proof_verifier_ready=false WHERE singleton;
DO $hard$ BEGIN IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='site_private.business_runtime'::regclass AND conname='business_runtime_proof_verifier_ready_check') THEN
 ALTER TABLE site_private.business_runtime ADD CONSTRAINT business_runtime_proof_verifier_ready_check CHECK(NOT proof_verifier_ready);
 END IF; END $hard$;
SELECT set_config('ecv.s34.contain_ok','true',true);
`;
  for(const [name,update]of [['generation',`UPDATE site_private.proof_generations SET revoked_at=clock_timestamp() WHERE key_id=${kid} AND revoked_at IS NULL;`],['charlie',`UPDATE site_private.user_security_state SET business_enabled=false,security_hold=true,hold_reason='administrative' WHERE ${charlie};`]].filter(([name])=>!ctx.state.raceOnly||name!=='charlie'))body+=`SAVEPOINT s34_${name};
\\set ON_ERROR_STOP off
${update}
\\if :ERROR
ROLLBACK TO SAVEPOINT s34_${name};
SELECT set_config('ecv.s34.contain_ok','false',true);
\\endif
\\set ON_ERROR_STOP on
RELEASE SAVEPOINT s34_${name};
`;
  body+=`SELECT jsonb_build_object('gatesClosed',NOT enabled AND NOT proof_verifier_ready,'containmentOk',current_setting('ecv.s34.contain_ok')='true','hardCheck',EXISTS(SELECT FROM pg_constraint WHERE conrelid='site_private.business_runtime'::regclass AND convalidated AND pg_get_expr(conbin,conrelid)='(NOT proof_verifier_ready)')) FROM site_private.business_runtime WHERE singleton;`;
 }else need(false,'MAINTENANCE_SCOPE');
 return begin+body+end;
}
export const fenceSQL=`BEGIN; SET LOCAL statement_timeout='20s'; SELECT pg_advisory_xact_lock(3303,5); SELECT jsonb_build_object('pid',pg_backend_pid(),'fence',true);`;
export const queueSQL=`SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only')='on','observerPid',pg_backend_pid(),'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('pid',l.pid,'mode',l.mode,'granted',l.granted,'waitstart',l.waitstart,'role',a.usename,'blockers',pg_blocking_pids(l.pid)) ORDER BY l.waitstart),'[]') FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE locktype='advisory' AND classid=3303 AND objid=5 AND objsubid=2));`;
