import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {writeOnce} from './r3.mjs';
import {assertOutboxReceiptBinding,recordOutboxInvalidation} from './outbox-batch-plan.mjs';

export function checkOutboxReceiverPeer({socket,method,url,headers},authority,fingerprint) {
  assert.equal(socket.remoteAddress,'127.0.0.1');
  assert.equal(socket.authorized,true);
  assert.equal(socket.getPeerCertificate().fingerprint256,fingerprint);
  assert.equal(method,'POST');
  assert.equal(url,'/invalidate');
  assert.equal(headers.host,authority);
  assert.equal(headers['content-type'],'application/json');
  assert.ok(!Object.keys(headers).some(name=>name==='forwarded'||name.startsWith('x-forwarded-')));
  assert.equal(typeof headers['idempotency-key'],'string');
}

function respond(response,status,value) {
  response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  response.end(JSON.stringify(value));
}

// Only a future approved worker batch may call listen(). Importing starts nothing.
export function isolatedOutboxReceiver({plan,journal,origin,tls,fingerprint,interruptAfterReceive=false}) {
  assertOutboxReceiptBinding(plan,journal);
  if(interruptAfterReceive) assert.ok(plan.mode==='reply-loss-after-durable-receive'&&plan.events.length===1);
  const parsed=new URL(origin);
  assert.equal(parsed.origin,origin);
  assert.equal(parsed.protocol,'https:');
  assert.equal(parsed.hostname,'127.0.0.1');
  assert.ok(Number(parsed.port)>=1024);
  assert.match(fingerprint,/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
  assert.ok([tls.ca,tls.cert,tls.key].every(x=>typeof x==='string'&&x.length>0));
  const server=createServer({ca:tls.ca,cert:tls.cert,key:tls.key,requestCert:true,rejectUnauthorized:true,
    minVersion:'TLSv1.2',headersTimeout:2000,requestTimeout:4000,maxHeaderSize:4096},async(req,res)=>{
    try {checkOutboxReceiverPeer(req,parsed.host,fingerprint);}
    catch {respond(res,403,{code:'OUTBOX_RECEIVER_DENIED'});return;}
    const timer=setTimeout(()=>res.destroy(),3000);
    try {
      const parts=[];
      let size=0;
      for await (const chunk of req) {
        size+=chunk.length;
        if(size>1024) {res.destroy();return;}
        parts.push(chunk);
      }
      if(res.destroyed||!req.complete) return;
      const bytes=Buffer.concat(parts);
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      const receipt=recordOutboxInvalidation(plan,journal,value,req.headers['idempotency-key']);
      if(interruptAfterReceive) {
        assert.equal(receipt.duplicate,false);
        const [,owner,token]=plan.events[0].actions[0].values;
        writeOnce(join(journal,'receiver-reply-interrupted.json'),{...value,
          bodySha256:createHash('sha256').update(bytes).digest('hex'),owner,token,generation:1,interruptedBeforeResponse:true});
        res.destroy();
        return;
      }
      respond(res,200,receipt);
    } catch {
      // A lost receipt remains ambiguous for the sender. Do not promise non-delivery.
      if(!res.destroyed) respond(res,503,{code:'OUTBOX_RECEIVER_RESULT_UNKNOWN'});
    } finally {clearTimeout(timer);}
  });
  return Object.freeze({
    listen:()=>new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(Number(parsed.port),'127.0.0.1',()=>{server.off('error',reject);resolve();});
    }),
    close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
  });
}
