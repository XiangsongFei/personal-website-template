// Candidate composition only. Import and direct execution do not start anything.
// An independently approved future executor must call startCandidate explicitly.
import {readFile} from 'node:fs/promises';
import {createHash,createPrivateKey,X509Certificate} from 'node:crypto';
import {createBusinessBinding} from '../../../lib/business/binding.mjs';
import {createIdentityAdapter} from '../../../lib/business/identity.mjs';
import {startPrivateRpcService} from '../../../lib/business/private-ingress.node.mjs';
import {createAuthTransport,verifiedAuth,ISSUER,PROJECT} from './auth-client.mjs';
import {installUdsEvidence} from './uds-evidence.mjs';
import {imageGate,launchImageGate} from './image-identity.mjs';
export {imageGate} from './image-identity.mjs';
export const PRIVATE_ORIGIN='https://api.'+PROJECT+'.internal.test:8445';
export const WORKER_PIN='00:BB:41:6C:72:D1:87:E0:71:A8:EF:05:4B:BB:E8:42:FC:BA:A5:C9:EF:37:2B:5A:73:9D:99:64:FE:1D:24:65';
export const binding=createBusinessBinding({project:PROJECT,authIssuer:ISSUER,privateOrigin:PRIVATE_ORIGIN,
 registrarHost:'pg.'+PROJECT+'.internal.test',socketPath:'/run/clean-internal/postgrest.sock',testOnly:true});
export function runtimeGuard({version=process.version,platform=process.platform,arch=process.arch}={}) {
 if(version!=='v24.22.1'||platform!=='linux'||arch!=='arm64')throw Error('RUNTIME_NOT_PINNED');
}
export function candidateOptions({apikey,tls},openAuth) {
 const transport=createAuthTransport({ca:tls.serverCa,apikey},openAuth);
 return Object.freeze({enabled:true,binding,peerPolicy:Object.freeze({uid:100,gid:1000}),
  listenHost:'0.0.0.0',listenPort:8445,trustedFingerprint:WORKER_PIN,
  identity:createIdentityAdapter({auth:verifiedAuth(transport),issuer:ISSUER}),
  tls:Object.freeze({ca:tls.clientsCa,cert:tls.cert,key:tls.key})});
}
export async function verifyFrozenFiles(manifest) {
 if(manifest.source_sha!=='56ab76779eab3ed1db6110574f2750c42252d5cf'||manifest.runtime!=='v24.22.1'||manifest.platform!=='linux/arm64/v8')throw Error('SOURCE_NOT_PINNED');
 const required=[...['binding','identity','private-ingress.node','private-rpc','protocol','r3-intent-ledger','r3-intent-object','r3-verifier','repository','service'].map(x=>'lib/business/'+x+'.mjs'),
  'tests/s3/clean-candidate/uds-evidence.mjs','tests/s3/clean-candidate/auth-client.mjs','tests/s3/clean-candidate/service.mjs','tests/s3/clean-candidate/control.mjs','tests/s3/clean-candidate/host-mtls.mjs','tests/s3/clean-candidate/image-identity.mjs','tests/s3/clean-candidate/launch.json','package.json','package-lock.json'];
 if(JSON.stringify(Object.keys(manifest.files).sort())!==JSON.stringify(required.sort())||JSON.stringify(manifest.runtime_dependencies)!=='[]')throw Error('SOURCE_INVENTORY');
 for(const [path,sha]of Object.entries(manifest.files)) {
  if(!/^(?:lib\/business\/[\w.-]+\.mjs|tests\/s3\/clean-candidate\/[\w.-]+\.mjs|tests\/s3\/clean-candidate\/launch\.json|package(?:-lock)?\.json)$/.test(path))throw Error('SOURCE_PATH');
  const raw=await readFile(new URL('../../../'+path,import.meta.url));
  if(createHash('sha256').update(raw).digest('hex')!==sha)throw Error('SOURCE_CHANGED');
 }
 imageGate(manifest.image);
 launchImageGate(JSON.parse(await readFile(new URL('./launch.json',import.meta.url),'utf8')),manifest.image);
}
export async function startCandidate({enabled=false,apikey}={}) {
 if(enabled!==true)throw Error('CANDIDATE_DISABLED');
 runtimeGuard();
 const manifest=JSON.parse(await readFile(new URL('./frozen.json',import.meta.url),'utf8'));
 imageGate(manifest.image); // Exact identity does not grant permission to start.
 await verifyFrozenFiles(manifest);
 if(JSON.stringify(Object.keys(manifest.tls.public_sha256).sort())!==JSON.stringify(['clients-ca.crt','private-server.crt','server-ca.crt']))throw Error('TLS_INVENTORY');
 const publicFiles={};
 for(const [name,sha]of Object.entries(manifest.tls.public_sha256)) {
  const pem=await readFile('/run/s34-tls/'+name,'utf8');
  if(createHash('sha256').update(pem).digest('hex')!==sha)throw Error('TLS_CHANGED');
  const cert=new X509Certificate(pem);
  if(Date.parse(cert.validFrom)>Date.now()||Date.parse(cert.validTo)-Date.now()<20*60*1000)throw Error('TLS_WINDOW');
  publicFiles[name]=pem;
 }
 const cert=new X509Certificate(publicFiles['private-server.crt']);
 if(cert.fingerprint256!==manifest.tls.server_fingerprint||!cert.checkHost(new URL(PRIVATE_ORIGIN).hostname))throw Error('TLS_IDENTITY');
 const key=await readFile('/run/s34-tls/private-server.key','utf8');
 if(!cert.checkPrivateKey(createPrivateKey(key)))throw Error('TLS_KEY');
 installUdsEvidence();
 return startPrivateRpcService(candidateOptions({apikey,tls:{serverCa:publicFiles['server-ca.crt'],
  clientsCa:publicFiles['clients-ca.crt'],cert:publicFiles['private-server.crt'],key}}));
}
