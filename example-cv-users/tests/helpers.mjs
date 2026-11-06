import assert from 'node:assert/strict';
import {runtime} from './runtime.mjs';
import {realAuthority,TEST_ORIGIN} from './auth-fixture.mjs';
export const EMAIL='user-a@example.invalid';
export const names={account:'__Host-ecv-users-session',recovery:'__Host-ecv-users-recovery',tx:'__Host-ecv-users-tx',grant:'__Host-ecv-users-grant'};
export async function setup(options={}){const auth=await realAuthority(options.auth);const mf=runtime({outboundService:r=>auth.fetch(r),...options.runtime});return{auth,mf,jar:new Map()};}
export async function request(ctx,action,data,options={}){
 const response=await ctx.mf.dispatchFetch(TEST_ORIGIN+'/api/account/'+action,{method:data===undefined?'GET':'POST',headers:{Origin:TEST_ORIGIN,'Content-Type':'application/json',Cookie:[...ctx.jar].map(([k,v])=>k+'='+v).join('; '),...options.headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const lines=response.headers.getSetCookie();
 for(const line of lines){assert.match(line,/; Secure; HttpOnly; SameSite=Lax/);assert.doesNotMatch(line,/Domain=/i);const [pair]=line.split(';'),i=pair.indexOf('=');if(/Max-Age=0(?:;|$)/.test(line))ctx.jar.delete(pair.slice(0,i));else ctx.jar.set(pair.slice(0,i),pair.slice(i+1));}
 const body=await response.json();return{status:response.status,body,lines};
}
export const apiCount=(auth,method,path)=>auth.events.filter(e=>e.method===method&&e.path===path).length;
export const hash=async s=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
export async function object(ctx,email=EMAIL){const key=await hash('isolated-users\0'+email);const ns=await ctx.mf.getDurableObjectNamespace('USERS_RECOVERY_STATE');return ns.get(ns.idFromName('account:v1:'+key));}
export async function recover(ctx,token='012345') {assert.equal((await request(ctx,'recovery-otp-send',{email:EMAIL})).status,200);const result=await request(ctx,'recovery-otp-verify',{email:EMAIL,token});assert.equal(result.status,200,result.body.message);assert.equal(result.body.next,'/reset-password');}
