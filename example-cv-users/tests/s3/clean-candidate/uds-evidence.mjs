// Test composition only. Observe the unchanged business HTTP client; never send
// a second request or expose JWT/body/error text. Storage is the approved tmpfs.
import {subscribe,unsubscribe} from 'node:diagnostics_channel';
import {createHash} from 'node:crypto';
import {openSync,writeSync,closeSync} from 'node:fs';
export const TRACE_PATH='/tmp/s34-uds-evidence.ndjson';
export const SOCKET_PATH='/run/clean-internal/postgrest.sock';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function observeUds({socketPath=SOCKET_PATH,emit,now=Date.now}={}){
 const pending=new WeakMap();let serial=0;
 function created({request:q}){
  if(q.socketPath!==socketPath)return;
  if(q.method!=='POST'||!/^\/rpc\/(get_my_site|read_introduction|read_create_operation|apply_business_grant)$/.test(q.path)||++serial>64)throw Error('UDS_OBSERVER_SCOPE');
  const auth=q.getHeader('authorization');if(typeof auth!=='string'||!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth))throw Error('UDS_OBSERVER_TOKEN');
  const token=auth.slice(7),claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  const r={seq:serial,startedAt:now(),rpc:q.path.slice(5),socketPath,jwtSha256:sha(token),uid:claims.sub,sid:claims.session_id,requestBytes:0,requestSha256:null,complete:false};
  const chunks=[];let ended=false;const take=(b,encoding)=>{if(b===undefined||typeof b==='function')return;const raw=Buffer.isBuffer(b)?b:Buffer.from(b,typeof encoding==='string'?encoding:undefined);r.requestBytes+=raw.length;if(r.requestBytes>8192)throw Error('UDS_OBSERVER_LIMIT');chunks.push(Buffer.from(raw));};
  const write=q.write,end=q.end;
  q.write=function(...args){take(args[0],args[1]);return Reflect.apply(write,this,args);};
  q.end=function(...args){if(ended)throw Error('UDS_OBSERVER_DUPLICATE');ended=true;take(args[0],args[1]);r.requestSha256=sha(Buffer.concat(chunks));chunks.length=0;return Reflect.apply(end,this,args);};
  pending.set(q,r);
 }
 function received({request:q,response:s}){
  const r=pending.get(q);if(!r)return;pending.delete(q);
  let bytes=0,done=false;const chunks=[],read=s.read;
  // Tap only bytes already consumed by the original reader. No data listener,
  // resume(), altered flow control, header injection or response replacement.
  s.read=function(...args){const b=Reflect.apply(read,this,args);if(b!==null){const raw=Buffer.isBuffer(b)?b:Buffer.from(b);bytes+=raw.length;if(bytes>65536)throw Error('UDS_OBSERVER_LIMIT');chunks.push(Buffer.from(raw));}return b;};
  function finish(){if(done)return;done=true;let code=null;const raw=Buffer.concat(chunks);try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));if(['42501','PT503','PT409','22023','PGRST106'].includes(v?.code))code=v.code;}catch{}
   emit({...r,finishedAt:now(),status:s.statusCode,contentType:s.headers['content-type']?.split(';')[0]??null,responseBytes:bytes,responseSha256:sha(raw),code,complete:s.complete===true&&s.readableEnded===true&&r.requestSha256!==null});chunks.length=0;
  }
  s.once('end',finish);s.once('aborted',finish);s.once('error',finish);s.once('close',finish);
 }
 subscribe('http.client.request.created',created);subscribe('http.client.response.finish',received);
 return ()=>{unsubscribe('http.client.request.created',created);unsubscribe('http.client.response.finish',received);};
}
let installed=false;
export function installUdsEvidence(){
 if(installed)throw Error('UDS_OBSERVER_ALREADY_INSTALLED');installed=true;
 const fd=openSync(TRACE_PATH,'wx',0o600);let size=0;
 const dispose=observeUds({emit:r=>{const line=JSON.stringify(r)+'\n';size+=Buffer.byteLength(line);if(size>1048576)throw Error('UDS_OBSERVER_STORAGE_LIMIT');writeSync(fd,line);}});
 return ()=>{dispose();closeSync(fd);};
}
