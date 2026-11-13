import {udsProgram,parseUdsResult,safeUdsTrace} from './uds-transport.mjs';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fixedTls} from './fixed-tls.mjs';
export {mailInvocation,mailJson} from './mail.mjs';
import {checkServerIdentity} from 'node:tls';
import {RegistrationStream,command} from './io.mjs';
import {gracefulJsonOnce} from './graceful-json.mjs';
import {need,DriverStop,hash} from './state.mjs';
import {PROJECT,OLD_NODE,GATEWAY,pins} from './contract.mjs';
import {checkIo} from './deadline.mjs';
import {SERVICES,assertServiceBindings,httpsTarget} from './bindings.mjs';
export async function httpsJson({destination='auth',method,path,body,token,apikey,ca,cert,key,fault=false}){
 const active=checkIo();
 const target=httpsTarget(destination),host=target.servername,port=target.port;
 need(destination==='auth'&&path==='/auth/v1/health'?method==='GET'&&body===undefined&&token===undefined:destination==='auth'?/^\/auth\/v1\/(user|admin\/users(?:\/[0-9a-f-]{36})?|token\?grant_type=password|recover|verify)$/.test(path):/^\/rpc\/(get_my_site|read_introduction|read_create_operation|apply_business_grant)$/.test(path),'HTTP_PATH');
 need(['GET','POST','PUT'].includes(method),'HTTP_METHOD');
 const raw=body===undefined?undefined:JSON.stringify(body);need(!raw||Buffer.byteLength(raw)<=8192,'HTTP_BODY_LIMIT');
 const headers={Host:target.authority,Accept:'application/json',Connection:'close'};
 if(apikey)headers.apikey=apikey;if(token)headers.Authorization='Bearer '+token;
 if(raw!==undefined){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(raw);}
 const options={hostname:target.hostname,port,servername:host,path,method,ca,cert,key,rejectUnauthorized:true,minVersion:'TLSv1.2',checkServerIdentity:(_,peer)=>checkServerIdentity(host,peer),maxHeaderSize:24576,headers,signal:active?.signal};
 const events=[];let pair;
 try{
  const r=await gracefulJsonOnce(options,raw,{fault,timeout:Math.min(8000,active?.remaining()??8000),emit:e=>events.push(e),connectTls:config=>{need(!pair,'DISPATCH_ONCE');pair=fixedTls(destination,config);return pair.socket;}});
  const carrier=await pair.carrier.finish();
  return {...r,transport:{protocol:'https',complete:true,carrier,tls:{readEnd:events.some(e=>e.event==='tls_read_end'),writeFinish:events.some(e=>e.event==='tls_write_finish'),closed:events.some(e=>e.event==='tls_close'),hadError:events.some(e=>e.event==='tls_close'&&e.hadError)}}};
 }catch(error){pair?.socket.destroy();pair?.carrier.abort();if(pair?.carrier)try{await pair.carrier.finish();}catch{}const e=new DriverStop('TRANSPORT_UNKNOWN',true);e.intentionalFault=error.intentionalFault===true;throw e;}
}

