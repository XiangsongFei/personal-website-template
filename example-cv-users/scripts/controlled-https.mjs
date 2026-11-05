import {safeError} from './transport-diagnostics.mjs';
import {assertCurrentNode} from './https/node-identity.mjs';
// Explicitly approved, one-shot local runner. Merely importing/building never runs it.
import https from 'node:https';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createInterface} from 'node:readline';
import {spawnSync} from 'node:child_process';
import {runtime} from '../tests/runtime.mjs';
import {CERT,readPublicCertificate,loadServerIdentity} from './https/identity.mjs';
import {authorizeLocalRequest,outgoingHeaders,browserFamily,cookieMetadata,cookieNames} from './local-https-boundary.mjs';
import {ORIGIN,POST_PATHS,validateBatch,checkManifest,bindings,createExecutor} from './controlled-real.mjs';

assertCurrentNode();
const [batchFile,manifestFile,checkOnly]=process.argv.slice(2);
if(!batchFile||!manifestFile||checkOnly&&checkOnly!=='--check')throw Error('explicit_batch_and_manifest_required');
const batch=JSON.parse(readFileSync(batchFile)),manifest=JSON.parse(readFileSync(manifestFile));
checkManifest(resolve('.'),manifest);validateBatch(batch,manifest);
if(checkOnly){console.log('Approved batch and exact build/tool bindings valid; no services or authentication started.');process.exit(0);}
if(!process.stdin.isTTY)throw Error('interactive_stdin_required_no_heredoc');
const key=process.env.USERS_PUBLISHABLE_KEY;
if(!key?.startsWith('sb_publishable_'))throw Error('publishable_key_missing');
const cert=readPublicCertificate();
if(cert.fingerprint256.replaceAll(':','')!=='03442B780D6297FB22F0CDC95E7FB78199A6E8EB966C633C2A4C8E96997933F8'
  ||cert.ca||cert.subjectAltName!=='IP Address:127.0.0.1'||Date.parse(cert.validFrom)>Date.now()
  ||Date.parse(cert.validTo)<batch.expiresAt+10*60000)throw Error('bound_leaf_certificate_unusable');
// This reads trust only. Separate approval is required to change certificate trust.
const trusted=spawnSync('/usr/bin/security',['verify-cert','-c',CERT,'-p','ssl','-s','127.0.0.1'],{encoding:'utf8',timeout:5000,maxBuffer:16384});
if(trusted.error||trusted.signal||trusted.status!==0)throw Error('trusted_https_unavailable');
const dir=resolve('.runtime',batch.id);mkdirSync(dir,{recursive:true,mode:0o700});
const executor=createExecutor({batch,manifest,dir,key,send:request=>fetch(request,{redirect:'manual'})});
const mf=runtime({port:0,unsafeInspectDurableObjects:false,resourcePersistencePath:resolve(dir,'state'),bindings:bindings(batch,key),
  serviceBindings:{USERS_CONTROLLED_EGRESS:request=>executor.outbound(request)},
  outboundService:()=>{throw Error('unmediated_network_denied');}});
