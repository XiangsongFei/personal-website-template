// Deliberately cannot enter executeDriver, FileIntents, maintenance or Auth.
import {need,DriverStop} from './state.mjs';
import {gates,readReceipt} from './evidence.mjs';
import {same} from './state.mjs';
import {loadContract} from './contract.mjs';
import {boundedOperation} from './deadline.mjs';
import {isLiveHost} from './live-host.mjs';
import {P01_SCOPE,effectScope} from './scope.mjs';
export function safeP01Receipt(v){return v.base?{...v.safeReceipt,readOnly:v.readOnly,rollback:v.rollback,pid:v.pid,systemIdentifier:v.base.meta.system_identifier,fingerprints:v.base.fingerprints,gates:v.base.gates}:v.exactMatch!==undefined?{...v.safeReceipt,readOnly:v.readOnly,rollback:v.rollback,exactMatch:v.exactMatch,closed:v.closed,roleDelta:v.roleDelta}:v.safeReceipt??v;}
export async function executeP01Only({host,journal,meter,runId,mode,signal}){
 need(mode==='OFFLINE'||mode==='REAL'&&isLiveHost(host)&&meter.timeWindow===host.executionWindow,'REAL_HOST_REQUIRED');effectScope(host.approval,P01_SCOPE);let failure=null,closure={status:'EXTERNAL_STOP_REQUIRED'},status='STOP';
 const ctx={runId,mode,meter,fixture:loadContract().fixture,state:{proofs:{}},history:host.history,step:'P00'};
 async function once(id,cost,fn,check=()=>{}){const counters=meter.reserve(id,'P01',cost);journal.issue(id,{phase:'P01_ONLY',action:id},counters);let value;try{value=await boundedOperation(fn,{meter,signal,timeoutMs:120000});check(value);journal.result(id,{status:'PASS',receipt:safeP01Receipt(value)});return value;}catch(e){journal.result(id,{status:e.unknown?'UNKNOWN':'STOP',code:e.code??'P01_TOOL_STOP',...(value?{receipt:safeP01Receipt(value)}:{})});throw e;}}
 try{
  meter.reserve('P00-carried','P00',host.preflightUsage);journal.record('P00-carried-usage',host.preflightUsage);
  await once('P01-dynamic-gates',{},()=>host.checkGates(ctx),v=>gates(v,mode));
  const observed=await once('P01-readonly-observer',{explicit_database_transactions:1,read_only_audit:1},()=>host.observe(ctx),v=>{readReceipt(v);need(same(v.base.fingerprints,host.history.fingerprints)&&!v.base.gates.enabled&&!v.base.gates.proof_verifier_ready,'P01_DATA_OR_GATE_DRIFT');});ctx.last=observed;
  await once('P01-catalog',{explicit_database_transactions:1,read_only_audit:1},()=>host.catalog(ctx),v=>need(v.readOnly&&v.rollback&&v.exactMatch&&v.closed&&v.roleDelta===0,'P01_CATALOG'));
  await once('P01-health-mail',{http_edges:3,mail_http:1},()=>host.p01HealthMail(),v=>need(v.auth?.status===200&&v.auth.mutation===false&&v.mail.complete===true,'P01_HEALTH_MAIL'));
  await once('P01-registrar-tls',{},()=>host.p01Registrar(),v=>need(v.authorized&&v.inputEof&&v.outputEof&&v.exitCode===0&&v.sqlSent===false&&v.postgresStartupSent===false,'P01_REGISTRAR'));
  await once('P01-error-observer',{explicit_database_transactions:1,read_only_audit:1},()=>host.p01ErrorObserver(),v=>need(v.readOnly&&v.rollback&&v.source==='postgres-log'&&v.sqlstate==='22012'&&v.unique,'P01_ERROR_OBSERVER'));
  journal.record('P01-BUSINESS-NOT-RUN',{P02ThroughP16:'NOT RUN',businessWrites:0,authWrites:0,intentTransactions:0,writeCommitEvidence:'NOT RUN'});status='P01_ONLY_PASS';
 }catch(e){failure={status:e.unknown?'UNKNOWN':'STOP',code:e instanceof DriverStop?e.code:'P01_TOOL_STOP'};status=failure.status;meter.stop();}
 finally{host.destroySecrets?.();}
 const result={runId,mode,status,failure,closure,usage:meter.used,P02ThroughP16:'NOT RUN',automaticRetries:0};journal.record('FINAL',result);return result;
}
