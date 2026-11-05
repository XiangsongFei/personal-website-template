import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
const fixture=fileURLToPath(new URL('./fixtures/stop-health-only.mjs',import.meta.url));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(check,ms=2000){const end=Date.now()+ms;while(Date.now()<end){if(check())return;await delay(20);}throw Error('condition_timeout');}
function start(scenario){
 const child=spawn(process.execPath,[fixture,scenario],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}});const rows=[];let buf='';let stderr='';
 child.stdout.on('data',chunk=>{buf+=chunk;let i;while((i=buf.indexOf('\n'))>=0){rows.push(JSON.parse(buf.slice(0,i)));buf=buf.slice(i+1);}});child.stderr.on('data',x=>stderr+=x);
 const exited=once(child,'exit').then(([code,signal])=>({code,signal}));
 return {child,rows,exited,stderr:()=>stderr};
}
async function released(port){return new Promise((ok,no)=>{const s=net.connect({host:'127.0.0.1',port});s.on('connect',()=>{s.destroy();no(Error('port_still_open'));});s.on('error',e=>e.code==='ECONNREFUSED'?ok(true):no(e));});}
function killOwned(ctx){
 assert.ok(ctx.child.pid && ctx.child.exitCode===null && ctx.child.signalCode===null);
 const p=spawnSync('/bin/ps',['-p',String(ctx.child.pid),'-o','ppid=,comm=,args='],{encoding:'utf8'});
 assert.equal(p.status,0);assert.ok(p.stdout.includes(String(process.pid)));assert.ok(p.stdout.includes(process.execPath));assert.ok(p.stdout.includes(fixture));
 ctx.child.kill('SIGTERM');
}
for(const [name,lines]of [['normal',1],['repeated',2]])test(name+' stop: accepted, cleanup, exit and port release independently observed',async t=>{
 const c=start(name);t.after(()=>{if(c.child.exitCode===null&&c.child.signalCode===null)killOwned(c);});await waitFor(()=>c.rows.some(x=>x.kind==='ready'));const port=c.rows[0].port;
 c.child.stdin.write('stop\n'.repeat(lines));const exit=await c.exited;
 assert.deepEqual(exit,{code:0,signal:null});assert.equal(c.rows.filter(x=>x.kind==='stop_instruction_accepted').length,lines);assert.equal(c.rows.filter(x=>x.kind==='cleanup_started').length,1);assert.equal(c.rows.filter(x=>x.kind==='cleanup_complete').length,1);assert.ok(c.rows.some(x=>x.kind==='stopped'&&x.confirmed));await released(port);assert.equal(c.stderr(),'');
 t.diagnostic(JSON.stringify({pid:c.child.pid,port,accepted:true,duplicateCount:lines-1,cleanupComplete:true,exitCode:exit.code,portReleased:true,authRequests:0}));
});
test('timeout preserves cleanup UNKNOWN; identity-bound fallback exits and releases port',async t=>{
 const c=start('timeout');t.after(()=>{if(c.child.exitCode===null&&c.child.signalCode===null)killOwned(c);});await waitFor(()=>c.rows.some(x=>x.kind==='ready'));const port=c.rows[0].port;c.child.stdin.write('stop\n');
 await waitFor(()=>c.rows.some(x=>x.kind==='stopped'&&!x.confirmed),12000);
 assert.equal(c.rows.filter(x=>x.kind==='cleanup_complete').length,0);assert.equal(c.child.exitCode,null);await released(port);
 killOwned(c);const exit=await c.exited;assert.equal(exit.signal,'SIGTERM');await released(port);
 t.diagnostic(JSON.stringify({pid:c.child.pid,port,accepted:true,cleanupComplete:false,cleanupStatus:'UNKNOWN',boundedFallback:'owned PID SIGTERM',processExited:true,portReleased:true,authRequests:0}));
});
test('Python heredoc-like inherited stdin is EOF, whereas piped child input remains usable',async t=>{
 const py='import os\nos.execve('+JSON.stringify(process.execPath)+', ['+JSON.stringify(process.execPath)+', "-e", "process.stdin.resume();process.stdin.on(\'end\',()=>console.log(\'stdin_eof\'))"], {"PATH":"/usr/bin:/bin"})\n';
 const p=spawn('/usr/bin/python3',['-'],{stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',x=>out+=x);const exited=once(p,'exit');p.stdin.end(py);const [code]=await exited;assert.equal(code,0);assert.equal(out.trim(),'stdin_eof');
 t.diagnostic('Launcher consumed stdin before exec; no Auth or service was started.');
});
test('controlled runner stop is accepted once, waits for scoped cleanup and disposal, and releases its port',async t=>{
 const c=start('controlled-normal');t.after(()=>{if(c.child.exitCode===null&&c.child.signalCode===null)killOwned(c);});await waitFor(()=>c.rows.some(x=>x.kind==='ready'));const port=c.rows[0].port;
 c.child.stdin.write('stop\nstop\n');const exit=await c.exited;
 assert.deepEqual(exit,{code:0,signal:null});assert.equal(c.rows.filter(x=>x.kind==='stop_accepted').length,1);
 assert.equal(c.rows.filter(x=>x.kind==='scoped_cleanup_started').length,1);assert.equal(c.rows.filter(x=>x.kind==='ledger_closed').length,1);
 assert.ok(c.rows.some(x=>x.kind==='stop_complete'&&x.cleanupConfirmed&&x.workersDisposed));await released(port);
 t.diagnostic(JSON.stringify({pid:c.child.pid,port,accepted:true,cleanupConfirmed:true,processExited:true,portReleased:true,authRequests:0}));
});
test('controlled runner cleanup timeout remains unconfirmed; only the owned health fixture is terminated',async t=>{
 const c=start('controlled-timeout');t.after(()=>{if(c.child.exitCode===null&&c.child.signalCode===null)killOwned(c);});await waitFor(()=>c.rows.some(x=>x.kind==='ready'));const port=c.rows[0].port;c.child.stdin.write('stop\n');
 await waitFor(()=>c.rows.some(x=>x.kind==='stop_unconfirmed'),32000);assert.equal(c.rows.filter(x=>x.kind==='stop_complete').length,0);
 assert.equal(c.rows.filter(x=>x.kind==='scoped_cleanup_started').length,1);await released(port);killOwned(c);const exit=await c.exited;assert.equal(exit.signal,'SIGTERM');
 t.diagnostic(JSON.stringify({pid:c.child.pid,port,cleanupStatus:'UNKNOWN',ownedPidExit:true,portReleased:true,authRequests:0}));
});
