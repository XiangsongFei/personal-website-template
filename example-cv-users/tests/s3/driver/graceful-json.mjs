// One owned TLS connection per request. Never retry or pool credentials.
import https from 'node:https';
import tls from 'node:tls';
export function gracefulJsonOnce(options,raw,{timeout=8000,emit=()=>{},connectTls=tls.connect,fault=false}={}) {
 return new Promise((resolve,reject)=>{
  let req,socket,responseValue,readEnded=false,writeFinished=false,closed=false,settled=false,injected=false;
  const agent=new https.Agent({keepAlive:false,maxSockets:1,maxTotalSockets:1,maxCachedSessions:0});
  const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);socket?.destroy();agent.destroy();emit({event:'transport_unknown'});const error=Error('TRANSPORT_UNKNOWN');error.intentionalFault=injected;error.observation={body_complete:!!responseValue,observed_status:responseValue?.status??null,observed_code:['42501','PT409','22023','PGRST106'].includes(responseValue?.json?.code)?responseValue.json.code:null,tls_read_end:readEnded,tls_write_finish:writeFinished,tls_closed:closed};reject(error);};
  const timer=setTimeout(fail,timeout);
  agent.createConnection=(config)=>{
   socket=connectTls({...config,allowHalfOpen:true});
   socket.once('end',()=>{readEnded=true;emit({event:'tls_read_end'});});
   socket.once('finish',()=>{writeFinished=true;emit({event:'tls_write_finish'});});
   socket.once('error',fail);
   socket.once('close',hadError=>{
    closed=true;emit({event:'tls_close',hadError,readEnded,writeFinished});
    if(hadError||!readEnded||!writeFinished||!responseValue)return fail();
    if(settled)return;settled=true;clearTimeout(timer);agent.destroy();resolve(responseValue);
   });
   return socket;
  };
  try {
   req=https.request({...options,agent},response=>{
    const chunks=[];let n=0;
    // Own this single non-pooled TLS connection before Node's responseOnEnd.
    // Public end() makes writable=false and sends close_notify without the
    // default destroySoon() discarding the peer's still unread TLS closure.
    response.prependOnceListener('end',()=>{if(response.complete&&!settled&&socket.writable){emit({event:'graceful_half_close'});socket.end();}});
    if(response.headers['content-type']?.split(';')[0]!=='application/json'||(response.statusCode>=300&&response.statusCode<400))return fail();
    response.on('data',chunk=>{if(fault){injected=true;response.destroy();fail();return;}n+=chunk.length;if(n>131072)return fail();chunks.push(chunk);});
    response.once('error',fail);response.once('aborted',fail);
    response.once('end',()=>{
     try {
      if(!response.complete||settled) return fail();
      const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      if(!json||typeof json!=='object')return fail();
      responseValue={status:response.statusCode,json};emit({event:'http_complete',status:response.statusCode});
      // No result is released before the independent TLS lifecycle completes.
      if(closed)fail();
     }catch{fail();}
    });
   });
   req.once('error',fail);req.end(raw);
  }catch{fail();}
 });
}
