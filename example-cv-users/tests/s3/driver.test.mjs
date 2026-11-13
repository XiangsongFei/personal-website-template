import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';
import {executeDriver} from './driver/engine.mjs';import {Meter,Journal,FileIntents,hash,DriverStop} from './driver/state.mjs';import {loadContract,costs,pins,ALICE,BOB,CHARLIE} from './driver/contract.mjs';import {MockHost,complete} from './driver/mock-host.mjs';import {claimApprovedIntent} from '../../lib/business/r3-intent-ledger.mjs';import {binding} from './clean-candidate/service.mjs';import {maintenanceSQL,observationSQL} from './driver/sql.mjs';import {parseDatabaseErrors,parsePostgrestAccess,httpsJson} from './driver/transport.mjs';import {createLiveHost} from './driver/live-host.mjs';
function setup(options={}){const directory=realpathSync(mkdtempSync(join(tmpdir(),'ecv-s34-driver-test-'))),runId=randomUUID(),host=new MockHost(options),journal=new Journal(join(directory,'journal'),{runId,mode:'OFFLINE'}),intents=new FileIntents(join(directory,'intents'),{runId,sourceSha:'a'.repeat(64),create:true});return {directory,host,journal,intents,runId};}
async function run(options={},limits={}){const s=setup(options);const result=await executeDriver({...s,clock:s.host.clock,limits,sourceSha:'a'.repeat(64)});return {...s,result};}
test('complete P02-P16 model retains expected UNKNOWN and closes within unchanged budget',async()=>{
 const {result:r,host,journal}=await run();assert.equal(r.status,'COMPLETED_EXPECTED_UNKNOWN');assert.equal(r.mode,'OFFLINE');assert.equal(r.realAcceptance,'NOT RUN');assert.equal(r.caseResults.P15,'UNKNOWN');assert.equal(r.cleanup.status,'VERIFIED_CLOSED');assert.equal(r.cleanup.charlieEpoch,1);
 for(const [key,n]of Object.entries({http_edges:203,auth_control:9,auth_user_get:61,explicit_database_transactions:95,read_only_audit:47,local_intent:6,proof_sign:3,registration_tx:3,grant_apply:3,outer_business:31,direct_db:4,auth_row_insert_cap:32,maintenance_tx:12}))assert.equal(r.usage[key],n,key);
 assert.equal(host.signatureCalls,3);assert.equal(host.stops,1);assert.equal(host.base.gates.enabled,false);assert.equal(host.base.users.filter(u=>u.uid===BOB).length,1);
 const p15=JSON.parse(readFileSync(join(journal.directory,'P15-fault-C2-get_my_site-positive.result.json')));assert.equal(p15.status,'UNKNOWN');assert.equal(p15.evidence.outerStatus,503);assert.equal(p15.evidence.database.sqlstate,'42501');
});
test('existing Alice password skips reset without transferring its unused slot',async()=>{const {result:r}=await run({credential:true});assert.equal(r.status,'COMPLETED_EXPECTED_UNKNOWN');assert.equal(r.usage.auth_control,8);assert.equal(r.usage.http_edges,201);assert.equal(r.usage.auth_delete_sessions,1);});
test('missing transport, database, attribution or persistence evidence cannot pass',async t=>{
 for(const [name,point,mutate]of [
 ['TLS EOF','P04:read:A1',r=>delete r.transport.tls.readEnd],
 ['DB source','P04:read:A1',r=>delete r.database],
 ['SQLSTATE','P05:read:A2',r=>r.database.sqlstate='22023'],
 ['inner frame','P10:direct:AR',r=>r.database.raiseLine=7],
 ['receipt commit','P04:observe',(r,h,c)=>{if(c.state.grants.A1)r.receiptMatches={};}],
 ['registration EOF','P04:signRegister:A1',r=>r.registration.outputEof=false]
 ])await t.test(name,async()=>{const s=await run({faults:{[point]:mutate}});assert.notEqual(s.result.status,'COMPLETED_EXPECTED_UNKNOWN');assert.equal(s.result.cleanup.status,'VERIFIED_CLOSED');assert.equal(s.host.stops,1);});
});
test('each individual budget is enforced before dispatch and leaves cleanup reserve',async t=>{
 for(const key of ['normal_reads','http_edges','auth_user_get','registration_tx','proof_sign','local_intent','auth_insert_users','auth_insert_sessions','business_insert_proof_generations','direct_db'])await t.test(key,async()=>{const s=await run({}, {[key]:0});assert.equal(s.result.status,'STOP');assert.equal(s.result.cleanup.status,'VERIFIED_CLOSED');assert(s.result.failure.code.startsWith('BUDGET_'));});
});
test('all step budgets and aggregate quotas reject expansions, negatives and duplicates',()=>{
 const {plan}=loadContract();const m=new Meter(plan,{clock:()=>0});assert.throws(()=>new Meter(plan,{limits:{http_edges:204}}),/BUDGET_OVERRIDE/);
 assert.throws(()=>m.reserve('x','P04',{http_edges:-1}),/UNKNOWN_BUDGET/);assert.throws(()=>m.reserve('x','P04',{unclassified:1}),/UNKNOWN_BUDGET/);
 m.reserve('one','P05',costs.login);assert.throws(()=>m.reserve('two','P05',costs.login),/STEP_BUDGET_auth_control/);assert.throws(()=>m.reserve('one','P05',{}),/DUPLICATE_OPERATION/);
});
test('UNKNOWN never retries; close runs and no later business dispatch occurs',async()=>{
 const s=await run({faults:{'P04:apply:A1':'unknown'}});assert.equal(s.result.status,'UNKNOWN');assert.equal(s.host.calls.filter(s=>s==='P04:apply:A1').length,1);assert(!s.host.calls.some(s=>s.startsWith('P05:')));assert.equal(s.result.cleanup.status,'VERIFIED_CLOSED');
});
test('closure UNKNOWN dominates an earlier STOP and all raw states remain in receipts',async()=>{
 const s=await run({faults:{'P05:read:A2':'stop','P16:close':'unknown'}});assert.equal(s.result.status,'UNKNOWN');assert.equal(s.result.failure.status,'STOP');assert.equal(s.result.cleanup.status,'UNKNOWN');assert.equal(s.host.base.gates.enabled,true);assert.equal(s.host.stops,1);
});
test('optional containment failure reports FAIL instead of a clean pass',async()=>{const s=await run({faults:{'P16:close':r=>r.containmentOk=false}});assert.equal(s.result.status,'STOP');assert.equal(s.result.cleanup.status,'FAIL');assert.equal(s.host.base.gates.enabled,false);});
test('P00 P01 independent-review gates cannot be skipped, and Mock cannot become REAL',async t=>{
 for(const gate of ['p00','p01','driverReview','source','image','uds','serviceBindings'])await t.test(gate,async()=>{const s=await run({faults:{gates:{[gate]:false}}});assert.equal(s.result.status,'STOP');assert.equal(s.host.calls.length,0);});
 const s=setup();await assert.rejects(executeDriver({...s,mode:'REAL',clock:s.host.clock}),/REAL_HOST_REQUIRED/);assert.throws(()=>createLiveHost({}),/NEW_AUTHORIZATION_REQUIRED/);
});
test('hold and enabled failures must be isolated predicates, not another refusal',async()=>{
 const s=await run({faults:{'P08:maintenance:hold':(r,h)=>{h.base.security_state.find(x=>x.auth_user_id===CHARLIE).business_enabled=false;}}});assert.equal(s.result.failure.code,'MAINTENANCE_PREDICATE_MISMATCH');assert.equal(s.result.cleanup.status,'VERIFIED_CLOSED');
});
test('Bob changes, new unbound SID, missing retained SID and changed old receipts fail closed',async t=>{
 for(const [name,mutate]of [
 ['Bob',r=>r.base.protected_auth[0].data_sha256='0'.repeat(64)],
 ['site',r=>r.base.fingerprints.find(x=>x.name==='site_data.sites').data_sha256='0'.repeat(64)],
 ['unbound',r=>r.base.sessions.push({sid:randomUUID(),uid:ALICE})],
 ['retained A2',(r,h,c)=>{if(c.state.sessions.A2)r.base.sessions=r.base.sessions.filter(x=>x.sid!==c.state.sessions.A2.sid);}],
 ['receipt',r=>r.base.operation_receipts[0].site_id=randomUUID()]
 ])await t.test(name,async()=>{const s=await run({faults:{'P05:observe':mutate}});assert.notEqual(s.result.status,'COMPLETED_EXPECTED_UNKNOWN');assert(s.result.failure);});
});
test('deadline aborts new business and still performs reserved close',async()=>{const s=await run({faults:{'P03:maintenance:open':(r,h)=>h.now+=1140001}});assert.equal(s.result.status,'STOP');assert.equal(s.result.failure.code,'DEADLINE_STOP');assert.equal(s.host.base.gates.enabled,false);});
test('an unrelated network UNKNOWN cannot masquerade as P15 expected fault',async()=>{const s=await run({faults:{'P15:faultRead:C2':r=>r.intentionalFault=false}});assert.equal(s.result.status,'UNKNOWN');assert.equal(s.result.expectedUnknown,false);assert.equal(s.result.cleanup.status,'VERIFIED_CLOSED');});
test('create-only journal refuses overwrites and secret-bearing receipt fields',()=>{const s=setup();s.journal.issue('operation',{action:'test'},{});s.journal.result('operation',{status:'UNKNOWN'});const p=join(s.journal.directory,'operation.result.json'),before=hash(readFileSync(p));assert.throws(()=>s.journal.result('operation',{status:'PASS'}),/EEXIST/);assert.equal(hash(readFileSync(p)),before);assert.throws(()=>s.journal.record('secret',{password:'never-save'}),/SECRET_RECEIPT/);assert.throws(()=>new Journal(s.journal.directory,{runId:s.runId,mode:'OFFLINE'}),/EEXIST/);});
test('persistent intent is denied after consumption, process restart or scope substitution',async()=>{
 const s=setup();const intent={project:binding.project,action:'issue',uid:ALICE,session_id:randomUUID(),epoch:0,proof_id:randomUUID(),key_id:'s34-r3-clean-20261112-k5'};s.intents.approve(intent,100,160);
 assert(await claimApprovedIntent(s.intents.storage(),intent,()=>110,binding));assert.equal(await claimApprovedIntent(s.intents.storage(),intent,()=>110,binding),false);
 const reopened=new FileIntents(s.intents.directory,{runId:s.runId,sourceSha:'a'.repeat(64)});assert.equal(await claimApprovedIntent(reopened.storage(),intent,()=>110,binding),false);assert.throws(()=>reopened.approve(intent,100,160),/INTENT_ALREADY_EXISTS/);
 const foreign=new FileIntents(s.intents.directory,{runId:randomUUID(),sourceSha:'b'.repeat(64)});await assert.rejects(claimApprovedIntent(foreign.storage(),intent,()=>110,binding),/INTENT_SCOPE/);
});
test('cross-process intent race has exactly one winner and no retry',async()=>{
 const s=setup(),intent={project:binding.project,action:'issue',uid:ALICE,session_id:randomUUID(),epoch:0,proof_id:randomUUID(),key_id:'s34-r3-clean-20261112-k5'};s.intents.approve(intent,100,160);
 const code=`import {FileIntents} from ${JSON.stringify(new URL('./driver/state.mjs',import.meta.url).href)};import {claimApprovedIntent} from ${JSON.stringify(new URL('../../lib/business/r3-intent-ledger.mjs',import.meta.url).href)};import {binding} from ${JSON.stringify(new URL('./clean-candidate/service.mjs',import.meta.url).href)};const f=new FileIntents(process.argv[1],{runId:process.argv[2],sourceSha:'a'.repeat(64)});try{console.log((await claimApprovedIntent(f.storage(),JSON.parse(process.argv[3]),()=>110,binding))?'WIN':'DENY');}catch{console.log('UNKNOWN');}`;
 const child=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',code,s.intents.directory,s.runId,JSON.stringify(intent)],{stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',b=>out+=b);p.on('error',reject);p.on('close',c=>c===0?resolve(out.trim()):reject(Error('CHILD')));});
 const r=await Promise.all([child(),child()]);assert.equal(r.filter(x=>x==='WIN').length,1);assert.equal(r.filter(x=>['DENY','UNKNOWN'].includes(x)).length,1);
});
test('SQL builders cannot target Bob, create sites, alter migrations or add diagnostic RPCs',()=>{
 const {fixture,plan}=loadContract(),ctx={fixture,plan,state:{sessions:{A1:{uid:ALICE,sid:randomUUID()}},proofs:{}},keyWindow:{notBefore:100,signUntil:1300,verifyUntil:1360},history:{grants:[]}};
 for(const name of ['generation','open','initCharlie','hold','clearHold','disable','enable','expireA1','deleteA1','epoch','revoke','close']){
  const sql=maintenanceSQL(name,ctx);assert(sql.includes('GRANT ecv_s3_owner,ecv_s3_grant_writer'));assert(sql.includes('REVOKE ecv_s3_owner,ecv_s3_grant_writer'));assert(!sql.includes(BOB));assert.doesNotMatch(sql,/SET (?:LOCAL )?ROLE|CREATE (?:OR REPLACE )?FUNCTION|CREATE TABLE|site_data\.[a-z_]+\s+SET/);
 }
 const close=maintenanceSQL('close',ctx);assert(close.indexOf('SET enabled=false')<close.indexOf('SAVEPOINT s34_generation'));assert(close.includes('ROLLBACK TO SAVEPOINT s34_charlie'));assert(!close.includes('security_epoch=1'));
 assert.throws(()=>maintenanceSQL('createSite',ctx),/MAINTENANCE_SCOPE/);
 const observer=observationSQL(ctx);assert(observer.includes('READ ONLY'));assert(observer.trim().endsWith('ROLLBACK;'));assert(!observer.includes('request.jwt.claims'));
});
test('safe DB-log parser retains only unique SQLSTATE/context and accepts no outer-error substitution',()=>{
 const raw='2026-11-12 07:00:00.000 UTC [123] 42501 172.30.232.3 ecv_s3_internal_api_login@postgres ERROR: BUSINESS_DENIED\nCONTEXT: PL/pgSQL function site_private.auth_source_identity() line 25 at RAISE\nSTATEMENT: select token-secret-never-output';
 const parsed=parseDatabaseErrors(raw,{from:Date.parse('2026-11-12T06:59:59Z'),to:Date.parse('2026-11-12T07:00:01Z')});assert.equal(parsed.length,1);assert.equal(parsed[0].frames[0].raiseLine,25);assert(!JSON.stringify(parsed).includes('token-secret'));
 assert.equal(parsePostgrestAccess('x "POST /rpc/get_my_site HTTP/1.1" 403 23','get_my_site',403).length,1);
});
test('transport refuses arbitrary destination or forbidden RPC before any network call',async()=>{await assert.rejects(httpsJson({destination:'production',path:'/'}),/HTTP_DESTINATION/);await assert.rejects(httpsJson({destination:'candidate',path:'/rpc/create_site',method:'POST'}),/HTTP_PATH/);});
test('every aggregate and individual counter rejects overrun before any dispatch',()=>{const {plan}=loadContract(),m=new Meter(plan,{clock:()=>0});for(const [key,cap]of Object.entries(m.cap)){const n=new Meter(plan,{clock:()=>0});assert.throws(()=>n.reserve('over-'+key,'P04',{[key]:cap+1}),/BUDGET_/);assert.deepEqual(n.used,{});}});
test('grant receipt, user fields, audit rows and identity fingerprints are mandatory',async t=>{
 for(const [name,point,change]of [
 ['claims','P04:observe',(r,h,c)=>{if(c.state.grants.A1)r.receiptMatches[c.state.proofs.A1.proof_id].claimsExact=false;}],
 ['result','P04:observe',(r,h,c)=>{if(c.state.grants.A1)r.receiptMatches[c.state.proofs.A1.proof_id].resultExact=false;}],
 ['expiry','P04:apply:A1',r=>r.data.expires_at='2100-01-01T00:00:00Z'],
 ['Alice field','P05:observe',r=>r.authUserFields[ALICE].email='0'.repeat(64)],
 ['old audit','P05:observe',r=>r.authRows.find(x=>x.table==='audit_log_entries').sha='0'.repeat(64)],
 ['Charlie identity','P05:observe',r=>delete r.charlieIdentityStable]
 ])await t.test(name,async()=>{const {result}=await run({faults:{[point]:change}});assert.notEqual(result.status,'COMPLETED_EXPECTED_UNKNOWN');});
});
test('SIGTERM-style cancellation preserves active UNKNOWN and enters P16 without later business',async()=>{const s=setup(),controller=new AbortController();s.host.faults['P05:read:A2']=()=>controller.abort();const r=await executeDriver({...s,clock:s.host.clock,sourceSha:'a'.repeat(64),signal:controller.signal});assert.equal(r.status,'UNKNOWN');assert.equal(r.failure.code,'SIGNAL_INTERRUPTED_UNKNOWN');assert.equal(r.cleanup.status,'VERIFIED_CLOSED');assert(!s.host.calls.some(x=>x.startsWith('P06:')));assert.equal(s.host.stops,1);});
test('a forged REAL Mock fails before any gate or business action',async()=>{const s=setup();s.host.mode='REAL';await assert.rejects(executeDriver({...s,mode:'REAL'}),/REAL_HOST_REQUIRED/);assert.equal(s.host.calls.length,0);});
test('pre-P01 read-only P00 transactions carry into the same budget without expansion',async()=>{const s=setup();s.host.preflightUsage={read_only_audit:2,explicit_database_transactions:2};const r=await executeDriver({...s,clock:s.host.clock,sourceSha:'a'.repeat(64)});assert.equal(r.status,'COMPLETED_EXPECTED_UNKNOWN');assert.equal(r.usage.explicit_database_transactions,97);assert.equal(r.usage.read_only_audit,49);const x=setup();x.host.preflightUsage={read_only_audit:4,explicit_database_transactions:4};const bad=await executeDriver({...x,clock:x.host.clock});assert.equal(bad.status,'STOP');assert.equal(x.host.calls.length,0);});
test('failed invariants retain actual snapshot and failed permission checks retain SQLSTATE',async()=>{
 const s=await run({faults:{'P05:read:A2':r=>r.database.sqlstate='22023'}});const denied=JSON.parse(readFileSync(join(s.journal.directory,'P05-read-A2-get_my_site-deny.result.json')));assert.equal(denied.evidence.database.sqlstate,'22023');assert.equal(denied.status,'STOP');
 const x=await run({faults:{'P05:observe':r=>r.base.protected_auth[0].data_sha256='0'.repeat(64)}});const snap=JSON.parse(readFileSync(join(x.journal.directory,'P05-login-observe-A2-snapshot.json')));assert.equal(snap.base.protected_auth[0].data_sha256,'0'.repeat(64));assert.notEqual(x.result.status,'COMPLETED_EXPECTED_UNKNOWN');
});

