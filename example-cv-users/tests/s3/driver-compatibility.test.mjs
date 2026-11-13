// Synthetic local peers/processes only. Never call Docker/Auth/PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createServer as httpsServer} from 'node:https';
import {connect as tlsConnect} from 'node:tls';
import {gracefulJsonOnce} from './driver/graceful-json.mjs';
import {carrierInvocation,FixedStream,fixedTls} from './driver/fixed-tls.mjs';
import {parseMailResponse,mailJson} from './driver/mail.mjs';
import {correlateDatabase} from './driver/transport.mjs';
import {observeUds,SOCKET_PATH} from './clean-candidate/uds-evidence.mjs';
import {hash} from './driver/state.mjs';
import {SERVICES} from './driver/bindings.mjs';
import {pins} from './driver/contract.mjs';
import {candidateProbeScript} from './driver/live-host.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function processFake(){const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kills=0;p.kill=()=>{p.kills++;queueMicrotask(()=>p.emit('close',143));};return p;}
test('both lanes are exact container targets and have no host listener/port/DNS fallback',()=>{
 for(const [lane,ip,port]of [['auth','172.30.232.4',8443],['candidate','172.30.232.5',8445]]){const r=carrierInvocation(lane);assert.equal(r.ip,ip);assert.equal(r.port,port);assert(r.argv.includes('exec'));assert(!r.argv.includes('run'));assert(!r.argv.join(' ').includes('5742'));assert(!r.argv.join(' ').includes('listen'));assert(r.argv.at(-1).includes('allowHalfOpen:true'));}assert.throws(()=>carrierInvocation('other'),/HTTP_DESTINATION/);
});
test('TLS uses encrypted stdio and preserves CA/SNI; wrong target is refused before spawn',()=>{
 let made=0,options;const carrier=new PassThrough();const socket=new EventEmitter();socket.destroy=()=>{};
 const r=fixedTls('auth',{servername:SERVICES.auth.host,ca:'CA',rejectUnauthorized:true},{makeStream:()=>{made++;return carrier;},open:o=>{options=o;return socket;}});assert.equal(r.carrier,carrier);assert.equal(options.socket,carrier);assert.equal(options.host,undefined);assert.equal(options.port,undefined);assert.equal(options.rejectUnauthorized,true);assert.equal(made,1);
 for(const p of [{servername:'evil'},{rejectUnauthorized:false},{ca:null}])assert.throws(()=>fixedTls('auth',{servername:SERVICES.auth.host,ca:'CA',rejectUnauthorized:true,...p},{makeStream:()=>{throw Error('SPAWN');}}),/TLS_TARGET/);
});
test('carrier requires both EOFs, zero exit and empty stderr; no retry after fault',async t=>{
 for(const fault of ['none','input','output','stderr','exit','timeout'])await t.test(fault,async()=>{let calls=0;const p=processFake(),s=new FixedStream('auth',{spawnProcess:()=>{calls++;return p;},timeout:fault==='timeout'?15:500});s.resume();if(fault!=='input'&&fault!=='timeout')s.end();if(fault!=='output'&&fault!=='timeout')p.stdout.end();if(fault==='stderr')p.stderr.write('error');await tick();if(fault!=='timeout')p.emit('close',fault==='exit'?1:0);if(fault==='none')assert.equal((await s.finish()).exitCode,0);else await assert.rejects(s.finish());assert.equal(calls,1);s.destroy();});
});
test('actual synthetic TLS over stdio proves response/EOF and rejects truncation, timeout and fault without retry',async t=>{
 const dir=mkdtempSync(tmpdir()+'/ecv-s34-stdio-tls-');const ssl=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',dir+'/key','-out',dir+'/cert','-days','1','-subj','/CN=synthetic','-addext','subjectAltName=DNS:stdio-fixture.invalid']);assert.equal(ssl.status,0);
 const ca=readFileSync(dir+'/cert'),server=httpsServer({key:readFileSync(dir+'/key'),cert:ca},(q,s)=>{if(q.url==='/timeout')return;if(q.url==='/headers'){s.writeHead(200,{'Content-Type':'application/json','Content-Length':'50'});s.flushHeaders();return;}if(q.url==='/truncate'){s.writeHead(200,{'Content-Type':'application/json','Content-Length':'50'});s.write('{}');s.socket.destroy();return;}s.writeHead(200,{'Content-Type':'application/json'});s.end('{"ok":true}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 try{for(const mode of ['complete','truncate','timeout','headers','fault'])await t.test(mode,async()=>{let starts=0,carrier;
  const connectTls=options=>{carrier=new FixedStream('candidate',{spawnProcess:()=>{starts++;return spawn(process.execPath,['-e',`const s=require('net').connect({host:'127.0.0.1',port:${port},allowHalfOpen:true});s.on('connect',()=>{process.stdin.pipe(s);s.pipe(process.stdout);});s.on('error',()=>process.exit(1));s.on('close',()=>process.stdin.destroy());`],{stdio:['pipe','pipe','pipe']});}});return tlsConnect({...options,host:undefined,port:undefined,socket:carrier,allowHalfOpen:true});};
  const op=gracefulJsonOnce({hostname:'stdio-fixture.invalid',servername:'stdio-fixture.invalid',port:8445,path:'/'+mode,method:'GET',ca,rejectUnauthorized:true,headers:{Connection:'close'}},undefined,{connectTls,timeout:['timeout','headers'].includes(mode)?50:3000,fault:['fault','headers'].includes(mode)});
  if(mode==='complete'){const r=await op;assert.equal(r.json.ok,true);assert.equal((await carrier.finish()).exitCode,0);}else{await assert.rejects(op,e=>{assert.equal(e.intentionalFault,mode==='fault');return true;});carrier.abort();carrier.destroy(Error('synthetic fault'));await assert.rejects(carrier.finish());}assert.equal(starts,1);
 });}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
function mail(body='{"messages":[]}',headers=''){return Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${headers}\r\n${body}`);}
test('Mailpit empty result, length and chunked framing work without runtime install',()=>{assert.deepEqual(parseMailResponse(mail()),{messages:[]});assert.deepEqual(parseMailResponse(Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n')),{});});
test('Mailpit rejects wrong service, redirects, truncated/ambiguous/oversize/encoded data',()=>{
 for(const raw of [mail().subarray(0,-1),Buffer.from('HTTP/1.1 302 Found\r\nLocation: http://auth\r\n\r\n'),mail('{}','Content-Encoding: gzip\r\n'),mail('{}','Content-Length: 2\r\n'),mail().toString().replace('application/json','text/html'),Buffer.alloc(1081345)])assert.throws(()=>parseMailResponse(Buffer.from(raw)));
});
test('Mailpit does not retry failed client or empty mailbox and preserves scoped paths',async()=>{let count=0;await assert.rejects(mailJson('/api/v1/messages',{run:async()=>{count++;return {code:1,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};}}));assert.equal(count,1);const r=await mailJson('/api/v1/messages',{run:async()=>({code:0,stdout:mail(),stderr:Buffer.alloc(0)})});assert.deepEqual(r.messages,[]);await assert.rejects(mailJson('/api/v1/message/../../auth'));
});
test('actual Node24 diagnostics observes unchanged UDS request/complete response without leaking content',async()=>{
 const socketPath=mkdtempSync(tmpdir()+'/ecv-s34-observer-')+'/rpc.sock',records=[],dispose=observeUds({socketPath,emit:r=>records.push(r)});
 const claims={sub:'alice',session_id:'sid'},token='e30.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.secret',body='{"target":"site"}';let received;
 const server=createServer(async(q,s)=>{let b='';for await(const chunk of q)b+=chunk;received={b,authorization:q.headers.authorization};s.writeHead(403,{'content-type':'application/json'});s.end('{"code":"42501","message":"private diagnostic"}');});
 try{await new Promise(r=>server.listen(socketPath,r));const response=await new Promise((resolve,reject)=>{const q=request({socketPath,path:'/rpc/read_introduction',method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}},async s=>{try{let text='';for await(const b of s)text+=b;resolve({status:s.statusCode,text});}catch(e){reject(e);}});q.on('error',reject);q.write(body.slice(0,5));q.end(body.slice(5));});await tick();assert.equal(received.b,body);assert.equal(received.authorization,'Bearer '+token);assert.equal(response.status,403);assert.match(response.text,/private diagnostic/);assert.equal(records.length,1);const r=records[0];assert(r.complete);assert.equal(r.jwtSha256,hash(token));assert.equal(r.requestSha256,hash(body));assert.equal(r.responseSha256,hash(response.text));assert.equal(r.code,'42501');assert.equal(r.uid,'alice');assert(!JSON.stringify(r).includes('secret'));assert(!JSON.stringify(r).includes('private diagnostic'));assert(!JSON.stringify(r).includes('"site"'));}finally{dispose();await new Promise(r=>server.close(r));}
});
const at=Date.parse('2026-11-12T07:00:00Z'),scope={from:at,to:at+100,rpc:'get_my_site',uid:'alice',sid:'sid',jwtSha256:hash('jwt'),requestSha256:hash('{}')};
function trace(){return {seq:1,startedAt:at,finishedAt:at+50,socketPath:SOCKET_PATH,rpc:scope.rpc,uid:scope.uid,sid:scope.sid,jwtSha256:scope.jwtSha256,requestSha256:scope.requestSha256,status:403,code:'42501',contentType:'application/json',responseBytes:16,responseSha256:hash('{"code":"42501"}'),complete:true};}
const log=(raw,code=0)=>({code,stdout:Buffer.from(raw),stderr:Buffer.alloc(0)});
function denialLog(){return log(`2026-11-12 07:00:00.000 UTC [123] 42501 172.30.232.2 ecv_s3_internal_api_login@postgres ERROR: private text\nCONTEXT: PL/pgSQL function site_private.lock_business_qualification() line ${pins.frames.lock_business_qualification.qualification_line} at RAISE\nPL/pgSQL function site_api.get_my_site() line 4 at assignment\n`);}
test('denial comes from actual UDS and unique PG frame; never infers transaction rollback',()=>{const r=correlateDatabase(denialLog(),trace(),{...scope,candidate:{status:403,json:{code:'42501'}}});assert.equal(r.database.pid,123);assert.equal(r.database.outcome,'DENIED_RESPONSE_OBSERVED');assert.equal(r.database.rpcContextObserved,true);assert.equal(r.requestBinding.source,'observed-original-jwt-and-uds');assert(!JSON.stringify(r).includes('private text'));assert(!Object.hasOwn(r.database,'role'));});
test('missing/mismatched receipt, early HTTP denial, ambiguity and wrong error cannot become PASS',async t=>{
 const mutations={missing:r=>delete r.complete,jwt:r=>r.jwtSha256=hash('other'),uid:r=>r.uid='bob',sid:r=>r.sid='cross',rpc:r=>r.rpc='other',body:r=>r.requestSha256=hash('other'),status:r=>r.status=200,code:r=>r.code='22023',socket:r=>r.socketPath='/other',truncated:r=>r.complete=false};for(const [name,mutate]of Object.entries(mutations))await t.test(name,()=>{const r=trace();mutate(r);assert.throws(()=>correlateDatabase(denialLog(),r,scope));});
 for(const raw of [log(''),log(denialLog().stdout.toString().repeat(2)),log(denialLog().stdout.toString().replace('site_api.get_my_site','site_api.other')),log('',1)])assert.throws(()=>correlateDatabase(raw,trace(),scope));assert.throws(()=>correlateDatabase(denialLog(),null,{...scope,candidate:{status:403,json:{code:'42501'}}}));
});
test('P15 can retain independent actual database denial while outer transmission stays UNKNOWN',()=>{const r=correlateDatabase(denialLog(),trace(),scope);assert.equal(r.postgrest.status,403);assert.equal(r.postgrest.code,'42501');assert.equal(r.database.outcome,'DENIED_RESPONSE_OBSERVED');assert.throws(()=>correlateDatabase(denialLog(),{...trace(),complete:false},scope));});
test('write response awaits reconciliation; neither HTTP200 nor missing database evidence proves commit',()=>{const r=correlateDatabase(log(''),{...trace(),rpc:'apply_business_grant',status:200,code:null},{...scope,rpc:'apply_business_grant'});assert.equal(r.database.outcome,'RESPONSE_COMPLETE_AWAITING_RECONCILIATION');assert.throws(()=>correlateDatabase(denialLog(),{...trace(),status:200,code:null},scope));});

test('premature carrier destroy without error still reaps child and remains UNKNOWN',async()=>{const p=processFake(),s=new FixedStream('candidate',{spawnProcess:()=>p});s.destroy();await assert.rejects(s.finish());assert.equal(p.kills,1);});

test('both TLS lanes reject authorized but unpinned leaf certificates on each dispatch',()=>{for(const destination of ['auth','candidate']){const carrier=new PassThrough(),socket=new EventEmitter();let failure;socket.authorized=true;socket.getPeerCertificate=()=>({fingerprint256:'00:00'});socket.destroy=e=>{failure=e;};fixedTls(destination,{servername:destination==='auth'?SERVICES.auth.host:SERVICES.node.host,ca:'CA',rejectUnauthorized:true},{makeStream:()=>carrier,open:()=>socket});socket.emit('secureConnect');assert.equal(failure.code,'TLS_IDENTITY');}});

test('P01 generated dynamic probe parses offline and contains only TLS/UDS connectivity, not business requests',()=>{const script=candidateProbeScript(),r=spawnSync(process.execPath,['--check','--input-type=module'],{input:script,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(script,/authTLS:true,udsConnect:true/);assert(!script.includes('/auth/v1/user'));assert(!script.includes('http.request'));assert(!script.includes('psql'));});
