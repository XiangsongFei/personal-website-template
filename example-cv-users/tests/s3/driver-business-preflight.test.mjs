import {WORK_ROOT} from './driver/contract.mjs';
// Local-only budget and final-observer frame checks, no real environment I/O.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {observationSQL,finalObservationSQL} from './driver/sql.mjs';
import {loadContract,pins,PROJECT,root} from './driver/contract.mjs';import {hash} from './driver/state.mjs';import {candidateStopPreflight,maintenanceCommitReceipt} from './driver/live-host.mjs';
const fixture=loadContract().fixture,context={fixture,history:{grants:[]},state:{proofs:{}}};
test('one final read-only transaction retains complete baseline, private/Auth hashes, catalog and explicit rollback',()=>{
 const sql=finalObservationSQL(context),data=observationSQL(context).replace(/ROLLBACK;\s*$/,''),cat=readFileSync(new URL('./m7-catalog-observe.sql',import.meta.url),'utf8'),body=cat.slice(cat.indexOf('WITH\nns AS ')).replace(/ROLLBACK;\s*$/,'');
 assert(sql.startsWith(data));assert(sql.includes(body));assert.equal((sql.match(/^BEGIN[^;]*;/gm)??[]).length,1);assert.equal((sql.match(/^ROLLBACK;/gm)??[]).length,1);assert(sql.trim().endsWith('ROLLBACK;'));assert.match(sql,/REPEATABLE READ READ ONLY/);assert.match(sql,/observer_pid/);assert.match(sql,/observer_read_only/);assert.match(sql,/observer_isolation/);
 for(const field of ['authUserFields','authRows','protectedBusiness','authStable','charlieIdentityStable','receiptMatches','closed_constraints'])assert(sql.includes(field),field);
 assert(!/^\s*(?:COMMIT|UPDATE|DELETE|INSERT|ALTER|GRANT|REVOKE)\b/m.test(sql));
});
test('business stop cannot relabel a spontaneous exit, wrong identity or OOM as controlled success',()=>{
 const c={Id:'id',Name:'name',Image:'image',State:{Running:true,OOMKilled:false},RestartCount:0};assert.equal(candidateStopPreflight(c,c).running,true);
 for(const change of [x=>x.State.Running=false,x=>delete x.State.Running,x=>x.State.OOMKilled=true,x=>x.RestartCount=1]){const bad=structuredClone(c);change(bad);assert.throws(()=>candidateStopPreflight(bad,c),/CANDIDATE_UNEXPECTED_EXIT/);}
 assert.throws(()=>candidateStopPreflight({...c,Id:'other'},c),/STOP_TARGET_CHANGED/);
});
test('actual CLI full rehearsal with carried P00 fits 97/49 plus one final reserved transaction, no replacement capacity',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'ecv-business-preflight-'))),runId=randomUUID(),base=WORK_ROOT,start=Date.now()-1000;
 const launch=JSON.parse(readFileSync(new URL('./clean-candidate/launch.json',import.meta.url))),approval={version:1,state:'OFFLINE_REHEARSAL',project:PROJECT,scope:'S34-P02-P16',runId,sourceSha:pins.source_sha,driverSealSha256:hash(readFileSync(new URL('./driver/seal.json',import.meta.url))),candidateName:launch.container_name,runDirectory:join(base,'s3-4-live-run-'+runId),receiptDirectory:join(base,'s3-4-run-receipts-'+runId),intentDirectory:pins.intent_directory,windowStartedAt:new Date(start).toISOString(),expiresAt:new Date(start+1200000).toISOString(),rehearsal:{limits:{explicit_database_transactions:97,read_only_audit:49}}};
 const path=join(dir,'approval.json');writeFileSync(path,JSON.stringify(approval),{mode:0o600});const preload=join(dir,'carried.mjs');writeFileSync(preload,`import {MockHost} from ${JSON.stringify(new URL('./driver/mock-host.mjs',import.meta.url).href)};Object.defineProperty(MockHost.prototype,'preflightUsage',{get:()=>({explicit_database_transactions:2,read_only_audit:2})});`,{mode:0o600});
 const guard=fileURLToPath(new URL('./driver/offline-guard.mjs',import.meta.url)),cli=fileURLToPath(new URL('../../scripts/s34-driver.mjs',import.meta.url)),r=spawnSync(process.execPath,['--import',guard,'--import',preload,cli,'--rehearse','--approval',path,'--approval-sha256',hash(readFileSync(path))],{encoding:'utf8',timeout:15000,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:tmpdir()}});
 assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/"offlineExternalIoAttempts":0/);const value=JSON.parse(r.stdout);assert.equal(value.status,'COMPLETED_EXPECTED_UNKNOWN');assert.equal(value.cleanup.status,'VERIFIED_CLOSED');assert.equal(value.usage.explicit_database_transactions,97);assert.equal(value.usage.read_only_audit,49);assert.equal(value.usage.http_edges,203);assert.equal(value.usage.local_intent,6);assert.equal(value.usage.auth_user_get,61);assert.equal(value.usage.auth_row_insert_cap,32);assert.equal(value.usage.explicit_database_transactions+1,98);assert.equal(value.usage.read_only_audit+1,50);assert(value.usage.explicit_database_transactions+1+2>98);
 const realCli=readFileSync(cli,'utf8');assert(realCli.includes('explicit_database_transactions:97,read_only_audit:49'));
});

test('maintenance evidence requires an actual COMMIT tag and retains closed-state metadata without SQL or secrets',()=>{const r={code:0,tags:['BEGIN','GRANT ROLE','DO','REVOKE ROLE','COMMIT'],rows:[{gatesClosed:true,hardCheck:true,containmentOk:true}],safe:{exitCode:0,sqlSha256:hash('SQL')}};const receipt=maintenanceCommitReceipt(r);assert.equal(receipt.committed,true);assert.equal(receipt.commandTags.at(-1),'COMMIT');assert.equal(receipt.gatesClosed,true);assert.equal(receipt.source,'psql-command-tags');for(const bad of [{...r,code:1},{...r,tags:['BEGIN','ROLLBACK']},{...r,tags:['BEGIN']}])assert.throws(()=>maintenanceCommitReceipt(bad),/MAINTENANCE_UNKNOWN/);});
