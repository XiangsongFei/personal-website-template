// Local-only safety state. Import does not create files, processes or sockets.
import {createHash} from 'node:crypto';
import {mkdirSync,openSync,closeSync,writeSync,fsyncSync,readFileSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {assertTimeWindow} from './time-window.mjs';
import {budget} from '../s34-budget.mjs';
export const CLEANUP_RESERVE_MS=90000; // Four bounded P16 actions, inside the same 20 minutes.
export class DriverStop extends Error {
 constructor(code,unknown=false){super(code);this.name='DriverStop';this.code=code;this.unknown=unknown;}
}
export const need=(ok,code,unknown=false)=>{if(!ok)throw new DriverStop(code,unknown);};
export const hash=raw=>createHash('sha256').update(raw).digest('hex');
export const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const same=(a,b)=>canonical(a)===canonical(b);
function receiptSafe(value){
 const text=JSON.stringify(value);need(!/"(?:password|token|jwt|access_token|refresh_token|signature|key_bytes|secret|privateKey|apikey)"\s*:/.test(text)&&!/[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/.test(text),'SECRET_RECEIPT');
}
function durableNew(path,value){
 const fd=openSync(path,'wx',0o600);
 try{const bytes=Buffer.from(JSON.stringify(value)+'\n');let n=0;while(n<bytes.length){const written=writeSync(fd,bytes,n);need(written>0,'SHORT_DURABLE_WRITE',true);n+=written;}fsyncSync(fd);}finally{closeSync(fd);}
 const dir=openSync(dirname(path),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}
function privateDir(path,create=false){
 if(create)mkdirSync(path,{mode:0o700});
 const st=lstatSync(path);need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'UNSAFE_PRIVATE_DIRECTORY');
 need(realpathSync(path)===resolve(path),'SYMLINKED_PRIVATE_DIRECTORY');
}
function readPrivate(path){
 const st=lstatSync(path);need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'UNSAFE_PRIVATE_FILE');
 return JSON.parse(readFileSync(path,'utf8'));
}
export class Journal {
 constructor(directory,{runId,mode}){
  need(/^[0-9a-f-]{36}$/.test(runId)&&['OFFLINE','REAL'].includes(mode),'JOURNAL_SCOPE');
  privateDir(directory,true);this.directory=directory;this.runId=runId;this.mode=mode;
  durableNew(resolve(directory,'RUN.json'),{version:1,runId,mode,state:'NEW'});
 }
 issue(id,descriptor,counters){
  need(/^[A-Za-z0-9_-]{1,100}$/.test(id),'OPERATION_ID');
  // No raw provider objects, SQL, tokens, passwords or proof MACs are journalled.
  receiptSafe(descriptor);
  durableNew(resolve(this.directory,id+'.issued.json'),{runId:this.runId,mode:this.mode,id,state:'ISSUED',descriptor,counters});
 }
 result(id,receipt){
  readPrivate(resolve(this.directory,id+'.issued.json'));
  receiptSafe(receipt);
  durableNew(resolve(this.directory,id+'.result.json'),{runId:this.runId,mode:this.mode,id,...receipt});
 }
 readResult(id){need(/^[A-Za-z0-9_-]{1,100}$/.test(id),'OPERATION_ID');return readPrivate(resolve(this.directory,id+'.result.json'));}
 record(id,value){need(/^[A-Za-z0-9_-]{1,100}$/.test(id),'RECORD_ID');receiptSafe(value);durableNew(resolve(this.directory,id+'.json'),value);}
}
export class Meter {
 constructor(plan,{clock,startedAt,deadlineAt,timeWindow,limits={}}={}){
  if(timeWindow){assertTimeWindow(timeWindow,{startedAt,deadlineAt,clock});need(timeWindow.authority.expiresMs-timeWindow.authority.startMs<=plan.elapsed_minutes_cap*60000,'TIME_WINDOW_CAP');}
  this.timeWindow=timeWindow;this.clock=timeWindow?.clock??clock??(()=>performance.now());this.start=timeWindow?.start??startedAt??this.clock();const deadline=timeWindow?.deadline??this.start+plan.elapsed_minutes_cap*60000;
  need(deadlineAt===undefined||deadlineAt===deadline,'DEADLINE_OVERRIDE');Object.defineProperty(this,'deadline',{value:deadline,enumerable:true,writable:false,configurable:false});
  this.cap={...budget(plan),read_only_audit:plan.read_only_audit_transaction_cap,local_intent:plan.local_intent_transaction_cap??6,candidate_stop:plan.docker.stop_new_container_cap};
  need(Number.isSafeInteger(this.cap.local_intent)&&this.cap.local_intent>=0&&this.cap.local_intent<=6,'INTENT_CAP');
  for(const [k,v]of Object.entries(plan.auth_row_insert_caps))this.cap['auth_insert_'+k]=v;
  for(const [k,v]of Object.entries(plan.auth_row_delete_caps))this.cap['auth_delete_'+k]=v;
  for(const [k,v]of Object.entries(plan.business_insert_caps))this.cap['business_insert_'+k]=v;
  for(const [k,v]of Object.entries(limits)){need(k in this.cap&&Number.isSafeInteger(v)&&v>=0&&v<=this.cap[k],'BUDGET_OVERRIDE');this.cap[k]=v;}
  this.steps=Object.fromEntries(plan.steps.map(s=>[s.id,{...s.slots}]));this.used={};this.stepUsed={};this.ids=new Set();this.stopped=false;
  this.cleanupReserve=plan.independent_final_observer?{maintenance_tx:1,read_only_audit:3,explicit_database_transactions:4}:{maintenance_tx:1,read_only_audit:2,explicit_database_transactions:3};
 }
 checkTime(cleanup=false){if(this.timeWindow){const wall=this.timeWindow.wallClock();need(wall>=this.timeWindow.authority.startMs&&wall<this.timeWindow.authority.expiresMs,'DEADLINE_STOP');}need(this.clock()<=this.deadline-(cleanup?0:CLEANUP_RESERVE_MS),'DEADLINE_STOP');}
 stop(){this.stopped=true;}
 reserve(id,step,cost,{cleanup=false}={}){
  cost={...cost};
  for(const [prefix,total]of [['auth_insert_','auth_row_insert_cap'],['business_insert_','business_row_insert_cap']]){
   const n=Object.entries(cost).filter(([k])=>k.startsWith(prefix)).reduce((n,[,v])=>n+v,0);
   if(n){need(!(total in cost),'DUPLICATE_AGGREGATE_BUDGET');cost[total]=n;}
  }
  this.checkTime(cleanup);need(cleanup||!this.stopped,'DRIVER_STOPPED');need(!this.ids.has(id),'DUPLICATE_OPERATION');
  need(step in this.steps,'STEP_SCOPE');
  for(const [key,n] of Object.entries(cost)){
   need(Number.isSafeInteger(n)&&n>=0&&key in this.cap,'UNKNOWN_BUDGET');
   const reserve=cleanup?0:(this.cleanupReserve[key]??0);
   need((this.used[key]??0)+n<=this.cap[key]-reserve,'BUDGET_'+key);
   if(key in this.steps[step])need((this.stepUsed[step]?.[key]??0)+n<=this.steps[step][key],'STEP_BUDGET_'+key);
  }
  this.ids.add(id);for(const [key,n]of Object.entries(cost)){this.used[key]=(this.used[key]??0)+n;this.stepUsed[step]??={};this.stepUsed[step][key]=(this.stepUsed[step][key]??0)+n;}
  return structuredClone(this.used);
 }
}
// Atomic create-only records survive crashes and reject cross-process re-use.
// A torn record is UNKNOWN, never removed or repaired. No retrying transaction.
export class FileIntents {
 constructor(directory,{runId,sourceSha,create=false}){privateDir(directory,create);this.directory=directory;this.scope={runId,sourceSha};}
 path(id,kind){need(/^[0-9a-f-]{36}$/.test(id),'INTENT_ID');return resolve(this.directory,id+'.'+kind+'.json');}
 approve(intent,validFrom,expiresAt){
  need(Number.isSafeInteger(validFrom)&&expiresAt>validFrom&&expiresAt-validFrom<=7200,'INTENT_WINDOW');
  const record={state:'approved',validFrom,expiresAt,intent:structuredClone(intent)};
  try{durableNew(this.path(intent.proof_id,'approved'),{...this.scope,record});}catch(e){if(e.code==='EEXIST')throw new DriverStop('INTENT_ALREADY_EXISTS');throw new DriverStop('INTENT_APPROVAL_UNKNOWN',true);}
 }
 storage(){const self=this;return {async transaction(callback){
  let read;
  try{return await callback({async get(name){
   const id=name.split('/').at(-1);let value;
   try{value=readPrivate(self.path(id,'approved'));}catch(e){if(e.code==='ENOENT')return undefined;throw e;}
   need(value.runId===self.scope.runId&&value.sourceSha===self.scope.sourceSha,'INTENT_SCOPE');
   try{const spent=readPrivate(self.path(id,'consumed'));need(spent.runId===value.runId&&spent.sourceSha===value.sourceSha&&same(spent.record.intent,value.record.intent)&&spent.record.state==='consumed','INTENT_TORN',true);return spent.record;}catch(e){if(e.code!=='ENOENT')throw e;}
   read={id,record:value.record};return structuredClone(value.record);
  },async put(name,record){
   need(read&&name.endsWith('/'+read.id)&&record.state==='consumed'&&same(record.intent,read.record.intent),'INTENT_WRITE_SCOPE');
   try{durableNew(self.path(read.id,'consumed'),{...self.scope,record});}catch(e){
    if(e.code==='EEXIST'){const spent=readPrivate(self.path(read.id,'consumed'));need(spent.runId===self.scope.runId&&spent.sourceSha===self.scope.sourceSha&&spent.record.state==='consumed'&&same(spent.record.intent,record.intent),'INTENT_TORN',true);throw new DriverStop('INTENT_RACE_LOST');}
    throw new DriverStop('INTENT_CLAIM_UNKNOWN',true);
   }
  }});}catch(e){if(e.code==='INTENT_RACE_LOST')return false;if(e instanceof DriverStop)throw e;throw new DriverStop('INTENT_STORAGE_UNKNOWN',true);}
 }};}
}
