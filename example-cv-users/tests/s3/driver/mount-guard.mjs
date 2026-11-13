import{P14R_SCOPE,TAIL_SCOPE,loadContract}from'./contract.mjs';
// Four empirically verified Desktop paths, never a general prefix rewrite.
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {need,hash,same} from './state.mjs';
import {candidatePrivileges} from './evidence.mjs';
import {pins} from './contract.mjs';
export const MOUNT_POLICY=JSON.parse(readFileSync(new URL('./mount-policy.json',import.meta.url)));
export function trustedMountSource(source,target,desktop){
 const entry=MOUNT_POLICY.entries.find(e=>e.target===target);
 if(!entry)return source;
 need(desktop.context===MOUNT_POLICY.context&&desktop.daemon===MOUNT_POLICY.daemon&&desktop.serverVersion===MOUNT_POLICY.serverVersion,'MOUNT_DESKTOP_IDENTITY');
 need(source===entry.source||source===entry.dockerSource,'P01_MOUNT_SOURCE');
 return entry.source;
}
export function hostMountFiles({stat=lstatSync,real=realpathSync,read=path=>{
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=fstatSync(fd),raw=readFileSync(fd),after=fstatSync(fd);need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'MOUNT_FILE_CHANGED');return {raw,stat:after};}finally{closeSync(fd);}
}}={}){
 const result=[];
 for(const e of MOUNT_POLICY.entries){
  need(resolve(e.source)===e.source&&real(e.source)===e.source,'MOUNT_HOST_REALPATH');
  for(let p=e.source;;p=dirname(p)){const s=stat(p);need(!s.isSymbolicLink()&&(p===e.source?s.isFile():s.isDirectory()),'MOUNT_HOST_SYMLINK_OR_TYPE');if(dirname(p)===p)break;}
  const s=stat(e.source),v=read(e.source);need(s.isFile()&&s.nlink===1&&(s.mode&0o022)===0&&v.stat.dev===s.dev&&v.stat.ino===s.ino&&v.stat.nlink===1&&hash(v.raw)===e.sha256,'MOUNT_HOST_CONTENT');
  result.push({target:e.target,sha256:e.sha256,regular:true,noSymlinks:true});
 }
 return result;
}
export function candidateMountGate(c,launch,desktop){
 need(c.Mounts.length===launch.mounts.length&&c.HostConfig.Mounts?.length===launch.mounts.length,'P01_MOUNT_INVENTORY');
 for(const mount of launch.mounts){
  const actual=c.Mounts.filter(x=>x.Destination===mount.target),requests=c.HostConfig.Mounts.filter(x=>x.Target===mount.target);need(actual.length===1&&requests.length===1,'P01_MOUNT_DUPLICATE');
  const [a]=actual,[r]=requests;need((a.Type!=='bind'||a.Propagation==='rprivate')&&a.RW===false&&r.ReadOnly===true&&a.Type===mount.type&&r.Type===mount.type&&Object.keys(r).every(k=>['Type','Source','Target','ReadOnly'].includes(k)),'P01_MOUNT_MODE');
  const tls=MOUNT_POLICY.entries.find(e=>e.target===mount.target);if(tls)need(mount.type==='bind'&&mount.source===tls.source,'P01_MOUNT_POLICY');
  const actualSource=mount.type==='volume'?a.Name:trustedMountSource(a.Source,mount.target,desktop),requestSource=trustedMountSource(r.Source,mount.target,desktop);
  need(actualSource===mount.source&&requestSource===mount.source,'P01_MOUNT_SOURCE');
 }
 return {status:'PASS',mounts:c.Mounts.length,tlsFiles:MOUNT_POLICY.entries.length};
}
// Pure check reused by the REAL path and real-inspect mutation tests.
export function candidateInspectGate(c,launch,{id,context,daemon,serverVersion,requireRunning=true}={}){
 candidatePrivileges(c);
 need(c.Id===id&&c.Name==='/'+launch.container_name&&(!requireRunning||c.State.Running)&&c.Image===launch.image,'P01_CONTAINER_IDENTITY');
 need(c.Config.User===launch.user&&c.HostConfig.ReadonlyRootfs&&c.HostConfig.Memory===launch.memory_bytes&&c.HostConfig.NanoCpus===launch.nano_cpus&&c.HostConfig.PidsLimit===64&&same(c.HostConfig.CapDrop,['ALL'])&&c.HostConfig.NetworkMode===launch.network_mode,'P01_RESOURCE_IDENTITY');
 need(same(c.Config.Entrypoint,launch.entrypoint)&&same(c.Config.Cmd,launch.command)&&c.Config.WorkingDir==='/app'&&c.HostConfig.RestartPolicy.Name==='no','P01_ENTRYPOINT');
 need(Object.keys(c.HostConfig.Tmpfs??{}).length===1&&c.HostConfig.Tmpfs['/tmp']===launch.tmpfs['/tmp'],'P01_TMPFS');
 candidateMountGate(c,launch,{context,daemon,serverVersion});
 need(Object.values(c.NetworkSettings.Networks).length===1&&Object.values(c.NetworkSettings.Networks)[0].NetworkID===launch.network_mode&&Object.values(c.NetworkSettings.Networks)[0].IPAddress==='172.30.232.5'&&(launch.publish_ports.length===0?(same(launch,loadContract(TAIL_SCOPE).launch)||same(launch,loadContract(P14R_SCOPE).launch))&&same(c.HostConfig.PortBindings??{},{})&&same(c.NetworkSettings.Ports??{},{}):same(c.HostConfig.PortBindings,{'8445/tcp':[{HostIp:'127.0.0.1',HostPort:'57422'}]})),'P01_NETWORK');
 need(daemon===pins.daemon_baseline.ID,'DAEMON_ID');return {status:'PASS'};
}
export function candidateTlsProbeScript(){return `import {lstatSync,readFileSync} from 'node:fs';import {createHash,X509Certificate,createPrivateKey} from 'node:crypto';const files=${JSON.stringify(MOUNT_POLICY.entries.map(e=>({path:e.target,sha256:e.sha256})))};for(const e of files){for(let p=e.path;;p=p.slice(0,p.lastIndexOf('/'))||'/'){const s=lstatSync(p);if(s.isSymbolicLink()||(p===e.path?(!s.isFile()||s.nlink!==1):!s.isDirectory()))throw Error('MOUNT_TYPE');if(p==='/')break;}const raw=readFileSync(e.path);if(createHash('sha256').update(raw).digest('hex')!==e.sha256)throw Error('MOUNT_CONTENT');}const cert=new X509Certificate(readFileSync('/run/s34-tls/private-server.crt'));if(!cert.checkPrivateKey(createPrivateKey(readFileSync('/run/s34-tls/private-server.key'))))throw Error('MOUNT_KEY');console.log(JSON.stringify({tlsFiles:4,regular:true,sha256:true,keyPair:true}));`;}

export function candidateEndpointGate(c,launch,id,n){need(n.Id===id,'P01_ACTUAL_NETWORK_ID');const endpoint=n.Containers?.[c.Id];if(id===launch.network_mode)need(endpoint?.Name===launch.container_name&&endpoint.IPv4Address==='172.30.232.5/29','P01_ACTUAL_ENDPOINT');else need(endpoint===undefined,'P01_EXTRA_NETWORK');}
