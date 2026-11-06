import {MANUAL_POLICY} from './manual-dashboard-evidence.mjs';
import {applicationPreflight,runtimeBindings} from './controlled-runtime.mjs';
import {RUN_LEASE_MAX_MS,usesReceipt} from './approval-receipt.mjs';
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
import {ORIGIN,POST_PATHS,validateBatch,checkManifest,bindings,createExecutor,authorizeRun,inspectRunApproval} from './controlled-real.mjs';

assertCurrentNode();
const args=process.argv.slice(2);
const [batchFile,manifestFile]=args;
const checkOnly=args.includes('--check');
const receiptAt=args.indexOf('--approval-receipt'),liveAt=args.indexOf('--live-read');
const manualAt=args.indexOf('--manual-evidence');
if(manualAt>=0&&liveAt>=0)throw Error('ambiguous_evidence_source');
const receiptFile=receiptAt>=0?args[receiptAt+1]:null,liveReadFile=manualAt>=0?args[manualAt+1]:liveAt>=0?args[liveAt+1]:null;
if(!batchFile||!manifestFile)throw Error('explicit_batch_and_manifest_required');
const candidateBytes=readFileSync(batchFile),batch=JSON.parse(candidateBytes),manifest=JSON.parse(readFileSync(manifestFile));
const receiptMode=usesReceipt(batch);
if((batch.approvalPolicy===MANUAL_POLICY)!==(manualAt>=0)&&!args.includes('--application-preflight'))throw Error('evidence_source_argument_denied');
checkManifest(resolve('.'),manifest);
validateBatch(batch,manifest,{prepared:receiptMode});
// Actual Worker/API check uses synthetic credentials and an in-memory authority only.
// It runs before trust evaluation/installation and before live authorization claim.
const plannedExpiry=Math.min(Date.now()+RUN_LEASE_MAX_MS,batch.expiresAt,Date.parse(readPublicCertificate().validTo)-3600000);
const preflight=await applicationPreflight({batch,expiresAt:plannedExpiry});
console.log(JSON.stringify({kind:'application_preflight',...preflight}));
if(args.includes('--application-preflight'))process.exit(0);
// Check never consumes approval and cannot be mistaken for an execution authorization.
if(checkOnly){
  if(receiptMode){if(!receiptFile||!liveReadFile)throw Error('approval_receipt_required');
    inspectRunApproval({batch,manifest,candidateBytes,receipt:JSON.parse(readFileSync(receiptFile)),liveReadBytes:readFileSync(liveReadFile),certificateValidTo:Date.parse(readPublicCertificate().validTo)});
  }
  console.log('Authorization checked only; no lease consumed, services or authentication started.');process.exit(0);
}

if(!process.stdin.isTTY)throw Error('interactive_stdin_required_no_heredoc');
const key=process.env.USERS_PUBLISHABLE_KEY;
if(!key?.startsWith('sb_publishable_'))throw Error('publishable_key_missing');
const cert=readPublicCertificate();
if(cert.fingerprint256.replaceAll(':','')!=='03442B780D6297FB22F0CDC95E7FB78199A6E8EB966C633C2A4C8E96997933F8'
  ||cert.ca||cert.subjectAltName!=='IP Address:127.0.0.1'||Date.parse(cert.validFrom)>Date.now()
  ||Date.parse(cert.validTo)<(receiptMode?Date.now()+3600000:batch.expiresAt+10*60000))throw Error('bound_leaf_certificate_unusable');
// This reads trust only. Separate approval is required to change certificate trust.
const trusted=spawnSync('/usr/bin/security',['verify-cert','-c',CERT,'-p','ssl','-s','127.0.0.1'],{encoding:'utf8',timeout:5000,maxBuffer:16384});
if(trusted.error||trusted.signal||trusted.status!==0)throw Error('trusted_https_unavailable');
const dir=resolve('.runtime',batch.id);mkdirSync(dir,{recursive:true,mode:0o700});
const approvalContext=receiptMode?authorizeRun({batch,manifest,candidateBytes,receipt:JSON.parse(readFileSync(receiptFile??'')),liveReadBytes:readFileSync(liveReadFile??''),certificateValidTo:Date.parse(cert.validTo)}):undefined;
const executor=createExecutor({batch,manifest,dir,key,approvalContext,send:request=>fetch(request,{redirect:'manual'})});
const mf=runtime({port:0,unsafeInspectDurableObjects:false,resourcePersistencePath:resolve(dir,'state'),bindings:runtimeBindings(batch,key,approvalContext?.expiresAt??Math.min(batch.expiresAt,Date.now()+RUN_LEASE_MAX_MS)),
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
log({kind:'ready',batch:batch.id,origin:ORIGIN,runId:approvalContext?.runId??null,expiresAt:approvalContext?.expiresAt??batch.expiresAt});
expiryTimer=setTimeout(()=>void stop(),Math.max(0,(approvalContext?.expiresAt??batch.expiresAt)-Date.now()));
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
