import {TAIL_SCOPE,isContinuation,profilePin} from './contract.mjs';
// Explicit read-only pre-P01 observer. No SQL, HTTP, credential transmission,
// startup, listener or resource mutations. Keys are checked in RAM only.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {checkServerIdentity} from 'node:tls';
import {fixedTls,probeFixedTls} from './fixed-tls.mjs';
import {command} from './io.mjs';
import {root,pins,loadContract,GATEWAY,OLD_NODE,DB,REMAINING_SCOPE} from './contract.mjs';
import {SERVICES,assertServiceBindings,serviceBindingSha256,serviceTopologyErrors,candidateNameForScope,candidateAbsent} from './bindings.mjs';
import {canonical,hash,need} from './state.mjs';
const ascii=x=>canonical(x).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const safeEnv=new Set(['GOTRUE_API_PORT','GOTRUE_JWT_ISSUER','PGRST_SERVER_UNIX_SOCKET','PGRST_SERVER_UNIX_SOCKET_MODE']);
export function certificateBindings(){
 const {frozen}=loadContract(),base=dirname(dirname(fileURLToPath(root))),b1=resolve(base,'s3-3-r3-clean-business-integration-b1-resume-20261111-e449c25f'),pki=resolve(base,'s3-3-r3-clean-integration-environment-20261111-e449c25f/private/pki');
 for(const p of pins.public_certificates){const raw=readFileSync(p.path),c=new X509Certificate(raw);need(hash(raw)===p.sha256&&Date.parse(c.validFrom)<=Date.now()&&Date.parse(c.validTo)-Date.now()>=1200000,'BINDING_CERTIFICATE_PIN');}
 const cert=p=>new X509Certificate(readFileSync(p)),ca=cert(resolve(b1,'tls/server/server-ca.crt')),clients=cert(resolve(b1,'tls/server/clients-ca.crt'));
 const gateway=cert(resolve(b1,'gateway-app-v4/gateway.crt')),server=cert(resolve(b1,'tls/server/private-server.crt')),pg=cert(resolve(pki,'server.crt')),registration=cert(resolve(pki,'registration.crt')),worker=cert(resolve(b1,'tls/worker/worker.crt'));
 need(gateway.checkHost(SERVICES.auth.host)&&server.checkHost(SERVICES.node.host)&&pg.checkHost(SERVICES.registration.host)&&[gateway,server,pg].every(c=>c.verify(ca.publicKey))&&[worker,registration].every(c=>c.verify(clients.publicKey)),'BINDING_CERTIFICATE_IDENTITY');
 need(server.fingerprint256===frozen.tls.server_fingerprint&&worker.fingerprint256===SERVICES.node.workerFingerprint&&gateway.fingerprint256===SERVICES.auth.fingerprint,'BINDING_MTLS_PIN');
 for(const [c,path]of [[gateway,resolve(b1,'gateway-app-v4/gateway.key')],[server,resolve(b1,'tls/server/private-server.key')],[worker,resolve(b1,'tls/worker/worker.key')],[registration,resolve(pki,'registration.key')]])need(c.checkPrivateKey(createPrivateKey(readFileSync(path))),'BINDING_KEY_PAIR');
 return {ok:true,serverHost:SERVICES.node.host,registrarHost:SERVICES.registration.host,gatewayHost:SERVICES.auth.host,workerFingerprint:worker.fingerprint256,gatewayFingerprint:gateway.fingerprint256,caPath:resolve(b1,'tls/server/server-ca.crt')};
}
export async function probeAuthLane(certificates,{open}={}){
 const s=SERVICES.auth,options={servername:s.host,ca:readFileSync(certificates.caPath),rejectUnauthorized:true,minVersion:'TLSv1.2'};
 return probeFixedTls('auth',options,open?{open}:{});
}
const UDS_STAT=`import {lstatSync,accessSync,constants} from 'node:fs';const d=${JSON.stringify('/run/clean-internal')},s=${JSON.stringify(SERVICES.postgrest.socket)};const view=(p,type)=>{const v=lstatSync(p);if(v.isSymbolicLink()||!(type==='directory'?v.isDirectory():v.isSocket()))throw Error('UDS_TYPE');return {uid:v.uid,gid:v.gid,mode:v.mode&4095,type};};accessSync(s,constants.R_OK|constants.W_OK);console.log(JSON.stringify({directory:view(d,'directory'),socket:view(s,'socket'),uid:process.getuid(),gid:process.getgid(),readWrite:true}));`;
export async function collectBindingTopology({candidateId=null,probe=probeAuthLane,run=command}={}){
 assertServiceBindings();const docker=async args=>{const r=await run(['docker','--context','desktop-linux',...args]);need(r.code===0,'BINDING_DOCKER_UNKNOWN',true);return r.stdout;};
 const contextResult=await run(['docker','context','show']);need(contextResult.code===0,'BINDING_CONTEXT');
 const context=contextResult.stdout.toString().trim(),daemon=JSON.parse(await docker(['info','--format','{{json .}}'])).ID;
 need(context===SERVICES.context&&daemon===SERVICES.daemon,'BINDING_DAEMON');
 const objects=JSON.parse(await docker(['inspect',...Object.keys(pins.resource_config_sha256)]));
 const containers=Object.fromEntries(objects.map(o=>[o.Id,{name:o.Name,running:o.State.Running,configSha256:hash(ascii(o.Config)),hostSha256:hash(ascii(o.HostConfig)),cmd:o.Config.Cmd,user:o.Config.User,networkMode:o.HostConfig.NetworkMode,portBindings:o.HostConfig.PortBindings,mounts:o.Mounts.map(m=>({Type:m.Type,Name:m.Name??null,Source:m.Source,Destination:m.Destination,RW:m.RW})),env:Object.fromEntries(o.Config.Env.map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}).filter(([k])=>safeEnv.has(k)))}]));
 for(const [id,p]of Object.entries(pins.resource_config_sha256)){const c=containers[id];need(c?.running&&c.configSha256===p.config&&c.hostSha256===p.host,'BINDING_CONTAINER_DRIFT');}
 const networks=Object.fromEntries(JSON.parse(await docker(['network','inspect',...Object.keys(pins.networks)])).map(n=>[n.Id,{Internal:n.Internal,IPAM:n.IPAM,Containers:n.Containers}]));
 const mount=containers[GATEWAY].mounts.find(m=>m.Destination==='/config');need(mount?.Type==='bind'&&!mount.RW,'BINDING_GATEWAY_MOUNT');
 const raw=readFileSync(resolve(mount.Source,'kong.yaml')),parsed=JSON.parse(raw);const services=parsed.services.filter(s=>s.name==='clean-auth');need(services.length===1&&services[0].routes?.length===1,'BINDING_GATEWAY_CONFIG');const service=services[0],route=service.routes[0];
 // Never return consumers, credential fields, certificate keys or config text.
 const gatewayRoute={sha256:hash(raw),url:service.url,retries:service.retries,paths:route.paths,stripPath:route.strip_path};
 const stat=await docker(['exec','--user','1000:1000',OLD_NODE,'node','--input-type=module','-e',UDS_STAT]),uds=JSON.parse(stat);
 const capabilities={};
 for(const [key,args]of Object.entries({mail:['exec',GATEWAY,'/bin/sh','-c','test -x /usr/bin/nc'],carrier:['exec','--user','1000:1000',OLD_NODE,'node','-e',"if(process.platform!=='linux'||process.getuid()!==1000)process.exit(1);require('node:net');"]})){const r=await run(['docker','--context','desktop-linux',...args]);capabilities[key]=r.code===0;}
 const log=await run(['docker','--context','desktop-linux','logs','--tail','1',DB]);capabilities.databaseLog=log.code===0;
 return {context,daemon,containers,networks,gatewayRoute,uds,capabilities};
}
export async function checkServiceBindings({candidateId=null,probe=probeAuthLane,run=command,scope}={}){
 const checkedAt=new Date().toISOString(),snapshot=await collectBindingTopology({candidateId,probe,run});
 const names=(await run(['docker','--context','desktop-linux','container','ls','-a','--format','{{.Names}}']));need(names.code===0,'BINDING_CONTAINER_LIST');
 snapshot.candidateId=candidateId;snapshot.candidateAbsent=candidateAbsent(names.stdout.toString().split(/\r?\n/),scope);if(isContinuation(scope))snapshot.candidateName=candidateNameForScope(scope);
 snapshot.certificates=certificateBindings();snapshot.authLane=await probe(snapshot.certificates);
 const errors=serviceTopologyErrors(snapshot,{beforeP01:candidateId===null,scope});
 return {version:1,status:errors.length?'STOP':'SERVICE_BINDINGS_PASS',checkedAt,completedAt:new Date().toISOString(),beforeP01:candidateId===null,serviceBindingSha256:serviceBindingSha256(scope),...(isContinuation(scope)?{profileScope:scope,remainingProfileSha256:profilePin(scope)}:{}),errors,snapshot,dependencies:[{service:'Auth/Gateway',static:errors.length?'SEE_ERRORS':'PASS',connection:snapshot.authLane.authorized?'TLS_PASS_NO_HTTP':'STOP'},{service:'Mailpit',static:snapshot.capabilities.mail?'CLIENT_AND_TOPOLOGY_PASS':'STOP',connection:'NOT_RUN_THIS_CHECK'},{service:'PostgREST UDS',static:'SEE_UDS_IDENTITY',connection:'NOT_RUN_THIS_CHECK'},{service:'Proof registration',static:'PINNED_TOPOLOGY_AND_CERTIFICATES',connection:'NOT_RUN_THIS_CHECK'},{service:'existing Node carrier',static:snapshot.capabilities.carrier?'PASS':'STOP',connection:snapshot.authLane.authorized?'OPAQUE_CARRIER_PASS':'STOP'},{service:'PostgreSQL error log',static:snapshot.capabilities.databaseLog?'READABLE':'STOP',connection:'NO_SQL_SENT'},{service:'new Node',static:'FROZEN_SOURCE_AND_IMAGE_REQUIRE_DRIVER_CHECK',connection:'P01_REQUIRED'}],counts:{sqlTransactions:0,httpRequests:0,authRequests:0,tlsProbeAttempts:1,containerMutations:0}};
}
