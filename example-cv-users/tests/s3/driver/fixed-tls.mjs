// Host TLS terminates here; the existing carrier sees only encrypted bytes.
// No listener, pool, DNS fallback, credentials in argv, or automatic retry.
import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {connect,checkServerIdentity} from 'node:tls';
import {SERVICES,assertServiceBindings} from './bindings.mjs';
import {OLD_NODE,loadContract} from './contract.mjs';
import {need,DriverStop} from './state.mjs';
import {checkIo} from './deadline.mjs';
export function carrierInvocation(destination){
 assertServiceBindings();need(['auth','candidate'].includes(destination),'HTTP_DESTINATION');
 const s=destination==='auth'?SERVICES.auth:SERVICES.node;
 const ip=destination==='auth'?s.gatewayIp:s.ip,port=destination==='auth'?s.gatewayPort:s.port;
 // Same half-close/opaque-byte principle as the accepted S3.3 forwarder.
 const script=`const n=require('node:net');const s=n.connect({host:${JSON.stringify(ip)},port:${port},allowHalfOpen:true});let a=false,b=false;const t=setTimeout(()=>{s.destroy();process.exitCode=7;},8000);s.on('connect',()=>{process.stdin.pipe(s);s.pipe(process.stdout,{end:false});});process.stdin.on('end',()=>{a=true;});s.on('end',()=>{b=true;process.stdout.end();});s.on('error',()=>{process.exitCode=8;process.stdin.destroy();});s.on('close',error=>{clearTimeout(t);if(error||!a||!b)process.exitCode=9;process.stdin.destroy();});process.stdout.on('error',()=>{s.destroy();process.exitCode=10;});`;
 return {argv:['docker','--context','desktop-linux','exec','-i','--user','1000:1000',OLD_NODE,'node','-e',script],ip,port,carrier:OLD_NODE,servername:s.host,fingerprint:destination==='auth'?s.fingerprint:loadContract().frozen.tls.server_fingerprint};
}
export class FixedStream extends Duplex {
 constructor(destination,{spawnProcess=spawn,timeout=8000}={}){
  super({allowHalfOpen:true});this.on('error',()=>{});this.inputEof=false;this.outputEof=false;this.errors=0;this.exitCode=null;this.failed=false;this.active=checkIo();
  const {argv}=carrierInvocation(destination);const p=this.child=spawnProcess(argv[0],argv.slice(1),{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin'}});
  this.completion=new Promise(resolve=>p.once('close',code=>{this.exitCode=code;clearTimeout(this.timer);clearTimeout(this.closeTimer);this.active?.signal.removeEventListener('abort',this.abortListener);resolve(code);if(code!==0||!this.outputEof)this.destroy(new DriverStop('CARRIER_UNKNOWN',true));}));
  this.abortListener=()=>{this.abort();this.destroy(new DriverStop('CARRIER_ABORT_UNKNOWN',true));};this.active?.signal.addEventListener('abort',this.abortListener,{once:true});
  this.timer=setTimeout(()=>this.destroy(new DriverStop('CARRIER_TIMEOUT_UNKNOWN',true)),Math.min(timeout,this.active?.remaining()??timeout));
  p.on('error',()=>this.destroy(new DriverStop('CARRIER_UNKNOWN',true)));p.stdin.on('error',()=>this.destroy(new DriverStop('CARRIER_INPUT_UNKNOWN',true)));
  p.stdout.on('data',b=>{if(!this.push(b))p.stdout.pause();});p.stdout.on('end',()=>{this.outputEof=true;this.push(null);});p.stderr.on('data',b=>{this.errors+=b.length;if(this.errors>65536)this.destroy(new DriverStop('CARRIER_STDERR_UNKNOWN',true));});
 }
 _read(){this.child?.stdout.resume();}
 _write(b,e,cb){this.child.stdin.write(b,e,cb);}
 _final(cb){this.inputEof=true;this.child.stdin.end(cb);}
 abort(){this.failed=true;if(!this.killed&&this.exitCode===null){this.killed=true;this.child?.stdin.destroy();this.child?.kill('SIGTERM');}}
 _destroy(error,cb){if(error)this.abort();else if(!this.inputEof||!this.outputEof){if(!this.inputEof){this.inputEof=true;this.child?.stdin.end();}this.closeTimer=setTimeout(()=>this.abort(),1000);}cb(error);}
 async finish(){let timer;try{const code=await Promise.race([this.completion,new Promise((_,reject)=>{timer=setTimeout(()=>{this.destroy(new DriverStop('CARRIER_EOF_UNKNOWN',true));reject(new DriverStop('CARRIER_EOF_UNKNOWN',true));},Math.min(5000,this.active?.remaining()??5000));})]);need(!this.failed&&code===0&&this.inputEof&&this.outputEof&&this.errors===0,'CARRIER_EOF_UNKNOWN',true);return {inputEof:true,outputEof:true,exitCode:0};}finally{clearTimeout(timer);}}
}
export function fixedTls(destination,options,{makeStream=d=>new FixedStream(d),open=connect}={}){
 const target=carrierInvocation(destination);need(options.servername===target.servername&&options.rejectUnauthorized===true&&options.ca,'TLS_TARGET');
 const carrier=makeStream(destination);let socket;
 try{socket=open({...options,host:undefined,port:undefined,path:undefined,socket:carrier,allowHalfOpen:true,rejectUnauthorized:true,minVersion:'TLSv1.2',checkServerIdentity:(_,peer)=>checkServerIdentity(target.servername,peer)});}catch(e){carrier.destroy(e);throw e;}
 carrier.once('error',()=>socket.destroy(new DriverStop('CARRIER_UNKNOWN',true)));
 socket.once('secureConnect',()=>{if(!socket.authorized||target.fingerprint&&socket.getPeerCertificate().fingerprint256!==target.fingerprint)socket.destroy(new DriverStop('TLS_IDENTITY',true));});
 return {socket,carrier};
}
export async function probeFixedTls(destination,options,{open=fixedTls}={}){
 let pair;try{pair=open(destination,options);await new Promise((resolve,reject)=>{const s=pair.socket;let secure=false,fingerprint;const t=setTimeout(()=>{s.destroy();reject(new DriverStop('TLS_PROBE_UNKNOWN',true));},5000);s.once('secureConnect',()=>{secure=s.authorized===true;fingerprint=s.getPeerCertificate().fingerprint256;pair.fingerprint=fingerprint;s.end();});s.once('error',()=>{clearTimeout(t);reject(new DriverStop('TLS_PROBE_UNKNOWN',true));});s.once('close',error=>{clearTimeout(t);error||!secure?reject(new DriverStop('TLS_PROBE_UNKNOWN',true)):resolve();});});const eof=await pair.carrier.finish();return {authorized:true,host:options.servername,fingerprint:pair.fingerprint,...eof};}catch{pair?.socket.destroy();pair?.carrier.abort?.();if(pair?.carrier)try{await pair.carrier.finish();}catch{}return {authorized:false,code:'TLS_PROBE_UNKNOWN'};}
}
