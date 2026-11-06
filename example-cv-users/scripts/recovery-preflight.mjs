// Entirely synthetic recovery through the built Worker/API and persistent SQLite DO.
import {mkdtempSync,rmSync} from 'node:fs';import {resolve} from 'node:path';
import {runtime} from '../tests/runtime.mjs';import {realAuthority,TEST_KEY,TEST_PASSWORD,TEST_OTP} from '../tests/auth-fixture.mjs';
import {AUTH,ORIGIN,PROJECT,sha} from './controlled-real.mjs';
export async function recoveryPreflight({workerBindings}){
  const email='user-a@example.invalid',password='SYNTHETIC_RECOVERY_Q2_ONLY',auth=await realAuthority({url:AUTH}),dir=mkdtempSync(resolve('.runtime/recovery-preflight-'));
  const categories={recover:0,verifyRecovery:0,passwordUpdate:0,passwordLogin:0,localLogout:0,getUser:0,jwks:0};
  let mf,requests=0,escaped=0,puts=0,claimedBeforePut=false;const jar=new Map();
  const grants=async()=>{const store=await mf.unsafeGetDurableObjectStorage('example-cv-users','RecoveryState',{name:'account:v1:'+sha(PROJECT+'\0'+email)});return (await store.exec("SELECT value FROM state WHERE key LIKE 'grant:%'")).map(r=>JSON.parse(r.value));};
  mf=runtime({unsafeInspectDurableObjects:true,resourcePersistencePath:resolve(dir,'state'),bindings:workerBindings,serviceBindings:{USERS_CONTROLLED_EGRESS:async request=>{
    if(new URL(request.url).origin!==AUTH)throw Error('preflight_target_denied');requests++;
    const u=new URL(request.url),category=u.pathname.endsWith('/recover')?'recover':u.pathname.endsWith('/verify')?'verifyRecovery':request.method==='PUT'?'passwordUpdate':u.pathname.endsWith('/token')?'passwordLogin':u.pathname.endsWith('/logout')?'localLogout':u.pathname.endsWith('/jwks.json')?'jwks':'getUser';categories[category]++;
    if(request.method==='PUT'){puts++;claimedBeforePut=(await grants()).some(g=>g.status==='attempted');if(!claimedBeforePut)throw Error('grant_not_claimed_before_put');}
    return auth.fetch(request);
  }},outboundService:()=>{escaped++;throw Error('preflight_external_network_denied');}});
  async function call(path,data){const response=await mf.dispatchFetch(ORIGIN+path,{method:data===undefined?'GET':'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},...(data===undefined?{}:{body:JSON.stringify(data)}),redirect:'manual'});await response.arrayBuffer();for(const c of response.headers.getSetCookie()){const p=c.split(';')[0],i=p.indexOf('=');if(/Max-Age=0(?:;|$)/.test(c))jar.delete(p.slice(0,i));else jar.set(p.slice(0,i),p.slice(i+1));}return response.status;}
  const expect=async(path,data,status=200)=>{const result=await call(path,data);if(result!==status)throw Error('recovery_preflight_api_failed_'+path+'_'+result);return result;};
  try{
    await mf.ready;await expect('/forgot-password');await expect('/api/account/recovery-otp-send',{email});await expect('/api/account/recovery-progress');await expect('/api/account/recovery-otp-verify',{email,token:TEST_OTP});await expect('/reset-password');await expect('/api/account/recovery-session');
    const ready=(await grants()).find(g=>g.status==='ready');if(!ready||ready.expires<Date.now()+590000)throw Error('preflight_ready_grant_missing');
    await expect('/api/account/reset-password',{newPassword:password,confirmNewPassword:password});
    if(!(await grants()).some(g=>g.status==='updated')||puts!==1)throw Error('preflight_grant_not_updated');
    const replay=await call('/api/account/reset-password',{newPassword:password,confirmNewPassword:password});if(replay<400||puts!==1)throw Error('preflight_replay_allowed');
    if(jar.size)throw Error('preflight_recovery_cookie_not_cleared');
    await expect('/api/account/login',{email,password});await expect('/account');await expect('/api/account/logout',{});await expect('/account',undefined,303);
    if(escaped||puts!==1)throw Error('preflight_isolation_failed');
    return {configurationAccepted:true,recoverySendStatus:200,recoveryVerifyStatus:200,sqliteGrantReady:true,claimedBeforePut,onePut:true,grantUpdated:true,replayDenied:true,newPasswordLoginStatus:200,syntheticLogoutStatus:200,postLogoutStatus:303,syntheticUpstreamCalls:requests,syntheticCategories:categories,realUpstreamCalls:0};
  }finally{await mf.dispose();rmSync(dir,{recursive:true,force:true});}
}
