import {WORK_ROOT} from './driver/contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {normalizedAuthority,createTimeWindow,isTimeWindow,assertTimeWindow,utcNanoseconds} from './driver/time-window.mjs';
import {createLiveHost,requireCandidateCreationOrder} from './driver/live-host.mjs';
import {startupScope} from './driver/startup.mjs';
import {serviceBindingSha256} from './driver/bindings.mjs';
import {Meter,hash} from './driver/state.mjs';
import {loadContract,pins,PROJECT,root} from './driver/contract.mjs';
const cli=fileURLToPath(new URL('../../scripts/s34-driver.mjs',import.meta.url)),base=WORK_ROOT;
const seal=()=>hash(readFileSync(new URL('./driver/seal.json',import.meta.url)));
function setup(mode='OFFLINE_REHEARSAL'){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'ecv-time-cli-'))),runId=randomUUID(),start=Date.now()-1000;
 const launch=JSON.parse(readFileSync(new URL('./clean-candidate/launch.json',import.meta.url)));
 const reviewPath=join(dir,'review.json');writeFileSync(reviewPath,JSON.stringify({status:'OFFLINE_REVIEW_PASS',driverSealSha256:seal(),scope:'OFFLINE_FIXTURE_NOT_EXECUTION_AUTHORIZATION'}),{mode:0o600});
 const a={version:1,state:mode,project:PROJECT,scope:'S34-P02-P16',runId,sourceSha:pins.source_sha,driverSealSha256:seal(),windowStartedAt:new Date(start).toISOString(),expiresAt:new Date(start+1200000).toISOString(),candidateName:launch.container_name,runDirectory:resolve(base,'s3-4-live-run-'+runId),receiptDirectory:resolve(base,'s3-4-run-receipts-'+runId),intentDirectory:pins.intent_directory,reviewPath,reviewSha256:hash(readFileSync(reviewPath)),baselinePath:resolve(base,'s3-4-final-preparation-20261112T055926Z/baseline-final.json'),baselineSha256:pins.baseline_sha256,acceptedEffects:{aliceResetAndCascade:true,charlieFixtureAndContainment:true,temporaryMaintenanceAndCheck:true,stopNewCandidate:true}};
 return {dir,a,path:join(dir,'approval.json')};
}
function invoke(s,action='--rehearse',{extra=[],digest,preload,tempDirectory=tmpdir()}={}){
 writeFileSync(s.path,JSON.stringify(s.a),{mode:0o600});
 const guard=fileURLToPath(new URL('./driver/offline-guard.mjs',import.meta.url));
 const p=spawnSync(process.execPath,['--import',guard,...(preload?['--import',preload]:[]),cli,action,'--approval',s.path,'--approval-sha256',digest??hash(readFileSync(s.path)),...extra],{encoding:'utf8',timeout:15000,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:tempDirectory}});
 assert(!p.error,p.error?.message);const errors=p.stderr.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)),audit=errors.find(x=>'offlineExternalIoAttempts'in x);assert.equal(audit?.offlineExternalIoAttempts,0,p.stderr);return {...p,error:errors.find(x=>x.status==='STOP'),out:p.stdout?JSON.parse(p.stdout):null};
}
const realIntentsConsumed=()=>loadContract().fixture.proof_slots.some(s=>['approved','consumed'].some(x=>existsSync(join(pins.intent_directory,s.proof_id+'.'+x+'.json'))));
// Explicit read-view fixture for deeper CLI file-gate tests ONLY. The child
// has offline-guard installed first: no Docker/network/SQL can be dispatched.
function syntheticUnconsumed(s){const preload=join(s.dir,'SYNTHETIC-unconsumed-read-view.mjs'),targets=loadContract().fixture.proof_slots.flatMap(p=>['approved','consumed'].map(x=>join(pins.intent_directory,p.proof_id+'.'+x+'.json')));writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const targets=new Set(${JSON.stringify(targets)}),original=fs.existsSync;fs.existsSync=p=>targets.has(String(p))?false:original(p);syncBuiltinESMExports();`);return preload;}
const realIntentBefore=()=>existsSync(pins.intent_directory)?readdirSync(pins.intent_directory).sort():null;
test('one immutable authority uses one conservative anchor; no tolerance and both override directions reject',()=>{
 let mono=1234.75,wall=Date.parse('2026-11-12T12:00:05Z');const clock=()=>mono,wallClock=()=>wall;
 const a={runId:randomUUID(),windowStartedAt:'2026-11-12T12:00:00.000000Z',expiresAt:'2026-11-12T12:20:00Z'},w=createTimeWindow(a,'a'.repeat(64),{clock,wallClock});
 assert(isTimeWindow(w));assert(Object.isFrozen(w));const {plan}=loadContract(),m=new Meter(plan,{timeWindow:w});assert.equal(m.deadline,w.deadline);assert(Number.isSafeInteger(w.deadline));assert.throws(()=>{m.deadline++;});assertTimeWindow(w,{approval:a,digest:'a'.repeat(64),startedAt:w.start,deadlineAt:w.deadline});
 for(const delta of [-1,-.001,.001,1])assert.throws(()=>new Meter(plan,{timeWindow:w,deadlineAt:w.deadline+delta}),/DEADLINE_OVERRIDE/);
 assert.throws(()=>assertTimeWindow(w,{approval:{...a,expiresAt:'2026-11-12T12:19:59Z'},digest:'a'.repeat(64)}),/TIME_AUTHORITY_MISMATCH/);
 assert.throws(()=>assertTimeWindow({...w}),/TIME_CONTEXT_REQUIRED/);
 mono=w.deadline-90000+1;assert.throws(()=>m.checkTime(),/DEADLINE_STOP/);assert.doesNotThrow(()=>m.checkTime(true));mono=w.deadline+1;assert.throws(()=>m.checkTime(true),/DEADLINE_STOP/);
});
test('UTC precision is normalized inward, exact extra nanosecond cap and invalid calendar are rejected',()=>{
 const a={windowStartedAt:'2026-11-12T12:00:00.123456789Z',expiresAt:'2026-11-12T12:20:00.123456789Z'},n=normalizedAuthority(a);assert.equal(n.startMs,Date.parse('2026-11-12T12:00:00.124Z'));assert.equal(n.expiresMs,Date.parse('2026-11-12T12:20:00.123Z'));
 assert.equal(utcNanoseconds('2026-11-12T12:00:00.123Z'),utcNanoseconds('2026-11-12T12:00:00.123000000+00:00'));
 assert.throws(()=>normalizedAuthority({...a,expiresAt:'2026-11-12T12:20:00.123456790Z'}),/TIME_WINDOW_CAP/);
 for(const s of ['2026-02-30T12:00:00Z','2026-11-12 12:00:00Z','2026-11-12T12:00:00+08:00','2026-11-12T12:00:60Z','nope'])assert.throws(()=>utcNanoseconds(s));
});
test('actual CLI complete rehearsal follows parser/startup/Meter/Intent/state machine with external I/O denied',()=>{
 const before=realIntentBefore(),s=setup(),r=invoke(s);assert.equal(r.status,0,r.stderr);assert.equal(r.out.status,'COMPLETED_EXPECTED_UNKNOWN');assert.equal(r.out.mode,'OFFLINE');assert.equal(r.out.realExecution,'NOT AUTHORIZED');assert.equal(r.out.cleanup.status,'VERIFIED_CLOSED');assert.equal(r.out.time.windowMs,1200000);assert.equal(r.out.time.cleanupReserveMs,90000);assert.equal(r.out.usage.http_edges,203);assert.equal(r.out.usage.local_intent,6);assert(!existsSync(s.a.runDirectory));assert.deepEqual(realIntentBefore(),before);assert(r.out.receiptDirectory.startsWith(join(realpathSync(tmpdir()),'ecv-s34-cli-rehearsal-')));
});
test('actual CLI same deadline with zero offset and six/nine digit representation does not false STOP',()=>{
 const s=setup();s.a.windowStartedAt=s.a.windowStartedAt.replace('Z','000000Z');s.a.expiresAt=s.a.expiresAt.replace('Z','000000Z');s.a.rehearsal={deadlineOffsetMs:0,startOffsetMs:0};const r=invoke(s);assert.equal(r.status,0,r.stderr);assert.equal(r.out.status,'COMPLETED_EXPECTED_UNKNOWN');
});
test('actual formal --execute passes time initialization then fails missing P00 prerequisite without journal or external I/O',()=>{
 const s=setup('AUTHORIZED'),r=invoke(s,'--execute',{preload:syntheticUnconsumed(s)});assert.equal(r.status,1);assert.equal(r.error.code,'PRE_P00_STARTUP_RECEIPT');assert(!existsSync(s.a.runDirectory));
});
test('actual CLI rejects early/late overrides, missing/invalid/expired times, cleanup shortage and malformed args',async t=>{
 const changes={early:s=>s.a.rehearsal={deadlineOffsetMs:-1},late:s=>s.a.rehearsal={deadlineOffsetMs:1},shiftBoth:s=>s.a.rehearsal={deadlineOffsetMs:1,startOffsetMs:1},missing:s=>delete s.a.expiresAt,invalid:s=>s.a.expiresAt='invalid',calendar:s=>s.a.expiresAt='2026-02-30T12:00:00Z',expired:s=>{const n=Date.now()-1201000;s.a.windowStartedAt=new Date(n).toISOString();s.a.expiresAt=new Date(n+1200000).toISOString();},over20:s=>s.a.expiresAt=new Date(Date.parse(s.a.windowStartedAt)+1200001).toISOString(),noCleanup:s=>{const n=Date.now()-1111000;s.a.windowStartedAt=new Date(n).toISOString();s.a.expiresAt=new Date(n+1200000).toISOString();}};
 for(const [name,change]of Object.entries(changes))await t.test(name,()=>{const s=setup();change(s);const r=invoke(s);assert.equal(r.status,1);assert(r.error);assert(!existsSync(s.a.runDirectory));});
 const s=setup();assert.equal(invoke(s,'--rehearse',{extra:['--deadline','123']}).error.code,'EXPLICIT_EXECUTION_ARGUMENTS_REQUIRED');
});
test('real CLI does not admit rehearsal switches or undeclared time overrides',()=>{
 for(const mutate of [a=>a.rehearsal={deadlineOffsetMs:0},a=>a.deadlineAt=0]){const s=setup('AUTHORIZED');mutate(s.a);const r=invoke(s,'--execute');assert.equal(r.status,1);assert(['REHEARSAL_NOT_REAL','DEADLINE_OVERRIDE'].includes(r.error.code));assert(!existsSync(s.a.runDirectory));}
});
test('actual CLI budget overflow still STOP; UNKNOWN is dispatched once and closes without retry',()=>{
 const s=setup();s.a.rehearsal={limits:{http_edges:0}};const stopped=invoke(s);assert.equal(stopped.out.status,'STOP');assert.equal(stopped.out.failure.code,'BUDGET_http_edges');assert.equal(stopped.out.cleanup.status,'VERIFIED_CLOSED');
 const u=setup();u.a.rehearsal={faults:{'P04:apply:A1':'unknown'}};const unknown=invoke(u);assert.equal(unknown.out.status,'UNKNOWN');assert.equal(unknown.out.cleanup.status,'VERIFIED_CLOSED');const files=readdirSync(join(unknown.out.receiptDirectory,'journal'));assert.equal(files.filter(x=>x==='P04-apply-A1.issued.json').length,1);assert(!files.some(x=>x.startsWith('P05-')));
});
test('pure pre-P00 CLI checks scope before candidate creation and rejects consumed Intent/name/run/history conflicts',()=>{
 const s=setup('PREPARED_NOT_AUTHORIZED'),r=invoke(s,'--preflight-before-p00');if(realIntentsConsumed()){assert.equal(r.status,1);assert.equal(r.error.code,'FROZEN_INTENT_ALREADY_USED');}else{assert.equal(r.status,0,r.stderr);assert.equal(r.out.status,'PRE_P00_OFFLINE_PASS');assert.equal(r.out.externalIo,0);}assert(!existsSync(s.a.runDirectory));
 s.a.candidateName='ecv-s34-permissions-20261112-node';assert.equal(invoke(s,'--preflight-before-p00').error.code,'STARTUP_RUN_IDENTITY_OR_REPLAY');
 const old=setup('PREPARED_NOT_AUTHORIZED');old.a.runId='af888ec9-e695-4676-8d95-f3412af15694';old.a.runDirectory=resolve(base,'s3-4-live-run-'+old.a.runId);assert.equal(invoke(old,'--preflight-before-p00').error.code,'STARTUP_RUN_IDENTITY_OR_REPLAY');
});

test('REAL public factory rejects a custom-clock branded window before any dynamic I/O',()=>{const s=setup('AUTHORIZED');writeFileSync(s.path,JSON.stringify(s.a),{mode:0o600});const digest=hash(readFileSync(s.path)),window=createTimeWindow(s.a,digest,{clock:()=>1,wallClock:()=>Date.parse(s.a.windowStartedAt)+1});assert.throws(()=>createLiveHost({approvalPath:s.path,approvalSha256:digest,timeWindow:window}),e=>e.code==='REAL_CLOCK_REQUIRED');});
test('actual CLI detects an already consumed intent through read-only filesystem fault injection',()=>{const s=setup('PREPARED_NOT_AUTHORIZED'),id=loadContract().fixture.proof_slots[0].proof_id,target=join(pins.intent_directory,id+'.consumed.json'),preload=join(s.dir,'consumed-read-view.mjs');writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.existsSync;fs.existsSync=p=>String(p)===${JSON.stringify(target)}||original(p);syncBuiltinESMExports();`);const before=realIntentBefore(),r=invoke(s,'--preflight-before-p00',{preload});assert.equal(r.error.code,'FROZEN_INTENT_ALREADY_USED');assert.deepEqual(realIntentBefore(),before);assert(!existsSync(s.a.runDirectory));});
test('pre-P00 shared CLI rejects missing effects, changed authority digest and invalid budgets',()=>{for(const mutation of [a=>delete a.acceptedEffects,a=>a.acceptedEffects.stopNewCandidate=false]){const s=setup('AUTHORIZED');mutation(s.a);const r=invoke(s,'--preflight-before-p00');assert(['EFFECT_CONTRACT','EFFECT_AUTHORIZATION'].includes(r.error.code));assert(!existsSync(s.a.runDirectory));}const s=setup(),original=hash(Buffer.from(JSON.stringify(s.a)));s.a.expiresAt=new Date(Date.parse(s.a.expiresAt)-1).toISOString();assert.equal(invoke(s,'--rehearse',{digest:original}).error.code,'APPROVAL_DIGEST');const b=setup();b.a.rehearsal={limits:{http_edges:204}};assert.equal(invoke(b).error.code,'BUDGET_OVERRIDE');});
function receiptFixture(s){
 const save=(name,value)=>{const path=join(s.dir,name);writeFileSync(path,JSON.stringify(value),{mode:0o600});return {path,sha:hash(readFileSync(path))};};
 const a=s.a,t=Date.parse(a.windowStartedAt),at=n=>new Date(t+n).toISOString(),scope=startupScope(a),baseline=JSON.parse(readFileSync(a.baselinePath));
 const startup=save('startup.json',{version:1,status:'PRE_P00_OFFLINE_PASS',phase:'BEFORE_P00',runId:a.runId,driverSealSha256:a.driverSealSha256,startupScopeSha256:scope,externalIo:0,checkedAt:at(1)});a.startupReceiptPath=startup.path;a.startupReceiptSha256=startup.sha;
 const tx=[11,12].map((pid,i)=>{const r=save('synthetic-tx-'+i+'.json',{scope:'SYNTHETIC_FIXTURE_NO_REAL_QUERY',runId:a.runId,readOnly:true,rollback:true,pid,exitCode:0,tags:['BEGIN','ROLLBACK']});return {readOnly:true,rollback:true,pid,receiptPath:r.path,receiptSha256:r.sha};});
 const p00=save('p00.json',{runId:a.runId,status:'PASS_REAL_READ_ONLY',sourceSha:pins.source_sha,physicalId:'7706828727995158580',daemonId:pins.daemon_baseline.ID,closedCatalogExact:true,fingerprints:baseline.fingerprints,inventories:baseline.inventories,startedAt:at(10),completedAt:at(100),transactions:tx});a.preflightPath=p00.path;a.preflightSha256=p00.sha;
 const historical=JSON.parse(readFileSync(resolve(base,'s3-4-real-acceptance-af888ec9-e695-4676-8d95-f3412af15694/bindings.json')));const bound=save('binding-synthetic.json',{...historical,scope:'SYNTHETIC_FILE_GATE_FIXTURE_NO_LIVE_PROBE',runId:a.runId,driverSealSha256:a.driverSealSha256,serviceBindingSha256:serviceBindingSha256(),checkedAt:at(20),completedAt:at(30)});a.bindingReceiptPath=bound.path;a.bindingReceiptSha256=bound.sha;
 a.candidateId='P01_PENDING';return {save,at};
}
test('post-P00/pre-P01 actual CLI catches malformed raw rollback receipt before any candidate exists',()=>{const s=setup('AUTHORIZED');receiptFixture(s);const p00=JSON.parse(readFileSync(s.a.preflightPath));p00.transactions[0].pid=-1;writeFileSync(s.a.preflightPath,JSON.stringify(p00));s.a.preflightSha256=hash(readFileSync(s.a.preflightPath));const r=invoke(s,'--preflight-before-p01',{preload:syntheticUnconsumed(s)});assert.equal(r.error.code,'P00_TRANSACTION_RECEIPTS');assert(!existsSync(s.a.runDirectory));});

