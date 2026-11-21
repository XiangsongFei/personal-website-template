import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isIPv4} from 'node:net';
import {resolve4} from 'node:dns/promises';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
import {withCredential} from '../../lib/business/identity.mjs';
import {databaseOptions} from './database.mjs';
import {publicationProject as project} from './target.mjs';

const digest=s=>createHash('sha256').update(s).digest('hex');
const baseSha='f5f9a703ffcfb279098c731bf8adc947e449148b59c9c3c973e98a3c18973916';
const oldIssuer='http://127.0.0.1:56321/auth/v1', issuer='https://'+project+'.supabase.co/auth/v1';
const fn='site_private.auth_source_identity()', table='site_private.hosted_session_timebox';
const acl=`p.proacl::text='{postgres=X/postgres,ecv_s3_authz_reader=X/postgres}'`;

export function buildTimeboxMigration(m7) {
 const original=m7.split('CREATE OR REPLACE FUNCTION '+fn+' RETURNS TABLE(uid uuid, sid uuid)\n')[1]
  ?.split('$fn$;')[0]?.split('AS $fn$')[1]?.replace(oldIssuer,issuer);
 assert.ok(original);
 assert.equal(digest(original),baseSha);
 assert.equal(original.split(' RETURN QUERY SELECT u,s;').length,2);
 const body=original.replace('DECLARE c jsonb; u uuid; s uuid;','DECLARE c jsonb; u uuid; s uuid; settings record; born timestamptz;')
   .replace(' RETURN QUERY SELECT u,s;',` SELECT w.* INTO settings FROM ${table} w WHERE w.singleton AND w.project_ref='${project}' FOR SHARE;
 IF NOT FOUND OR (settings.seconds>0 AND settings.verified_until<=pg_catalog.clock_timestamp()) THEN
  RAISE EXCEPTION 'R05_SESSION_POLICY_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF settings.seconds>0 THEN
  SELECT a.created_at INTO born FROM auth.sessions a WHERE a.id=s AND a.user_id=u;
  IF born IS NULL OR born+pg_catalog.make_interval(secs=>settings.seconds)<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'R05_SESSION_TIMEBOX_EXPIRED' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN QUERY SELECT u,s;`);
 const sha=digest(body);
 return {sha,sql:`
 DO $check$ BEGIN
 IF to_regclass('${table}') IS NOT NULL OR NOT EXISTS(
  SELECT FROM pg_proc p WHERE p.oid='${fn}'::regprocedure AND p.proowner='postgres'::regrole AND p.prosecdef AND ${acl} AND p.proconfig=ARRAY['search_path=""']
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${baseSha}')
   OR pg_has_role('postgres','ecv_s3_owner','SET')
 THEN RAISE EXCEPTION 'R05_M7_BASELINE'; END IF;
 END;$check$;
 GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;
 CREATE TABLE ${table} (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  project_ref text NOT NULL CHECK(project_ref='${project}'),
  seconds integer NOT NULL CHECK(seconds IN (0,300)),
  verified_until timestamptz CHECK((seconds=0 AND verified_until IS NULL) OR
    (seconds>0 AND verified_until IS NOT NULL AND isfinite(verified_until)))
 );
 REVOKE ALL ON ${table} FROM PUBLIC,anon,authenticated,authenticator,service_role;
 ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
 ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
 INSERT INTO ${table} VALUES (true,'${project}',0,NULL);
 CREATE OR REPLACE FUNCTION ${fn} RETURNS TABLE(uid uuid, sid uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$${body}$fn$;
 REVOKE ecv_s3_owner FROM postgres GRANTED BY postgres RESTRICT;
 ${verifyTimeboxCatalog(sha)}`};
}

