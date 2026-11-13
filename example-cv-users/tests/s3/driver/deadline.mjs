import {AsyncLocalStorage} from 'node:async_hooks';
import {DriverStop,need,CLEANUP_RESERVE_MS} from './state.mjs';
const scope=new AsyncLocalStorage();
export function ioScope(){return scope.getStore();}
export function checkIo(){const s=ioScope();if(s){need(!s.signal.aborted&&s.remaining()>0,'IO_DEADLINE_UNKNOWN',true);}return s;}
export async function boundedOperation(fn,{meter,cleanup=false,timeoutMs=20000,signal}={}){
 const end=meter.deadline-(cleanup?0:CLEANUP_RESERVE_MS),remaining=()=>Math.max(0,end-meter.clock());
 need(remaining()>0,'DEADLINE_STOP');need(cleanup||!signal?.aborted,'SIGNAL_STOP');const controller=new AbortController();let timer,abort;
 try{return await scope.run({signal:controller.signal,remaining},()=>Promise.race([
  Promise.resolve().then(fn),new Promise((_,reject)=>{abort=()=>{controller.abort();reject(new DriverStop('SIGNAL_INTERRUPTED_UNKNOWN',true));};if(!cleanup)signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{controller.abort();reject(new DriverStop('OPERATION_TIMEOUT_UNKNOWN',true));},Math.min(timeoutMs,remaining()));})
 ]));}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}