export function validatePgFiles(lock,{read=readFileSync}={}){for(const pkg of lock.packages)for(const [file,sha]of Object.entries(pkg.files))need(hash(read(resolve(pkg.root,file)))===sha,'HOST_PG_DEPENDENCY_CHANGED');}
export function pinnedPg(){
 const lock=JSON.parse(readFileSync(new URL('./pg-dependencies.json',import.meta.url)));
 validatePgFiles(lock);
 const pg=createRequire(resolve(lock.pgRoot,'package.json'))('./lib/index.js');need(pg.Client,'HOST_PG_CLIENT');return pg;
}
export function registrarClientClass(pg,onReceipt){
 return class BoundRegistrationClient extends pg.Client {
  constructor(config){
   assertServiceBindings();const host=SERVICES.registration.host;need(config.host===host&&config.port===SERVICES.registration.port&&config.database==='postgres'&&config.user===SERVICES.registration.user&&config.ssl?.rejectUnauthorized===true&&config.ssl.servername===host,'REGISTRAR_CONFIG');
   const stream=new RegistrationStream();super({...config,stream:()=>stream});this.carrier=stream;this.onceQuery=false;this.peer=false;this.sqlResult=null;this.connectionError=false;
   // pg emits socket errors outside the query Promise too. Never let an idle
   // EventEmitter error terminate the process before the driver's P16 finally.
   this.on('error',()=>{this.connectionError=true;});
   const check=config.ssl.checkServerIdentity;this.connectionParameters.ssl.checkServerIdentity=(name,peer)=>{const e=check(name,peer);this.peer=e===undefined;return e;};
  }
  async query(sql,values){need(!this.onceQuery&&sql==='SELECT site_private.register_business_ticket($1::jsonb) AS registered'&&values?.length===1,'REGISTER_ONCE');this.onceQuery=true;this.sqlResult=await super.query(sql,values);return this.sqlResult;}
  async end(){await super.end();const eof=await this.carrier.finish();need(!this.connectionError,'REGISTRATION_CONNECTION_UNKNOWN',true);need(this.peer,'REGISTRAR_PEER_UNVERIFIED');onReceipt({committed:this.sqlResult?.command==='SELECT'&&this.sqlResult.rows?.[0]?.registered===true,command:this.sqlResult?.command,rowCount:this.sqlResult?.rowCount,registered:this.sqlResult?.rows?.[0]?.registered===true,peerVerified:this.peer,...eof});}
 };
}
export async function directUnix({rpc,body,token,dispatchId}, {run=command}={}){
 assertServiceBindings();
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
 const expected={dispatchId,uid:claims.sub,sid:claims.session_id,rpc,socketPath:SERVICES.postgrest.socket,jwtSha256:hash(token),requestSha256:hash(JSON.stringify(body)),requestBytes:Buffer.byteLength(JSON.stringify(body))};
 let r;try{r=await run(['docker','--context','desktop-linux','exec','-i','--user','1000:1000',SERVICES.postgrest.carrier,'node','--input-type=module','-e',udsProgram(SERVICES.postgrest.socket)],JSON.stringify({rpc,body,authorization:'Bearer '+token,dispatchId}),{timeout:12000});}
 catch(error){const e=new DriverStop('UDS_RESULT_UNKNOWN',true);e.safeReceipt={transport:{protocol:'http-uds',complete:false,stage:['PROCESS_TIMEOUT_UNKNOWN','PROCESS_ABORT_UNKNOWN','PROCESS_OUTPUT_UNKNOWN','PROCESS_UNKNOWN'].includes(error.code)?error.code:'PROCESS_UNKNOWN',execution:error.processReceipt??null,dispatchId},requestBinding:{...expected,source:'issued-original-jwt-request'},database:{outcome:'UNKNOWN',source:'NOT_VERIFIED'}};throw e;}
 return parseUdsResult(r,expected);
}
// Only SQLSTATE/function/context/PID survive this parser; never log SQL text,
// claims, parameters, JWTs or arbitrary database error messages.
export function parseDatabaseErrors(raw,{from,to}){
 const records=[];let record=null;
 for(const line of raw.split(/\r?\n/)){
  const prefix=/^\d{4}-\d\d-\d\d[^[]+\[(\d+)\]/.exec(line);
  if(prefix&&record&&Number(prefix[1])!==record.pid)record=null;
  const m=/^(\d{4}-\d\d-\d\d[^[]+)\[(\d+)\]\s+([A-Z0-9]{5})\s+\S*\s+(\S+)@postgres\s+ERROR:/.exec(line);
  if(m){const t=Date.parse(m[1].trim().replace(' UTC','Z'));if(Number.isFinite(t)&&t>=from&&t<=to){record={timestampMs:t,timestamp:m[1].trim(),pid:Number(m[2]),sqlstate:m[3],sessionUser:m[4],frames:[]};records.push(record);}else record=null;continue;}
  if(prefix&&/\sERROR:/.test(line)){record=null;continue;}
  if(record){const f=/(?:PL\/pgSQL|SQL) function (?:(site_private|site_api)\.)?\"?([a-z_]+)\"?(?:\([^)]*\))? (?:line (\d+) at ([A-Za-z_ ]+)|statement (\d+))/.exec(line);if(f){const schema=f[1]??(['get_my_site','read_introduction','read_create_operation','apply_business_grant'].includes(f[2])?'site_api':'site_private');record.frames.push({function:schema+'.'+f[2],raiseLine:f[4]?.trim()==='RAISE'?Number(f[3]):null});}}
 }
 return records;
}
export function parsePostgrestAccess(raw,rpc,status){
 return raw.split(/\r?\n/).filter(line=>line.includes('POST /rpc/'+rpc+' ')&&new RegExp('" '+status+'(?: |$)').test(line));
}
// Request claims below come from the observed original JWT, not PostgreSQL.
// A denied HTTP response is NOT a transaction ROLLBACK acknowledgement.
export function correlateDatabase(dbLogs,trace,{from,to,rpc,uid,sid,jwtSha256,requestSha256,candidate=null,dispatchId=null,usedErrors=new Set()}){
 need(dbLogs.code===0,'DB_LOG_UNKNOWN',true);
 const errors=parseDatabaseErrors(dbLogs.stdout.toString()+dbLogs.stderr.toString(),{from:trace?.startedAt??from,to:trace?.finishedAt??to}).filter(x=>x.sessionUser==='ecv_s3_internal_api_login');
 const unverified=code=>{const e=new DriverStop(code,true);e.safeReceipt={udsEvidence:safeUdsTrace(trace),requestBinding:{uid,sid,rpc,jwtSha256,requestSha256,...(dispatchId?{dispatchId}:{})},postgrest:{status:trace?.status??null,code:safeUdsTrace(trace)?.code??null},database:{source:'postgres-log',attribution:'NOT_VERIFIED',outcome:'UNKNOWN',errors}};throw e;};
 if((dispatchId!==null&&trace?.dispatchId!==dispatchId)||!trace?.complete||trace.socketPath!==SERVICES.postgrest.socket||trace.rpc!==rpc||trace.uid!==uid||trace.sid!==sid||trace.jwtSha256!==jwtSha256||trace.requestSha256!==requestSha256||trace.contentType!=='application/json'||!Number.isSafeInteger(trace.seq)||trace.seq<1||!Number.isFinite(trace.startedAt)||trace.startedAt<from||trace.finishedAt>to||!Number.isFinite(trace.finishedAt)||trace.finishedAt<trace.startedAt||!Number.isSafeInteger(trace.responseBytes)||trace.responseBytes<2||!/^[a-f0-9]{64}$/.test(trace.responseSha256??''))unverified('UDS_ATTRIBUTION_NOT_VERIFIED');
 const status=trace.status;
 if(candidate&&(candidate.status!==status||(status!==200&&candidate.json?.code!==trace.code)))unverified('PRIVATE_UDS_RESPONSE_MISMATCH');
 if((status===200?errors.length!==0:errors.length!==1))unverified('DB_LOG_ATTRIBUTION_UNKNOWN');
 const requestBinding={...(dispatchId?{dispatchId}:{}),uid:trace.uid,sid:trace.sid,jwtSha256:trace.jwtSha256,requestSha256:trace.requestSha256,rpc:trace.rpc,source:'observed-original-jwt-and-uds'};
 const postgrest={status,code:trace.code,codeOrigin:'uds-response-body',responseSha256:trace.responseSha256,udsObserved:true};
 if(status===200)return {postgrest,requestBinding,udsEvidence:trace,database:{source:'postgrest-original-jwt',outcome:rpc==='apply_business_grant'?'RESPONSE_COMPLETE_AWAITING_RECONCILIATION':'READ_COMPLETED',uid,sid,rpc,udsObserved:true}};
 const e=errors[0],errorId=hash(JSON.stringify(e));if(usedErrors.has(errorId))unverified('DB_ERROR_ALREADY_USED');const frame=e.frames.find(f=>f.raiseLine!==null)??{function:null,raiseLine:null},pin=pins.frames[frame.function?.split('.').at(-1)];
 if(!e.frames.some(f=>f.function==='site_api.'+rpc)||trace.code!==e.sqlstate)unverified('DB_RPC_CONTEXT_NOT_VERIFIED');
 usedErrors.add(errorId);return {postgrest,requestBinding,udsEvidence:trace,database:{errorId,correlation:'controlled-single-request-time-frame-not-server-claims',timestampMs:e.timestampMs,...frame,pid:e.pid,sqlstate:e.sqlstate,sessionUser:e.sessionUser,rpc,uid,sid,bodySha256:pin?.body_sha256??null,unique:true,rpcContextObserved:true,source:'postgres-log',outcome:'DENIED_RESPONSE_OBSERVED'}};
}
export async function unexpectedOuterEvidence({outerStatus,candidate,readLogs}){
 let observed={postgrest:{status:candidate?.status??null},database:{source:'unconfirmed',outcome:'UNKNOWN'}};
 if(candidate)try{observed=await readLogs(candidate.status);}catch(error){observed=error.safeReceipt??observed;}
 // No complete candidate response cannot prove that nothing reached the DB.
 return {...observed,outerStatus,transport:candidate?.transport??{protocol:'https',complete:false}};
}
