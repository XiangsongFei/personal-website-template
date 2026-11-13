import {createR3Issuer,createRegisteredGrantService} from '../../../lib/business/r3-verifier.mjs';
import {need,DriverStop} from './state.mjs';
// Keep the REAL branded issuer/verification/registration pipeline pending at its
// repository boundary. No synthetic Grant DTO and no network on stage release.
// Only apply()'s CURRENT operation scope can dispatch the actual Grant request.
export async function stageRegistration({binding,identity,handle,receipt,intent,intentNamespace,key,registrar,clock=()=>Math.floor(Date.now()/1000)}){
 let readyResolve,readyReject,resultResolve,resultReject,proof,issued=false,cancelled=false;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const deferred=new Promise((resolve,reject)=>{resultResolve=resolve;resultReject=reject;});
 // Suppress a local cancellation before the repository boundary is entered;
 // the original Promise still rejects when/if the pipeline awaits it.
 deferred.catch(()=>{});
 const verifier=createRegisteredGrantService({binding,enabled:true,project:binding.project,identity,lookupKey:async()=>key,registrar,clock,repository:{grant:async(h,input)=>{need(h===handle&&!proof,'REGISTRATION_STAGE_SCOPE');proof=input.proof;readyResolve(proof);return deferred;}}});
 const issuer=createR3Issuer({binding,enabled:true,project:binding.project,identity,intent,intentNamespace,lookupSigningKey:async()=>key,verifier,clock});
 const pipeline=issuer.issue(handle,receipt).then(value=>({ok:true,value}),error=>{readyReject(error);return {ok:false,error};});
 await ready;
 return {
  proof,nativeVerified:true,
  async apply(dispatch){
   need(!issued&&!cancelled&&typeof dispatch==='function','GRANT_STAGE_ONCE');issued=true;
   try{const result=await dispatch(proof);resultResolve(result);}catch(error){resultReject(error);}
   const outcome=await pipeline;if(!outcome.ok)throw outcome.error;return outcome.value;
  },
  cancel(){if(!issued&&!cancelled){cancelled=true;resultReject(new DriverStop('LOCAL_GRANT_NOT_DISPATCHED'));}}
 };
}
