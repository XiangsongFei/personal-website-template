import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gracefulJsonOnce} from './graceful_https.mjs';
const dir=process.argv[2],ca=fs.readFileSync(dir+'/cert.pem'),context=tls.createSecureContext({key:fs.readFileSync(dir+'/key.pem'),cert:ca}),results=[];
async function run(mode,{legacy=false}={}) {
 let serverClosed=false,hold=false,upstream,front,held=[],tlsSocket;const trace=[];
 const server=tls.createServer({key:fs.readFileSync(dir+'/key.pem'),cert:ca,allowHalfOpen:true},s=>{
  tlsSocket=s;s.on('error',()=>{});let data='',sent=false;
  s.on('data',chunk=>{
   data+=chunk.toString();if(sent||!data.includes('\r\n\r\n'))return;sent=true;
   if(mode==='abort'){serverClosed=true;front.resetAndDestroy();upstream.destroy();s.destroy();return;}
   const status=mode==='ok'?200:409,body=JSON.stringify(status===200?{ok:true}:{code:'PT409'});
   hold=true;s.write('HTTP/1.1 '+status+' Test\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: '+(Buffer.byteLength(body)+(mode==='truncate'?10:0))+'\r\n\r\n'+body);
   if(mode==='timeout')return;
   setTimeout(()=>{serverClosed=true;if(mode==='reset'){front.resetAndDestroy();upstream.destroy();s.destroy();}else{hold=false;for(const data of held)upstream.write(data);held=[];s.end();}},120);
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const proxy=net.createServer({allowHalfOpen:true},p=>{
  front=p;upstream=net.connect({host:'127.0.0.1',port:server.address().port,allowHalfOpen:true});p.on('error',()=>{});upstream.on('error',()=>{});
  p.on('data',data=>{if(hold)held.push(data);else upstream.write(data);});p.on('end',()=>{if(!hold)upstream.end();});upstream.on('data',data=>p.write(data));upstream.on('end',()=>p.end());
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const port=proxy.address().port;
 const opts={hostname:'127.0.0.1',port,servername:'close-fixture.invalid',ca,rejectUnauthorized:true,method:'GET',path:'/fixture',headers:{Connection:'close'}};
 let value,error;
 try {
  if(legacy) value=await new Promise((resolve,reject)=>{const q=https.request({...opts,agent:false},async s=>{const chunks=[];for await(const x of s)chunks.push(x);resolve({status:s.statusCode,json:JSON.parse(Buffer.concat(chunks))});});q.once('error',reject);q.end();});
  else value=await gracefulJsonOnce(opts,undefined,{timeout:1500,emit:e=>trace.push(e)});
 }catch(e){error=e.message;}
 const result={mode,legacy,result:error?'UNKNOWN':'COMPLETE',status:value?.status??null,resolvedBeforeServerClosed:!serverClosed,trace};
 if(legacy){assert.equal(value.status,409);assert.equal(serverClosed,false);}
 else if(['reset','abort','truncate','timeout'].includes(mode)){assert.equal(error,'TRANSPORT_UNKNOWN');}
 else {assert.equal(value.status,mode==='ok'?200:409);assert.equal(serverClosed,true);assert(trace.some(x=>x.event==='tls_read_end'));assert(trace.some(x=>x.event==='tls_write_finish'));assert(trace.some(x=>x.event==='tls_close'&&!x.hadError));}
 await new Promise(resolve=>setTimeout(resolve,150));front?.destroy();upstream?.destroy();tlsSocket?.destroy();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>proxy.close(resolve))]);results.push(result);
}
await run('conflict',{legacy:true});for(const mode of ['ok','conflict','reset','abort','truncate','timeout'])await run(mode);
console.log(JSON.stringify({tests:7,pass:7,businessWrites:0,realTlsFixtures:true,results}));