test('unreconciled denial after STOP stays NOT_VERIFIED and does not obstruct safe closure',async()=>{const s=await run({faults:{'P05:read:A2':r=>r.database.sqlstate='22023'}});assert.equal(s.result.cleanup.status,'VERIFIED_CLOSED');assert.equal(s.host.base.gates.enabled,false);const r=JSON.parse(readFileSync(join(s.journal.directory,'denials-unreconciled.json')));assert.equal(r.outcome,'NOT_VERIFIED');assert(!s.host.calls.some(x=>x.startsWith('P06:')));});
test('denied operation cannot silently mutate otherwise mutable security state',async()=>{const s=await run({faults:{'P05:read:A2':(r,h)=>{h.base.security_state[0].security_epoch++;}}});assert.equal(s.result.failure.code,'DENIAL_SIDE_EFFECT');assert.equal(s.result.cleanup.status,'VERIFIED_CLOSED');});

test('twenty-minute cap reserves ninety seconds for four bounded cleanup actions',()=>{const {plan}=loadContract();let now=0;const meter=new Meter(plan,{clock:()=>now});assert.equal(meter.deadline,1200000);now=1110001;assert.throws(()=>meter.checkTime(),/DEADLINE_STOP/);assert.doesNotThrow(()=>meter.checkTime(true));now=1200001;assert.throws(()=>meter.checkTime(true),/DEADLINE_STOP/);});
