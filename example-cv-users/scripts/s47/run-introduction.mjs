import assert from 'node:assert/strict';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {createHash,createPublicKey,generateKeyPairSync,randomBytes,randomUUID,sign,verify} from 'node:crypto';
import {once} from 'node:events';
import {existsSync,lstatSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {request as unixRequest} from 'node:http';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';
import {runtime} from '../../tests/runtime.mjs';
import {createIdentityAdapter,accountContext} from '../../lib/business/identity.mjs';
import {createBusinessBinding} from '../../lib/business/binding.mjs';
import {verifySecurityEnvelope} from '../../lib/business/r3-verifier.mjs';
import {grantBytes,hex,proofBytes,sha256,uuid} from '../../lib/business/protocol.mjs';
import {prepareIntroduction,introductionText,parseSaveReceipt} from '../../lib/editor/introduction-dto.ts';
import {createAcceptanceSave} from './acceptance-save.mjs';
import {textDraftArgs} from '../../lib/business/introduction-repository.mjs';
import {runFullText,s47Functions,s47RpcNames} from './full-text.mjs';
import {runTargeted} from './targeted.mjs';
import {assertBudgetHeadroom} from './budget.mjs';

const mode=process.argv[2];
assert.ok(mode===undefined||mode==='--all-text'||mode==='--follow-up','UNRECOGNIZED_MODE');
const followUp=mode==='--follow-up';
const full=mode==='--all-text'||followUp;
const project=followUp?'s47-all-text-acceptance-followup-r01':full?'s47-all-text-acceptance':'s47-intro-acceptance-20261128-r02';
const issuer='https://users.auth.example.invalid/auth/v1';
const privateOrigin='https://users.draft.example.invalid';
const oldProject='ecv-s33a-20261109-7dd22a81', oldIssuer='http://127.0.0.1:56321/auth/v1';
const stageDir=realpathSync('.runtime/s4-7/'+project), build=join(stageDir,'build');
assert.ok(!existsSync(join(stageDir,'manifest.json')), 'one shot');
const authBin=join(build,'auth');
const pgBin='/private/var/tmp/ecv-s37-pg-build.mjCv9PFm/installed/bin';
const restBin=realpathSync('../../s35-hosted-acceptance-20261122-58ae9ac7/example-cv-users/.runtime/s37-b-chain-20261126/postgrest');
const textSqlPath='/Users/xiangsongfei/.codex/local-archives/S3-PAUSED-CHECKPOINT-20261127/restricted/supplement/s37-independent/historical/supabase/candidates/s36-text-only/01-text-publication.sql';
const baseline='c0a9588254fab69e379d66e501b4e434d392e41c';
const sourceHead=full?execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim():baseline;
let root, db, restSock;
const dbPort=55447;
const env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'};
const sha=v=>createHash('sha256').update(v).digest('hex');
const read=p=>readFileSync(p,'utf8');
const literal=s=>"'"+String(s).replaceAll("'","''")+"'";
const json=v=>literal(JSON.stringify(v))+'::jsonb';
const beforeMigrations=JSON.parse(read('tests/s3/migration-source-contract.json'));
const m7=JSON.parse(read('docs/s3/S3.6-HOSTED-TARGET-MANIFEST.PG17.12.json')).m7Adaptation;
const textDigest='97b2017168b197ba6d006050717207535b6a56d3dcd5f1116b386313575bb175';
const limits=followUp?{textHTTP:180,workerSaves:16,nativeSaves:16,allSaveEntrances:16,lookups:12,sqlObservation:24,passwordLogins:4,grants:4,generations:1}:full?{textHTTP:180,workerSaves:36,nativeSaves:36,allSaveEntrances:36,lookups:16,sqlObservation:40,passwordLogins:4,grants:4,generations:1}:{textHTTP:48,workerSaves:10,nativeSaves:10,allSaveEntrances:10,lookups:8,sqlObservation:24,passwordLogins:2,grants:2,generations:1};
const textCandidates=full?['01-resume-text','02-repeatable-text','03-introduction-receipt'].map(file=>{
  const path='supabase/candidates/s47/'+file+'.sql';
  const source=read(path);
  return {path:realpathSync(path),source,sha256:sha(source)};
}):[];
const counts=Object.fromEntries(Object.keys(limits).map(k=>[k,0]));
const witness={project,sourceHead,counts,limits,cases:[],saves:[],upstream:[],stage:'preflight'};
let stopRequested=false;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{stopRequested=true;writesFrozen=true;});
const note=e=>{witness.saves.push(e);report();};
const report=()=>writeFileSync(join(stageDir,'receipt.json'),JSON.stringify(witness,null,2)+'\n',{mode:0o600});
const phase=name=>{witness.stage=name;report();console.log('STAGE',name);};
const mark=(name,data={})=>{witness.cases.push({name,...data});report();console.log('PASS',name);};
function ensureBudget(allocation,label) {
  const ceiling={...limits,sqlObservation:limits.sqlObservation-(witness.stage==='cleanup'?0:2)};
  try {assertBudgetHeadroom(counts,ceiling,allocation,label);}
  catch(error){witness.budgetStop={stage:witness.stage,reason:error.message,allocation};report();throw error;}
}
function take(...kinds) {
  if(stopRequested && witness.stage!=='cleanup')throw Error('STOP_REQUESTED');
  const allocation=Object.create(null);
  for(const kind of kinds) allocation[kind]=(allocation[kind]??0)+1;
  ensureBudget(allocation,'REQUEST');
  for(const [kind,amount] of Object.entries(allocation))counts[kind]+=amount;
  report();
}
function execute(bin,args,options={}) {
  return execFileSync(bin,args,{env,encoding:'utf8',timeout:25_000,stdio:['pipe','pipe','pipe'],...options}).trim();
}
function pg(name,args,options) {return execute(join(pgBin,name),args,options);}
const psql=role=>['-XqAtw','-h',root,'-p',String(dbPort),'-U',role,'-d','postgres','-v','ON_ERROR_STOP=1','-f','-'];
function sql(input,role='supabase_admin') {
  return pg('psql',psql(role),{input:"SET statement_timeout='12s'; SET lock_timeout='3s';\n"+input});
}
function obs(query) {
  take('sqlObservation');
  return JSON.parse(sql('BEGIN READ ONLY;\n'+query+'\nCOMMIT;'));
}
function checkDenial(role,statement) {
  take('sqlObservation');
  const out=spawnSync(join(pgBin,'psql'),psql(role),{input:"\\set VERBOSITY verbose\nBEGIN READ ONLY;\n"+statement+"\nROLLBACK;\n",env,encoding:'utf8',timeout:5000});
  assert.equal(out.status,3);
  assert.match(out.stderr,/42501:/);
}
function definition(source,name) {
  const match=source.match(new RegExp('CREATE (?:OR REPLACE )?FUNCTION site_private[.]'+name+'[(][\\s\\S]*?\\$fn\\$;','m'));
  assert.ok(match,name);
  return match[0];
}
function bound(source,oldValue,newValue) {
  assert.equal(source.split(oldValue).length,2);
  return source.replace(oldValue,newValue);
}
const textSql=read(textSqlPath);
const migrations=Object.fromEntries(Object.keys(beforeMigrations).map(name=>[name,read('supabase/migrations/'+name)]));
const m5Source=migrations['20261110183047_s3_registered_business_proofs.sql'];
const identitySource=definition(migrations[m7.file],'auth_source_identity');
const checkSource=definition(m5Source,'check_ticket_claims');
const bridge=`
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $guard$
BEGIN
 IF current_setting('s47.fixture')<>'${project}' OR inet_server_addr() IS NOT NULL
 OR NOT EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND NOT enabled AND NOT proof_verifier_ready
   AND project_ref='${oldProject}' AND auth_issuer='${oldIssuer}')
 OR EXISTS(SELECT FROM site_data.sites) OR EXISTS(SELECT FROM site_private.proof_generations)
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='site_private.auth_source_identity()'::regprocedure)<>'${sha(identitySource.split('$fn$')[1])}'
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='site_private.check_ticket_claims(jsonb)'::regprocedure)<>'${sha(checkSource.split('$fn$')[1])}'
 THEN RAISE EXCEPTION 'S47_CLOSED_BRIDGE_SCOPE'; END IF;
END
$guard$;
ALTER TABLE site_private.business_runtime DROP CONSTRAINT business_runtime_project_ref_check, DROP CONSTRAINT business_runtime_auth_issuer_check;
UPDATE site_private.business_runtime SET project_ref='${project}',auth_issuer='${issuer}';
ALTER TABLE site_private.business_runtime
 ADD CONSTRAINT business_runtime_project_ref_check CHECK(project_ref='${project}'),
 ADD CONSTRAINT business_runtime_auth_issuer_check CHECK(auth_issuer='${issuer}');
${bound(identitySource,oldIssuer,issuer)}
${bound(checkSource,oldProject,project).replace(/^CREATE FUNCTION/,'CREATE OR REPLACE FUNCTION')}
COMMIT;
`;

