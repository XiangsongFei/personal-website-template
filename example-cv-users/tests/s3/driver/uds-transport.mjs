// One request only. Diagnostic envelopes contain hashes and enums, never tokens,
// headers, arbitrary child errors or response bodies on an incomplete path.
import {need,DriverStop,hash} from './state.mjs';
export async function udsChild({http,connect,createHash,input,output,socketPath,timeout=8000}){
 const sha=x=>createHash('sha256').update(x).digest('hex');
 let m,claims,raw;try{m=JSON.parse(input);raw=JSON.stringify(m.body);claims=JSON.parse(Buffer.from(m.authorization.split('.')[1],'base64url'));}catch{output(JSON.stringify({version:1,complete:false,failure:'INPUT_FORMAT',dispatched:false}));return;}
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x);
 if(!['get_my_site','read_introduction'].includes(m.rpc)||!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(m.authorization)||!uuid(m.dispatchId)||!uuid(claims.sub)||!uuid(claims.session_id)||Buffer.byteLength(raw)>8192){output(JSON.stringify({version:1,complete:false,failure:'INPUT_SCOPE',dispatched:false}));return;}
 const trace={seq:1,dispatchId:m.dispatchId,startedAt:Date.now(),socketPath,rpc:m.rpc,uid:claims.sub,sid:claims.session_id,jwtSha256:sha(m.authorization.slice(7)),requestSha256:sha(raw),requestBytes:Buffer.byteLength(raw)};
 await new Promise(resolve=>{
  const agent=new http.Agent({keepAlive:false,maxSockets:1,maxTotalSockets:1});agent.createConnection=()=>connect({path:socketPath,allowHalfOpen:true});
  let req,socket,done=false,end=false,finish=false,closed=false,responseEnd=false,value=null,bytes=0,chunks=[];
  const terminal=failure=>{if(done)return;done=true;clearTimeout(timer);const complete=!failure&&!!value&&end&&finish&&closed&&responseEnd;
   const receipt={version:1,dispatched:true,complete,failure:failure??null,readEnd:end,writeFinish:finish,closed,hadError:!!failure,udsEvidence:{...trace,finishedAt:Date.now(),status:value?.status??null,code:typeof value?.json?.code==='string'&&/^[A-Z0-9]{5,12}$/.test(value.json.code)?value.json.code:null,contentType:value?.contentType??null,responseBytes:bytes,responseSha256:sha(Buffer.concat(chunks)),complete}};
   output(JSON.stringify(complete?{...receipt,status:value.status,json:value.json}:receipt));chunks=[];if(failure){req?.destroy();agent.destroy();}else agent.destroy();resolve();};
  const maybe=()=>{if(responseEnd&&end&&finish&&closed)terminal();};
  const timer=setTimeout(()=>terminal('TIMEOUT'),timeout); // A live timer guarantees a terminal envelope.
  try{req=http.request({socketPath,method:'POST',path:'/rpc/'+m.rpc,agent,headers:{Authorization:m.authorization,'Content-Type':'application/json','Accept-Profile':'site_api','Content-Profile':'site_api','Content-Length':Buffer.byteLength(raw),Connection:'close'}},r=>{
   r.prependOnceListener('end',()=>{if(r.complete&&!done&&socket?.writable)socket.end();});
   r.on('data',b=>{bytes+=b.length;if(bytes>65536){terminal('RESPONSE_LIMIT');return;}chunks.push(Buffer.from(b));});
   r.on('aborted',()=>terminal('RESPONSE_ABORTED'));r.on('error',()=>terminal('RESPONSE_ERROR'));
   r.on('end',()=>{if(done)return;if(!r.complete){terminal('RESPONSE_TRUNCATED');return;}
    let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{terminal('RESPONSE_JSON');return;}
    if(json===null||typeof json!=='object'){terminal('RESPONSE_SHAPE');return;}
    value={status:r.statusCode,json,contentType:r.headers['content-type']?.split(';')[0]??null};responseEnd=true;maybe();});
   r.on('close',()=>{if(!responseEnd&&!done)terminal('RESPONSE_CLOSED_EARLY');});
  });
  req.on('socket',s=>{socket=s;s.on('finish',()=>{finish=true;maybe();});s.on('end',()=>{end=true;maybe();});s.on('error',()=>terminal('SOCKET_ERROR'));s.on('close',error=>{closed=true;if(error)terminal('SOCKET_ERROR');else if(!end)terminal('SOCKET_READ_END_MISSING');else if(!responseEnd||!finish)terminal('STREAM_INCOMPLETE');else maybe();});});
  req.on('finish',()=>{});req.on('error',()=>terminal('REQUEST_ERROR'));req.end(raw);
  }catch{terminal('REQUEST_SETUP');}
 });
}
export function udsProgram(socketPath){return `import http from 'node:http';import {connect} from 'node:net';import {createHash} from 'node:crypto';let input='';for await(const b of process.stdin){input+=b;if(Buffer.byteLength(input)>12288)process.exit(13);}await (${udsChild.toString()})({http,connect,createHash,input,output:s=>process.stdout.write(s),socketPath:${JSON.stringify(socketPath)}});`;}
const failureCodes=new Set(['INPUT_FORMAT','INPUT_SCOPE','TIMEOUT','RESPONSE_LIMIT','RESPONSE_ABORTED','RESPONSE_ERROR','RESPONSE_TRUNCATED','RESPONSE_JSON','RESPONSE_SHAPE','RESPONSE_CLOSED_EARLY','SOCKET_ERROR','SOCKET_READ_END_MISSING','STREAM_INCOMPLETE','REQUEST_ERROR','REQUEST_SETUP']);
export function safeUdsTrace(t){
 if(!t||typeof t!=='object')return null;
 const out={};for(const k of ['seq','startedAt','finishedAt','requestBytes','responseBytes','status'])if(Number.isSafeInteger(t[k])&&t[k]>=0)out[k]=t[k];
 for(const k of ['dispatchId','uid','sid'])if(typeof t[k]==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(t[k]))out[k]=t[k];
 for(const k of ['jwtSha256','requestSha256','responseSha256'])if(/^[a-f0-9]{64}$/.test(t[k]??''))out[k]=t[k];
 if(['get_my_site','read_introduction','read_create_operation','apply_business_grant'].includes(t.rpc))out.rpc=t.rpc;
 if(t.socketPath==='/run/clean-internal/postgrest.sock')out.socketPath=t.socketPath;
 if(t.contentType==='application/json')out.contentType=t.contentType;
 if(typeof t.code==='string'&&/^[A-Z0-9]{5,12}$/.test(t.code))out.code=t.code;
 out.complete=t.complete===true;return out;
}
export function parseUdsResult(r,expected){
 const execution={exitCode:Number.isInteger(r.code)?r.code:null,signal:['SIGTERM','SIGKILL','SIGINT'].includes(r.signal)?r.signal:null,stdoutBytes:r.stdout.length,stdoutSha256:hash(r.stdout),stderrBytes:r.stderr.length,stderrSha256:hash(r.stderr)};
 let v;try{v=JSON.parse(r.stdout);}catch{}
 function unknown(stage){const e=new DriverStop('UDS_RESULT_UNKNOWN',true);e.safeReceipt={transport:{protocol:'http-uds',complete:false,stage,execution,dispatchId:expected.dispatchId},udsEvidence:safeUdsTrace(v?.udsEvidence),streamFlags:{readEnd:v?.readEnd===true,writeFinish:v?.writeFinish===true,closed:v?.closed===true,hadError:v?.hadError===true},requestBinding:{...expected,source:'issued-original-jwt-request'},database:{outcome:'UNKNOWN',source:'NOT_VERIFIED'}};throw e;}
 if(r.code!==0||r.signal||r.stderr.length)unknown('CHILD_EXECUTION');
 if(!v||v.version!==1)unknown('CHILD_ENVELOPE');
 if(!v.complete)unknown(failureCodes.has(v.failure)?v.failure:'INCOMPLETE_ENVELOPE');
 const t=v.udsEvidence;
 if(!(v.readEnd&&v.writeFinish&&v.closed&&!v.hadError&&t?.complete&&t.dispatchId===expected.dispatchId&&t.uid===expected.uid&&t.sid===expected.sid&&t.rpc===expected.rpc&&t.socketPath===expected.socketPath&&t.jwtSha256===expected.jwtSha256&&t.requestSha256===expected.requestSha256&&Number.isSafeInteger(t.requestBytes)&&t.requestBytes===expected.requestBytes&&t.status===v.status&&t.code===(v.json?.code??null)))unknown('BINDING_OR_STREAM');
 // No raw response is logged. Hash/length are produced over bytes in the child;
 // the JSON is used only by the existing response and commit validators.
 if(!(t.responseBytes>=2&&t.responseBytes<=65536&&/^[a-f0-9]{64}$/.test(t.responseSha256??'')&&Number.isFinite(t.startedAt)&&Number.isFinite(t.finishedAt)&&t.finishedAt>=t.startedAt))unknown('RESPONSE_METADATA');
 return {...v,transport:{protocol:'http-uds',complete:true,execution,stream:{readEnd:true,writeFinish:true,closed:true,hadError:false},carrierExit:0}};
}
// A completed read transport and a verified DB attribution are separate facts.
// Losing the second must not erase the first, and never justifies a replay.
export async function withUdsAttribution(result,{binding,collect}){
 try{return {outerStatus:result.status,data:result.json,transport:result.transport,...await collect()};}
 catch(error){
  const e=error instanceof DriverStop?error:new DriverStop('DB_EVIDENCE_UNKNOWN',true);
  e.unknown=true;e.safeReceipt={...e.safeReceipt,outerStatus:result.status,transport:result.transport,udsEvidence:safeUdsTrace(result.udsEvidence),requestBinding:{...binding,source:'observed-original-jwt-and-uds'},database:{...e.safeReceipt?.database,attribution:'NOT_VERIFIED',outcome:'UNKNOWN'}};throw e;
 }
}
