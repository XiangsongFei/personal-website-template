import{safeUdsTrace,withUdsAttribution}from'./uds-transport.mjs';
import {P14R_SCOPE,TAIL_SCOPE,isContinuation,profilePin} from './contract.mjs';
// REAL adapter is inert at import. Construction requires a NEW, pinned external
// approval plus independent review. No Docker create/start command exists here.
import {readFileSync,lstatSync,realpathSync,statfsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createHmac,randomBytes,X509Certificate} from 'node:crypto';
import {need,DriverStop,hash,same,canonical} from './state.mjs';
import {root,pins,loadContract,PROJECT,DB,API,AUTH,ISSUER,ALICE,BOB,CHARLIE,REMAINING_SCOPE} from './contract.mjs';
import {remainingContract,remainingAuthority,dispatchId} from './remaining.mjs';
import {command,psql,SqlSession} from './io.mjs';
import {httpsJson,pinnedPg,registrarClientClass,directUnix,mailJson,correlateDatabase,unexpectedOuterEvidence} from './transport.mjs';
import {observationSQL,finalObservationSQL,maintenanceSQL,fenceSQL,queueSQL} from './sql.mjs';
import {binding,PRIVATE_ORIGIN,WORKER_PIN} from '../clean-candidate/service.mjs';
import {IMAGE,inspectedImageGate} from '../clean-candidate/image-identity.mjs';
import {createIdentityAdapter,accountContext} from '../../../lib/business/identity.mjs';
import {createRpcRepository} from '../../../lib/business/repository.mjs';
import {dispatchOuterRead,authControlRequest} from './requests.mjs';
import {stageRegistration} from './registration.mjs';
import {claimApprovedIntent,ledgerName} from '../../../lib/business/r3-intent-ledger.mjs';
import {configurationRace} from './race.mjs';
import {probeFixedTls} from './fixed-tls.mjs';
import {TRACE_PATH} from '../clean-candidate/uds-evidence.mjs';
import {SERVICES,requireBindingReceipt} from './bindings.mjs';
import {assertTimeWindow,utcNanoseconds} from './time-window.mjs';
import {startupScope,hostOfflineChecks} from './startup.mjs';
import {checkServiceBindings} from './binding-check.mjs';
import {candidateInspectGate,hostMountFiles,candidateTlsProbeScript,candidateEndpointGate} from './mount-guard.mjs';
import {BUSINESS_SCOPE,P01_SCOPE,effectScope} from './scope.mjs';
import {healthAndMail,registrarTlsOnly,postgresErrorObserver} from './p01-probes.mjs';
const liveHosts=new WeakSet();export const isLiveHost=host=>liveHosts.has(host);
const emitJwt=(key,claims)=>{const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const bytes=b({alg:'HS256',typ:'JWT'})+'.'+b(claims);return bytes+'.'+createHmac('sha256',key).update(bytes).digest('base64url');};
function trustedJson(path,digest,{protectedParent=false}={}){const s=lstatSync(path),p=lstatSync(dirname(path));const secure=(s.mode&0o077)===0||protectedParent&&p.uid===process.getuid()&&(p.mode&0o077)===0&&(s.mode&0o022)===0;need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&s.nlink===1&&secure&&realpathSync(path)===resolve(path),'APPROVAL_FILE_SECURITY');const bytes=readFileSync(path);need(hash(bytes)===digest,'APPROVAL_DIGEST');return JSON.parse(bytes);}
function preparedReceipts({approvalPath,approvalSha256,timeWindow,requireCandidate=true,scope=BUSINESS_SCOPE}){
 need(approvalPath&&/^[a-f0-9]{64}$/.test(approvalSha256??''),'NEW_AUTHORIZATION_REQUIRED');
 const a=trustedJson(approvalPath,approvalSha256),seal=readFileSync(new URL('./seal.json',import.meta.url));
 need(a.version===1&&a.state==='AUTHORIZED'&&a.project===PROJECT&&a.scope===scope&&a.driverSealSha256===hash(seal)&&a.sourceSha===pins.source_sha&&/^[0-9a-f-]{36}$/.test(a.runId),'NEW_AUTHORIZATION_REQUIRED');
 const review=trustedJson(a.reviewPath,a.reviewSha256);need(review.status==='OFFLINE_REVIEW_PASS'&&review.driverSealSha256===hash(seal),'INDEPENDENT_REVIEW_REQUIRED');
 const lock=JSON.parse(seal);for(const [file,digest]of Object.entries(lock.files))need(hash(readFileSync(new URL(file,root)))===digest,'DRIVER_SOURCE_CHANGED');
 effectScope(a,scope);
 assertTimeWindow(timeWindow,{approval:a,digest:approvalSha256,requireSystemClock:true});
 need(a.startupReceiptPath&&/^[a-f0-9]{64}$/.test(a.startupReceiptSha256??''),'PRE_P00_STARTUP_RECEIPT');const startup=trustedJson(a.startupReceiptPath,a.startupReceiptSha256);need(startup.status==='PRE_P00_OFFLINE_PASS'&&startup.phase==='BEFORE_P00'&&startup.runId===a.runId&&startup.driverSealSha256===hash(seal)&&startup.startupScopeSha256===startupScope(a)&&startup.externalIo===0,'PRE_P00_STARTUP_RECEIPT');
 need(requireCandidate?/^[a-f0-9]{64}$/.test(a.candidateId??''):a.candidateId==='P01_PENDING','CANDIDATE_ID');
 const contract=isContinuation(scope)?remainingContract(scope):loadContract(scope);if(isContinuation(scope))remainingAuthority(a,contract);
 const baseline=trustedJson(a.baselinePath,a.baselineSha256,{protectedParent:true});need(a.baselineSha256===contract.baselineSha256,'FROZEN_BASELINE_CHANGED');
 const p00=trustedJson(a.preflightPath,a.preflightSha256);
 need(p00.runId===a.runId&&p00.status==='PASS_REAL_READ_ONLY'&&p00.sourceSha===pins.source_sha&&p00.physicalId==='7706828727995158580'&&p00.daemonId==='d47715b7-0a23-49e0-a063-32f98fe1753c'&&p00.closedCatalogExact===true&&same(p00.fingerprints,baseline.fingerprints)&&same(p00.inventories,baseline.inventories),'NEW_P00_RECEIPT_REQUIRED');
 need(!isContinuation(scope)||p00.transactions?.length===2,'REMAINING_P00_BUDGET');
 need(Array.isArray(p00.transactions)&&p00.transactions.length>=2&&p00.transactions.length<=3&&p00.transactions.every(t=>t.readOnly===true&&t.rollback===true&&Number.isInteger(t.pid)&&t.pid>0&&/^[a-f0-9]{64}$/.test(t.receiptSha256)),'P00_TRANSACTION_RECEIPTS');
 for(const t of p00.transactions){const r=trustedJson(t.receiptPath,t.receiptSha256,{protectedParent:true});need(r.runId===a.runId&&r.readOnly===true&&r.rollback===true&&r.pid===t.pid&&r.exitCode===0&&r.tags?.at(-1)==='ROLLBACK','P00_RAW_ROLLBACK_RECEIPT');}
 need(utcNanoseconds(startup.checkedAt)<=utcNanoseconds(p00.startedAt)&&utcNanoseconds(startup.checkedAt)>=utcNanoseconds(a.windowStartedAt),'PRE_P00_STARTUP_ORDER');
 need(utcNanoseconds(p00.startedAt)>=utcNanoseconds(a.windowStartedAt)&&utcNanoseconds(p00.completedAt)>=utcNanoseconds(p00.startedAt)&&utcNanoseconds(p00.completedAt)<=BigInt(Date.now())*1000000n,'P00_WINDOW');
 const bound=trustedJson(a.bindingReceiptPath,a.bindingReceiptSha256);requireBindingReceipt(bound,{runId:a.runId,windowStartedAt:a.windowStartedAt,p00CompletedAt:p00.completedAt,driverSealSha256:a.driverSealSha256,scope});
 return {a,baseline,p00};
}
export function checkPreP01Receipts(options){
 const {a}=preparedReceipts({...options,requireCandidate:false});
 return {version:1,status:'PRE_P01_FILE_PASS',checkedAt:new Date().toISOString(),runId:a.runId,driverSealSha256:a.driverSealSha256,startupScopeSha256:startupScope(a),preflightSha256:a.preflightSha256,bindingReceiptSha256:a.bindingReceiptSha256,externalIo:0,realExecution:'NOT AUTHORIZED_BY_CHECK'};
}
export function createLiveHost({approvalPath,approvalSha256,journal,alicePassword,timeWindow,scope=BUSINESS_SCOPE}){
 const {a,baseline,p00}=preparedReceipts({approvalPath,approvalSha256,timeWindow,scope});
 need(a.preP01ReceiptPath&&/^[a-f0-9]{64}$/.test(a.preP01ReceiptSha256??''),'PRE_P01_FILE_RECEIPT');
 const preP01=trustedJson(a.preP01ReceiptPath,a.preP01ReceiptSha256);need(preP01.status==='PRE_P01_FILE_PASS'&&preP01.runId===a.runId&&preP01.driverSealSha256===a.driverSealSha256&&preP01.startupScopeSha256===startupScope(a)&&preP01.preflightSha256===a.preflightSha256&&preP01.bindingReceiptSha256===a.bindingReceiptSha256&&preP01.externalIo===0&&utcNanoseconds(preP01.checkedAt)>=utcNanoseconds(p00.completedAt),'PRE_P01_FILE_RECEIPT');
 need(alicePassword===undefined||typeof alicePassword==='string'&&alicePassword.length>=8&&alicePassword.length<=256,'VOLATILE_CREDENTIAL');
 need(pins.fixture_mode!=='OFFLINE_SYNTHETIC_NOT_EXECUTION_AUTHORITY','SYNTHETIC_FIXTURES_CANNOT_AUTHORIZE_REAL_EXECUTION');
 const host=new LiveHost(a,baseline,journal);Object.defineProperty(host,'executionWindow',{value:timeWindow,writable:false});host.contract=isContinuation(scope)?remainingContract(scope):loadContract(scope);need(!isContinuation(scope)||alicePassword===undefined,'REMAINING_FRESH_CREDENTIAL_REQUIRED');host.preP01=preP01;host.preflight=p00;host.preflightReceiptSha256=a.preflightSha256;host.preflightUsage={read_only_audit:p00.transactions.length,explicit_database_transactions:p00.transactions.length};if(alicePassword!==undefined)host.credentials.Alice=alicePassword;liveHosts.add(host);return host;
}
export function catalogReceipt(envelope,r){need(r.code===0&&r.tags.at(-1)==='ROLLBACK','CATALOG_UNKNOWN',true);return {...r.safe,readOnly:true,rollback:true,catalogInputSha256:hash(JSON.stringify(envelope)),tables:Object.keys(envelope.catalog.tables).length,functions:Object.keys(envelope.catalog.functions).length,policies:Object.keys(envelope.catalog.policies).length};}
export function maintenanceCommitReceipt(r){need(r.code===0&&r.tags.at(-1)==='COMMIT','MAINTENANCE_UNKNOWN',true);const row=r.rows.find(x=>'gatesClosed'in x);return {...r.safe,committed:true,commandTags:r.tags,source:'psql-command-tags',...(row?{gatesClosed:row.gatesClosed,hardCheck:row.hardCheck,containmentOk:row.containmentOk}:{})};}
export function candidateStopPreflight(c,expected){need(c.Id===expected.Id&&c.Name===expected.Name&&c.Image===expected.Image,'STOP_TARGET_CHANGED');need(c.State.Running===true&&c.State.OOMKilled===false&&c.RestartCount===0,'CANDIDATE_UNEXPECTED_EXIT',true);return {id:c.Id,name:c.Name,image:c.Image,running:true,restartCount:c.RestartCount};}
export function requireCandidateCreationOrder(createdAt,preP01){need(utcNanoseconds(createdAt)>=utcNanoseconds(preP01.checkedAt),'P01_CREATED_BEFORE_FILE_GATE');}
// Pure generator: syntax is checked offline; execution remains P01-only.
export function candidateProbeScript(){return `import {runtimeGuard,verifyFrozenFiles} from './tests/s3/clean-candidate/service.mjs';import {readFileSync,lstatSync} from 'node:fs';import {X509Certificate,createPrivateKey,createHash} from 'node:crypto';import {connect as tlsConnect,checkServerIdentity} from 'node:tls';import {connect as unixConnect} from 'node:net';runtimeGuard();const f=JSON.parse(readFileSync('./tests/s3/clean-candidate/frozen.json'));await verifyFrozenFiles(f);for(const [name,h]of Object.entries(f.tls.public_sha256)){const raw=readFileSync('/run/s34-tls/'+name);if(createHash('sha256').update(raw).digest('hex')!==h||Date.parse(new X509Certificate(raw).validTo)-Date.now()<1200000)throw Error('TLS');}const cert=new X509Certificate(readFileSync('/run/s34-tls/private-server.crt'));if(!cert.checkPrivateKey(createPrivateKey(readFileSync('/run/s34-tls/private-server.key'))))throw Error('KEY');const d=lstatSync('/run/clean-internal'),s=lstatSync('/run/clean-internal/postgrest.sock');if(d.uid!==100||d.gid!==1000||(d.mode&511)!==504||!d.isDirectory()||d.isSymbolicLink()||s.uid!==100||s.gid!==1000||(s.mode&511)!==432||!s.isSocket()||s.isSymbolicLink())throw Error('UDS');await new Promise((resolve,reject)=>{const sock=tlsConnect({host:'172.30.232.4',port:8443,servername:${JSON.stringify(SERVICES.auth.host)},ca:readFileSync('/run/s34-tls/server-ca.crt'),rejectUnauthorized:true,checkServerIdentity:(_,p)=>checkServerIdentity(${JSON.stringify(SERVICES.auth.host)},p)},()=>{if(!sock.authorized||sock.getPeerCertificate().fingerprint256!==${JSON.stringify(SERVICES.auth.fingerprint)}){sock.destroy();reject(Error('GATEWAY_IDENTITY'));}else sock.end();});const t=setTimeout(()=>{sock.destroy();reject(Error('TLS_TIMEOUT'));},5000);sock.on('error',()=>{clearTimeout(t);reject(Error('TLS'));});sock.on('close',e=>{clearTimeout(t);e?reject(Error('TLS_CLOSE')):resolve();});});await new Promise((resolve,reject)=>{const sock=unixConnect('/run/clean-internal/postgrest.sock',()=>sock.end());const t=setTimeout(()=>{sock.destroy();reject(Error('UDS_TIMEOUT'));},2000);sock.on('error',()=>{clearTimeout(t);reject(Error('UDS'));});sock.on('close',e=>{clearTimeout(t);e?reject(Error('UDS_CLOSE')):resolve();});});console.log(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,uid:process.getuid(),authTLS:true,udsConnect:true,ok:true}));`;}
class LiveHost {
 constructor(a,baseline,journal){this.mode='REAL';this.approval=a;this.history=baseline;this.journal=journal;this.actors={};this.pending={};this.credentials={};this.mailBefore=null;this.mailId=null;this.otp=null;this.adminKey=null;this.httpContext=null;this.trustedCandidate=false;this.pg=null;this.stopped=false;this.usedDatabaseErrors=new Set();}
 async docker(args){const r=await command(['docker','--context','desktop-linux',...args]);need(r.code===0,'DOCKER_READ_UNKNOWN',true);return r.stdout;}
 async checkGates(ctx){
  need(ctx.mode==='REAL'&&ctx.runId===this.approval.runId,'LIVE_SCOPE');
  hostOfflineChecks();
  const context=(await command(['docker','context','show'])).stdout.toString().trim();need(context==='desktop-linux','DOCKER_CONTEXT');
  const info=JSON.parse(await this.docker(['info','--format','{{json .}}']));need(info.ID==='d47715b7-0a23-49e0-a063-32f98fe1753c','DAEMON_ID');
  for(const key of ['ServerVersion','Driver','Architecture','NCPU','MemTotal'])need(info[key]===pins.daemon_baseline[key],'DAEMON_BASELINE_DRIFT');
  const fs=statfsSync(fileURLToPath(root));need(fs.bavail*fs.bsize>=24*1024**3,'HOST_DISK_BUDGET');
  const mem=(await this.docker(['exec','--user','postgres',DB,'cat','/proc/meminfo'])).toString();need(Number(/MemAvailable:\s+(\d+)/.exec(mem)?.[1])*1024>=1024**3,'VM_MEMORY_BUDGET');
  for(const [id,expected]of Object.entries(pins.resource_config_sha256)){
   const object=JSON.parse(await this.docker(['inspect',id]))[0];
   const ascii=x=>canonical(x).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
   need(object.State.Running&&hash(ascii(object.Config))===expected.config&&hash(ascii(object.HostConfig))===expected.host,'EXISTING_RESOURCE_DRIFT');
  }
  const {frozen}=this.contract;for(const [path,digest]of Object.entries(frozen.files))need(hash(readFileSync(new URL(path,root)))===digest,'FROZEN_SOURCE_CHANGED');
  const image=JSON.parse(await this.docker(['image','inspect','--platform','linux/arm64/v8',IMAGE.engine_image_id]))[0];inspectedImageGate(image);
  const verified=await command(['python3','-B',fileURLToPath(new URL('./image_verify.py',import.meta.url))],JSON.stringify(IMAGE),{timeout:60000});need(verified.code===0&&JSON.parse(verified.stdout).verified,'RESIDENT_IMAGE_UNVERIFIED');
  const c=JSON.parse(await this.docker(['inspect',this.approval.candidateId]))[0];this.candidate=c;
  const launch=this.contract.launch;
  requireCandidateCreationOrder(c.Created,this.preP01);
  hostMountFiles();candidateInspectGate(c,launch,{id:this.approval.candidateId,context,daemon:info.ID,serverVersion:info.ServerVersion});
  const tlsFiles=JSON.parse(await this.docker(['exec','--user','1000:1000',c.Id,'node','--input-type=module','-e',candidateTlsProbeScript()]));need(tlsFiles.tlsFiles===4&&tlsFiles.regular&&tlsFiles.sha256&&tlsFiles.keyPair,'P01_TLS_FILES');
  for(const [id,expected]of Object.entries(pins.networks)){const n=JSON.parse(await this.docker(['network','inspect',id]))[0];need(n.Internal===true&&same(n.IPAM,expected.IPAM),'NETWORK_CONFIGURATION_DRIFT');candidateEndpointGate(c,launch,id,n);const endpoints=Object.fromEntries(Object.entries(n.Containers??{}).filter(([cid])=>cid!==c.Id).map(([cid,x])=>[cid,{Name:x.Name,IPv4Address:x.IPv4Address}]));need(same(endpoints,expected.Containers),'NETWORK_ENDPOINT_DRIFT');}
  this.trustedCandidate=true;const base=dirname(fileURLToPath(root));this.b1=resolve(base,'../s3-3-r3-clean-business-integration-b1-resume-20261111-e449c25f');this.pki=resolve(base,'../s3-3-r3-clean-integration-environment-20261111-e449c25f/private/pki');
  const serviceBindings=await checkServiceBindings({candidateId:c.Id,scope:this.approval.scope});this.journal.record('LIVE-service-bindings',serviceBindings);need(serviceBindings.status==='SERVICE_BINDINGS_PASS','SERVICE_BINDINGS_STOP');
  this.ca=readFileSync(resolve(this.b1,'tls/server/server-ca.crt'),'utf8');this.workerCert=readFileSync(resolve(this.b1,'tls/worker/worker.crt'),'utf8');this.workerKey=readFileSync(resolve(this.b1,'tls/worker/worker.key'),'utf8');
  need(hash(this.ca)===frozen.tls.public_sha256['server-ca.crt']&&new X509Certificate(this.workerCert).fingerprint256===WORKER_PIN,'HOST_TLS_PIN');
  for(const cert of pins.public_certificates){const raw=readFileSync(cert.path);const c=new X509Certificate(raw);need(hash(raw)===cert.sha256&&Date.parse(c.validFrom)<=Date.now()&&Date.parse(c.validTo)-Date.now()>=1200000,'PUBLIC_CERTIFICATE_GATE');}
  this.apikey=readFileSync(resolve(this.b1,'private/publishable.key'),'utf8').trim();need(/^sb_publishable_[A-Za-z0-9_-]{32,128}$/.test(this.apikey),'PUBLISHABLE_KEY');
  const dynamic=candidateProbeScript();
  const dyn=await this.docker(['exec','--user','1000:1000',c.Id,'node','--input-type=module','-e',dynamic]);need(JSON.parse(dyn).ok&&JSON.parse(dyn).authTLS===true&&JSON.parse(dyn).udsConnect===true,'P01_DYNAMIC');
  const lane=await probeFixedTls('candidate',{servername:SERVICES.node.host,ca:this.ca,cert:this.workerCert,key:this.workerKey,rejectUnauthorized:true});need(lane.authorized&&lane.fingerprint===frozen.tls.server_fingerprint,'P01_MTLS_IDENTITY');
  this.traceCursor=0;need((await this.readTrace()).length===0,'UDS_TRACE_INITIAL_STATE');
  ctx.history=this.history;this.pg=pinnedPg();
  if([BUSINESS_SCOPE,REMAINING_SCOPE,TAIL_SCOPE,P14R_SCOPE].includes(this.approval.scope)){const env=JSON.parse(await this.docker(['inspect',AUTH]))[0];need(env.Id===AUTH&&env.Config.Env.includes('GOTRUE_JWT_ISSUER='+ISSUER),'AUTH_SOURCE_IDENTITY');const keys=env.Config.Env.filter(x=>x.startsWith('GOTRUE_JWT_SECRET='));need(keys.length===1,'AUTH_SOURCE');this.adminKey=keys[0].slice('GOTRUE_JWT_SECRET='.length);}
  this.journal.record('LIVE-gates',{mode:'REAL',candidateId:c.Id,dynamic:JSON.parse(dyn),tlsFiles,mtls:lane,imageId:c.Image,sourceSha:pins.source_sha,descriptorRole:'Frozen Node/PG/UDS identities; no business request during gates'});
  return {mode:'REAL',project:PROJECT,physicalId:'7706828727995158580',daemon:info.ID,sourceSha:pins.source_sha,imageId:IMAGE.engine_image_id,configDigest:IMAGE.config_digest,p00:true,p01:true,driverReview:true,image:true,source:true,tls:true,uds:true,resourceBudget:true,noHistoricalReplay:true,serviceBindings:true};
 }
 async p01HealthMail(){need(this.approval.scope===P01_SCOPE,'P01_SCOPE_REQUIRED');return healthAndMail(this);}
 async p01Registrar(){need(this.approval.scope===P01_SCOPE,'P01_SCOPE_REQUIRED');return registrarTlsOnly(this.pki);}
 async p01ErrorObserver(){need(this.approval.scope===P01_SCOPE,'P01_SCOPE_REQUIRED');return postgresErrorObserver();}
 hasAliceCredential(){return typeof this.credentials.Alice==='string';}
 async observe(ctx){
  const r=await psql(observationSQL(ctx));need(r.code===0&&r.tags.at(-1)==='ROLLBACK'&&r.rows.length===2,'OBSERVATION_UNKNOWN',true);
  const b=r.rows[0],extra=r.rows[1];need(b.meta.read_only==='on'&&b.meta.isolation==='repeatable read','OBSERVATION_NOT_READ_ONLY');
  if(!ctx.initial){need(same(b.fingerprints,this.history.fingerprints)&&same(b.inventories,this.history.inventories),'P00_BASELINE_DRIFT');need(Number(b.connections.max)===40&&b.connections.active<=36&&b.connections.roles.ecv_s3_internal_api_login===4&&b.connections.roles.ecv_s3_registration_login===2,'PG_CONNECTION_BUDGET');const log=b.postgres_settings;need(log.log_error_verbosity==='verbose'&&log.log_statement==='none'&&log.log_min_error_statement==='panic'&&log.log_line_prefix==='%m [%p] %e %h %u@%d '&&extra.diagnosticSettings.errorParameters==='0','DIAGNOSTIC_CONFIGURATION');}
  ctx.keyWindow??={notBefore:Math.floor(Date.parse(b.meta.snapshot_time)/1000)-5,signUntil:Math.floor(Date.parse(b.meta.snapshot_time)/1000)+1200,verifyUntil:Math.floor(Date.parse(b.meta.snapshot_time)/1000)+1260};
  return {readOnly:true,rollback:true,pid:b.meta.backend_pid,base:b,...extra,safeReceipt:r.safe};
 }
 async catalog(ctx){
  const r=await psql(readFileSync(new URL('tests/s3/m7-catalog-observe.sql',root),'utf8'));need(r.code===0&&r.tags.at(-1)==='ROLLBACK'&&r.rows.length===1,'CATALOG_UNKNOWN',true);
  const envelope={identity:{daemon_id:'d47715b7-0a23-49e0-a063-32f98fe1753c',project:PROJECT,database_container:DB,pg_system_identifier:ctx.last.base.meta.system_identifier,database:ctx.last.base.meta.database,server_version_num:ctx.last.base.meta.server_version_num},catalog:r.rows[0]};
  const name=ctx.step+'-catalog-input',receipt=catalogReceipt(envelope,r);this.journal.record(name,receipt);
  const compare=await command(['python3','-B',fileURLToPath(new URL('tests/s3/clean_target.py',root)),'--observation-stdin'],JSON.stringify(envelope));
  need(compare.code===0&&JSON.parse(compare.stdout).errors.length===0,'CATALOG_DRIFT');
  return {readOnly:true,rollback:true,exactMatch:true,closed:r.rows[0].closed_constraints.verifier&&r.rows[0].closed_constraints.paired,roleDelta:0,safeReceipt:receipt};
 }
 async independentFinal(ctx){
  const r=await psql(finalObservationSQL(ctx));need(r.code===0&&r.tags.at(-1)==='ROLLBACK'&&r.rows.length===4,'INDEPENDENT_OBSERVATION_UNKNOWN',true);
  const [base,extra,catalog,meta]=r.rows;need(base.meta.read_only==='on'&&meta.observer_read_only==='on'&&meta.observer_isolation==='repeatable read'&&meta.observer_pid===base.meta.backend_pid,'INDEPENDENT_READONLY_FRAME');
  const profile=JSON.parse(readFileSync(new URL('../r3-clean-target.json',import.meta.url))),envelope={identity:{...profile.target,pg_system_identifier:base.meta.system_identifier,database:base.meta.database,server_version_num:base.meta.server_version_num},catalog};
  const compared=await command(['python3','-B',fileURLToPath(new URL('../clean_target.py',import.meta.url)),'--observation-stdin'],JSON.stringify(envelope));need(compared.code===0&&JSON.parse(compared.stdout).errors.length===0,'INDEPENDENT_CATALOG_DRIFT');
  const independent={catalogExact:true,closed:catalog.closed_constraints.verifier&&catalog.closed_constraints.paired,physicalId:base.meta.system_identifier,catalogSha256:hash(JSON.stringify(catalog))};
  return {readOnly:true,rollback:true,pid:meta.observer_pid,base,...extra,independent,safeReceipt:{...r.safe,readOnly:true,rollback:true,pid:meta.observer_pid,...independent}};
 }
 async auth(method,path,body,token){need([BUSINESS_SCOPE,REMAINING_SCOPE,TAIL_SCOPE,P14R_SCOPE].includes(this.approval.scope),'BUSINESS_SCOPE_REQUIRED');const r=await httpsJson({destination:'auth',method,path,body,token,apikey:this.apikey,ca:this.ca});this.lastAuthTransport=r.transport;return r;}
 adminToken(){const now=Math.floor(Date.now()/1000);return emitJwt(this.adminKey,{iss:ISSUER,aud:'authenticated',role:'service_role',iat:now,exp:now+120});}
 email(uid){return uid===CHARLIE?'s34-charlie-20261112@example.test':this.history.users.find(x=>x.uid===uid).email;}
 makeIdentity(slot){
  return createIdentityAdapter({issuer:ISSUER,auth:{signInWithPassword:async body=>{const r=await this.auth('POST','/auth/v1/token?grant_type=password',body);need(r.status===200&&r.json.access_token,'LOGIN_UNKNOWN',true);this.actors[slot]={token:r.json.access_token,user:r.json.user,transport:r.transport};return {data:{session:{access_token:r.json.access_token,user:r.json.user},user:r.json.user}};},verifyTokenAndUser:async token=>{const r=await this.auth('GET','/auth/v1/user',undefined,token);need(r.status===200,'AUTH_USER_UNKNOWN',true);const c=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));return {data:{claims:c,user:r.json}};}}});
 }
 repository(identity,slot,{fault=false}={}){
  const mtls={fetch:async(url,init)=>{need(url.startsWith(PRIVATE_ORIGIN+'/rpc/'),'PRIVATE_ORIGIN');try{need(!this.requestTrace,'DISPATCH_ONCE');const before=await this.readTrace();need(before.length===this.traceCursor,'UDS_UNOWNED_REQUEST');this.requestTrace={before,dispatchId:this.currentDispatchId,rpc:new URL(url).pathname.slice(5),jwtSha256:hash(init.headers.Authorization.slice(7)),requestSha256:hash(init.body)};const r=await httpsJson({destination:'candidate',method:'POST',path:new URL(url).pathname,body:JSON.parse(init.body),token:init.headers.Authorization.slice(7),ca:this.ca,cert:this.workerCert,key:this.workerKey,fault});this.httpContext=r;return Response.json(r.json,{status:r.status});}catch(e){this.faultObserved=e.intentionalFault===true;throw e;}}};
  return createRpcRepository({binding,enabled:true,project:PROJECT,endpoint:PRIVATE_ORIGIN,identity,mtls});
 }
 async readTrace(){
  const script=`const f=require('node:fs'),p=${JSON.stringify(TRACE_PATH)},s=f.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.uid!==1000||s.gid!==1000||s.nlink!==1||(s.mode&4095)!==384||s.size>1048576)throw Error('TRACE_IDENTITY');process.stdout.write(f.readFileSync(p));`;
  const r=await command(['docker','--context','desktop-linux','exec','--user','1000:1000',this.candidate.Id,'node','-e',script], '',{maxBytes:1048576});need(r.code===0&&r.stderr.length===0,'UDS_TRACE_UNKNOWN',true);
  try{const raw=r.stdout.toString();need(!raw||raw.endsWith('\n'),'UDS_TRACE_INCOMPLETE',true);const rows=raw.split('\n').filter(Boolean).map(x=>JSON.parse(x));need(rows.length<=64&&rows.every((r,i)=>r.seq===i+1),'UDS_TRACE_SEQUENCE');return rows;}catch{throw new DriverStop('UDS_TRACE_UNKNOWN',true);}
 }
 async logEvidence(from,to,rpc,uid,sid,status,{directTrace=null,token=null,body=null}={}){
  let trace,request;
  if(directTrace){trace=directTrace;request={jwtSha256:hash(token),requestSha256:hash(JSON.stringify(body))};}
  else{request=this.requestTrace;need(request&&request.rpc===rpc,'UDS_REQUEST_MISSING',true);const after=await this.readTrace();need(after.length===request.before.length+1&&same(after.slice(0,-1),request.before),'UDS_DISPATCH_COUNT',true);trace={...after.at(-1),dispatchId:request.dispatchId};this.traceCursor=after.length;}
  try{const dbLogs=await command(['docker','--context','desktop-linux','logs','--since',new Date(from).toISOString(),'--until',new Date(to+1000).toISOString(),DB]);
  return correlateDatabase(dbLogs,trace,{from,to,rpc,uid,sid,...request,candidate:directTrace?null:this.httpContext,dispatchId:directTrace?.dispatchId??request.dispatchId,usedErrors:this.usedDatabaseErrors});
  }catch(error){const e=error instanceof DriverStop?error:new DriverStop('DB_EVIDENCE_UNKNOWN',true);e.unknown=true;e.safeReceipt={...e.safeReceipt,udsEvidence:safeUdsTrace(trace),requestBinding:{uid,sid,rpc,jwtSha256:request.jwtSha256,requestSha256:request.requestSha256,dispatchId:directTrace?.dispatchId??request.dispatchId,source:'observed-original-jwt-and-uds'},...(this.httpContext?.transport?{transport:this.httpContext.transport}:{}),database:{...e.safeReceipt?.database,outcome:'UNKNOWN',attribution:'NOT_VERIFIED'}};throw e;}
 }
 async read(action,ctx){
  const actor=this.actors[action.slot];need(actor,'ACTOR_SLOT');const who=ctx.state.sessions[action.slot],from=Date.now();this.httpContext=null;this.requestTrace=null;this.faultObserved=false;
  const identity=this.makeIdentity(action.slot),repository=this.repository(identity,action.slot,{fault:action.action==='faultRead'});
  const response=await dispatchOuterRead({rpc:action.rpc,fixture:ctx.fixture,identity,token:actor.token,repository});const data=await response.json();
  if(action.action==='outerRecovery'){need(this.httpContext===null,'RECOVERY_REACHED_DATABASE');return {outerStatus:response.status,layer:'identity-purpose',postgrest:null,transport:this.lastAuthTransport,safeReceipt:{outerStatus:response.status,layer:'identity-purpose',database:'NOT REACHED'}};}
  const fault=action.action==='faultRead';if(!(fault?response.status===503:response.status===200||response.status===403)){const error=new DriverStop('UNEXPECTED_OUTER_HTTP',true);error.safeReceipt=await unexpectedOuterEvidence({outerStatus:response.status,candidate:this.httpContext,readLogs:status=>this.logEvidence(from,Date.now(),action.rpc,who.uid,who.sid,status)});throw error;}
  const evidence=await this.logEvidence(from,Date.now(),action.rpc,who.uid,who.sid,response.status);
  const r={outerStatus:response.status,clientStatus:response.status,data,transport:fault?{complete:false,protocol:'https'}:this.httpContext?.transport,...evidence};
  if(fault){r.actualUnknown=true;r.intentionalFault=this.faultObserved;need(data.code==='COMMIT_UNKNOWN','FAULT_CLIENT_STATUS');r.safeReceipt={outerStatus:response.status,clientStatus:503,clientCode:data.code,postgrest:r.postgrest,database:r.database,requestBinding:r.requestBinding,udsEvidence:r.udsEvidence,transport:r.transport,actualUnknown:true,intentionalFault:r.intentionalFault};}
  return r;
 }
 async direct(action,ctx){const actor=this.actors[action.slot],who=ctx.state.sessions[action.slot],from=Date.now();const body=action.rpc==='read_introduction'?{target:ctx.fixture.actors.Alice.site}:{};const r=await directUnix({rpc:action.rpc,body,token:actor.token,dispatchId:dispatchId(ctx.runId,ctx.operationId)});return withUdsAttribution(r,{binding:{uid:who.uid,sid:who.sid,rpc:action.rpc,dispatchId:r.udsEvidence.dispatchId,jwtSha256:hash(actor.token),requestSha256:hash(JSON.stringify(body))},collect:()=>this.logEvidence(from,Date.now(),action.rpc,who.uid,who.sid,r.status,{directTrace:r.udsEvidence,token:actor.token,body})});}

 async maintenance(kind,ctx){need([BUSINESS_SCOPE,REMAINING_SCOPE,TAIL_SCOPE,P14R_SCOPE].includes(this.approval.scope),'BUSINESS_SCOPE_REQUIRED');const r=await psql(maintenanceSQL(kind,ctx));need(r.code===0&&r.tags.at(-1)==='COMMIT','MAINTENANCE_UNKNOWN',true);return {committed:true,exitCode:0,roleDelta:0,...(kind==='close'?r.rows.find(x=>'gatesClosed'in x):{}),safeReceipt:maintenanceCommitReceipt(r)};}
 async execute(a,ctx){
  if(this.approval.scope===P14R_SCOPE){need(['prepareAliceCredential','login','approveIntent','signRegister','apply','read','race','observe','catalog','close','independentFinal','maintenance','stopCandidate'].includes(a.action)&&(!a.slot||a.slot==='A1')&&(!a.rpc||a.rpc==='get_my_site')&&(a.action!=='maintenance'||['generation','open'].includes(a.kind)),'P14R_ACTION_SCOPE');need(ctx.state.raceOnly===true,'P14R_CONTEXT');}
  this.currentDispatchId=dispatchId(ctx.runId,ctx.operationId);
  need([BUSINESS_SCOPE,REMAINING_SCOPE,TAIL_SCOPE,P14R_SCOPE].includes(this.approval.scope)||a.action==='stopCandidate','BUSINESS_SCOPE_REQUIRED');
  if(isContinuation(this.approval.scope)){need(!['resetAlice','createCharlie'].includes(a.action),'LEGACY_ACTION_FORBIDDEN');need(same(ctx.fixture,this.contract.fixture),'HOST_PROFILE_MISMATCH');}else need(!['prepareAliceCredential','prepareCharlieCredential','independentFinal'].includes(a.action),'REMAINING_SCOPE_REQUIRED');
  if(a.action==='independentFinal')return this.independentFinal(ctx);
  if(a.action==='observe')return this.observe(ctx);if(a.action==='catalog')return this.catalog(ctx);
  if(a.action==='maintenance')return this.maintenance(a.kind,ctx);if(a.action==='close')return this.maintenance('close',ctx);
  if(['prepareAliceCredential','prepareCharlieCredential'].includes(a.action)){const actor=a.action==='prepareAliceCredential'?'Alice':'Charlie',uid=actor==='Alice'?ALICE:CHARLIE;this.credentials[actor]=randomBytes(32).toString('base64url');const q=authControlRequest('updateExistingCredential',{uid,password:this.credentials[actor]}),r=await this.auth(q.method,q.path,q.body,this.adminToken());return {status:r.status,uid:r.json.id,transport:r.transport};}
  if(a.action==='resetAlice'){this.credentials.Alice=randomBytes(32).toString('base64url');const q=authControlRequest(a.action,{password:this.credentials.Alice}),r=await this.auth(q.method,q.path,q.body,this.adminToken());return {status:r.status,uid:r.json.id,transport:r.transport};}
  if(a.action==='createCharlie'){this.credentials.Charlie=randomBytes(32).toString('base64url');const q=authControlRequest(a.action,{email:this.email(CHARLIE),password:this.credentials.Charlie}),r=await this.auth(q.method,q.path,q.body,this.adminToken());return {status:r.status,uid:r.json.id,transport:r.transport};}
  if(a.action==='login'){
   const actor=ctx.fixture.session_slots[a.slot].actor,identity=this.makeIdentity(a.slot);const {handle,receipt}=await identity.passwordLogin({email:this.email(ctx.fixture.actors[actor].uid),password:this.credentials[actor]});const stored=this.actors[a.slot];Object.assign(stored,{identity,handle,receipt});return {token:stored.token,user:stored.user,authVerified:true,originalToken:true,transport:stored.transport};
  }
  if(a.action==='approveIntent'){const now=Math.floor(Date.now()/1000);ctx.intents.approve(a.intent,now,now+60);return {approved:true,safeReceipt:{proofId:a.intent.proof_id,state:'approved'}};}
  if(a.action==='signRegister'){
   this.key??=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);const key={id:ctx.fixture.key_id,project:PROJECT,macKey:this.key,...ctx.keyWindow,revoked:false};let registration;
   const Client=registrarClientClass(this.pg,r=>{registration=r;});const material=()=>Object.fromEntries([['ca','server-ca.crt'],['cert','registration.crt'],['key','registration.key']].map(([k,n])=>[k,readFileSync(resolve(this.pki,n),'utf8')]));
   const actor=this.actors[a.slot];
   const storage=ctx.intents.storage();const namespace={idFromName:n=>n,get:n=>{need(n===ledgerName(PROJECT),'INTENT_NAMESPACE');return {claimOnce:p=>claimApprovedIntent(storage,p,undefined,binding)};}};
   const stage=await stageRegistration({binding,identity:actor.identity,handle:actor.handle,receipt:actor.receipt,intent:a.intent,intentNamespace:namespace,key,registrar:{Client,credentials:material}});this.pending[a.slot]=stage;
   return {proof:stage.proof,nativeVerified:stage.nativeVerified,registration,safeReceipt:{proofId:stage.proof.proof_id,registration}};
  }
  if(a.action==='apply'){
   const actor=this.actors[a.slot],from=Date.now();this.httpContext=null;this.requestTrace=null;const stage=this.pending[a.slot];need(stage,'GRANT_STAGE_REQUIRED');let data;
   try{data=await stage.apply(proof=>this.repository(actor.identity,a.slot).grant(actor.handle,{proof}));}catch(error){const who=ctx.state.sessions[a.slot],stop=new DriverStop('GRANT_RESULT_UNCONFIRMED',true);stop.safeReceipt=await unexpectedOuterEvidence({outerStatus:this.httpContext?.status??null,candidate:this.httpContext,readLogs:status=>this.logEvidence(from,Date.now(),'apply_business_grant',who.uid,who.sid,status)});throw stop;}
   const who=accountContext(actor.handle);const e=await this.logEvidence(from,Date.now(),'apply_business_grant',who.uid,who.session_id,200);return {data,outerStatus:200,transport:this.httpContext.transport,...e};
  }
  if(['read','faultRead','outerRecovery'].includes(a.action))return this.read(a,ctx);if(a.action==='direct')return this.direct(a,ctx);
  if(a.action==='recover'){const q=authControlRequest(a.action,{email:this.email(ALICE)}),r=await this.auth(q.method,q.path,q.body);return {status:r.status,transport:r.transport};}
  if(a.action==='mailMetadata'){
   const data=await mailJson('/api/v1/messages'),messages=data.messages??data.Messages;need(Array.isArray(messages),'MAIL_FORMAT');if(a.when==='before'){this.mailBefore=new Set(messages.map(m=>m.ID));return {complete:true,before:true,safeReceipt:{messageCount:messages.length}};}
   const fresh=messages.filter(m=>!this.mailBefore.has(m.ID));need(fresh.length===1,'MAIL_COUNT');this.mailId=fresh[0].ID;return {complete:true,newCount:1,safeReceipt:{messageId:this.mailId}};
  }
  if(a.action==='mailBody'){
   const data=await mailJson('/api/v1/message/'+this.mailId);need((data.To??[]).some(x=>x.Address===this.email(ALICE)),'MAIL_RECIPIENT');const text=(data.Text??'')+' '+(data.HTML??'');const matches=[...text.matchAll(/https?:\/\/[^\s"<>]+/g)].map(m=>m[0].replaceAll('&amp;','&')).map(s=>{try{return new URL(s);}catch{return null;}}).filter(u=>u?.searchParams.get('type')==='recovery');
   const tokens=new Set(matches.map(u=>u.searchParams.get('token_hash')??u.searchParams.get('token')).filter(Boolean));need(tokens.size===1&&matches.every(u=>['localhost','127.0.0.1','gateway.'+PROJECT+'.internal.test'].includes(u.hostname)),'MAIL_TOKEN_SCOPE');this.otp=[...tokens][0];return {complete:true,recipientUid:ALICE,newMessage:true,safeReceipt:{recipientUid:ALICE,messageId:this.mailId}};
  }
  if(a.action==='verifyRecovery'){
   need(this.otp,'RECOVERY_TOKEN_MISSING');const q=authControlRequest(a.action,{tokenHash:this.otp}),r=await this.auth(q.method,q.path,q.body);this.otp=null;need(r.status===200&&r.json.access_token,'RECOVERY_VERIFY_UNKNOWN',true);this.actors.AR={token:r.json.access_token,user:r.json.user,transport:r.transport};return {token:r.json.access_token,user:r.json.user,authVerified:true,originalToken:true,transport:r.transport};
  }
  if(a.action==='race')return this.race(ctx);
  if(a.action==='stopCandidate'){
   need(this.trustedCandidate&&!this.stopped,'STOP_SCOPE');this.stopped=true;const c=JSON.parse(await this.docker(['inspect',this.approval.candidateId]))[0];const before=candidateStopPreflight(c,this.candidate);this.journal.record('LIVE-stop-before',before);const r=await command(['docker','--context','desktop-linux','stop','--time','5',c.Id]);need(r.code===0,'STOP_UNKNOWN',true);const after=JSON.parse(await this.docker(['inspect',c.Id]))[0];need(after.State.Running===false&&after.State.ExitCode===0&&after.State.OOMKilled===false&&after.RestartCount===0,'STOP_FINAL_STATE_UNKNOWN',true);return {stopped:true,safeReceipt:{id:c.Id,status:after.State.Status,exitCode:after.State.ExitCode,oom:false,restartCount:0,before}};
  }
  need(false,'OPERATION_NOT_WHITELISTED');
 }
 async waitUntil(ms,ctx){const n=ms-Date.now()+50;need(n>=0&&n<=6000,'WAIT_SCOPE');ctx.meter.checkTime();await new Promise(resolve=>setTimeout(resolve,n));}
 async race(ctx){return configurationRace({read:()=>this.read({action:'read',slot:ctx.state.raceOnly?'A1':'C2',rpc:'get_my_site'},ctx),revocationSQL:maintenanceSQL('revoke',ctx)});}
 destroySecrets(){for(const stage of Object.values(this.pending))stage.cancel();this.credentials={};this.actors={};this.pending={};this.adminKey=null;this.key=null;this.otp=null;this.workerKey=null;}
}
