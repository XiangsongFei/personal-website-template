// Offline staging only. The generated SQL is restricted to a disposable local Unix-socket database.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const admission=`DO $rebuild_guard$
BEGIN
 IF current_database()<>'s36_rebuild' OR inet_server_addr() IS NOT NULL
    OR session_user<>'postgres' OR current_user<>session_user
    OR current_setting('server_version_num')<>'170012'
    OR current_setting('unix_socket_directories') NOT IN ('/private/var/tmp/s36-rebuild/socket','"/private/var/tmp/s36-rebuild/socket"')
    OR current_setting('port')<>'55436'
    OR NOT EXISTS (SELECT FROM pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper)
    OR to_regclass('site_data.draft_revisions') IS NULL
    OR to_regprocedure('site_private.lock_business_qualification()') IS NULL
 THEN RAISE EXCEPTION 'S36_REBUILD_TARGET'; END IF;
END;
$rebuild_guard$;`;

export function buildInstallFailure(stage,source,frozenSha) {
  assert.equal(sha(source),frozenSha);
  assert.ok(stage==='01'||stage==='02');
  assert.equal(source.match(/^BEGIN;$/gm)?.length,1);
  assert.equal(source.match(/^COMMIT;$/gm)?.length,1);
  assert.match(source,/(?:^|\n)COMMIT;\s*$/u);
  const observed=stage==='01'
    ? "to_regprocedure('site_api.save_text_draft(uuid,jsonb,text)') IS NOT NULL AND to_regclass('site_private.text_digest_mappings') IS NOT NULL"
    : "to_regrole('ecv_s36_outbox_worker') IS NOT NULL AND EXISTS(SELECT FROM pg_policy WHERE polrelid='site_private.publication_outbox'::regclass AND polname='s36_outbox_worker_update')";
  return source.replace(/^BEGIN;$/m,()=>`BEGIN;\n${admission}`).replace(/COMMIT;\s*$/u,()=>`DO $rebuild_fault$
BEGIN
 IF NOT (${observed}) THEN RAISE EXCEPTION 'S36_REBUILD_EFFECT_ABSENT'; END IF;
 RAISE EXCEPTION 'S36_INSTALL_FAULT_${stage}' USING ERRCODE='PZ361';
END;
$rebuild_fault$;
ROLLBACK;
`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [output,src01,sha01,src02,sha02]=process.argv.slice(2);
  assert.equal(process.argv.length,7);
  const inputs=[['01',src01,sha01],['02',src02,sha02]].map(([stage,src,digest])=>
    [stage,digest,buildInstallFailure(stage,readFileSync(src,'utf8'),digest)]);
  mkdirSync(output,{mode:0o700});
  const write=(name,value)=>writeFileSync(join(output,name),value,{mode:0o600,flag:'wx'});
  for(const [stage,,sql] of inputs) write(stage+'-fault.sql',sql);
  write('manifest.json',JSON.stringify({
    status:'PREPARED_NOT_EXECUTED',target:'s36_rebuild',socket:'/private/var/tmp/s36-rebuild/socket',port:55436,
    cases:inputs.map(([stage,frozenSha,sql])=>({stage,frozenSha,probeSha:sha(sql),sqlstate:'PZ361'}))
  },null,2)+'\n');
}
