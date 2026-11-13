// Fixed R3 GoTrue /user transport, adapted from reviewed S3.3 client. No login,
// refresh, redirects, retry, proxy, DNS lookup, generic path or secret discovery.
import {request} from 'node:https';
import {checkServerIdentity} from 'node:tls';
export const PROJECT='ecv-r3-clean-20261111-e449c25f';
export const HOST='gateway.'+PROJECT+'.internal.test';
export const ISSUER='http://'+HOST+':8000/auth/v1';
function transport({ca,apikey},open,destination) {
 if(typeof ca!=='string'||!ca.includes('BEGIN CERTIFICATE')||typeof apikey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{32,128}$/.test(apikey))throw Error('AUTH_CONFIG');
 return Object.freeze({userOnce(token){
  if(typeof token!=='string'||token.length>16384||!/^\w[\w-]*\.[\w-]+\.[\w-]+$/.test(token))throw Error('TOKEN_FORMAT');
  return new Promise((resolve,reject)=>{
   let req,done=false;
   const stop=()=>{if(done)return;done=true;clearTimeout(timer);req?.destroy();reject(Error('AUTH_RESULT_UNKNOWN'));};
   const timer=setTimeout(stop,8000);
   try {
    req=open({hostname:destination==='host'?'127.0.0.1':'172.30.232.4',port:destination==='host'?57421:8443,servername:HOST,path:'/auth/v1/user',method:'GET',
     headers:{Host:HOST,Accept:'application/json',apikey,Authorization:'Bearer '+token},
     ca,rejectUnauthorized:true,minVersion:'TLSv1.2',checkServerIdentity:(_,cert)=>checkServerIdentity(HOST,cert),
     agent:false,maxHeaderSize:24576},async response=>{
      try {
       if(response.headers['content-type']?.split(';')[0]!=='application/json'||response.statusCode>=300&&response.statusCode<400)throw Error('AUTH_RESPONSE');
       let size=0;const chunks=[];
       for await(const chunk of response){size+=chunk.length;if(size>131072)throw Error('AUTH_RESPONSE');chunks.push(chunk);}
       if(response.complete!==true)throw Error('AUTH_RESPONSE');
       const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
       if(!json||Array.isArray(json)||typeof json!=='object')throw Error('AUTH_RESPONSE');
       if(done)return;done=true;clearTimeout(timer);resolve({status:response.statusCode,json});
      }catch{response.destroy();stop();}
     });
    req.once('error',stop);req.end();
   }catch{stop();}
  });
 }});
}
export const createAuthTransport=(config,open=request)=>transport(config,open,'container');
export const createHostAuthTransport=(config,open=request)=>transport(config,open,'host');
export function verifiedAuth(transport) {
 return Object.freeze({async verifyTokenAndUser(token){
  const result=await transport.userOnce(token);
  if([401,403].includes(result.status)&&['bad_jwt','session_not_found'].includes(result.json?.error_code))return {error:{code:'IDENTITY_REQUIRED'}};
  if(result.status!==200)throw Error('AUTH_RESULT_UNKNOWN');
  // GoTrue authenticated this exact bearer before decode. Identity adapter checks
  // issuer, audience, UID, SID, exp and purpose; PostgREST independently verifies JWT.
  try {
   const parts=token.split('.');if(parts.length!==3)throw Error('TOKEN');
   const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
   const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
   if(header.alg!=='HS256'||header.typ!=='JWT'||!claims||Array.isArray(claims)||typeof claims!=='object')throw Error('TOKEN');
   return {data:{claims,user:result.json}};
  }catch{return {error:{code:'IDENTITY_REQUIRED'}};}
 }});
}
