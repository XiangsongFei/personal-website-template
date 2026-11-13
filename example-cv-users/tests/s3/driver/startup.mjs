import {WORK_ROOT} from './contract.mjs';
import {P14R_SCOPE,TAIL_SCOPE,isContinuation,profilePin} from './contract.mjs';
// Pure file/argument/time/budget checks. No child process, network or mutation.
import {readFileSync,lstatSync,realpathSync,existsSync,accessSync,constants,statfsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {root,pins,loadContract,PROJECT,REMAINING_SCOPE} from './contract.mjs';
import {remainingContract,remainingAuthority} from './remaining.mjs';
import {hash,need,Meter,canonical} from './state.mjs';
import {pinnedPg} from './transport.mjs';
import {certificateBindings} from './binding-check.mjs';
import {SERVICES,assertServiceBindings} from './bindings.mjs';
import {verifyFrozenFiles} from '../clean-candidate/service.mjs';
import {createTimeWindow,normalizedAuthority} from './time-window.mjs';
import {hostMountFiles} from './mount-guard.mjs';
import {BUSINESS_SCOPE,P01_SCOPE,effectScope} from './scope.mjs';
import {p01Meter} from './p01-budget.mjs';
export function parseCli(args){
 if(args.length===0||args.length===1&&args[0]==='--check')return {mode:'check'};
 if(['--bindings-check','--bindings-check-remaining','--bindings-check-tail','--bindings-check-p14r'].includes(args[0])){need(args.length===5&&args[1]==='--run-id'&&/^[0-9a-f-]{36}$/.test(args[2])&&args[3]==='--receipt','BINDING_CHECK_ARGUMENTS');return {mode:'bindings',...(args[0]!=='--bindings-check'?{scope:args[0]==='--bindings-check-p14r'?P14R_SCOPE:args[0]==='--bindings-check-tail'?TAIL_SCOPE:REMAINING_SCOPE}:{}),runId:args[2],path:resolve(args[4])};}
 const modes={'--execute':'REAL','--rehearse':'OFFLINE','--p01-only':'P01','--rehearse-p01':'P01_OFFLINE','--preflight-before-p00':'PREPARE','--preflight-before-p01':'P01_PREPARE'};
 const raceModes={'--execute-p14r':'REAL','--rehearse-p14r':'OFFLINE','--preflight-p14r-before-p00':'PREPARE','--preflight-p14r-before-p01':'P01_PREPARE'};
 if(Object.hasOwn(raceModes,args[0])){need(args.length===5&&args[1]==='--approval'&&args[3]==='--approval-sha256','EXPLICIT_EXECUTION_ARGUMENTS_REQUIRED');return {mode:raceModes[args[0]],profile:P14R_SCOPE,approvalPath:resolve(args[2]),approvalSha256:args[4]};}
 const tailModes={'--execute-tail':'REAL','--rehearse-tail':'OFFLINE','--preflight-tail-before-p00':'PREPARE','--preflight-tail-before-p01':'P01_PREPARE'};
 if(Object.hasOwn(tailModes,args[0])){need(args.length===5&&args[1]==='--approval'&&args[3]==='--approval-sha256','EXPLICIT_EXECUTION_ARGUMENTS_REQUIRED');return {mode:tailModes[args[0]],profile:TAIL_SCOPE,approvalPath:resolve(args[2]),approvalSha256:args[4]};}
 const remainingModes={'--execute-remaining':'REAL','--rehearse-remaining':'OFFLINE','--preflight-remaining-before-p00':'PREPARE','--preflight-remaining-before-p01':'P01_PREPARE'};
 if(Object.hasOwn(remainingModes,args[0])){need(args.length===5&&args[1]==='--approval'&&args[3]==='--approval-sha256','EXPLICIT_EXECUTION_ARGUMENTS_REQUIRED');return {mode:remainingModes[args[0]],profile:REMAINING_SCOPE,approvalPath:resolve(args[2]),approvalSha256:args[4]};}
 need(args.length===5&&args[0] in modes&&args[1]==='--approval'&&args[3]==='--approval-sha256','EXPLICIT_EXECUTION_ARGUMENTS_REQUIRED');
 return {mode:modes[args[0]],approvalPath:resolve(args[2]),approvalSha256:args[4]};
}
export function protectedJson(path,digest,{protectedParent=false}={}){
 const st=lstatSync(path),parent=lstatSync(dirname(path)),secure=(st.mode&0o077)===0||protectedParent&&parent.uid===process.getuid()&&(parent.mode&0o077)===0&&(st.mode&0o022)===0;need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&st.nlink===1&&secure&&realpathSync(path)===resolve(path)&&st.size<=65536,'APPROVAL_FILE_SECURITY');
 const raw=readFileSync(path);need(/^[a-f0-9]{64}$/.test(digest??'')&&hash(raw)===digest,'APPROVAL_DIGEST');return JSON.parse(raw);
}
export async function verifiedCode(){
 const {frozen}=loadContract();await verifyFrozenFiles(frozen);assertServiceBindings();
 const raw=readFileSync(new URL('./seal.json',import.meta.url)),seal=JSON.parse(raw);
 for(const [name,digest]of Object.entries(seal.files))need(hash(readFileSync(new URL(name,root)))===digest,'DRIVER_SOURCE_CHANGED');return hash(raw);
}
export function validateHostNode(v={version:process.version,platform:process.platform,arch:process.arch,digest:hash(readFileSync(process.execPath))}){need(v.version==='v24.22.1'&&v.platform==='darwin'&&v.arch==='arm64'&&v.digest==='6f32069480ec14d52b6d7b1f3c7124cfbbc46203abf5ddf5c65b127435f3f329','HOST_NODE_PIN');}
export function hostOfflineChecks(){
 need(pins.fixture_mode!=='OFFLINE_SYNTHETIC_NOT_EXECUTION_AUTHORITY','SYNTHETIC_FIXTURES_CANNOT_AUTHORIZE_REAL_EXECUTION');
 validateHostNode();
 hostMountFiles();pinnedPg();const certificates=certificateBindings(),fs=statfsSync(fileURLToPath(root));need(fs.bavail*fs.bsize>=24*1024**3,'HOST_DISK_BUDGET');
 const base=dirname(fileURLToPath(root)),key=readFileSync(resolve(base,'../s3-3-r3-clean-business-integration-b1-resume-20261111-e449c25f/private/publishable.key'),'utf8').trim();need(/^sb_publishable_[A-Za-z0-9_-]{32,128}$/.test(key),'PUBLISHABLE_KEY');
 return {hostNodePin:true,pgDependencyBytes:true,certificates:certificates.ok,privateKeyPairs:true,publishableKeyFormat:true,hostDiskBudget:true};
}
export function checkIntentContract(directory,fixture,{exists=existsSync,stat=lstatSync,real=realpathSync,expectedDirectory=pins.intent_directory}={}){
 need(resolve(directory)===expectedDirectory,'PERSISTENT_INTENT_DIRECTORY');
 const parent=exists(directory)?directory:dirname(directory),st=stat(parent);
 need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(exists(directory)?(st.mode&0o077)===0:true)&&real(parent)===parent,'INTENT_DIRECTORY_SECURITY');
 accessSync(parent,constants.R_OK|constants.W_OK|constants.X_OK);
 for(const slot of fixture.proof_slots)for(const suffix of ['approved','consumed'])need(!exists(resolve(directory,slot.proof_id+'.'+suffix+'.json')),'FROZEN_INTENT_ALREADY_USED');
 return {status:'INITIALIZATION_CONTRACT_PASS',exists:exists(directory),recordsCreated:0,transactions:0};
}
export function startupScope(a){return hash(canonical({version:1,runId:a.runId,project:a.project,scope:a.scope,sourceSha:a.sourceSha,driverSealSha256:a.driverSealSha256,window:normalizedAuthority(a),candidateName:a.candidateName,runDirectory:a.runDirectory,receiptDirectory:a.receiptDirectory,intentDirectory:a.intentDirectory,planSha256:pins.plan_sha256,fixtureSha256:pins.fixture_sha256,...(isContinuation(a.scope)?{remainingProfileSha256:profilePin(a.scope),baselineSha256:a.baselineSha256,budgetAllocation:a.budgetAllocation}:{})}));}
export async function prepareStartup(options){
 const {mode,approvalPath,approvalSha256}=options,a=protectedJson(approvalPath,approvalSha256),offline=['OFFLINE','P01_OFFLINE'].includes(mode);
 const scope=isContinuation(options.profile)?options.profile:['P01','P01_OFFLINE'].includes(mode)?P01_SCOPE:['PREPARE','P01_PREPARE'].includes(mode)?a.scope:BUSINESS_SCOPE;
 need(isContinuation(scope)===isContinuation(options.profile),'REMAINING_CLI_REQUIRED');
 const allowed=offline?['OFFLINE_REHEARSAL']:mode==='PREPARE'?['PREPARED_NOT_AUTHORIZED','AUTHORIZED']:['AUTHORIZED'];
 need(allowed.includes(a.state)&&a.version===1&&a.project===PROJECT&&a.scope===scope&&[BUSINESS_SCOPE,P01_SCOPE,REMAINING_SCOPE,TAIL_SCOPE,P14R_SCOPE].includes(scope)&&/^[0-9a-f-]{36}$/.test(a.runId),'NEW_AUTHORIZATION_REQUIRED');
 need(offline||a.rehearsal===undefined,'REHEARSAL_NOT_REAL');
 if(!offline)need(['aliceResetAndCascade','charlieFixtureAndContainment','temporaryMaintenanceAndCheck'].every(k=>typeof a.acceptedEffects?.[k]==='boolean')&&typeof a.acceptedEffects?.stopNewCandidate==='boolean','EFFECT_CONTRACT');
 if(!offline&&a.state==='AUTHORIZED'||scope===P01_SCOPE)effectScope(a,scope);
 const seal=await verifiedCode(),contract=isContinuation(scope)?remainingContract(scope):loadContract(scope),{plan,fixture,frozen}=contract;need(a.driverSealSha256===seal&&a.sourceSha===pins.source_sha,'STARTUP_SOURCE_IDENTITY');
 if(isContinuation(scope))remainingAuthority(a,contract);
 need(!['startedAt','deadlineAt','timeWindow','durationMs'].some(k=>Object.hasOwn(a,k)),'DEADLINE_OVERRIDE');
 if(!offline){const review=protectedJson(a.reviewPath,a.reviewSha256);need(review.status==='OFFLINE_REVIEW_PASS'&&review.driverSealSha256===seal,'INDEPENDENT_REVIEW_REQUIRED');const baseline=protectedJson(a.baselinePath,a.baselineSha256,{protectedParent:true});need(a.baselineSha256===contract.baselineSha256&&baseline.meta?.system_identifier==='7706828727995158580','FROZEN_BASELINE_CHANGED');}
 const window=createTimeWindow(a,approvalSha256); // The only wall→mono conversion.
 const spec=a.rehearsal??{};
 need(Object.keys(spec).every(k=>['limits','faults','deadlineOffsetMs','startOffsetMs'].includes(k)),'REHEARSAL_SCOPE');
 const meterOptions={timeWindow:window,startedAt:spec.startOffsetMs===undefined?undefined:window.start+spec.startOffsetMs,deadlineAt:spec.deadlineOffsetMs===undefined?undefined:window.deadline+spec.deadlineOffsetMs,limits:spec.limits??{}};const meter=scope===P01_SCOPE?p01Meter(plan,meterOptions):new Meter(plan,meterOptions);meter.checkTime();
 const base=WORK_ROOT,directory=resolve(base,'s3-4-live-run-'+a.runId),launch=contract.launch;
 need(a.candidateName===launch.container_name&&a.runDirectory===directory&&!existsSync(directory)&&!existsSync(resolve(base,'s3-4-real-acceptance-'+a.runId)),'STARTUP_RUN_IDENTITY_OR_REPLAY');
 const receiptDirectory=resolve(base,'s3-4-run-receipts-'+a.runId);need(a.receiptDirectory===receiptDirectory,'RECEIPT_DIRECTORY_SCOPE');
 for(const terminal of ['RESULT.json','STOP.json','OUTER-STOP.json','DRIVER-EXIT.json'])need(!existsSync(resolve(receiptDirectory,terminal)),'STARTUP_RUN_TERMINAL');
 if(existsSync(receiptDirectory)){const st=lstatSync(receiptDirectory);need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0&&realpathSync(receiptDirectory)===receiptDirectory,'RECEIPT_DIRECTORY_SECURITY');}
 const packageRoot=launch.mounts[0].source;
 need(readFileSync(resolve(packageRoot,'tests/s3/clean-candidate/frozen.json')).equals(readFileSync(new URL('../clean-candidate/frozen.json',import.meta.url))),'PACKAGED_MANIFEST_CHANGED');
 for(const [path,digest]of Object.entries(frozen.files))need(hash(readFileSync(resolve(packageRoot,path)))===digest,'PACKAGED_SOURCE_CHANGED');
 // A rehearsal uses its own temporary FileIntents in the CLI. Never retarget
 // REAL pins or pretend the consumed real ledger is fresh to run a simulation.
 // PREPARE/P01_PREPARE/REAL still check the real pinned ledger without bypass.
 const hostChecks=(offline||pins.fixture_mode==='OFFLINE_SYNTHETIC_NOT_EXECUTION_AUTHORITY')?{status:'SYNTHETIC_MODE_HOST_ONLY_CHECKS_NOT_CLAIMED'}:hostOfflineChecks();
 const intent=offline?{status:'SYNTHETIC_ONLY_REAL_INTENTS_NOT_VERIFIED',recordsCreated:0,transactions:0}:checkIntentContract(a.intentDirectory,fixture,{expectedDirectory:contract.intentDirectory});
 return {approval:a,scope,contract,directory,window,intent,meter,hostChecks,driverSealSha256:seal,startupScopeSha256:startupScope(a),serviceTargets:{auth:SERVICES.auth.gatewayIp+':'+SERVICES.auth.gatewayPort,candidate:SERVICES.node.ip+':'+SERVICES.node.port,mail:SERVICES.mail.origin},approvalSha256};
}
export function startupReceipt(s){return {version:1,checkedAt:new Date().toISOString(),status:'PRE_P00_OFFLINE_PASS',phase:'BEFORE_P00',runId:s.approval.runId,driverSealSha256:s.driverSealSha256,startupScopeSha256:s.startupScopeSha256,normalizedWindow:s.window.authority,candidateName:s.approval.candidateName,runDirectory:s.directory,receiptDirectory:s.approval.receiptDirectory,hostChecks:s.hostChecks,intent:s.intent,serviceTargets:s.serviceTargets,limits:{windowMs:1200000,cleanupMs:90000,http:s.meter.cap.http_edges,postgres:s.meter.cap.explicit_database_transactions,readOnly:s.meter.cap.read_only_audit,intent:s.meter.cap.local_intent},externalIo:0,realExecution:'NOT AUTHORIZED_BY_CHECK'};}
