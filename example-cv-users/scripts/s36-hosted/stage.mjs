import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isolatedRef} from './target.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const local = fileURLToPath(new URL('../../supabase/',import.meta.url));
const inputs = JSON.parse(readFileSync(join(local,'candidates/s36-a1/sources.json')));
const legacyProject='ecv-s33a-20261109-7dd22a81';
const legacyIssuer='http://127.0.0.1:56321/auth/v1';
function checked(path, digest) {
  const bytes=readFileSync(path);
  if (sha(bytes)!==digest) throw new Error('FROZEN_SOURCE_DRIFT: '+path);
  return bytes;
}

export function projectBridge(project, m5, m7) {
  const ref=isolatedRef(project), issuer='https://'+ref+'.supabase.co/auth/v1';
  const functions = [
    [m7,'auth_source_identity()','postgres',legacyIssuer,issuer,
      'ce226469471a5b2ac60ac1af7bcdf33caf76187fd43d56c18ac5d83b0d3b385c'],
    [m5,'check_ticket_claims(jsonb)','ecv_s3_grant_writer',legacyProject,ref,null]
  ].map(([sql,signature,owner,oldValue,newValue,pinnedDigest]) => {
    const start=signature.slice(0,signature.indexOf('('));
    const header=new RegExp('^CREATE (?:OR REPLACE )?FUNCTION site_private\\.'+start+'\\(', 'm');
    const offset=sql.search(header), end=sql.indexOf('$fn$;',offset);
    if (offset<0 || end<0) throw new Error('FROZEN_FUNCTION_UNAVAILABLE');
    const definition=sql.slice(offset,end+5);
    const body=definition.split('$fn$')[1];
    if (body.split(oldValue).length!==2 || (pinnedDigest && sha(body)!==pinnedDigest))
      throw new Error('FROZEN_FUNCTION_DRIFT');
    return {signature,owner,bodyHash:sha(body),
      sql:definition.replace(/^CREATE FUNCTION/,'CREATE OR REPLACE FUNCTION').replace(oldValue,newValue)};
  });
  const checks=functions.map(f=>`('${f.signature}','${f.owner}','${f.bodyHash}')`).join(',\n    ');
  return `-- Hosted closed installation only. Apply after intact M1–M7 and S3.6 01.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $before$
BEGIN
  IF current_user<>'postgres' OR session_user<>current_user OR current_database()<>'postgres'
     OR current_setting('server_version_num')::int / 10000<>17
     OR EXISTS (SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper)
     OR NOT EXISTS (SELECT FROM site_private.business_runtime WHERE singleton AND NOT enabled
                    AND NOT proof_verifier_ready AND project_ref='${legacyProject}' AND auth_issuer='${legacyIssuer}')
     OR NOT EXISTS (SELECT FROM site_private.text_publication_runtime WHERE singleton
                    AND NOT write_enabled AND NOT public_read_enabled AND NOT outbox_enabled)
     OR EXISTS (SELECT FROM site_private.proof_generations)
     OR EXISTS (SELECT FROM site_private.registered_business_tickets)
     OR EXISTS (SELECT FROM site_private.business_session_grants)
     OR EXISTS (SELECT FROM site_data.sites)
     OR EXISTS (SELECT FROM (VALUES ${checks}) e(signature,owner,digest)
                 LEFT JOIN pg_proc p ON p.oid=to_regprocedure('site_private.'||e.signature)
                 WHERE p.proowner IS DISTINCT FROM to_regrole(e.owner)::oid
                    OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM e.digest)
  THEN RAISE EXCEPTION 'HOSTED_CLOSED_BASELINE_MISMATCH'; END IF;
END;
$before$;
GRANT ecv_s3_owner, ecv_s3_grant_writer, ecv_s3_command_writer TO postgres
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
ALTER TABLE site_private.business_runtime
  DROP CONSTRAINT business_runtime_project_ref_check,
  DROP CONSTRAINT business_runtime_auth_issuer_check;
UPDATE site_private.business_runtime SET project_ref='${ref}', auth_issuer='${issuer}' WHERE singleton;
ALTER TABLE site_private.business_runtime
  ADD CONSTRAINT business_runtime_project_ref_check CHECK (project_ref='${ref}'),
  ADD CONSTRAINT business_runtime_auth_issuer_check CHECK (auth_issuer='${issuer}');
${functions.map(f=>f.sql).join('\n')}
-- The 01 write switch also admits publish/unpublish by default. Keep their ACL closed.
SET LOCAL ROLE ecv_s3_command_writer;
REVOKE EXECUTE ON FUNCTION site_api.publish_site(uuid,jsonb,text), site_api.unpublish_site(uuid,jsonb,text) FROM authenticated;
RESET ROLE;
REVOKE ecv_s3_owner, ecv_s3_grant_writer, ecv_s3_command_writer FROM postgres GRANTED BY postgres RESTRICT;
DO $after$
BEGIN
  IF EXISTS (SELECT FROM pg_auth_members
              WHERE roleid IN ('ecv_s3_owner'::regrole,'ecv_s3_grant_writer'::regrole,'ecv_s3_command_writer'::regrole)
              AND (member<>'postgres'::regrole OR grantor<>10 OR NOT admin_option OR inherit_option OR set_option))
     OR EXISTS (SELECT FROM pg_roles r WHERE rolname IN ('anon','authenticated','authenticator','service_role')
                 AND (has_function_privilege(r.oid,'site_api.publish_site(uuid,jsonb,text)','EXECUTE')
                   OR has_function_privilege(r.oid,'site_api.unpublish_site(uuid,jsonb,text)','EXECUTE')))
     OR NOT has_function_privilege('authenticated','site_api.save_text_draft(uuid,jsonb,text)','EXECUTE')
  THEN RAISE EXCEPTION 'HOSTED_ACL_MISMATCH'; END IF;
END;
$after$;
COMMIT;
`;
}

export function stage(project, textSources, output) {
  const ref=isolatedRef(project);
  const stages=inputs.migrations.filter(item=>item.number<=7).map(item=>
    [item.file,checked(join(local,'migrations',item.file),item.sha256)]);
  const [part01,part02]=inputs.text_sql;
  const text=checked(join(textSources,part01.source),part01.source_sha256);
  checked(join(textSources,part02.source),part02.source_sha256); // verified, excluded from first install
  stages.push([part01.source,text]);
  stages.push(['hosted-project-closed.sql',projectBridge(ref,stages[4][1].toString(),stages[6][1].toString())]);
  mkdirSync(output,{mode:0o700});
  for(const [name,bytes] of stages) writeFileSync(join(output,name),bytes,{flag:'wx',mode:0o600});
  const manifest={project:ref,status:'CLOSED_INSTALLATION_CANDIDATE',
    order:stages.map(([file,bytes])=>({file,sha256:sha(bytes)})),excluded:[part02.source]};
  writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return manifest;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==5) throw new Error('Usage: stage.mjs <approved-ref> <historical-text-only-dir> <new-output-dir>');
  console.log(JSON.stringify(stage(...process.argv.slice(2)),null,2));
}
