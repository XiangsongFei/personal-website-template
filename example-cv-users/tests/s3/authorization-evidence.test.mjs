import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {authorizationCases} from './authorization-plan.mjs';
const root=new URL('../../',import.meta.url);
const matrix=JSON.parse(readFileSync(new URL('docs/s3/S3.4-PUBLIC-EVIDENCE.json',root)));
const ledger=matrix.initial_offline_snapshot;
test('historical PASS and UNKNOWN are imported from the unchanged final acceptance, never reexecuted',()=>{
  const actual=createHash('sha256').update(readFileSync(new URL(ledger.historical_source.path,root))).digest('hex');
  assert.equal(actual,ledger.historical_source.sha256);
  assert.equal(ledger.baseline,'56ab76779eab3ed1db6110574f2750c42252d5cf');
  assert(ledger.historical.every(x=>x.reexecuted===false));
  assert.equal(ledger.historical.find(x=>x.id==='H-TRANSPORT').status,'UNKNOWN');
  assert(ledger.historical.some(x=>x.status==='PASS'));
});
test('initial design snapshot retains its original offline versus NOT RUN classifications',()=>{
  const ids=ledger.cases.map(c=>c.id);assert.equal(new Set(ids).size,ids.length);
  for(const c of authorizationCases){assert(ids.includes(c.id));assert.equal(c.currentLive,'NOT RUN');}
  assert.equal(ledger.current_live,'NOT RUN');assert(ledger.cases.every(c=>c.live==='NOT RUN'&&c.offline==='PASS'));
  assert(ledger.cases.filter(c=>['AUTH-NO-GRANT','AUTH-CROSS-SID','AUTH-HOLD'].includes(c.id)).every(c=>c.offline_scope==='refusal projection only'));
  assert(ledger.prepared_only.some(c=>c.id==='AUTH-RECOVERY-DB'&&c.status==='NOT RUN'));
  assert(ledger.design_only.every(c=>c.status==='NOT RUN'));
});

test("final evidence summary preserves old UNKNOWN and NOT VERIFIED alongside new PASS",()=>{for(const id of ["P04-original","P10-original"])assert.equal(matrix.history.find(x=>x.id===id).status,"UNKNOWN");assert.equal(matrix.history.find(x=>x.id==="P14-original").status,"NOT VERIFIED");assert.equal(matrix.history.find(x=>x.id==="P15").status,"EXPECTED UNKNOWN");assert.equal(matrix.currentAcceptance.P14R,"PASS");assert.equal(matrix.currentAcceptance.independentChecks,43);assert.equal(matrix.deliveryPortability.realAuthorizationFromPublicFixtures,false);assert.equal(matrix.finalBatch.reconciliation.grantRowRevokedAt,null);assert(matrix.finalBatch.reconciliation.generationRevoked);});
