import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {RegistrationStream,SqlSession,command} from './driver/io.mjs';
import {boundedOperation,checkIo} from './driver/deadline.mjs';
import {configurationRace,raceReadReceipt} from './driver/race.mjs';
import {registrarClientClass,parseDatabaseErrors,unexpectedOuterEvidence} from './driver/transport.mjs';
import {PROJECT} from './driver/contract.mjs';
import {Journal,hash} from './driver/state.mjs';
import {mkdtempSync,realpathSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
const tick=()=>new Promise(r=>setImmediate(r));
function fakeProcess(){const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kills=[];p.kill=s=>{p.kills.push(s);queueMicrotask(()=>p.emit('close',143));};return p;}
const meter=()=>({deadline:Date.now()+120000,clock:Date.now});
test('stdio registration proves both EOFs and zero carrier exit without opening a listener',async()=>{
 const p=fakeProcess();let args;const s=new RegistrationStream({spawnProcess:(...a)=>{args=a;return p;}});s.resume();s.on('error',()=>{});s.connect(5432,'pg.'+PROJECT+'.internal.test');p.emit('spawn');s.end();p.stdout.end();await tick();p.emit('close',0);
 assert.deepEqual(await s.finish(),{inputEof:true,outputEof:true,exitCode:0});assert(args[1].includes('exec'));assert(!args[1].some(x=>x==='-p'||x==='run'));assert(args[1].includes('172.30.233.2'));
 assert.throws(()=>s.connect(5432,'pg.'+PROJECT+'.internal.test'),/REGISTRATION_TARGET/);
});
test('registration missing EOF, stderr or nonzero exit cannot report committed transport',async t=>{
 for(const fault of ['missing-input','missing-output','stderr','exit'])await t.test(fault,async()=>{const p=fakeProcess(),s=new RegistrationStream({spawnProcess:()=>p});s.on('error',()=>{});s.resume();s.connect(5432,'pg.'+PROJECT+'.internal.test');if(fault!=='missing-input')s.end();if(fault!=='missing-output')p.stdout.end();if(fault==='stderr')p.stderr.write('error');await tick();p.emit('close',fault==='exit'?1:0);await assert.rejects(s.finish(),/REGISTRATION_EOF_UNKNOWN/);s.destroy();});
});
test('pg idle/query-completed error is handled and blocks successful receipt',async()=>{
 class Pg extends EventEmitter{constructor(c){super();this.connectionParameters={ssl:c.ssl};}async query(){return {command:'SELECT',rowCount:1,rows:[{registered:true}]};}async end(){}}
 let receipts=0;const Client=registrarClientClass({Client:Pg},()=>receipts++),host='pg.'+PROJECT+'.internal.test';
 const c=new Client({host,port:5432,database:'postgres',user:'ecv_s3_registration_login',ssl:{rejectUnauthorized:true,servername:host,checkServerIdentity:()=>undefined}});
 c.peer=true;c.carrier.finish=async()=>({inputEof:true,outputEof:true,exitCode:0});
 await c.query('SELECT site_private.register_business_ticket($1::jsonb) AS registered',['{}']);
 assert.doesNotThrow(()=>c.emit('error',Error('disconnect after query')));await assert.rejects(c.end(),/REGISTRATION_CONNECTION_UNKNOWN/);assert.equal(receipts,0);
});
test('interactive SQL query EOF loss is UNKNOWN and close hang is bounded',async()=>{
 const p=fakeProcess(),s=new SqlSession({spawnProcess:()=>p});const q=s.query('BEGIN READ ONLY;');p.emit('close',1);await assert.rejects(q,/SQL_SESSION_UNKNOWN/);
 const hanging=fakeProcess();hanging.kill=()=>{};
 const before=Date.now();await assert.rejects(boundedOperation(async()=>{const a=new SqlSession({spawnProcess:()=>hanging});await a.finish();},{meter:meter(),timeoutMs:25}),/OPERATION_TIMEOUT_UNKNOWN/);assert(Date.now()-before<1000);
 // finish's own timer remains bounded by the same scope; close it to avoid a
 // lingering mock event source after the operation's timeout has been proven.
 hanging.emit('close',143);
});
test('operation abort prevents late descendant I/O and command never retries',async()=>{
 let attempts=0;const p=fakeProcess();p.kill=()=>{};let late;
 await assert.rejects(boundedOperation(async()=>{late=new Promise(resolve=>setTimeout(()=>{try{checkIo();resolve('UNSAFE');}catch(e){resolve(e.code);}},40));await command(['fake'], '',{spawnProcess:()=>{attempts++;return p;}});},{meter:meter(),timeoutMs:20}),/OPERATION_TIMEOUT_UNKNOWN/);
 assert.equal(attempts,1);assert.equal(await late,'IO_DEADLINE_UNKNOWN');p.emit('close',143);
});
function raceHarness({queue=true,releaseFailure=false,readValue={ok:true},revokeLines=['{"prepared":true,"roleDelta":0,"pid":102}','COMMIT']}={}){
 let now=0,index=0,readCalls=0,revokeCalls=0,releaseRead,releaseRevoke,revokeQueued=false;const events=[];
 const read=()=>{readCalls++;return new Promise(r=>{releaseRead=r;});};
 class Session{constructor(kind){this.kind=kind;}async query(sql){events.push(this.kind+':query');if(this.kind===0)return [JSON.stringify({fence:true,pid:100})];if(this.kind===2){revokeCalls++;revokeQueued=true;return new Promise(r=>{releaseRevoke=r;});}if(sql.includes('jsonb_build_object'))return [JSON.stringify({readOnly:true,rows:queue?[{pid:101,role:'ecv_s3_internal_api_login',granted:false,mode:'ShareLock',blockers:[100],waitstart:'2026-11-12T07:00:00Z'},...(revokeQueued?[{pid:102,role:'postgres',granted:false,mode:'ExclusiveLock',blockers:[100,101],waitstart:'2026-11-12T07:00:01Z'}]:[])]:[]})];return [];}
 async end(){events.push(this.kind+':rollback');if(this.kind===0){releaseRead?.(readValue);releaseRevoke?.(revokeLines);if(releaseFailure)throw Error('lost rollback');}return {rollback:true};}async finish(){events.push(this.kind+':close');return{code:0,stderrSha256:hash('')};}abort(){events.push(this.kind+':abort');}}
 return {opts:{read,revocationSQL:'COMMIT;',sessionFactory:()=>new Session(index++),clock:()=>now,sleep:async ms=>{now+=ms;}},events,get readCalls(){return readCalls;},get revokeCalls(){return revokeCalls;}};
}
test('actual coordinator proves shared-before-exclusive queue and releases all held sessions',async()=>{const h=raceHarness(),r=await configurationRace(h.opts);assert(r.databaseReadBeforeRevoke);assert(r.queue.readQueuedFirst);assert(r.queue.rollback);assert(r.fence.rollback);assert.equal(h.readCalls,1);assert.equal(h.revokeCalls,1);assert(h.events.includes('2:close'));});
test('unproven queue stops, releases fence and never starts or retries revocation',async()=>{const h=raceHarness({queue:false});await assert.rejects(configurationRace(h.opts),/READ_NOT_QUEUED/);assert.equal(h.readCalls,1);assert.equal(h.revokeCalls,0);assert(h.events.includes('0:rollback'));assert(h.events.includes('1:rollback'));});
test('fence release failure remains UNKNOWN without retrying a release',async()=>{const h=raceHarness({releaseFailure:true});await assert.rejects(configurationRace(h.opts),/FENCE_RELEASE_UNKNOWN/);assert(h.events.includes('0:abort'));assert.equal(h.revokeCalls,1);assert.equal(h.events.filter(x=>x==='0:rollback').length,1);assert.equal(h.events.filter(x=>x==='1:rollback').length,1);});
test('interleaved PID or unknown-state ERROR never borrows another database frame',()=>{
 const from=Date.parse('2026-11-12T06:59:59Z'),to=from+2000,head='2026-11-12 07:00:00.000 UTC [123] 42501 x ecv_s3_internal_api_login@postgres ERROR: denied\n';
 for(const other of ['2026-11-12 07:00:00.001 UTC [999] 00000 x postgres@postgres LOG: other','2026-11-12 07:00:00.001 UTC [123] 22023 x postgres@postgres ERROR: other']){const r=parseDatabaseErrors(head+other+'\nCONTEXT: PL/pgSQL function site_private.auth_source_identity() line 25 at RAISE',{from,to});assert.deepEqual(r[0].frames,[]);if(r.length===2)assert.equal(r[1].sqlstate,'22023');}
});
test('unexpected outer HTTP retains its real status and never calls an unobserved database NOT REACHED',async()=>{
 let logs=0;const r=await unexpectedOuterEvidence({outerStatus:503,candidate:{status:500,transport:{complete:true}},readLogs:async status=>{logs++;assert.equal(status,500);return {postgrest:{status},database:{sqlstate:'XX000',source:'postgres-log'}};}});assert.equal(r.outerStatus,503);assert.equal(r.postgrest.status,500);assert.equal(r.database.sqlstate,'XX000');
 const unknown=await unexpectedOuterEvidence({outerStatus:503,candidate:null,readLogs:()=>{logs++;}});assert.equal(unknown.outerStatus,503);assert.equal(unknown.database.outcome,'UNKNOWN');assert.equal(logs,1);
});
test('handleable SIGTERM aborts active operation once and leaves cleanup unsignalled',async()=>{
 const code=`import {stopSignals} from ${JSON.stringify(new URL('./driver/signals.mjs',import.meta.url).href)};import {boundedOperation} from ${JSON.stringify(new URL('./driver/deadline.mjs',import.meta.url).href)};const s=stopSignals();const m={deadline:Date.now()+120000,clock:Date.now};console.log('READY');try{await boundedOperation(()=>new Promise(()=>{}),{meter:m,signal:s.signal});}catch(e){console.log(e.code);}finally{await boundedOperation(async()=>console.log('CLEANUP'),{meter:m,signal:s.signal,cleanup:true});console.log(s.count);s.dispose();}`;
 const r=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let out='',err='',sent=false;p.stdout.on('data',b=>{out+=b;if(out.includes('READY')&&!sent){sent=true;p.kill('SIGTERM');}});p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',(code,signal)=>resolve({code,signal,out,err}));});
 assert.equal(r.code,0,JSON.stringify(r));assert.match(r.out,/SIGNAL_INTERRUPTED_UNKNOWN\nCLEANUP\n1/);assert.equal(r.err,'');
});

test('race durable receipt retains exact identity/UDS, queue times and native COMMIT evidence but no payload or credentials',async()=>{
 const readValue={outerStatus:200,postgrest:{status:200,udsObserved:true},database:{outcome:'READ_COMPLETED',uid:'charlie',sid:'new-c2',rpc:'get_my_site'},transport:{complete:true},requestBinding:{uid:'charlie',sid:'new-c2',rpc:'get_my_site',dispatchId:'new-operation',jwtSha256:hash('original-private-token')},udsEvidence:{seq:8,complete:true,responseSha256:hash('{"site":null}'),requestSha256:hash('{}')},token:'never-store-this',data:{secret:'business-content'}};
 const h=raceHarness({readValue,revokeLines:['BEGIN','SET','UPDATE 1','{"prepared":true,"roleDelta":0,"pid":102}','{"private":"never-store-this"}','REVOKE ROLE','COMMIT']}),r=await configurationRace(h.opts);
 assert.deepEqual(r.safeReceipt.read,raceReadReceipt(readValue));assert.equal(r.safeReceipt.revoke.commandTags.at(-1),'COMMIT');assert.equal(r.safeReceipt.revoke.sqlSha256,hash('COMMIT;'));assert(r.safeReceipt.revoke.responseSha256);assert.equal(r.safeReceipt.queue.readWaitStart,'2026-11-12T07:00:00Z');assert.equal(r.safeReceipt.queue.revokeWaitStart,'2026-11-12T07:00:01Z');assert(r.safeReceipt.fence.rollback);
 const d=realpathSync(mkdtempSync(tmpdir()+'/s34-race-archive-')),journal=new Journal(d+'/j',{runId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',mode:'OFFLINE'});journal.record('race',r.safeReceipt);const text=readFileSync(d+'/j/race.json','utf8');assert(!text.includes('never-store-this'));assert(!text.includes('business-content'));assert(!text.includes('original-private-token'));assert.equal(h.readCalls,1);assert.equal(h.revokeCalls,1);
});
test('lost revoke COMMIT evidence stays UNKNOWN and is not replayed to complete a receipt',async()=>{const h=raceHarness({revokeLines:['BEGIN','UPDATE 1']});await assert.rejects(configurationRace(h.opts),/REVOKE_COMMIT_UNKNOWN/);assert.equal(h.readCalls,1);assert.equal(h.revokeCalls,1);});
