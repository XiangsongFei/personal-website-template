// One binding builder for startup, preflight and tests. Never changes application rules.
import {bindings,AUTH,ORIGIN} from './controlled-real.mjs';
import {RUN_LEASE_MAX_MS} from './approval-receipt.mjs';
import {runtime} from '../tests/runtime.mjs';
import {realAuthority,TEST_KEY,TEST_PASSWORD} from '../tests/auth-fixture.mjs';
export function runtimeBindings(batch,key,expiresAt,now=Date.now()){
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+RUN_LEASE_MAX_MS)throw Error('run_lease_duration_denied');
  return {...bindings(batch,key),USERS_CONTROLLED_EXPIRES_AT:String(expiresAt)};
}
export async function applicationPreflight({batch,expiresAt}){
  if(batch.profile==='recovery-only-v1'){const {recoveryPreflight}=await import('./recovery-preflight.mjs');return recoveryPreflight({workerBindings:runtimeBindings(batch,TEST_KEY,expiresAt)});}
  const auth=await realAuthority({url:AUTH});let requests=0,escaped=0;
  const mf=runtime({unsafeInspectDurableObjects:false,bindings:runtimeBindings(batch,TEST_KEY,expiresAt),serviceBindings:{USERS_CONTROLLED_EGRESS:async request=>{
    if(new URL(request.url).origin!==AUTH)throw Error('preflight_target_denied');requests++;return auth.fetch(request);
  }},outboundService:()=>{escaped++;throw Error('preflight_external_network_denied');}});
  try{
    await mf.ready;
    const response=await mf.dispatchFetch(ORIGIN+'/api/account/login',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({email:'user-a@example.invalid',password:TEST_PASSWORD}),redirect:'manual'});
    await response.arrayBuffer();
    if(response.status!==200)throw Error('application_configuration_preflight_failed_'+response.status);
    const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    if(!cookie)throw Error('preflight_cookie_missing');
    const account=await mf.dispatchFetch(ORIGIN+'/account',{headers:{Cookie:cookie},redirect:'manual'});await account.arrayBuffer();
    if(account.status!==200)throw Error('preflight_identity_failed');
    const logout=await mf.dispatchFetch(ORIGIN+'/api/account/logout',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Cookie:cookie},body:'{}',redirect:'manual'});await logout.arrayBuffer();
    if(logout.status!==200||escaped)throw Error('preflight_cleanup_failed');
    return {configurationAccepted:true,syntheticLoginStatus:response.status,protectedStatus:account.status,syntheticLogoutStatus:logout.status,syntheticUpstreamCalls:requests,realUpstreamCalls:0};
  }finally{await mf.dispose();}
}