let started=false, authority=false, armed=false, changedAcl=false, mf, authChild, restChild, authBase, authPort, origin, appPort;
let failed=false, cleanupFailed=false, loseFor, fingerprint, restEnv, writesFrozen=false, s47GateOpen=false, s47AclOpened=false;
const users=[];
const loginReplies=new Map();
const trustedTokens=new Set();
const nativeCounts={};
function start(bin,args,localEnv) {
  return spawn(bin,args,{env:{...env,...localEnv},cwd:build,stdio:'ignore'});
}
async function stop(child) {
  if (!child || child.exitCode!==null || child.signalCode!==null) return;
  const done=once(child,'exit');
  child.kill('SIGTERM');
  const timer=setTimeout(()=>child.kill('SIGKILL'),2500);
  try {await done;} finally {clearTimeout(timer);}
}
async function availablePort() {
  const server=createServer().listen(0,'127.0.0.1');
  await once(server,'listening');
  const port=server.address().port;
  await new Promise((res,rej)=>server.close(e=>e?rej(e):res()));
  return port;
}
const credential = 'sb_publishable_'+randomBytes(16).toString('hex');
let jwks;
async function authWire(p,{method='GET',token,body}={}) {
  assert.match(p,/^\/(?:health|\.well-known\/jwks\.json|user|token\?grant_type=password|logout\?scope=local|admin\/users)$/);
  return fetch(authBase+p,{method,redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
}
async function authProxy(request) {
  const url=new URL(request.url);
  assert.equal(url.origin,'https://users.auth.example.invalid');
  assert.equal(request.headers.get('apikey'),credential);
  const target=url.pathname.slice('/auth/v1'.length)+url.search;
  assert.ok(['/.well-known/jwks.json','/user','/token?grant_type=password','/logout?scope=local'].includes(target));
  const token=request.headers.get('authorization')?.slice('Bearer '.length);
  const submit=target==='/token?grant_type=password';
  if (submit) take('passwordLogins');
  const body=submit?await request.json():undefined;
  if (submit) assert.ok(users.some(u=>body.email===u.email && body.password===u.password));
  const result=await authWire(target,{method:request.method,token,body});
  if (submit && result.ok) loginReplies.set(body.email,await result.clone().json());
  return result;
}
function dbRequest(name,args,token,rollback=false) {
  const submit=JSON.stringify(args);
  return new Promise((resolve,reject)=>{
    const request=unixRequest({socketPath:restSock,path:'/rpc/'+name,method:'POST',agent:false,signal:AbortSignal.timeout(5000),
      headers:{'Content-Type':'application/json','Content-Profile':'site_api','Accept-Profile':'site_api',
        'Content-Length':Buffer.byteLength(submit),...(token?{Authorization:'Bearer '+token}:{}),...(rollback?{Prefer:'tx=rollback'}:{})}},async response=>{
      try {
        const pieces=[];
        let size=0;
        for await(const chunk of response) {
          size+=chunk.length;
          if(size>131072) throw Error('REST_SIZE');
          pieces.push(chunk);
        }
        const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(pieces));
        assert.ok(response.complete);
        resolve({status:response.statusCode,value:JSON.parse(raw),rolledBack:response.headers['preference-applied']==='tx=rollback'});
      } catch(e) {reject(e);}
    });
    request.once('error',reject);
    request.end(submit);
  });
}
async function rest(name,args,token,{setup=false,rollback=false}={}) {
  assert.ok(['get_my_site','read_introduction','save_text_draft','read_text_publication_operation',
    'apply_business_grant','create_site',...(full?s47RpcNames:[])].includes(name));
  take(...(!setup?['textHTTP']:[]),
    ...(['save_text_draft','save_resume_text'].includes(name)?['allSaveEntrances','nativeSaves']:[]),
    ...(['read_text_publication_operation','read_resume_text_operation','read_introduction_receipt'].includes(name)?['lookups']:[]),
    ...(name==='apply_business_grant'?['grants']:[]));
  nativeCounts[name]=(nativeCounts[name]??0)+1;
  const r=await dbRequest(name,args,token,rollback);
  witness.upstream.push({phase:witness.stage,rpc:name,status:r.status,
    ...(typeof r.value?.code==='string'&&/^(?:PGRST[0-9]+|[A-Z0-9]{5})$/.test(r.value.code)?{code:r.value.code}:{}),
    ...((args.input?.request_id||args.input?.requestId)?{requestId:args.input.request_id??args.input.requestId}:{}),transaction:r.rolledBack?'rollback-preference-applied':'default'});
  report();
  return r;
}
async function rpcProxy(request) {
  const url=new URL(request.url);
  assert.ok([privateOrigin,...(full?['https://users.resume.example.invalid']:[])].includes(url.origin));
  assert.equal(request.method,'POST');
  assert.equal(request.headers.has('cookie'),false);
  const name=url.pathname.slice('/rpc/'.length);
  assert.ok(['get_my_site','read_introduction','save_text_draft','read_text_publication_operation',...(full?s47RpcNames:[])].includes(name));
  const args=await request.json();
  const token=request.headers.get('authorization')?.slice('Bearer '.length);
  assert.ok(trustedTokens.has(token));
  const writing=['save_text_draft','save_resume_text'].includes(name);
  if(writing && writesFrozen)throw Error('SAVE_DISPATCH_FROZEN');
  let r;
  try {r=await rest(name,args,token);}
  catch(error){if(full&&writing)writesFrozen=true;throw error;}
  if(full&&writing&&r.status>=500)writesFrozen=true;
  if(name==='save_text_draft' && args.input?.request_id===loseFor && r.status===200){
    assert.equal(r.value.request_id,loseFor);
    writesFrozen=true;
    witness.deliberatelyLostCommittedReply=true;
    return Response.json({code:'LOCAL_RESPONSE_LOST'},{status:503});
  }
  return Response.json(r.value,{status:r.status});
}
const path='/api/sites/introduction';
async function dispatch(actor,{attempt,reconcile=false,anonymous=false}={}) {
  take('textHTTP',...(attempt&&!reconcile?['workerSaves','allSaveEntrances']:[]));
  const response=await mf.dispatchFetch(origin+path+(reconcile?'/operation':''),{
    method:attempt?'POST':'GET',redirect:'manual',
    headers:{...(!anonymous?{Cookie:actor.cookie,'X-Workspace-Draft-Scope':actor.scope}:{}),
      ...(attempt?{Origin:origin,'Content-Type':'application/json'}:{})},
    ...(attempt?{body:JSON.stringify(attempt.body)}:{})
  });
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('cloudflare-cdn-cache-control'),'no-store');
  assert.equal(response.headers.getSetCookie().length,0);
  return {status:response.status,value:await response.json()};
}
const stateCheck=`SELECT json_build_object(
 'sites',(SELECT count(*) FROM site_data.sites),
 'ownerMirrors',(SELECT count(*) FROM site_data.sites s JOIN site_data.site_members m ON (m.site_id,m.auth_user_id,m.role,m.state)=(s.id,s.owner_auth_user_id,'owner','active')),
 'drafts',(SELECT count(*) FROM site_data.draft_revisions),
 'siteRevisionSum',(SELECT sum(draft_revision) FROM site_data.sites),
 'sectionRevisionSum',(SELECT sum(revision) FROM site_data.section_state),
 'operations',(SELECT count(*) FROM site_private.operation_requests WHERE operation='save_text_draft'),
 'audits',(SELECT count(*) FROM site_private.text_publication_audit),
 'maps',(SELECT count(*) FROM site_private.text_digest_mappings),
 'published',(SELECT count(*) FROM site_data.site_publications WHERE state<>'unpublished' OR snapshot_id IS NOT NULL OR publication_revision<>0),
 'outbox',(SELECT count(*) FROM site_private.publication_outbox));`;