let stopping=false,stopPromise,sequence=0,expiryTimer;
const active=new Set();
function log(data){console.log(JSON.stringify({at:new Date().toISOString(),...data}));}
async function handler(req,res){
  const seq=++sequence;let body,stage='boundary';const started=Date.now();
  try {
    if(stopping)throw Error('stopping');
    const route=authorizeLocalRequest(req,POST_PATHS);
    if(route.path==='/health'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('S2 local TLS diagnostic: health only; no authentication.');return;}
    if(req.method==='POST') {const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>4096)throw Error('body_size');chunks.push(c);}body=Buffer.concat(chunks);}
    const request=new Request(route.url,{method:route.method,headers:route.headers,...(body?{body}:{}),redirect:'manual'});
    log({kind:'request',seq,path:route.path,method:route.method,browser:browserFamily(req.headers['user-agent']),cookieNames:cookieNames(route.headers.get('cookie')??'')});
    stage='worker_dispatch';const response=await executor.dispatch(request,async r=>mf.dispatchFetch(r.url,{method:r.method,headers:r.headers,...(r.method==='POST'?{body:await r.arrayBuffer()}:{}),redirect:'manual'}),browserFamily(req.headers['user-agent']));
    stage='response_headers';const headers=outgoingHeaders(response);
    log({kind:'response',seq,status:response.status,location:headers.location??null,setCookies:(headers['set-cookie']??[]).map(cookieMetadata)});
    res.writeHead(response.status,headers);
    if(req.method==='HEAD'||!response.body){await response.body?.cancel();res.end();}else await pipeline(Readable.fromWeb(response.body),res);
  }catch(error){if(!res.headersSent)res.writeHead(503,{'Cache-Control':'private, no-store'});res.end();log({kind:'request_unknown',seq,stage,elapsedMs:Date.now()-started,...safeError(error)});}
  finally{body?.fill(0);}
}
const server=loadServerIdentity('tls',options=>https.createServer(options,(req,res)=>{const p=handler(req,res);active.add(p);p.finally(()=>active.delete(p));}));
server.requestTimeout=20000;server.headersTimeout=10000;
const input=createInterface({input:process.stdin});
function stop(){
  if(stopPromise)return stopPromise;
  stopping=true;clearTimeout(expiryTimer);log({kind:'stop_accepted'});
  stopPromise=(async()=>{
    let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('stop_timeout')),30000);});
    const dispose=(async()=>{const closed=new Promise(ok=>server.close(()=>ok()));server.closeIdleConnections();await Promise.allSettled([...active]);
      const cleanup=await executor.cleanup();log({kind:'session_cleanup',confirmed:cleanup});await closed;await mf.dispose();return cleanup;})();
    try {const cleanup=await Promise.race([dispose,deadline]);log({kind:'stop_complete',cleanupConfirmed:cleanup,workersDisposed:true});if(!cleanup)process.exitCode=1;}
    catch{process.exitCode=1;server.closeAllConnections();log({kind:'stop_unconfirmed'});}
    finally{clearTimeout(timer);input.close();process.stdin.pause();}
    // Keep evidence open while a timed-out cleanup may still publish its receipt.
    void dispose.finally(()=>executor.close()).catch(()=>{});
  })();return stopPromise;
}
try{await mf.ready;await new Promise((ok,no)=>{server.once('error',no);server.listen(8787,'127.0.0.1',ok);});}
catch{await mf.dispose();executor.close();input.close();throw Error('local_start_failed');}
writeFileSync(resolve(dir,'runtime.json'),JSON.stringify({pid:process.pid,node:process.execPath,sourceSha256:manifest.sourceSha256,toolingSha256:manifest.toolingSha256,
  artifactSha256:manifest.artifactSha256,origin:ORIGIN,workerURL:String(await mf.ready),noRemoteBindings:true,certificateFingerprint:cert.fingerprint256},null,2)+'\n',{mode:0o600});
log({kind:'ready',batch:batch.id,origin:ORIGIN});
expiryTimer=setTimeout(()=>void stop(),Math.max(0,batch.expiresAt-Date.now()));
console.log('Commands: status; arm <step-id>; unknown-check (only after confirmed scoped logout); stop. Never enter credentials here.');
input.on('line',line=>{try{
  if(line==='stop')void stop();
  else if(line==='status')log({kind:'status',...executor.snapshot()});
  else if(!stopping&&line.startsWith('arm ')){executor.arm(line.slice(4));log({kind:'armed',step:line.slice(4)});}
  else if(!stopping&&line==='unknown-check'){executor.permitUnknownCheck();log({kind:'unknown_check_ready'});}
}catch{log({kind:'command_rejected'});}});
input.on('close',()=>{if(!stopping)void stop();});
process.on('SIGINT',()=>void stop());
// SIGTERM intentionally retains the OS default for the identity-checked external
// fallback after shutdown is already UNKNOWN; it is not a cleanup receipt.
