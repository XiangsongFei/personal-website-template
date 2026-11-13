// Test-driver DTOs are checked by the SAME parser/handler as the application.
// This module has no transport, credentials, persistence or retry capability.
import {createInput,uuid} from '../../../lib/business/protocol.mjs';
import {createSiteService,createCandidateHandler} from '../../../lib/business/service.mjs';
import {need} from './state.mjs';
import {ALICE,CHARLIE} from './contract.mjs';
export const OUTER_ORIGIN='https://s34-driver.internal.test';
export function readRequest(rpc,fixture){
 const paths={get_my_site:['GET','/api/sites/mine'],read_introduction:['GET','/api/sites/'+fixture.actors.Alice.site+'/introduction'],read_create_operation:['POST','/api/sites/operations/read']};
 need(Object.hasOwn(paths,rpc),'DRIVER_READ_RPC');need(uuid(fixture.actors.Alice.site),'DRIVER_READ_TARGET');
 const [method,path]=paths[rpc],r=fixture.alice_receipt_read;
 const input=rpc==='read_create_operation'?createInput({schema_version:1,request_id:r.request_id,slug:r.slug,default_locale:r.default_locale}):null;
 return new Request(OUTER_ORIGIN+path,{method,headers:method==='POST'?{Origin:OUTER_ORIGIN,'Content-Type':'application/json'}:{},...(input?{body:JSON.stringify(input)}:{})});
}
// Both LiveHost.read and the offline end-to-end contract tests enter here.
export function dispatchOuterRead({rpc,fixture,identity,token,repository}){
 const handler=createCandidateHandler({origin:OUTER_ORIGIN,resolveAccount:()=>identity.verifyAccount(token),service:createSiteService({repository})});
 return handler(readRequest(rpc,fixture));
}
export function authControlRequest(action,{password,email,tokenHash,uid}={}){
 if(action==='updateExistingCredential'){need([ALICE,CHARLIE].includes(uid)&&typeof password==='string'&&password.length>=8,'DRIVER_CREDENTIAL_SCOPE');return {method:'PUT',path:'/auth/v1/admin/users/'+uid,body:{password}};}
 if(action==='resetAlice'){need(typeof password==='string'&&password.length>=8,'DRIVER_PASSWORD');return {method:'PUT',path:'/auth/v1/admin/users/'+ALICE,body:{password}};}
 if(action==='createCharlie'){need(typeof password==='string'&&password.length>=8&&email==='s34-charlie-20261112@example.test','DRIVER_CHARLIE');return {method:'POST',path:'/auth/v1/admin/users',body:{id:CHARLIE,email,password,email_confirm:true}};}
 if(action==='recover'){need(typeof email==='string'&&email.endsWith('@example.test'),'DRIVER_RECIPIENT');return {method:'POST',path:'/auth/v1/recover',body:{email}};}
 if(action==='verifyRecovery'){need(typeof tokenHash==='string'&&tokenHash.length>0,'DRIVER_RECOVERY_TOKEN');return {method:'POST',path:'/auth/v1/verify',body:{token_hash:tokenHash,type:'recovery'}};}
 need(false,'DRIVER_AUTH_ACTION');
}