const legacyCheck=`SELECT json_build_object('sites',(SELECT count(*) FROM site_data.sites),
 'ownerMirrors',(SELECT count(*) FROM site_data.sites s JOIN site_data.site_members m ON (m.site_id,m.auth_user_id,m.role,m.state)=(s.id,s.owner_auth_user_id,'owner','active')),
 'revisions',(SELECT coalesce(json_agg(json_build_array(site_id,site_revision,digest,payload) ORDER BY site_id),'[]') FROM site_data.draft_revisions),
 'closed',(SELECT NOT enabled AND NOT proof_verifier_ready FROM site_private.business_runtime));`;
function gate(on, text=false) {
  const change=`UPDATE site_private.business_runtime SET enabled=${on},proof_verifier_ready=${on};`;
  sql(`BEGIN; SELECT pg_advisory_xact_lock(3303,5);
    ${on?"ALTER TABLE site_private.business_runtime DROP CONSTRAINT business_runtime_proof_verifier_ready_check;":''}
    ${change}
    ${text?`UPDATE site_private.text_publication_runtime SET write_enabled=${on},public_read_enabled=false,outbox_enabled=false;`:''}
    ${on?'':"ALTER TABLE site_private.business_runtime ADD CONSTRAINT business_runtime_proof_verifier_ready_check CHECK(NOT proof_verifier_ready);"}
    COMMIT;`);
  armed=on;
}
const rpcFunctions=[
 'site_api.apply_business_grant(jsonb)','site_api.create_site(jsonb)','site_api.get_my_site()',
 'site_api.read_introduction(uuid)','site_api.read_create_operation(jsonb)'
];
const saveFunctions=['site_api.save_text_draft(uuid,jsonb,text)','site_api.read_text_publication_operation(uuid,text,jsonb,text)'];
const publishFunctions=['site_api.publish_site(uuid,jsonb,text)','site_api.unpublish_site(uuid,jsonb,text)'];
const deniedRoles=['anon','authenticated','authenticator','service_role'];
const primary = {auth:'supabase_auth_admin',api:'ecv_s3_internal_api_login',reg:'ecv_s3_registration_login'};
const gen='s47-intro-once';
async function startRest() {
  assert.ok(!restChild || restChild.exitCode!==null || restChild.signalCode!==null);
  // Only reuse this run's mode-0700 directory, after the previous child exited.
  if(existsSync(restSock)) {
    assert.ok(lstatSync(restSock).isSocket());
    rmSync(restSock);
  }
  restChild=start(restBin,[],restEnv);
  for(let i=0;i<60&&!existsSync(restSock);i++){assert.equal(restChild.exitCode,null);await wait(50);}
  assert.ok(lstatSync(restSock).isSocket() && (lstatSync(restSock).mode&0o777)===0o600);
}
const receiptQuery=(pending)=>`SELECT json_build_object('state',CASE
    WHEN EXISTS(SELECT FROM site_private.operation_requests r WHERE r.request_id='${pending.requestId}'
      AND r.payload_digest='${pending.digest}' AND r.actor_auth_user_id='${pending.uid}'
      AND r.actor_session_id='${pending.sid}' AND r.site_id='${pending.siteId}' AND r.basis_draft_revision=${pending.basisRevision}
      AND r.operation='save_text_draft' AND r.state='succeeded') THEN 'committed'
    ELSE 'unobserved' END,'revision',(SELECT draft_revision FROM site_data.sites WHERE id='${pending.siteId}'),
    'audit',EXISTS(SELECT FROM site_private.text_publication_audit a JOIN site_private.operation_requests r
       ON (r.id,r.site_id)=(a.operation_id,a.site_id) WHERE r.request_id='${pending.requestId}' AND r.site_id='${pending.siteId}'));`;