export function verifyTimeboxCatalog(sha) {
 assert.match(sha,/^[a-f0-9]{64}$/);
 return `
 DO $check$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_class t WHERE t.oid='${table}'::regclass
  AND t.relowner='postgres'::regrole AND t.relrowsecurity AND t.relforcerowsecurity)
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND rolbypassrls AND NOT rolsuper)
 OR EXISTS(SELECT FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','authenticator',
    'ecv_s3_internal_api_login','ecv_s3_registration_login','ecv_s3_owner') AND has_table_privilege(r.oid,'${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid='${fn}'::regprocedure AND p.proowner='postgres'::regrole AND p.prosecdef AND ${acl} AND p.proconfig=ARRAY['search_path=""']
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${sha}')
 OR pg_has_role('postgres','ecv_s3_owner','SET')
 THEN RAISE EXCEPTION 'R05_POLICY_CATALOG'; END IF;
 END;$check$;`;
}

export function timeboxManagement() {
 const token=execFileSync('/usr/bin/security',['find-generic-password','-a','supabase','-s','Supabase CLI','-w'],
  {encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:10000}).trim();
 assert.match(token,/^sbp_[A-Za-z0-9_-]+$/);
 async function request(method,seconds) {
  const response=await fetch('https://api.supabase.com/v1/projects/'+project+'/config/auth',
   {method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   ...(method==='PATCH'?{body:JSON.stringify({sessions_timebox:seconds})}:{}),redirect:'error',signal:AbortSignal.timeout(12000)});
  assert.equal(response.status,200,'R05_AUTH_MANAGEMENT_HTTP');
  const result=await response.json();
  return {seconds:result.sessions_timebox,inactivity:result.sessions_inactivity_timeout,
   single:result.sessions_single_per_user,jwtExpiry:result.jwt_exp};
 }
 return {read:()=>request('GET'),set:seconds=>{
  assert.ok(seconds===0||seconds===300);
  return request('PATCH',seconds);
 }};
}

export const zeroPolicy={seconds:0,inactivity:0,single:false,jwtExpiry:3600};
export const activePolicy={...zeroPolicy,seconds:300};

export async function withPlatformTimebox({admin,change,readLocal,receipt,action}) {
 assert.deepEqual(await admin.read(),zeroPolicy);
 receipt('platform-before',zeroPolicy);
 let restored=false;
 const restore=async()=>{
  if(restored) return;
  const observed=await admin.read();
  assert.ok(observed.seconds===0||observed.seconds===300);
  if(observed.seconds===300) await admin.set(0);
  assert.deepEqual(await admin.read(),zeroPolicy);
  const clear=`UPDATE ${table} SET seconds=0,verified_until=NULL WHERE singleton AND seconds IN (0,300);`;
  if(readLocal('policy-before-reset')!==0) {
    try {change('timebox-policy-restore',clear);}
    catch(error) {
      if(readLocal('policy-reset-reconcile')!==0) change('timebox-policy-recover',clear);
    }
  }
  assert.equal(readLocal('policy-restored'),0);
  restored=true;
  receipt('platform-restored',zeroPolicy);
 };
 let failure;
 try {
  await admin.set(300);
  assert.deepEqual(await admin.read(),activePolicy);
  receipt('platform-active',activePolicy);
  change('timebox-policy-activate',`UPDATE ${table} SET seconds=300,verified_until=clock_timestamp()+interval '12 minutes'
    WHERE singleton AND seconds=0 AND project_ref='${project}';`);
  assert.equal(readLocal('policy-active'),300);
  await action(restore);
 } catch(error) {
  failure=error;
  throw error;
 } finally {
  try { await restore(); }
  catch(error) {
   receipt('platform-restore-failed',{primary:failure?.code??null,cleanup:error?.code??null});
   if(!failure) throw error;
  }
 }
}

