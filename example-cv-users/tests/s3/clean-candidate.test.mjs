// Offline real modules + synthetic Auth/TLS peer/UDS only. No socket or listener.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {binding,candidateOptions,PRIVATE_ORIGIN,WORKER_PIN,runtimeGuard,verifyFrozenFiles,imageGate,startCandidate} from './clean-candidate/service.mjs';
import {createAuthTransport,createHostAuthTransport,ISSUER} from './clean-candidate/auth-client.mjs';
import {createControl} from './clean-candidate/control.mjs';
import {createHostMtls} from './clean-candidate/host-mtls.mjs';
import {handlePrivateRpc,privateRpcPreflight} from '../../lib/business/private-ingress.node.mjs';
import {createRpcRepository} from '../../lib/business/repository.mjs';
const root=new URL('../../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('./clean-candidate/frozen.json',import.meta.url)));
const uid='a33c0000-0000-4000-8000-000000000001',sid='d33a0000-0000-4000-8000-000000000002';
const claims={iss:ISSUER,aud:'authenticated',role:'authenticated',sub:uid,session_id:sid,exp:4000000000,is_anonymous:false,amr:[{method:'password'}]};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode(claims)+'.offline';
const tls={serverCa:'-----BEGIN CERTIFICATE-----offline',clientsCa:'offline',cert:'offline',key:'offline'};
const apikey='sb_publishable_'+'a'.repeat(40);
function fakeAuth(status=200,complete=true,json={id:uid,is_anonymous:false,email_confirmed_at:'2026-01-01'}) {
 let calls=0;
 return {get calls(){return calls;},open(options,receive){calls++;
  assert.equal(options.hostname,'172.30.232.4');assert.equal(options.servername,'gateway.'+binding.project+'.internal.test');
  assert.equal(options.path,'/auth/v1/user');assert.equal(options.method,'GET');assert.equal(options.rejectUnauthorized,true);
  assert.equal(options.agent,false);assert.equal(options.headers.Authorization,'Bearer '+token);
  const req=new EventEmitter();req.destroy=()=>{};req.end=()=>receive(Object.assign(Readable.from([Buffer.from(JSON.stringify(json))]),{statusCode:status,complete,headers:{'content-type':'application/json'}}));return req;
 }};
}
test('freeze verifies merged production bytes, package lock and candidate; import has no start',async()=>{
 await verifyFrozenFiles(manifest);
 const merged=JSON.parse(readFileSync(new URL('./fixtures/s33-merged-source-sha256.json',import.meta.url)));
 assert.equal(merged.sourceCommit,manifest.source_sha);
 for(const [path,digest] of Object.entries(merged.sourceSha256)){
  assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),digest,path);
  assert.equal(manifest.files[path],digest,path);
 }
 const changed=structuredClone(manifest);changed.files['lib/business/binding.mjs']='0'.repeat(64);
 await assert.rejects(verifyFrozenFiles(changed),/SOURCE_CHANGED/);
 const missing=structuredClone(manifest);delete missing.files['lib/business/binding.mjs'];
 await assert.rejects(verifyFrozenFiles(missing),/SOURCE_INVENTORY/);
 await assert.rejects(startCandidate(),/CANDIDATE_DISABLED/);
 assert.doesNotThrow(()=>imageGate(manifest.image));
 assert.throws(()=>imageGate({...manifest.image,verified:false}),/IMAGE_UNVERIFIED/);
});
test('runtime excludes old Node, Darwin, x64 and any unpinned version',()=>{
 runtimeGuard({version:'v24.22.1',platform:'linux',arch:'arm64'});
 for(const patch of [{version:'v22.23.3'},{version:'v24.22.3'},{platform:'darwin'},{arch:'x64'}])assert.throws(()=>runtimeGuard({version:'v24.22.1',platform:'linux',arch:'arm64',...patch}),/RUNTIME_NOT_PINNED/);
});
test('final repository -> candidate identity -> final ingress -> actual UDS adapter',async()=>{
 const auth=fakeAuth();const options=candidateOptions({apikey,tls},auth.open);
 const fakeStat=(path)=>({uid:100,gid:1000,mode:path.endsWith('.sock')?0o660:0o770,dev:1,ino:path.endsWith('.sock')?2:1,
  isSymbolicLink:()=>false,isDirectory:()=>!path.endsWith('.sock'),isSocket:()=>path.endsWith('.sock')});
 const prepared=await privateRpcPreflight(options,async path=>fakeStat(path));
 assert.equal(prepared.listenPort,8445);assert.equal(prepared.binding,binding);
 let uds=0;const open=(opts,receive)=>{
  uds++;assert.equal(opts.socketPath,binding.socketPath);assert.equal(opts.path,'/rpc/get_my_site');assert.equal(opts.headers.Authorization,'Bearer '+token);
  assert.equal(opts.headers['Content-Profile'],'site_api');assert.equal(opts.headers['Accept-Profile'],'site_api');
  const req=new EventEmitter();req.end=raw=>{assert.equal(raw,'{}');receive(Object.assign(Readable.from([Buffer.from('{"site":null}')]),{statusCode:200,complete:true,headers:{'content-type':'application/json'}}));};return req;
 };
 const mtls=createHostMtls({ca:'offline',cert:'offline',key:'offline'},(opts,receive)=>{
  assert.equal(opts.hostname,'127.0.0.1');assert.equal(opts.port,57422);assert.equal(opts.servername,binding.privateHost);
  assert.equal(opts.rejectUnauthorized,true);assert.equal(opts.headers.Host,binding.privateAuthority);
  const outgoing=new EventEmitter();outgoing.destroy=()=>{};
  outgoing.end=async raw=>{
   const req=Object.assign(Readable.from([Buffer.from(raw)]),{complete:true,method:opts.method,url:opts.path,rawHeaders:Object.entries(opts.headers).flat()});
   const result=await handlePrivateRpc(req,{...options,signal:opts.signal,peerFingerprint:WORKER_PIN,openUnixRequest:open});
   receive(Object.assign(Readable.from([Buffer.from(JSON.stringify(result.json))]),{complete:true,statusCode:result.status,headers:{'content-type':'application/json'}}));
  };return outgoing;
 });
 const repository=createRpcRepository({binding,enabled:true,project:binding.project,endpoint:PRIVATE_ORIGIN,identity:options.identity,mtls});
 assert.deepEqual(await repository.mine(await options.identity.verifyAccount(token)),{site:null});
 assert.equal(auth.calls,2);assert.equal(uds,1);
});
test('control revocation during pending start terminates immediately and cannot report READY',async()=>{
 let finish,closed=0;const exits=[],events=[];
 const pending=new Promise(resolve=>{finish=resolve;});
 const control=createControl({start:()=>pending,terminate:code=>exits.push(code),emit:event=>events.push(event)});
 control.feed(JSON.stringify({command:'START',apikey})+'\n');await Promise.resolve();
 control.stop();assert.deepEqual(exits,[0]);
 finish({close(){closed++;}});await control.settled();
 assert.equal(closed,1);assert.equal(events.includes('READY'),false);
 let starts=0;const rejected=createControl({start:()=>{starts++;},terminate:code=>exits.push(code)});
 rejected.feed('{"command":"START","command":"START","apikey":"'+apikey+'"}\n');await rejected.settled();
 assert.equal(starts,0);assert.equal(exits.at(-1),1);
});
test('host Auth and mTLS bindings have fixed loopback routes and never select another upstream',async()=>{
 let calls=0;
 const client=createHostAuthTransport({ca:tls.serverCa,apikey},(opts,receive)=>{
  calls++;assert.equal(opts.hostname,'127.0.0.1');assert.equal(opts.port,57421);assert.equal(opts.path,'/auth/v1/user');
  const req=new EventEmitter();req.destroy=()=>{};req.end=()=>receive(Object.assign(Readable.from([Buffer.from('{}')]),{complete:true,statusCode:200,headers:{'content-type':'application/json'}}));return req;
 });
 await client.userOnce(token);assert.equal(calls,1);
 const mtls=createHostMtls({ca:'offline',cert:'offline',key:'offline'},()=>{throw Error('UNEXPECTED_NETWORK');});
 const init={method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'};
 for(const url of ['https://outside.invalid/rpc/get_my_site',PRIVATE_ORIGIN+'/rpc/register_business_ticket',PRIVATE_ORIGIN+'/rpc/get_my_site?x=1'])assert.throws(()=>mtls.fetch(url,init),/MTLS_ROUTE/);
});
test('Auth incomplete, redirect and unexpected failure remain UNKNOWN once without retry',async()=>{
 for(const [status,complete]of [[200,false],[302,true],[500,true]]){
  const f=fakeAuth(status,complete);const options=candidateOptions({apikey,tls},f.open);
  await assert.rejects(options.identity.verifyAccount(token),{code:'IDENTITY_UNAVAILABLE'});assert.equal(f.calls,1);
 }
 const f=fakeAuth(401,true,{error_code:'bad_jwt'});const options=candidateOptions({apikey,tls},f.open);
 await assert.rejects(options.identity.verifyAccount(token),{code:'IDENTITY_REQUIRED'});assert.equal(f.calls,1);
 assert.throws(()=>createAuthTransport({ca:tls.serverCa,apikey:'admin'}),/AUTH_CONFIG/);
});