test('post-P00/pre-P01 valid synthetic receipts pass actual CLI file gate without Docker or journal',()=>{const s=setup('AUTHORIZED');receiptFixture(s);const r=invoke(s,'--preflight-before-p01',{preload:syntheticUnconsumed(s)});assert.equal(r.status,0,r.stderr);assert.equal(r.out.status,'PRE_P01_FILE_PASS');assert.equal(r.out.externalIo,0);assert(!existsSync(s.a.runDirectory));});

test('rehearsal rejects a temporary root inside the real workspace/Intent tree',()=>{const before=realIntentBefore(),s=setup();const r=invoke(s,'--rehearse',{tempDirectory:pins.intent_directory});assert.equal(r.error.code,'REHEARSAL_TEMP_SCOPE');assert.deepEqual(realIntentBefore(),before);});

test('candidate created before pre-P01 receipt is rejected even within the same millisecond',()=>{const gate={checkedAt:'2026-11-12T12:00:00.123456789Z'};assert.throws(()=>requireCandidateCreationOrder('2026-11-12T12:00:00.123456788Z',gate),/P01_CREATED_BEFORE_FILE_GATE/);requireCandidateCreationOrder('2026-11-12T12:00:00.123456789Z',gate);requireCandidateCreationOrder('2026-11-12T12:00:00.124Z',gate);});

