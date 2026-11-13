// Prepared stdin-only entry. Import creates no stdin handlers or listeners.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startCandidate} from './service.mjs';
export function createControl({start=startCandidate,terminate=code=>process.exit(code),emit=()=>{}}={}) {
 let input='',size=0,state='WAITING',server,chain=Promise.resolve();
 function stop(code=0){
  if(state==='CLOSED')return;
  const pending=state==='STARTING';state='CLOSED';
  // Starting is process-fatal: outstanding async reads cannot reach listen after
  // control is revoked. Production terminate never returns.
  if(pending||!server)terminate(code);
  else {server.close(()=>terminate(code));setTimeout(()=>terminate(code),1000).unref();}
 }
 function feed(chunk){
  if(state==='CLOSED')return;
  size+=Buffer.byteLength(chunk);input+=chunk;
  if(size>4096){emit('CONTROL_REJECTED');stop(1);return;}
  for(;;){
   const end=input.indexOf('\n');if(end<0)break;
   const line=input.slice(0,end);input=input.slice(end+1);
   chain=chain.then(async()=>{
    if(state==='CLOSED')return;
    const value=JSON.parse(line);
    if(JSON.stringify(value)!==line)throw Error('CONTROL');
    if(state==='WAITING'&&value&&Object.keys(value).sort().join(',')==='apikey,command'&&value.command==='START'){
     state='STARTING';server=await start({enabled:true,apikey:value.apikey});value.apikey=undefined;
     if(state==='CLOSED'){server.close();return;}
     state='READY';server.once('error',()=>{emit('SERVICE_FAILED');stop(1);});emit('READY');
    }else if(value&&Object.keys(value).join(',')==='command'&&value.command==='STOP')stop();
    else throw Error('CONTROL');
   }).catch(()=>{emit('START_OR_CONTROL_REJECTED');stop(1);});
  }
 }
 return Object.freeze({feed,stop,settled:()=>chain});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const emit=event=>process.stdout.write(JSON.stringify({event})+'\n');
 const control=createControl({emit});process.stdin.setEncoding('utf8');
 process.stdin.on('data',control.feed);process.stdin.on('end',()=>control.stop());
 process.on('SIGTERM',()=>control.stop());process.on('SIGINT',()=>control.stop());
 emit('AWAITING_EXPLICIT_CONFIG');
}
