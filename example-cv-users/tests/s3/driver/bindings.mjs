import {TAIL_SCOPE,isContinuation,profilePin} from './contract.mjs';
// Closed R3 service graph. IPs come only from the already reviewed pins, selected
// by exact network and container ID; no discovery, fallback or caller target.
import {utcNanoseconds} from './time-window.mjs';
import {readFileSync} from 'node:fs';
import {pins,root,loadContract,PROJECT,DB,API,AUTH,REG,GATEWAY,OLD_NODE,REMAINING_SCOPE} from './contract.mjs';
import {binding,PRIVATE_ORIGIN,WORKER_PIN} from '../clean-candidate/service.mjs';
import {need,hash,canonical,same} from './state.mjs';
export const MAIL='74fb0da243ddd4fe59d74e53526d1ee40a4292e108fb18fd5a1b94c95f7984bd';
export const NET={api:'1419200f8741e7b2effd48c34b081ba2545b13d6f98836c85c52b1b16e18c96c',registration:'2bccb2df320f50ac72274fffbd7d21a721d5b4086b39e3eee6b02df10aa33e1f',platform:'9d979c879b17e334429b81a71683e7c346c7f88dad745060b8fdcb16e454e525'};
const ip=(net,id)=>{const entry=pins.networks[net]?.Containers[id];need(entry&&/^172\.30\.\d+\.\d+\/\d+$/.test(entry.IPv4Address),'BINDING_PIN_IDENTITY');return entry.IPv4Address.split('/')[0];};
function freeze(v){for(const x of Object.values(v))if(x&&typeof x==='object')freeze(x);return Object.freeze(v);}
function expected(){const launch=JSON.parse(readFileSync(new URL('../clean-candidate/launch.json',import.meta.url)));
 return {project:PROJECT,context:'desktop-linux',daemon:pins.daemon_baseline.ID,
  auth:{container:AUTH,ip:ip(NET.platform,AUTH),port:9999,host:'gateway.'+PROJECT+'.internal.test',hostIp:'127.0.0.1',hostPort:57421,gateway:GATEWAY,gatewayIp:ip(NET.api,GATEWAY),gatewayPort:8443,issuer:binding.authIssuer,fingerprint:'7A:98:FA:CF:2D:D7:40:DE:95:7E:2E:E6:F5:10:A9:66:34:81:63:84:A0:5F:EC:00:7A:04:B2:B3:8C:E9:F9:27'},
  mail:{container:MAIL,ip:ip(NET.platform,MAIL),port:8025,origin:'http://'+ip(NET.platform,MAIL)+':8025',carrier:GATEWAY},
  registration:{carrier:REG,carrierIp:ip(NET.registration,REG),target:DB,ip:ip(NET.registration,DB),port:5432,host:binding.registrarHost,user:'ecv_s3_registration_login'},
  postgrest:{container:API,carrier:OLD_NODE,namespace:'2aab2d21c0b2a61056bd1237726122046a35cf2b41d6f7e559bef7ac05763265',socket:binding.socketPath,volume:'ecv-r3-clean-20261111-e449c25f-b1-uds',uid:100,gid:1000,directoryMode:0o770,socketMode:0o660},
  node:{name:launch.container_name,ip:launch.fixed_ipv4,network:launch.network_mode,port:launch.publish_ports[0].container_port,hostIp:launch.publish_ports[0].host_ip,hostPort:launch.publish_ports[0].host_port,origin:PRIVATE_ORIGIN,host:binding.privateHost,authority:binding.privateAuthority,user:launch.user,workerFingerprint:WORKER_PIN},
  maintenance:{container:DB,socket:'/work/socket',user:'postgres'},
  gatewayConfigSha256:'cd43bfaf1123e602713fec51d70b90b34ac5bcada74561578b6696d4713fec5f'};
}
export const SERVICES=freeze(expected());
export const candidateNameForScope=scope=>isContinuation(scope)?loadContract(scope).launch.container_name:SERVICES.node.name;
export function candidateAbsent(names,scope){need(Array.isArray(names),'CANDIDATE_NAME_LIST');return !names.includes(candidateNameForScope(scope));}
export const serviceBindingSha256=scope=>hash(canonical(isContinuation(scope)?{...SERVICES,node:{...SERVICES.node,name:candidateNameForScope(scope)}}:SERVICES));
export function assertServiceBindings(value=SERVICES){
 loadContract();need(same(value,expected()),'SERVICE_BINDING_CONTRACT');
 need(value.mail.container!==value.auth.container&&value.mail.ip!==value.auth.ip,'MAIL_AUTH_ALIAS');
 need(value.node.hostPort===57422&&value.node.port===8445&&value.node.ip==='172.30.232.5'&&value.node.network===NET.api&&value.node.hostIp==='127.0.0.1','NODE_BINDING');return value;
}
export function httpsTarget(destination){assertServiceBindings();need(destination==='auth'||destination==='candidate','HTTP_DESTINATION');const s=destination==='auth'?SERVICES.auth:SERVICES.node;return {hostname:s.host,port:destination==='auth'?s.gatewayPort:s.port,servername:s.host,authority:destination==='auth'?s.host:s.authority};}
export function requireBindingReceipt(r,{runId,windowStartedAt,p00CompletedAt,driverSealSha256,scope}){
 need(r?.version===1&&r.status==='SERVICE_BINDINGS_PASS'&&r.beforeP01===true&&r.runId===runId&&r.driverSealSha256===driverSealSha256&&r.serviceBindingSha256===serviceBindingSha256(scope),'PRE_P01_BINDING_RECEIPT');
 if(isContinuation(scope))need(r.profileScope===scope&&r.remainingProfileSha256===profilePin(scope),'BINDING_PROFILE_REQUIRED');
 need(utcNanoseconds(r.checkedAt)>=utcNanoseconds(windowStartedAt)&&utcNanoseconds(r.completedAt)>=utcNanoseconds(r.checkedAt)&&utcNanoseconds(r.completedAt)<=utcNanoseconds(p00CompletedAt),'PRE_P01_BINDING_WINDOW');
 need(same(r.counts,{sqlTransactions:0,httpRequests:0,authRequests:0,tlsProbeAttempts:1,containerMutations:0}),'PRE_P01_BINDING_BUDGET');
 need(serviceTopologyErrors(r.snapshot,{scope}).length===0,'PRE_P01_BINDING_STOP');return r;
}
export function serviceTopologyErrors(o,{beforeP01=true,scope}={}){
 const errors=[],check=(ok,code)=>{if(!ok)errors.push(code);};assertServiceBindings();
 if(isContinuation(scope))check(o.candidateName===candidateNameForScope(scope),'PROFILE_CANDIDATE_NAME');
 check(o.context===SERVICES.context&&o.daemon===SERVICES.daemon,'DOCKER_IDENTITY');
 for(const [id,p]of Object.entries(pins.resource_config_sha256)){const c=o.containers?.[id];check(c?.running&&c.configSha256===p.config&&c.hostSha256===p.host,'CONTAINER_'+id.slice(0,12));}
 for(const [id,p]of Object.entries(pins.networks)){const n=o.networks?.[id];check(n?.Internal===p.Internal&&same(n.IPAM,p.IPAM),'NETWORK_'+id.slice(0,12));const entries=Object.fromEntries(Object.entries(n?.Containers??{}).filter(([cid])=>beforeP01||cid!==o.candidateId).map(([cid,c])=>[cid,{Name:c.Name,IPv4Address:c.IPv4Address}]));check(same(entries,p.Containers),'NETWORK_ENDPOINT_'+id.slice(0,12));}
 const a=o.containers?.[AUTH],m=o.containers?.[MAIL],g=o.containers?.[GATEWAY],api=o.containers?.[API],old=o.containers?.[OLD_NODE];
 check(a?.name==='/'+PROJECT+'-auth'&&a.env?.GOTRUE_API_PORT==='9999'&&a.env?.GOTRUE_JWT_ISSUER===SERVICES.auth.issuer,'AUTH_IDENTITY');
 check(m?.name==='/'+PROJECT+'-mail'&&same(m.cmd,['/mailpit','--smtp','0.0.0.0:1025','--listen','0.0.0.0:8025']),'MAIL_IDENTITY');
 check(same(g?.portBindings,{'8443/tcp':[{HostIp:SERVICES.auth.hostIp,HostPort:String(SERVICES.auth.hostPort)}]}),'AUTH_HOST_PUBLISH');
 const route=o.gatewayRoute;check(route?.sha256===SERVICES.gatewayConfigSha256&&route.url==='http://'+PROJECT+'-auth:9999/'&&route.retries===0&&same(route.paths,['/auth/v1'])&&route.stripPath===true,'GATEWAY_AUTH_ROUTE');
 check(api?.networkMode==='container:'+SERVICES.postgrest.namespace&&old?.networkMode===api?.networkMode,'POSTGREST_NAMESPACE');
 check(api?.user==='100:1000'&&api.env?.PGRST_SERVER_UNIX_SOCKET===SERVICES.postgrest.socket&&api.env?.PGRST_SERVER_UNIX_SOCKET_MODE==='660','POSTGREST_SOCKET_CONFIG');
 for(const [c,rw]of [[api,true],[old,false]])check(c?.mounts?.some(m=>m.Type==='volume'&&m.Name===SERVICES.postgrest.volume&&m.Destination==='/run/clean-internal'&&m.RW===rw),'UDS_MOUNT_IDENTITY');
 const u=o.uds;check(u?.directory?.uid===100&&u.directory.gid===1000&&u.directory.mode===0o770&&u.directory.type==='directory'&&u.socket?.uid===100&&u.socket.gid===1000&&u.socket.mode===0o660&&u.socket.type==='socket'&&u.uid===1000&&u.gid===1000&&u.readWrite===true,'UDS_IDENTITY');
 check(o.certificates?.ok===true&&o.certificates.serverHost===SERVICES.node.host&&o.certificates.registrarHost===SERVICES.registration.host&&o.certificates.gatewayHost===SERVICES.auth.host&&o.certificates.workerFingerprint===SERVICES.node.workerFingerprint,'TLS_IDENTITIES');
 if(beforeP01)check(o.candidateAbsent===true&&o.candidateId==null,'P01_ALREADY_CREATED');
 check(o.capabilities?.mail===true&&o.capabilities?.carrier===true&&o.capabilities?.databaseLog===true,'CLIENT_CAPABILITIES');
 check(o.authLane?.authorized===true&&o.authLane?.host===SERVICES.auth.host&&o.authLane?.fingerprint===SERVICES.auth.fingerprint&&o.certificates?.gatewayFingerprint===SERVICES.auth.fingerprint,'AUTH_LANE_TLS_IDENTITY');return errors;
}