export async function pinnedRegistrar(target,address,run,ca) {
 const role='ecv_s3_registration_login';
 const options=databaseOptions(project,target,role);
 assert.ok(isIPv4(address)&&(await resolve4(options.host)).includes(address));
 const escape=value=>String(value).replace(/([:\\])/g,'\\$1');
 const password=join(run,'private','r05-registrar.pgpass');
 writeFileSync(password,[options.host,5432,options.database,options.user,options.password].map(escape).join(':')+'\n',
  {mode:0o600,flag:'wx'});
 const env={PATH:'/usr/bin:/bin:/opt/homebrew/bin',PGHOST:options.host,PGHOSTADDR:address,PGPORT:'5432',
   PGDATABASE:options.database,PGUSER:options.user,PGSSLMODE:'verify-full',PGSSLROOTCERT:ca,PGPASSFILE:password,
   PGCONNECT_TIMEOUT:'8',PGOPTIONS:'-c statement_timeout=5s -c lock_timeout=3s'};
 const sql=input=>execFileSync('/opt/homebrew/opt/libpq/bin/psql',['-X','-w','-qAt','-v','ON_ERROR_STOP=1'],
  {env,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:16000}).trim();
 const peer=`session_user='${role}' AND current_user=session_user AND current_setting('role')='none'
  AND current_database()='postgres' AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl AND version='TLSv1.3')`;
 assert.equal(sql('SELECT '+peer+';'),'t','R05_REGISTRAR_PREFLIGHT');
 return proof=>{
  assert.equal(proof.project,project);
  assert.ok(proof.expires_at>Math.floor(Date.now()/1000));
  const body=JSON.stringify(proof);
  assert.ok(!body.includes('$proof$'));
  const result=sql(`SELECT CASE WHEN ${peer} THEN site_private.register_business_ticket($proof$${body}$proof$::jsonb) ELSE false END;`);
  assert.equal(result,'t','R05_REGISTRAR_UNCONFIRMED');
 };
}

export async function runNaturalExpiry(actor,observe,receipt,admin,nativeRead) {
 const token=withCredential(actor.login.handle,value=>value);
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
 assert.deepEqual([claims.sub,claims.session_id],[actor.uid,actor.sid]);
 const first=observe('r05-window');
 assert.ok(first.present&&first.grant_live&&first.generation_live&&first.owner&&first.native_unexpired&&first.policy_seconds===300);
 assert.ok(claims.exp>first.deadline+45&&first.grant_exp>first.deadline+45&&first.generation_exp>first.deadline+45);
 assert.ok(first.obs<first.deadline-45);
 const until=t=>wait(Math.max(0,t*1000-Date.now()));
 const read=async(label,call)=>{
  try {return await call();}
  catch(error) {
   if(error?.name!=='TimeoutError'&&error?.name!=='AbortError'&&error?.status!==503) throw error;
   receipt(label+'-transport',{code:error.code??null,status:error.status??null});
   return await call();
  }
 };
 const businessRead=()=>actor.service.introduction(actor.login.handle,actor.site);
 await read('r05-positive',businessRead);
 const before=observe('r05-before');
 assert.ok(before.obs<first.deadline&&before.grant_live&&before.generation_live&&before.owner&&before.native_unexpired);
 await until(first.deadline+10);
 assert.deepEqual(await read('r05-platform-after',admin.read),activePolicy);
 await assert.rejects(read('r05-negative',businessRead),{code:'BUSINESS_DENIED',status:403});
 const native=await read('r05-native-negative',()=>nativeRead(token));
 assert.deepEqual([native.status,native.body.code,native.body.message],[403,'42501','R05_SESSION_TIMEBOX_EXPIRED']);
 const after=observe('r05-after');
 assert.ok(after.obs>=first.deadline&&after.obs<claims.exp&&after.grant_live&&after.generation_live&&after.owner&&after.native_unexpired);
 assert.deepEqual([after.deadline,after.sid,after.grant_id,after.key_id],[first.deadline,first.sid,first.grant_id,first.key_id]);
 receipt('r05-expiry',{tokenSha256:digest(token),jwtExpiry:claims.exp,before,after,sqlstate:native.body.code,reason:native.body.message});
}