test('caught forbidden I/O cannot produce a successful offline guard exit',()=>{const guard=fileURLToPath(new URL('./driver/offline-guard.mjs',import.meta.url));const r=spawnSync(process.execPath,['--import',guard,'--input-type=module','-e',"try{await fetch('https://never-contact.invalid');}catch{}"],{encoding:'utf8'});assert.equal(r.status,1);assert.equal(JSON.parse(r.stderr).offlineExternalIoAttempts,1);});

test('current P00 receipt directory may exist; terminal receipt still rejects reuse in actual CLI',()=>{for(const terminal of [false,true]){const s=setup('PREPARED_NOT_AUTHORIZED'),preload=join(s.dir,'receipt-dir-read-view.mjs');writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const r=${JSON.stringify(s.a.receiptDirectory)},terminal=${terminal},exists=fs.existsSync,stat=fs.lstatSync,real=fs.realpathSync;fs.existsSync=p=>String(p)===r||terminal&&String(p)===r+'/RESULT.json'||exists(p);fs.lstatSync=p=>String(p)===r?{uid:process.getuid(),mode:0o40700,isDirectory:()=>true,isSymbolicLink:()=>false}:stat(p);fs.realpathSync=p=>String(p)===r?r:real(p);syncBuiltinESMExports();`);const result=invoke(s,'--preflight-before-p00',{preload});if(terminal)assert.equal(result.error.code,'STARTUP_RUN_TERMINAL');else if(realIntentsConsumed())assert.equal(result.error.code,'FROZEN_INTENT_ALREADY_USED');else assert.equal(result.out.status,'PRE_P00_OFFLINE_PASS');assert(!existsSync(s.a.receiptDirectory));}});

test('host Node and pg byte guards reject drift without requiring private host material',async()=>{
 const {validateHostNode}=await import('./driver/startup.mjs');
 const {validatePgFiles}=await import('./driver/transport.mjs');
 const good={version:'v24.22.1',platform:'darwin',arch:'arm64',digest:'6f32069480ec14d52b6d7b1f3c7124cfbbc46203abf5ddf5c65b127435f3f329'};
 validateHostNode(good);for(const bad of [{version:'v24.22.3'},{platform:'linux'},{arch:'x64'},{digest:'0'.repeat(64)}])assert.throws(()=>validateHostNode({...good,...bad}),/HOST_NODE_PIN/);
 const lock={packages:[{root:'/synthetic',files:{'client.js':hash(Buffer.from('reviewed bytes'))}}]};validatePgFiles(lock,{read:()=>Buffer.from('reviewed bytes')});assert.throws(()=>validatePgFiles(lock,{read:()=>Buffer.from('drift')}),/HOST_PG_DEPENDENCY_CHANGED/);
 const setupReceipt=setup('PREPARED_NOT_AUTHORIZED'),r=invoke(setupReceipt,'--preflight-before-p00');assert.equal(r.status,0,r.stderr);assert.equal(r.out.hostChecks.status,'SYNTHETIC_MODE_HOST_ONLY_CHECKS_NOT_CLAIMED');assert(!existsSync(setupReceipt.a.runDirectory));
});