function authenticate(token) {
  const parts=token.split('.');
  const head=JSON.parse(Buffer.from(parts[0],'base64url'));
  const claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  assert.equal(head.alg,'ES256');
  const key=jwks.keys.find(k=>k.kid===head.kid);
  assert.ok(key);
  assert.ok(verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{
    key:createPublicKey({key,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')));
  assert.equal(claims.iss,issuer);
  return claims;
}
function validateBoundary() {

  assert.equal(pg('postgres',['--version']),'postgres (PostgreSQL) 17.12');
  assert.equal(execute(restBin,['--version']),'PostgREST 16.6');
  assert.equal(execute(authBin,['version']),'v2.198.0');
  assert.equal(sha(textSql),textDigest);
  for(const [name,source] of Object.entries(migrations)) assert.equal(sha(source),beforeMigrations[name]);
  assert.equal(sha(bound(migrations[m7.file],m7.before,m7.after)),m7.newSha256);
  assert.equal(execute('/usr/bin/git',['rev-parse','origin/main']),baseline);
  if(full){
    assert.equal(execute('/usr/bin/git',['status','--porcelain']),'');
    assert.equal(sha(readFileSync(authBin)),'0d9fed811548b67c45b6a97306ca4eefcb6714011e5294c836e8abdaacfaeda1');
    assert.ok(process.env.S47_PLAYWRIGHT_MODULE && existsSync(process.env.S47_PLAYWRIGHT_MODULE),'PLAYWRIGHT_NOT_CONFIGURED');
  } else assert.equal(execute('/usr/bin/git',['diff','--name-only','HEAD',sourceHead]),'');
}
try {
  validateBoundary();
  root=mkdtempSync('/private/tmp/s47-');
  db=join(root,'db');
  restSock=join(root,'rest.sock');
  assert.equal(lstatSync(root).mode&0o777,0o700);
  authPort=await availablePort(); appPort=await availablePort();
  assert.notEqual(authPort,appPort);
  authBase='http://127.0.0.1:'+authPort; origin=(full?'https://localhost:':'http://127.0.0.1:')+appPort;
  const rollbackSource=bound(textSql,'\nCOMMIT;','\nROLLBACK;');
  const manifest={project,sourceHead,instance:sha(root),origin,authBase,pgTcp:false,privateRestUnix:true,
    postgresSocketPort:dbPort,limits,
    ...(full?{baseline,executionOrder:[...Object.keys(migrations),textSqlPath,...textCandidates.map(c=>c.path)],
      budgetAllocation:{workerAndNativeBusiness:limits.textHTTP-8,reconciliationHttpReserve:8,
        savesIncludingWorkerAndNative:limits.allSaveEntrances,lookups:limits.lookups,
        sqlCasesAndObservations:limits.sqlObservation-2,independentCloseReserve:2,
        maximumOwnerSites:2,cloudUSD:0},
      fullTextHarnessSHA256:sha(readFileSync(new URL('./full-text.mjs',import.meta.url))),
      ...(followUp?{targetedHarnessSHA256:sha(readFileSync(new URL('./targeted.mjs',import.meta.url))),
        roles:{postgrest:'ecv_s3_internal_api_login',request:'authenticated',authBootstrap:'supabase_auth_admin'},
        productionBaseline:{deployment:'9af7cb4e-3e42-4a7a-bbf3-c6e2f4fafadd',
          version:'08768067-69e7-4e7c-8813-12cf7b8ccc0e',percent:100}}:{}),
      candidateSql:textCandidates.map(({path,sha256})=>({path,sha256}))}:{}),
    authSource:'https://github.com/supabase/auth/releases/tag/v2.198.0',
    versions:{postgres:'17.12',postgrest:'16.6',goTrue:'2.198.0',node:process.versions.node,
      workerd:JSON.parse(read('node_modules/miniflare/package.json')).version},
    binaries:{postgres:sha(readFileSync(join(pgBin,'postgres'))),postgrest:sha(readFileSync(restBin)),auth:sha(readFileSync(authBin))},
    source:{migrations:beforeMigrations,m7Adapted:m7.newSha256,text:textDigest,rollback:sha(rollbackSource),localIssuerBridge:sha(bridge),
      workerArtifact:sha(readFileSync('dist/server/index.js')),harness:sha(readFileSync(fileURLToPath(import.meta.url)))}};
  assert.equal(manifest.versions.node,'24.22.1');
  const rawManifest=JSON.stringify(manifest,null,2)+'\n';
  writeFileSync(join(stageDir,'manifest.json'),rawManifest,{mode:0o600,flag:'wx'});
  witness.manifestSHA256=sha(rawManifest);
  phase('postgres-and-auth');
  pg('initdb',['-D',db,'-U','supabase_admin','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8']);
  pg('pg_ctl',['-D',db,'-l',join(root,'pg.log'),'-o',
    '-c listen_addresses= -k '+root+' -p '+dbPort+' -c unix_socket_permissions=0700 -c s47.fixture='+project,'-w','start']);
  started=true;
  const pin=obs(`SELECT json_build_object('scope',current_setting('s47.fixture'),
    'fingerprint',encode(sha256(convert_to((SELECT system_identifier::text FROM pg_control_system())||'/'||
      (SELECT oid::text FROM pg_database WHERE datname=current_database()),'UTF8')),'hex'),
    'tcpOff',current_setting('listen_addresses')='' AND inet_server_addr() IS NULL,
    'pinnedSocket',current_setting('unix_socket_directories')=${literal(root)},
    'bootstrap',EXISTS(SELECT FROM pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper));`);
  assert.ok(pin.scope===project && pin.tcpOff && pin.pinnedSocket && pin.bootstrap);
  fingerprint=pin.fingerprint;
  mark('unix-only target fingerprint', {fingerprint});
  sql(`
    CREATE ROLE postgres LOGIN INHERIT CREATEROLE NOSUPERUSER BYPASSRLS;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE authenticator NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE supabase_auth_admin LOGIN CREATEROLE NOINHERIT NOBYPASSRLS;
    GRANT authenticated TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE GRANTED BY supabase_admin;
    GRANT CREATE ON DATABASE postgres TO postgres,supabase_auth_admin;
    ALTER SCHEMA public OWNER TO postgres;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    GRANT USAGE ON SCHEMA extensions TO postgres WITH GRANT OPTION;
    CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
    ALTER ROLE supabase_auth_admin SET search_path=auth;
  `);
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const key={...pair.privateKey.export({format:'jwk'}),kid:'s47-intro-es256',alg:'ES256',use:'sig',key_ops:['sign']};
  const dsn=p=>`postgresql://${p}@localhost:${dbPort}/postgres?host=${encodeURIComponent(root)}&sslmode=disable`;
  const authEnv={GOTRUE_JWT_SECRET:randomBytes(32).toString('hex'),GOTRUE_JWT_KEYS:JSON.stringify([key]),
    GOTRUE_JWT_ISSUER:issuer,GOTRUE_JWT_EXP:'900',GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',
    GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_DB_DRIVER:'postgres',DB_NAMESPACE:'auth',DATABASE_URL:dsn(primary.auth),
    API_EXTERNAL_URL:authBase,GOTRUE_API_HOST:'127.0.0.1',PORT:String(authPort),GOTRUE_SITE_URL:origin,
    GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_MAILER_AUTOCONFIRM:'true',
    GOTRUE_SMTP_HOST:'127.0.0.1',GOTRUE_SMTP_PORT:'1'};
  execute(authBin,['migrate'],{cwd:build,env:{...env,...authEnv}});
  authChild=start(authBin,['serve'],authEnv);
  for(let i=0;i<50&&!jwks;i++){
    assert.equal(authChild.exitCode,null);
    try {const r=await authWire('/.well-known/jwks.json');if(r.ok)jwks=await r.json();} catch { /* The listener may still be starting. */ }
    if(!jwks)await wait(70);
  }
  const pub=pair.publicKey.export({format:'jwk'});
  assert.equal(jwks?.keys?.length,1);
  assert.ok(['kty','crv','x','y'].every(k=>jwks.keys[0][k]===pub[k]));
  assert.equal((await (await authWire('/health')).json()).version,'v2.198.0');
  mark('native GoTrue and run-bound ES256 JWKS',{jwksSHA256:sha(JSON.stringify(jwks))});
  sql(`SET ROLE supabase_auth_admin;
    GRANT USAGE ON SCHEMA auth TO postgres;
    GRANT SELECT(id,email_confirmed_at,banned_until,is_anonymous), REFERENCES(id) ON auth.users TO postgres;
    GRANT SELECT(id,user_id,not_after) ON auth.sessions TO postgres;
    RESET ROLE;`);
  phase('M1–M7-closed-install');
  for(const [file,source] of Object.entries(migrations)){
    sql(file===m7.file?bound(source,m7.before,m7.after):source,'postgres');
    if(file==='20261107180504_s3_security_foundation.sql') sql('GRANT USAGE ON SCHEMA site_data,site_private,site_api TO postgres;');
    if(file==='20261109104800_s3_business_grants.sql') sql('GRANT SELECT ON site_private.business_runtime TO postgres;');
    witness.lastMigration=file;
    report();
  }
  authority=true;
  sql(bridge);
  const before=obs(`SELECT json_build_object(
    'hold',NOT enabled AND NOT proof_verifier_ready,'fixture',project_ref,'issuer',auth_issuer,
    'publicOrHostedConnections',(SELECT count(*) FROM pg_stat_activity WHERE client_addr IS NOT NULL),
    'privateRolesInitiallyInactive',(SELECT count(*) FROM pg_roles WHERE rolname IN ('${primary.api}','${primary.reg}') AND NOT rolcanlogin))
    FROM site_private.business_runtime;`);
  assert.deepEqual(before,{hold:true,fixture:project,issuer,publicOrHostedConnections:0,privateRolesInitiallyInactive:2});
  mark('M1–M7 closed with exact local project and issuer');

  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  for(const name of ['a','b']){
    const input=encode({alg:'ES256',kid:key.kid,typ:'JWT'})+'.'+encode({role:'service_role',exp:Math.floor(Date.now()/1000)+30});
    const adminJWT=input+'.'+sign('sha256',Buffer.from(input),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
    const email=project+'-'+name+'@example.invalid', password=randomBytes(24).toString('base64url');
    const response=await authWire('/admin/users',{method:'POST',token:adminJWT,body:{email,password,email_confirm:true}});
    assert.equal(response.status,200);
    const u=await response.json();assert.ok(uuid(u.id) && u.email===email);
    users.push({email,password,uid:u.id,name});
  }
  const [a,b]=users;
  mf=runtime({port:appPort,...(full?{https:true}:{}),bindings:{USERS_CURRENT_PASSWORD_POLICY:'ON',USERS_MODE:'isolated',USERS_PROJECT_REF:'isolated-users',
    USERS_SUPABASE_URL:'https://users.auth.example.invalid',USERS_PUBLISHABLE_KEY:credential,USERS_APP_ORIGIN:origin,
    USERS_INTRODUCTION_MODE:'synthetic',...(full?{USERS_RESUME_TEXT_MODE:'synthetic'}:{})},
    serviceBindings:{USERS_INTRODUCTION_RPC:rpcProxy,...(full?{USERS_RESUME_TEXT_RPC:rpcProxy}:{})},outboundService:authProxy});
  await mf.ready;
  for(const actor of users) {
    const r=await mf.dispatchFetch(origin+'/api/account/login',{method:'POST',
      headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:actor.email,password:actor.password})});
    assert.equal(r.status,200,(await r.clone().json()).code);
    actor.cookie=r.headers.getSetCookie().map(line=>line.split(';',1)[0]).join('; ');
    assert.ok(actor.cookie.startsWith('__Host-ecv-users-session'));
    const captured=loginReplies.get(actor.email);
    assert.equal(captured.user.id,actor.uid);
    actor.token=captured.access_token;
    trustedTokens.add(actor.token);
    const claims=authenticate(actor.token);
    assert.ok(claims.sub===actor.uid && uuid(claims.session_id) && claims.amr.some(x=>x.method==='password'));
    actor.sid=claims.session_id;
    actor.scope=sha(JSON.stringify(['workspace-draft',actor.uid,actor.sid]));
  }
  loginReplies.clear();
  const nativeSessions=obs(`SELECT json_build_object('accounts',(SELECT count(*) FROM auth.users),
    'sessions',(SELECT count(*) FROM auth.sessions),
    'bound',(SELECT count(*) FROM auth.sessions WHERE (user_id,id) IN (('${a.uid}','${a.sid}'),('${b.uid}','${b.sid}'))),
    'refresh',(SELECT count(*) FROM auth.refresh_tokens WHERE NOT revoked AND session_id IN ('${a.sid}','${b.sid}')));`);
  assert.deepEqual(nativeSessions,{accounts:2,sessions:2,bound:2,refresh:2});
  mark('two real Worker password logins and UID/SID/refresh readback',nativeSessions);

  phase('M3-original-transaction');
  const now=Math.floor(Date.now()/1000);
  take('generations');
  sql(`BEGIN;
    INSERT INTO site_private.proof_generations(key_id,not_before,sign_until,verify_until)
      VALUES('${gen}',to_timestamp(${now-10}),to_timestamp(${now+600}),to_timestamp(${now+720}));
    INSERT INTO site_private.user_security_state(auth_user_id,business_enabled,security_hold,hold_reason)
      VALUES('${a.uid}',true,false,'none'),('${b.uid}',true,false,'none');
    ALTER ROLE ${primary.api} LOGIN; ALTER ROLE ${primary.reg} LOGIN;
    COMMIT;`);
  restEnv={PGRST_DB_URI:dsn(primary.api),PGRST_DB_SCHEMAS:'site_api',PGRST_DB_CONFIG:'false',
    PGRST_DB_CHANNEL_ENABLED:'false',PGRST_DB_POOL:'2',PGRST_OPENAPI_MODE:'disabled',PGRST_JWT_AUD:'authenticated',
    PGRST_JWT_SECRET:JSON.stringify(jwks),PGRST_SERVER_UNIX_SOCKET:restSock,PGRST_SERVER_UNIX_SOCKET_MODE:'600',PGRST_LOG_LEVEL:'crit',PGRST_DB_TX_END:'commit-allow-override'};
  await startRest();
  gate(true);
  const macKey=await crypto.subtle.importKey('raw',randomBytes(32),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signing={project,id:gen,notBefore:now-10,signUntil:now+600,verifyUntil:now+720,revoked:false,macKey};
  const identity=createIdentityAdapter({issuer,auth:{
    getClaims:async token=>({data:{claims:authenticate(token)}}),
    getUser:async token=>{const r=await authWire('/user',{token});assert.equal(r.status,200);return {data:{user:await r.json()}};}
  }});
  const binding=createBusinessBinding({project,authIssuer:issuer,privateOrigin,registrarHost:'db.s47.example.invalid',testOnly:true});
  async function grant(actor) {
    const handle=await identity.verifyAccount(actor.token);
    assert.deepEqual(accountContext(handle),{uid:actor.uid,session_id:actor.sid});
    const issued=Math.floor(Date.now()/1000);
    const proof={version:1,project,action:'issue',purpose:'business',uid:actor.uid,session_id:actor.sid,epoch:0,
      proof_id:randomUUID(),issued_at:issued,expires_at:issued+50,payload_digest:'',key_id:gen,event:'password-login'};
    proof.payload_digest=await sha256(grantBytes(proof));
    const signature=hex(await crypto.subtle.sign('HMAC',macKey,proofBytes(proof)));
    const checked=await verifySecurityEnvelope('issue',handle,{proof,signature},{binding,identity,enabled:true,
      lookupKey:async id=>id===gen?signing:null});
    assert.equal(sql(`SELECT site_private.register_business_ticket(${json(checked)});`,primary.reg),'t');
    const r=await rest('apply_business_grant',{envelope:{proof:checked}},actor.token,{setup:true});
    assert.equal(r.status,200,r.value.code);
    assert.ok(r.value.status==='active' && uuid(r.value.grant_id));
    actor.grant=r.value.grant_id;
  }
  for(const actor of users)await grant(actor);
  for(const actor of users){
    const r=await rest('create_site',{input:{schema_version:1,request_id:randomUUID(),slug:'s47-intro-'+actor.name,default_locale:'en'}},actor.token,{setup:true});
    assert.equal(r.status,200,r.value.code);
    assert.ok(uuid(r.value.site_id) && r.value.persisted);
    actor.site=r.value.site_id;
  }
  gate(false);
  const legacy=obs(legacyCheck);
  assert.ok(legacy.closed && legacy.sites===2 && legacy.ownerMirrors===2 && legacy.revisions.length===2 &&
    legacy.revisions.every(e=>e[1]===0));
  mark('original M3 produced two revision-zero sites and Owner mirrors');

  phase('S3.6-01-rollback-and-install');
  sql(rollbackSource,'postgres');
  assert.deepEqual(obs(legacyCheck),legacy);
  assert.equal(obs("SELECT to_json(to_regclass('site_private.text_publication_runtime') IS NULL AND to_regrole('ecv_s36_public_reader') IS NULL);"),true);
  mark('independent readback verified rolled-back S3.6 01');
  sql(textSql,'postgres');
  assert.deepEqual(obs(legacyCheck),legacy);
  assert.equal(obs(`SELECT to_json(NOT write_enabled AND NOT public_read_enabled AND NOT outbox_enabled
    AND NOT EXISTS(SELECT FROM site_private.text_digest_mappings)) FROM site_private.text_publication_runtime;`),true);
  mark('closed S3.6 01 preserved legacy bytes, digest and Owner mirror');
  sql(`REVOKE EXECUTE ON FUNCTION ${publishFunctions.join(',')} FROM authenticated;
       REVOKE EXECUTE ON FUNCTION public.read_public_text(text,text) FROM anon;`);
  changedAcl=true;
  if(full){
    phase('S4.7-candidates-closed-install');
    for(const candidate of textCandidates){
      sql(candidate.source,'postgres');
      mark('closed candidate installed',{path:candidate.path,sha256:candidate.sha256});
    }
    const catalog=obs(`SELECT json_build_object(
      'tables',(SELECT count(*) FROM pg_class WHERE oid IN (
        'site_private.resume_text_runtime'::regclass,'site_private.resume_text_revisions'::regclass,
        'site_private.resume_text_receipts'::regclass,'site_private.resume_text_record_ids'::regclass) AND relrowsecurity AND relforcerowsecurity),
      'functions',(SELECT count(*) FROM pg_proc WHERE oid IN (${s47Functions.map(f=>literal(f)+'::regprocedure').join(',')})
       AND prosecdef AND pg_get_userbyid(proowner)='ecv_s3_command_writer'
       AND NOT has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE')
       AND NOT has_function_privilege('authenticator',oid,'EXECUTE') AND NOT has_function_privilege('service_role',oid,'EXECUTE')),
      'physicalGate',(SELECT NOT enabled FROM site_private.resume_text_runtime WHERE singleton)
        AND EXISTS(SELECT FROM pg_constraint WHERE conrelid='site_private.resume_text_runtime'::regclass
          AND conname='resume_text_runtime_enabled_check' AND convalidated));`);
    assert.deepEqual(catalog,{tables:4,functions:4,physicalGate:true});
    mark('S4.7 catalog verified closed',catalog);
    sql(`GRANT EXECUTE ON FUNCTION ${s47Functions.join(',')} TO authenticated;`);
    s47AclOpened=true;
  }
  assert.equal(obs(`SELECT to_json(NOT has_function_privilege('authenticated','${publishFunctions[0]}','EXECUTE')
    AND NOT has_function_privilege('authenticated','${publishFunctions[1]}','EXECUTE')
    AND NOT has_function_privilege('anon','public.read_public_text(text,text)','EXECUTE')
    AND EXISTS(SELECT FROM pg_trigger WHERE tgrelid='site_data.site_members'::regclass AND tgname='members_integrity' AND tgenabled='O')); `),true);
  const readiness = {target:a.site,operation:'save_text_draft',
    input:{schema_version:1,request_id:randomUUID(),expected_draft_revision:0,payload:{schema_version:1,entries:[]}}};
  readiness.canonical_request=JSON.stringify({operation:readiness.operation,...readiness.input});
  let r=await rest('read_text_publication_operation',readiness,a.token);
  const staleCache=r.status===404&&r.value.code==='PGRST202';
  assert.ok(staleCache || r.status===403 || r.status===503);
  await stop(restChild);
  await startRest();
  r=await rest('read_text_publication_operation',readiness,a.token);
  assert.ok((r.status===403&&r.value.code==='42501')||(r.status===503&&r.value.code==='PT503'),'loaded RPC must reach closed database gate');
  const apiReady=obs(`SELECT json_build_object('execute',bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE')),
    'count',count(*),'rlsGate',(SELECT NOT enabled AND NOT proof_verifier_ready FROM site_private.business_runtime))
    FROM pg_proc p WHERE p.oid IN ('${saveFunctions[0]}'::regprocedure,'${saveFunctions[1]}'::regprocedure);`);
  assert.deepEqual(apiReady,{execute:true,count:2,rlsGate:true});
  mark('closed PostgREST schema-cache readiness',{staleCacheReproduced:staleCache,refreshedStatus:r.status,code:r.value.code});
  if(full){
    for(const [name,args] of Object.entries({
      read_resume_text:{target:a.site,section_key:'profile'},
      read_resume_text_operation:{target:a.site,section_key:'profile',operation_id:randomUUID(),request_digest:'0'.repeat(64),basis:0},
      read_introduction_receipt:{target:a.site,operation_id:randomUUID(),request_digest:'0'.repeat(64),basis:0},
    })){
      const probe=await rest(name,args,a.token);
      assert.ok((probe.status===403&&probe.value.code==='42501')||(probe.status===503&&probe.value.code==='PT503'));
    }
    mark('S4.7 read RPC schema cache and closed execution verified');
    sql(`BEGIN;
      ALTER TABLE site_private.resume_text_runtime DROP CONSTRAINT resume_text_runtime_enabled_check;
      UPDATE site_private.resume_text_runtime SET enabled=true;
      COMMIT;`);
    s47GateOpen=true;
  }
  gate(true,true);

  if(full){
    async function adoptBrowserSession(owner){
      const captured=loginReplies.get(owner.email);
      assert.ok(captured && captured.user.id===owner.uid);
      const claims=authenticate(captured.access_token);
      assert.ok(claims.sub===owner.uid&&uuid(claims.session_id)&&claims.session_id!==owner.sid);
      const actor={...owner,token:captured.access_token,sid:claims.session_id,
        scope:sha(JSON.stringify(['workspace-draft',owner.uid,claims.session_id]))};
      loginReplies.delete(owner.email);
      trustedTokens.add(actor.token);
      await grant(actor);
      return actor;
    }
    const result=await (followUp?runTargeted:runFullText)({a,b,origin,mf,obs,sql,rest,dispatch,mark,phase,take,counts,witness,adoptBrowserSession,checkDenial,deniedRoles,
      followUp,ensureBudget,journal:note,freeze:()=>{writesFrozen=true;},lostKey:key=>{loseFor=key;},
      resumeAfterProof:()=>{assert.ok(writesFrozen && !stopRequested);writesFrozen=false;}});
    witness.gRead=result.gRead;
    witness.gSave=result.gSave;
  } else {
  phase('G-READ');
  assert.equal((await dispatch(a,{anonymous:true})).status,401);
  for(const actor of users){
    const got=await dispatch(actor);
    assert.equal(got.status,200,got.value.code);
    assert.ok(got.value.siteId===actor.site && got.value.revision===0 && uuid(got.value.record.id));
    assert.deepEqual(introductionText(got.value),{zh:'',en:''});
    actor.initial=got.value;
  }
  const cross=await rest('read_introduction',{target:b.site},a.token);
  assert.deepEqual({status:cross.status,code:cross.value.code},{status:403,code:'42501'});
  for(const role of deniedRoles)
    checkDenial('supabase_admin',`SET SESSION AUTHORIZATION ${role}; SELECT site_api.read_introduction('${a.site}');`);
  mark('real two-Owner reads, empty projections, cache closure, anonymous denial, native cross-site and SQL roles',{
    directRoles:deniedRoles,sqlstate:'42501',postgresConnectionRole:primary.api,requestRole:'authenticated'});
  witness.gRead='LOCAL_CORE_PASS';

  phase('G-SAVE');
  const make=(base,zh,en,id=randomUUID())=>prepareIntroduction(base,{zh,en},id);
  const journal=createAcceptanceSave({journal:note,
    allowed:()=>armed && counts.textHTTP<=44 && counts.lookups<limits.lookups && counts.sqlObservation<limits.sqlObservation-2,
    reconcile:attempt=>dispatch(a,{attempt,reconcile:true}), inspect:pending=>obs(receiptQuery(pending))});
  const subject={uid:a.uid,sid:a.sid};
  const save=attempt=>journal.run(subject,attempt,()=>dispatch(a,{attempt}),
    value=>value.status===200?parseSaveReceipt(value.value,attempt):undefined);
  const attempt=make(a.initial,'合成中文 引号“”','Synthetic English — bilingual');
  const first=await save(attempt);
  if(first.outcome!=='confirmed'){
    witness.gSave=first.outcome;
    throw Error('INITIAL_SAVE_NOT_CONFIRMED');
  }
  const saved=first.result;
  assert.equal(saved.revision,1);
  assert.deepEqual(introductionText(saved),attempt.submitted);
  const afterFirst=obs(stateCheck);
  assert.deepEqual(afterFirst,{sites:2,ownerMirrors:2,drafts:3,siteRevisionSum:1,sectionRevisionSum:1,operations:1,audits:1,maps:1,published:0,outbox:0});
  mark('atomic bilingual write with canonical native receipt and immutable history',afterFirst);

  const same=await dispatch(a,{attempt,reconcile:true});
  assert.deepEqual(same,first.response);
  const wrongDigest=make(a.initial,'不同命令','Different content',attempt.body.command.request_id);
  assert.deepEqual((await save(wrongDigest)).response,{status:409,value:{code:'REQUEST_CONFLICT'}});
  const wrongRecord={body:structuredClone(make(saved,'换记录','Wrong record').body)};
  wrongRecord.body.command.payload.entries[0].id=b.initial.record.id;
  wrongRecord.digest=(async()=>sha(textDraftArgs(a.site,wrongRecord.body.command).canonical_request))();
  assert.deepEqual((await save(wrongRecord)).response,{status:400,value:{code:'INVALID_INPUT'}});
  const stale=make(a.initial,'旧修订','Stale revision');
  const native=(candidate,options={})=>journal.run(subject,candidate,()=>rest('save_text_draft',
    textDraftArgs(a.site,candidate.body.command),a.token,options).then(r=>{
      if(r.status===409&&r.value.code==='PT409')return {...r,value:{code:'REQUEST_CONFLICT'}};
      return r;
    }),async r=>options.rollback&&r.status===200&&r.rolledBack?r.value:undefined);
  const rejected=await native(stale);
  assert.equal(rejected.outcome,'rejected');
  const rollback=make(saved,'应回滚','Must roll back');
  const rolledBack=await native(rollback,{rollback:true});
  assert.equal(rolledBack.outcome,'confirmed');
  assert.equal(rolledBack.result.draft_revision,2);
  assert.deepEqual(obs(stateCheck),afterFirst);
  assert.equal(obs(`SELECT to_json(NOT EXISTS(SELECT FROM site_private.operation_requests WHERE request_id='${rollback.body.command.request_id}')); `),true);
  mark('same-key receipt, digest mismatch, wrong record, native CAS and PostgreSQL rollback',
    {rollback:'commit-allow-override; tx=rollback',sameRevision:true,unchangedCounters:true});

  const clear=make(saved,'','');
  loseFor=clear.body.command.request_id;
  const recovered=await save(clear);
  assert.ok(witness.deliberatelyLostCommittedReply);
  assert.equal(recovered.outcome,'reconciled');
  const cleared=recovered.result;
  assert.equal(cleared.revision,2);
  assert.deepEqual(introductionText(cleared),{zh:'',en:''});
  assert.deepEqual(cleared.record.translations,{zh:'',en:''});
  assert.deepEqual(await dispatch(a),{status:200,value:cleared});
  const afterClear={...afterFirst,drafts:4,siteRevisionSum:2,sectionRevisionSum:2,operations:2,audits:2};
  assert.deepEqual(obs(stateCheck),afterClear);
  mark('deliberate response loss reconciled the original native commit, blank saved and reread',afterClear);
  witness.gSave='LOCAL_CORE_PASS';

  phase('revocation-and-expiry');
  sql(`UPDATE site_private.business_session_grants SET revoked_at=clock_timestamp(),reason='user_logout'
    WHERE id='${a.grant}' AND auth_user_id='${a.uid}' AND auth_session_id='${a.sid}' AND revoked_at IS NULL;
    UPDATE auth.sessions SET not_after=clock_timestamp()+interval '2 seconds'
    WHERE id='${b.sid}' AND user_id='${b.uid}';`);
  assert.equal((await dispatch(a)).status,403);
  await wait(2300);
  const deniedSave=actor=>dispatch(actor,{attempt:make(actor.initial,'拒绝','Denied')});
  const savesBefore=counts.nativeSaves;
  assert.equal((await deniedSave(a)).status,403);
  const expired=await dispatch(b);
  assert.ok([401,403].includes((await deniedSave(b)).status));
  assert.equal(counts.nativeSaves,savesBefore);
  assert.ok([401,403].includes(expired.status));
  const qualifiedClosed=obs(`SELECT json_build_object('grantRevoked',
   EXISTS(SELECT FROM site_private.business_session_grants WHERE id='${a.grant}' AND revoked_at IS NOT NULL),
   'sessionExpired',EXISTS(SELECT FROM auth.sessions WHERE id='${b.sid}' AND not_after<=clock_timestamp()),
   'grantStillLiveUntilCleanup',EXISTS(SELECT FROM site_private.business_session_grants WHERE id='${b.grant}' AND revoked_at IS NULL AND expires_at>clock_timestamp()));`);
  assert.deepEqual(qualifiedClosed,{grantRevoked:true,sessionExpired:true,grantStillLiveUntilCleanup:true});
  mark('grant revocation and elapsed native session deadline are independently rejected',{revoked:403,expired:expired.status});
  witness.gRead='LOCAL_PASS';witness.gSave='LOCAL_PASS';
  }
} catch(error) {
  failed=true;
  witness.failure={stage:witness.stage,name:error?.name,assertion:error?.code??null,
    sqlstate:(typeof error?.stderr==='string'?error.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]:undefined)??null,
    diagnostic:typeof error?.stderr==='string' ? error.stderr.split('\n').find(s=>s.includes('ERROR:'))?.slice(0,350) :
     /^[A-Z_0-9]+$/.test(error?.message??'')?error.message:undefined,
    ...(error?.code==='ERR_ASSERTION' && typeof error.actual==='number' && typeof error.expected==='number'?
      {actual:error.actual,expected:error.expected}:{}),
    sourceLine:error?.stack?.match(/(?:run-introduction|full-text|targeted)\.mjs:(\d+):/)?.[1]};
  console.error('STOP',JSON.stringify(witness.failure));
} finally {
  phase('cleanup');
  if(started) {
    try {
      if(authority) {
        sql(`BEGIN; SELECT pg_advisory_xact_lock(3303,5);
          UPDATE site_private.business_runtime SET enabled=false,proof_verifier_ready=false;
          DO $close$ BEGIN IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='site_private.business_runtime'::regclass
            AND conname='business_runtime_proof_verifier_ready_check') THEN
            ALTER TABLE site_private.business_runtime ADD CONSTRAINT business_runtime_proof_verifier_ready_check CHECK(NOT proof_verifier_ready);
          END IF; END $close$;
          UPDATE site_private.business_session_grants SET revoked_at=clock_timestamp(),reason='user_logout' WHERE revoked_at IS NULL;
          UPDATE site_private.proof_generations SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL;
          UPDATE site_private.user_security_state SET business_enabled=false,security_hold=true,hold_reason='administrative';
          REVOKE EXECUTE ON FUNCTION ${rpcFunctions.join(',')} FROM authenticated;
          REVOKE USAGE ON SCHEMA site_api FROM authenticated;
          ${changedAcl?`UPDATE site_private.text_publication_runtime SET write_enabled=false,public_read_enabled=false,outbox_enabled=false;
            REVOKE EXECUTE ON FUNCTION ${[...saveFunctions,...publishFunctions].join(',')} FROM authenticated;
            REVOKE EXECUTE ON FUNCTION public.read_public_text(text,text) FROM anon;`:''}
          ${full?`DO $s47$ BEGIN
            IF to_regclass('site_private.resume_text_runtime') IS NOT NULL THEN
              UPDATE site_private.resume_text_runtime SET enabled=false;
              IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='site_private.resume_text_runtime'::regclass
                AND conname='resume_text_runtime_enabled_check') THEN
                ALTER TABLE site_private.resume_text_runtime ADD CONSTRAINT resume_text_runtime_enabled_check CHECK(NOT enabled);
              END IF;
            END IF;
          END $s47$;
          ${s47AclOpened?'REVOKE EXECUTE ON FUNCTION '+s47Functions.join(',')+' FROM authenticated;':''}`:''}
          ALTER ROLE ${primary.api} NOLOGIN PASSWORD NULL;
          ALTER ROLE ${primary.reg} NOLOGIN PASSWORD NULL;
          COMMIT;`);
      }
    } catch {cleanupFailed=true;witness.closeError='AUTHORITY_CLOSE_FAILED';}
    try {
      await mf?.dispose();
      await stop(restChild);
      await stop(authChild);
      sql(`DO $cleanup$ BEGIN
        IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN DELETE FROM auth.refresh_tokens; END IF;
        IF to_regclass('auth.sessions') IS NOT NULL THEN DELETE FROM auth.sessions; END IF;
        IF EXISTS(SELECT FROM pg_roles WHERE rolname='${primary.auth}') THEN
          ALTER ROLE ${primary.auth} NOLOGIN NOCREATEROLE PASSWORD NULL;
          REVOKE CREATE ON DATABASE postgres FROM ${primary.auth};
        END IF;
        IF EXISTS(SELECT FROM pg_roles WHERE rolname='postgres') THEN
          ALTER ROLE postgres NOLOGIN NOCREATEROLE PASSWORD NULL;
          REVOKE CREATE ON DATABASE postgres FROM postgres;
        END IF;
      END $cleanup$;`);
      if(authority){
        const closed=obs(`SELECT json_build_object(
          'businessGateClosed',(SELECT NOT enabled AND NOT proof_verifier_ready FROM site_private.business_runtime),
          'physicalLatch',EXISTS(SELECT FROM pg_constraint WHERE conrelid='site_private.business_runtime'::regclass
            AND conname='business_runtime_proof_verifier_ready_check' AND convalidated),
          'activeGrants',(SELECT count(*) FROM site_private.business_session_grants WHERE revoked_at IS NULL),
          'activeGenerations',(SELECT count(*) FROM site_private.proof_generations WHERE revoked_at IS NULL),
          'sessions',(SELECT count(*) FROM auth.sessions),'refreshTokens',(SELECT count(*) FROM auth.refresh_tokens),
          'otherConnections',(SELECT count(*) FROM pg_stat_activity WHERE datname='postgres' AND pid<>pg_backend_pid()),
          'openLoginRoles',(SELECT count(*) FROM pg_roles WHERE rolname IN ('${primary.api}','${primary.reg}','${primary.auth}','postgres') AND rolcanlogin),
          'privateRpcSchemaUsage',has_schema_privilege('authenticated','site_api','USAGE'),
          'rpcExecuteGrants',(SELECT count(*) FROM pg_proc WHERE pronamespace='site_api'::regnamespace AND has_function_privilege('authenticated',oid,'EXECUTE')),
          ${s47GateOpen?`'s47Closed',(SELECT NOT enabled FROM site_private.resume_text_runtime WHERE singleton)
            AND EXISTS(SELECT FROM pg_constraint WHERE conrelid='site_private.resume_text_runtime'::regclass
              AND conname='resume_text_runtime_enabled_check' AND convalidated),`:''}
          'testHookPresent',to_regprocedure('site_private.s47_test_abort_save()') IS NOT NULL,
          'textGatesClosed',${changedAcl?'(SELECT NOT write_enabled AND NOT public_read_enabled AND NOT outbox_enabled FROM site_private.text_publication_runtime)':'NULL'});`);
        witness.closed=closed;report();
        assert.ok(closed.businessGateClosed && closed.physicalLatch && !closed.privateRpcSchemaUsage && !closed.testHookPresent &&
          ['activeGrants','activeGenerations','sessions','refreshTokens','otherConnections','openLoginRoles','rpcExecuteGrants'].every(k=>closed[k]===0) &&
          (!changedAcl||closed.textGatesClosed) && (!s47GateOpen||closed.s47Closed));
      }
    } catch(e){cleanupFailed=true;witness.closeError??='INDEPENDENT_CLOSE_WITNESS_FAILED';
      witness.closeDiagnostic=typeof e?.stderr==='string'?e.stderr.split('\n').find(s=>s.includes('ERROR:'))?.slice(0,240):undefined;}
    try {pg('pg_ctl',['-D',db,'-m','fast','-w','stop']); started=false;} catch {cleanupFailed=true;witness.pgStopError=true;}
  }
  try {await mf?.dispose();await stop(restChild);await stop(authChild);} catch {cleanupFailed=true;witness.childStopError=true;}
  if(root&&!started){
    const real=realpathSync(root);
    assert.ok(/^\/private\/tmp\/s47-[A-Za-z0-9]{6}$/.test(real) && lstatSync(real).uid===process.getuid());
    rmSync(root,{recursive:true,force:true});
  }
  const listening=spawnSync('/usr/sbin/lsof',['-nP','-iTCP','-sTCP:LISTEN'],{encoding:'utf8'}).stdout??'';
  const portStillBound=p=>p?new RegExp(':'+p+'\\s+[(]LISTEN[)]').test(listening):false;
  witness.cleanup={dbDirectoryRemoved:!root||!existsSync(root),postgresSocketRemoved:!root||!existsSync(join(root,'.s.PGSQL.'+dbPort)),
    postgrestSocketRemoved:!existsSync(restSock),authPortClosed:!portStillBound(authPort),workerPortClosed:!portStillBound(appPort),
    authExited:!authChild||authChild.exitCode!==null||authChild.signalCode!==null,
    postgrestExited:!restChild||restChild.exitCode!==null||restChild.signalCode!==null,dockerCommands:0,hostedRequests:0};
  cleanupFailed ||= Object.values(witness.cleanup).some(v=>typeof v==='boolean'&&!v);
  witness.nativeRpcCounts=nativeCounts;
  witness.outcome=cleanupFailed?'CLEANUP_UNCONFIRMED':failed?'STOPPED_AND_CLEANED':'LOCAL_PASS_CLEANED';
  report();
  console.log('OUTCOME',witness.outcome);
  if(cleanupFailed||failed) process.exitCode=1;
}
