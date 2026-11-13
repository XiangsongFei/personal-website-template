// No default execution. --check reads local source only. --execute requires a NEW
// externally approved file+digest and a reviewed current driver seal.
import {readFileSync,existsSync,realpathSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync,mkdtempSync,chmodSync} from 'node:fs';
import {resolve,basename,dirname,join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
if(['--rehearse','--rehearse-p01','--rehearse-remaining','--rehearse-tail','--rehearse-p14r'].includes(process.argv[2]))await import('../tests/s3/driver/offline-guard.mjs');
try{
const {parseCli,prepareStartup,startupReceipt,verifiedCode}=await import('../tests/s3/driver/startup.mjs');
const {createLiveHost,checkPreP01Receipts}=await import('../tests/s3/driver/live-host.mjs');
const {executeDriver}=await import('../tests/s3/driver/engine.mjs');
const {Journal,FileIntents,hash,need}=await import('../tests/s3/driver/state.mjs');
const {loadContract,root,pins,REMAINING_SCOPE,TAIL_SCOPE,P14R_SCOPE,isContinuation}=await import('../tests/s3/driver/contract.mjs');
const {verifyFrozenFiles}=await import('../tests/s3/clean-candidate/service.mjs');
const {stopSignals}=await import('../tests/s3/driver/signals.mjs');
const {assertServiceBindings,serviceBindingSha256}=await import('../tests/s3/driver/bindings.mjs');
const {checkServiceBindings}=await import('../tests/s3/driver/binding-check.mjs');
async function main(){
 const args=parseCli(process.argv.slice(2));
 if(args.mode==='check'){
  const driverSealSha256=await verifiedCode();
  console.log(JSON.stringify({status:'OFFLINE_CHECK_PASS',realExecution:'NOT AUTHORIZED',dockerOperations:0,authRequests:0,databaseTransactions:0,planSha256:pins.plan_sha256,driverSealSha256,serviceBindingSha256:serviceBindingSha256()}));return;
 }
 if(args.mode==='bindings'){
  const driverSealSha256=await verifiedCode(),path=args.path,parent=dirname(path),st=lstatSync(parent);need(!existsSync(path)&&st.isDirectory()&&st.uid===process.getuid()&&(st.mode&0o077)===0&&realpathSync(parent)===parent,'BINDING_RECEIPT_PATH');
  if(isContinuation(args.scope))need(args.runId===loadContract(args.scope).profile.runId,'REMAINING_RUN_IDENTITY');
  need(pins.fixture_mode!=='OFFLINE_SYNTHETIC_NOT_EXECUTION_AUTHORITY','SYNTHETIC_FIXTURES_CANNOT_AUTHORIZE_REAL_EXECUTION');
  const result={...await checkServiceBindings({scope:args.scope}),runId:args.runId,driverSealSha256};
  const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify(result,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}const dirfd=openSync(parent,'r');try{fsyncSync(dirfd);}finally{closeSync(dirfd);}
  console.log(JSON.stringify({status:result.status,errors:result.errors,counts:result.counts,receipt:path,receiptSha256:hash(readFileSync(path)),realExecution:'NOT AUTHORIZED'}));process.exitCode=result.status==='SERVICE_BINDINGS_PASS'?0:1;return;
 }
 const startup=await prepareStartup(args),approval=startup.approval;
 args.scope=startup.scope;
 if(args.mode==='PREPARE'){console.log(JSON.stringify(startupReceipt(startup)));return;}
 if(args.mode==='P01_PREPARE'){console.log(JSON.stringify(checkPreP01Receipts({...args,timeWindow:startup.window})));return;}
 let host,directory,intents,journal;
 if(['OFFLINE','P01_OFFLINE'].includes(args.mode)){
  // A wholly separate adapter and freshly allocated OS temp tree; no caller
  // path or REAL environment flag can redirect this into a live journal/Intent.
  const {MockHost}=await import('../tests/s3/driver/mock-host.mjs');
  const spec=approval.rehearsal??{};need(Object.values(spec.faults??{}).every(v=>['stop','unknown'].includes(v)),'REHEARSAL_FAULT_SCOPE');
  const workspace=realpathSync(dirname(dirname(fileURLToPath(root)))),requestedTemp=resolve(tmpdir());need(requestedTemp!==workspace&&!requestedTemp.startsWith(workspace+sep),'REHEARSAL_TEMP_SCOPE');const temporaryParent=realpathSync(requestedTemp);need(temporaryParent!==workspace&&!temporaryParent.startsWith(workspace+sep),'REHEARSAL_TEMP_SCOPE');
  if(isContinuation(startup.scope)){const {RemainingMockHost}=await import('../tests/s3/driver/remaining-mock.mjs');host=new RemainingMockHost({faults:spec.faults??{},contract:startup.contract});}else host=new MockHost({faults:spec.faults??{}});host.approval=approval;if(args.mode==='P01_OFFLINE'){host.preflightUsage={read_only_audit:2,explicit_database_transactions:2};host.history=host.snapshot({fixture:loadContract().fixture,state:{proofs:{}}}).base;}directory=realpathSync(mkdtempSync(join(temporaryParent,'ecv-s34-cli-rehearsal-')));chmodSync(directory,0o700);
  journal=new Journal(join(directory,'journal'),{runId:approval.runId,mode:'OFFLINE'});if(args.mode==='OFFLINE')intents=new FileIntents(join(directory,'intents'),{runId:approval.runId,sourceSha:startup.driverSealSha256,create:true});
 }else{
  // All pure startup checks and protected P00/P01 receipt validation PRECEDE
  // Journal/Intent initialization. Failed bootstrap leaves no consumed attempt.
  host=createLiveHost({...args,timeWindow:startup.window});startup.meter.checkTime();
  directory=startup.directory;journal=new Journal(directory,{runId:approval.runId,mode:'REAL'});host.journal=journal;
  if(args.mode==='REAL')intents=new FileIntents(startup.contract.intentDirectory,{runId:approval.runId,sourceSha:startup.driverSealSha256,create:!existsSync(startup.contract.intentDirectory)});
 }
 if(['P01','P01_OFFLINE'].includes(args.mode)){
  const {executeP01Only}=await import('../tests/s3/driver/p01-only.mjs');const stops=stopSignals();let result;try{result=await executeP01Only({host,journal,meter:startup.meter,runId:approval.runId,mode:args.mode==='P01'?'REAL':'OFFLINE',signal:stops.signal});}finally{stops.dispose();}console.log(JSON.stringify({...result,receiptDirectory:directory,realExecution:args.mode==='P01'?'P01_ONLY_NO_BUSINESS_AUTHORITY':'NOT AUTHORIZED'}));process.exitCode=result.status==='P01_ONLY_PASS'?0:1;return;
 }
 const stops=stopSignals();let result;
 try{result=await executeDriver({host,journal,intents,runId:approval.runId,mode:args.mode,timeWindow:startup.window,sourceSha:startup.driverSealSha256,signal:stops.signal,profileScope:args.profile,limits:args.mode==='OFFLINE'?approval.rehearsal?.limits??{}:isContinuation(startup.scope)?{}:{explicit_database_transactions:97,read_only_audit:49}});}finally{stops.dispose();}
 console.log(JSON.stringify({mode:args.mode,runId:result.runId,status:result.status,failure:result.failure,cleanup:result.cleanup,usage:result.usage,...(isContinuation(startup.scope)?{profileScope:startup.scope,caseResults:result.caseResults,oldP04:result.oldP04,...([TAIL_SCOPE,P14R_SCOPE].includes(startup.scope)?{oldP10:result.oldP10,...(startup.scope===P14R_SCOPE?{oldP14:result.oldP14,oldP15:result.oldP15}:{})}:{}),historicalCharged:result.historicalCharged}:{}),receiptDirectory:directory,time:{start:startup.window.start,deadline:startup.window.deadline,normalized:startup.window.authority,windowMs:1200000,cleanupReserveMs:90000},realExecution:args.mode==='OFFLINE'?'NOT AUTHORIZED':'ONLY_CURRENT_RECEIPTS'}));
 process.exitCode=(result.status==='COMPLETED_EXPECTED_UNKNOWN'||startup.scope===P14R_SCOPE&&result.status==='COMPLETE')&&result.cleanup.status==='VERIFIED_CLOSED'?0:1;
}
await main();}catch(e){console.error(JSON.stringify({status:'STOP',code:typeof e.code==='string'&&/^[A-Z][A-Z0-9_]*$/.test(e.code)?e.code:'DRIVER_BOOTSTRAP_STOP',retry:false}));process.exitCode=1;}
