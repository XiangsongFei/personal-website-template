// Future host driver binding. Fixed loopback route, exact RPC authority and TLS.
import {request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {Readable} from 'node:stream';
import {PRIVATE_ORIGIN} from './service.mjs';
export function createHostMtls({ca,cert,key},open=request){
 if(![ca,cert,key].every(x=>typeof x==='string'&&x.length))throw Error('MTLS_CONFIG');
 return Object.freeze({fetch(url,init){
  const target=new URL(url);
  if(target.origin!==PRIVATE_ORIGIN||target.username||target.password||target.search||target.hash||!/^\/rpc\/(get_my_site|read_introduction|read_create_operation|create_site|apply_business_grant)$/.test(target.pathname)||
     init.method!=='POST'||init.redirect!=='manual'||typeof init.body!=='string'||Buffer.byteLength(init.body)>8192||
     Object.keys(init.headers).sort().join(',')!=='Authorization,Content-Type'||init.headers['Content-Type']!=='application/json'||
     !/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(init.headers.Authorization))throw Error('MTLS_ROUTE');
  return new Promise((resolve,reject)=>{
   let req;try{
    req=open({hostname:'127.0.0.1',port:57422,servername:target.hostname,path:target.pathname,method:'POST',
     ca,cert,key,rejectUnauthorized:true,minVersion:'TLSv1.2',checkServerIdentity:(_,peer)=>checkServerIdentity(target.hostname,peer),
     agent:false,signal:init.signal,maxHeaderSize:24576,headers:{...init.headers,Host:target.host,'Content-Length':Buffer.byteLength(init.body)}},response=>{
      try {
      if(response.headers['content-type']?.split(';')[0]!=='application/json'||response.statusCode>=300&&response.statusCode<400){response.destroy();reject(Error('MTLS_RESULT_UNKNOWN'));return;}
      resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:{'Content-Type':'application/json'}}));
      }catch{response.destroy();reject(Error('MTLS_RESULT_UNKNOWN'));}
     });
    req.once('error',()=>reject(Error('MTLS_RESULT_UNKNOWN')));req.end(init.body);
   }catch{req?.destroy();reject(Error('MTLS_RESULT_UNKNOWN'));}
  });
 }});
}
