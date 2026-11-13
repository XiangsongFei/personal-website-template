// Non-business probes only. No JWT, RPC, auth mutation or commit.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {connect,checkServerIdentity} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {RegistrationStream,psql,command} from './io.mjs';
import {SERVICES} from './bindings.mjs';
import {mailJson} from './mail.mjs';
import {httpsJson,parseDatabaseErrors} from './transport.mjs';
import {transport} from './evidence.mjs';
import {need,hash,DriverStop} from './state.mjs';
import {DB} from './contract.mjs';
export async function registrarTlsOnly(pki){
 const carrier=new RegistrationStream();let socket,completed=false;
 try{
  await new Promise((resolve,reject)=>{carrier.once('error',reject);carrier.once('connect',resolve);carrier.connect(SERVICES.registration.port,SERVICES.registration.host);});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('PG_SSL_RESPONSE')),3000);carrier.once('error',reject);carrier.once('data',b=>{clearTimeout(timer);carrier.pause();b.length===1&&b[0]===83?resolve():reject(Error('PG_SSL_RESPONSE'));});carrier.write(Buffer.from([0,0,0,8,4,210,22,47]));});
  const expected=new X509Certificate(readFileSync(resolve(pki,'server.crt'))).fingerprint256;
  const value=await new Promise((resolve,reject)=>{
   socket=connect({socket:carrier,servername:SERVICES.registration.host,ca:readFileSync(pki+'/server-ca.crt'),cert:readFileSync(pki+'/registration.crt'),key:readFileSync(pki+'/registration.key'),rejectUnauthorized:true,allowHalfOpen:true,checkServerIdentity:(_,peer)=>checkServerIdentity(SERVICES.registration.host,peer)});
   const timer=setTimeout(()=>{socket.destroy();reject(Error('REGISTRAR_TLS_TIMEOUT'));},5000);let secure=false;
   socket.once('secureConnect',()=>{secure=socket.authorized&&socket.getPeerCertificate().fingerprint256===expected;if(!secure){socket.destroy();return;}socket.end();});socket.once('error',reject);socket.once('close',error=>{clearTimeout(timer);secure&&!error?resolve({authorized:true,host:SERVICES.registration.host,fingerprint:expected}):reject(Error('REGISTRAR_TLS_IDENTITY'));});
  });
  const eof=await carrier.finish();completed=true;return {...value,...eof,sqlSent:false,postgresStartupSent:false};
 }catch(e){
  const identity=/CERT|TLS.*IDENTITY|SELF_SIGNED|ALTNAME|UNKNOWN_CA|UNABLE_TO_VERIFY/.test(e.code??e.message??'');throw new DriverStop(identity?'P01_REGISTRAR_TLS_IDENTITY':'P01_REGISTRAR_TRANSPORT_UNKNOWN',!identity);
 }finally{socket?.destroy();if(!completed){carrier.destroy(new DriverStop('P01_REGISTRAR_ABORT',true));try{await carrier.finish();}catch{}}else carrier.destroy();}
}
// A non-business SELECT error inside a read-only savepoint tests the live log
// observer. ON_ERROR_STOP is restored before read-only/ROLLBACK confirmation.
export const ERROR_OBSERVER_SQL=`BEGIN READ ONLY;
SET LOCAL statement_timeout='3s';
SET LOCAL application_name='ecv-s34-p01-observer';
SELECT jsonb_build_object('pid',pg_backend_pid(),'readOnly',current_setting('transaction_read_only'));
SAVEPOINT p01_observer;
\\set ON_ERROR_STOP off
SELECT 1/0;
\\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT p01_observer;
SELECT jsonb_build_object('pid',pg_backend_pid(),'readOnly',current_setting('transaction_read_only'),'recovered',true);
ROLLBACK;
`;
export async function postgresErrorObserver({runSql=psql,run=command}={}){
 const from=Date.now(),r=await runSql(ERROR_OBSERVER_SQL),to=Date.now();
 need(r.code===0&&r.tags.at(-1)==='ROLLBACK'&&r.rows.length===2&&r.rows.every(x=>x.readOnly==='on')&&r.rows[0].pid===r.rows[1].pid&&r.rows[1].recovered===true&&/22012/.test(r.stderr.toString()),'P01_ERROR_OBSERVER_ROLLBACK');
 const logs=await run(['docker','--context','desktop-linux','logs','--since',new Date(from).toISOString(),'--until',new Date(to+1000).toISOString(),DB]);need(logs.code===0,'P01_DATABASE_LOG');
 const matches=parseDatabaseErrors(logs.stdout.toString()+logs.stderr.toString(),{from:from-10,to:to+1000}).filter(e=>e.pid===r.rows[0].pid&&e.sqlstate==='22012'&&e.sessionUser==='postgres');need(matches.length===1,'P01_ERROR_SOURCE');
 const metadata={readOnly:true,rollback:true,pid:r.rows[0].pid,sqlstate:'22012',source:'postgres-log',unique:true,writeCommitEvidence:'NOT RUN'};return {...metadata,safeReceipt:{...r.safe,...metadata,postgresError:matches[0],logSha256:hash(Buffer.concat([logs.stdout,logs.stderr]))}};
}
export async function healthAndMail(host){
 const r=await httpsJson({destination:'auth',method:'GET',path:'/auth/v1/health',apikey:host.apikey,ca:host.ca});transport(r.transport);need(r.status===200&&r.json?.name==='GoTrue','P01_AUTH_HEALTH');
 const mail=await mailJson('/api/v1/messages'),messages=mail.messages??mail.Messages;need(Array.isArray(messages),'P01_MAIL_METADATA');
 return {auth:{status:r.status,name:r.json.name,version:r.json.version,transport:r.transport,mutation:false},mail:{complete:true,messageCount:messages.length,metadataSha256:hash(JSON.stringify(mail)),bodyRead:false}};
}
