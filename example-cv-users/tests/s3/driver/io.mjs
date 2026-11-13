import {spawn} from 'node:child_process';
import {Duplex} from 'node:stream';
import {need,DriverStop,hash} from './state.mjs';
import {DB,REG} from './contract.mjs';
import {checkIo} from './deadline.mjs';
import {SERVICES,assertServiceBindings} from './bindings.mjs';
export function command(args,input='',{timeout=15000,maxBytes=4*1024*1024,spawnProcess=spawn}={}){
 const active=checkIo();if(active)timeout=Math.min(timeout,active.remaining());
 return new Promise((resolve,reject)=>{
  const p=spawnProcess(args[0],args.slice(1),{env:{PATH:'/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin',HOME:process.env.HOME},stdio:['pipe','pipe','pipe']});
  let out=[],err=[],n=0,settled=false;const timer=setTimeout(()=>{p.kill('SIGTERM');finish(new DriverStop('PROCESS_TIMEOUT_UNKNOWN',true));},timeout);
  const abort=()=>{p.kill('SIGTERM');finish(new DriverStop('PROCESS_ABORT_UNKNOWN',true));};
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);active?.signal.removeEventListener('abort',abort);if(error){error.processReceipt={exitCode:null,stdoutBytes:Buffer.concat(out).length,stdoutSha256:hash(Buffer.concat(out)),stderrBytes:Buffer.concat(err).length,stderrSha256:hash(Buffer.concat(err))};reject(error);}else resolve(result);};
  active?.signal.addEventListener('abort',abort,{once:true});
  p.on('error',()=>finish(new DriverStop('PROCESS_UNKNOWN',true)));
  p.stdout.on('data',b=>{n+=b.length;if(n>maxBytes){p.kill('SIGTERM');finish(new DriverStop('PROCESS_OUTPUT_UNKNOWN',true));}else out.push(b);});
  p.stderr.on('data',b=>{if(err.reduce((n,b)=>n+b.length,0)<65536)err.push(b);});
  p.on('close',(code,signal)=>finish(null,{code,signal,stdout:Buffer.concat(out),stderr:Buffer.concat(err)}));
  p.stdin.on('error',()=>{});p.stdin.end(input);
 });
}
export async function psql(sql,{timeout=15000}={}){
 assertServiceBindings();const m=SERVICES.maintenance;const result=await command(['docker','--context','desktop-linux','exec','-i','--user',m.user,m.container,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',SERVICES.maintenance.socket,'-d','postgres','-f','-'],sql,{timeout});
 const lines=result.stdout.toString().split(/\r?\n/).filter(Boolean);let rows=[];
 try{rows=lines.filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));}catch{throw new DriverStop('SQL_RESULT_UNKNOWN',true);}
 return {...result,rows,tags:lines.filter(x=>!x.startsWith('{')),safe:{exitCode:result.code,sqlSha256:hash(sql),stdoutSha256:hash(result.stdout),stderrSha256:hash(result.stderr)}};
}
// One interactive psql backend: used only for a held fence or read-only queue
// observer. Every command has a unique echo delimiter; no additional DB tx.
export class SqlSession {
 constructor({spawnProcess=spawn}={}){assertServiceBindings();this.active=checkIo();this.child=spawnProcess('docker',['--context','desktop-linux','exec','-i','--user',SERVICES.maintenance.user,SERVICES.maintenance.container,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',SERVICES.maintenance.socket,'-d','postgres'],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin'}});this.buffer='';this.lines=[];this.pending=null;this.serial=0;this.ended=false;this.err=[];
  this.abortListener=()=>this.child.kill('SIGTERM');this.active?.signal.addEventListener('abort',this.abortListener,{once:true});
  this.closed=new Promise(resolve=>this.child.on('close',code=>{this.ended=true;clearTimeout(this.pending?.timer);this.pending?.reject(new DriverStop('SQL_SESSION_UNKNOWN',true));this.active?.signal.removeEventListener('abort',this.abortListener);resolve({code,stderrSha256:hash(Buffer.concat(this.err))});}));
  this.child.on('error',()=>{this.ended=true;clearTimeout(this.pending?.timer);this.pending?.reject(new DriverStop('SQL_SESSION_UNKNOWN',true));});this.child.stdin.on('error',()=>{});
  this.bytes=0;this.errorBytes=0;
  this.child.stderr.on('data',b=>{this.errorBytes+=b.length;if(this.errorBytes<=65536)this.err.push(b);else this.abort();});
  this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',s=>{this.bytes+=Buffer.byteLength(s);if(this.bytes>4*1024*1024){this.abort();return;}this.buffer+=s;let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i).replace(/\r$/,'');this.buffer=this.buffer.slice(i+1);if(line===this.pending?.marker){const p=this.pending;this.pending=null;clearTimeout(p.timer);p.resolve(this.lines);this.lines=[];}else this.lines.push(line);}});
 }
 query(sql,timeout=8000){need(!this.pending&&!this.ended,'SQL_SESSION_STATE');if(this.active){need(!this.active.signal.aborted,'SQL_SESSION_ABORTED',true);timeout=Math.min(timeout,this.active.remaining());}return new Promise((resolve,reject)=>{const marker='ECV_S34_'+(++this.serial);const timer=setTimeout(()=>{this.pending=null;this.child.kill('SIGTERM');reject(new DriverStop('SQL_SESSION_TIMEOUT_UNKNOWN',true));},timeout);this.pending={resolve,reject,marker,timer};this.child.stdin.write(sql+'\n\\echo '+marker+'\n');});}
 async finish(){this.child.stdin.end('\\q\n');let timer;try{const r=await Promise.race([this.closed,new Promise((_,reject)=>{timer=setTimeout(()=>{this.child.kill('SIGTERM');reject(new DriverStop('SQL_SESSION_CLOSE_UNKNOWN',true));},Math.min(5000,this.active?.remaining()??5000));})]);need(r.code===0,'SQL_SESSION_CLOSE_UNKNOWN',true);return r;}finally{clearTimeout(timer);}}
 async end(sql='ROLLBACK;'){const lines=await this.query(sql);const r=await this.finish();need(lines.includes(sql.startsWith('COMMIT')?'COMMIT':'ROLLBACK'),'SQL_SESSION_CLOSE_UNKNOWN',true);return {...r,commandTags:lines.filter(x=>['ROLLBACK','COMMIT'].includes(x)),rollback:lines.includes('ROLLBACK')};}
 abort(){this.child.kill('SIGTERM');}
}
// stdio carries raw TCP bytes into the existing registration container. No
// listening TCP/UDS socket or new host port. PostgreSQL TLS terminates in pg.
export class RegistrationStream extends Duplex {
 constructor({spawnProcess=spawn}={}){super({allowHalfOpen:true});this.active=checkIo();this.spawnProcess=spawnProcess;this.process=null;this.inputEof=false;this.outputEof=false;this.exitCode=null;this.errors=[];this.completion=null;}
 setNoDelay(){return this;}setKeepAlive(){return this;}ref(){return this;}unref(){return this;}
 connect(port,host){
  assertServiceBindings();need(!this.process&&port===SERVICES.registration.port&&host===SERVICES.registration.host,'REGISTRATION_TARGET');
  const p=this.process=this.spawnProcess('docker',['--context','desktop-linux','exec','-i','--user','100:101',SERVICES.registration.carrier,'/usr/bin/nc','-w','8',SERVICES.registration.ip,String(SERVICES.registration.port)],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin'}});
  this.abortListener=()=>this.destroy(new DriverStop('REGISTRATION_ABORT_UNKNOWN',true));this.active?.signal.addEventListener('abort',this.abortListener,{once:true});
  this.completion=new Promise(resolve=>p.on('close',code=>{this.exitCode=code;this.active?.signal.removeEventListener('abort',this.abortListener);resolve(code);}));
  p.on('spawn',()=>queueMicrotask(()=>this.emit('connect')));p.on('error',()=>this.destroy(new DriverStop('REGISTRATION_CARRIER_UNKNOWN',true)));
  p.stdout.on('data',b=>{if(!this.push(b))p.stdout.pause();});p.stdout.on('end',()=>{this.outputEof=true;this.push(null);});p.stderr.on('data',b=>{if(this.errors.reduce((n,b)=>n+b.length,0)+b.length>65536)this.destroy(new DriverStop('REGISTRATION_STDERR_UNKNOWN',true));else this.errors.push(b);});p.stdin.on('error',e=>this.destroy(e));return this;
 }
 _read(){this.process?.stdout.resume();}
 _write(b,encoding,callback){this.process.stdin.write(b,encoding,callback);}
 _final(callback){this.inputEof=true;this.process.stdin.end(callback);}
 _destroy(error,callback){if(error)this.process?.kill('SIGTERM');callback(error);}
 async finish(){need(this.completion,'REGISTRATION_CARRIER_MISSING');let timer;try{const code=await Promise.race([this.completion,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new DriverStop('REGISTRATION_EOF_UNKNOWN',true)),Math.min(5000,this.active?.remaining()??5000));})]);need(code===0&&this.inputEof&&this.outputEof&&this.errors.length===0,'REGISTRATION_EOF_UNKNOWN',true);return {inputEof:true,outputEof:true,exitCode:code};}finally{clearTimeout(timer);}}
}
