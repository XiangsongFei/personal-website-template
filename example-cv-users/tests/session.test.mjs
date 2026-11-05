import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,request,EMAIL,apiCount,names} from './helpers.mjs';
import {TEST_PASSWORD,TEST_ORIGIN} from './auth-fixture.mjs';
const header=ctx=>[...ctx.jar].map(([key,value])=>key+'='+value).join('; ');
test('private SSR isolates concurrent users and refreshed chunk cookies survive the next request',async()=>{
 const ctx=await setup({auth:{padding:10000}});try{
  await request(ctx,'login',{email:EMAIL,password:TEST_PASSWORD});
  const chunks=[...ctx.jar].filter(([key])=>key.startsWith(names.account)).sort(([a],[b])=>a.localeCompare(b));assert.ok(chunks.length>1);
  const text=chunks.map(([,value])=>decodeURIComponent(value)).join('');const value=JSON.parse(Buffer.from(text.slice(7),'base64url').toString());value.expires_at=1;
  for(const [key]of chunks)ctx.jar.delete(key);ctx.jar.set(names.account,encodeURIComponent('base64-'+Buffer.from(JSON.stringify(value)).toString('base64url')));ctx.auth.setPadding(0);
  assert.equal((await request(ctx,'session')).status,200);assert.equal(ctx.auth.events.filter(e=>e.grant==='refresh_token').length,1);
  assert.equal((await request(ctx,'session')).status,200);assert.equal(ctx.auth.events.filter(e=>e.grant==='refresh_token').length,1);
  const other={...ctx,jar:new Map()};await request(other,'login',{email:'user-b@example.invalid',password:TEST_PASSWORD});
  for(let round=0;round<2;round++){
   const results=await Promise.all([ctx,other].map(c=>ctx.mf.dispatchFetch(TEST_ORIGIN+'/account',{headers:{Cookie:header(c)}})));
   const html=await Promise.all(results.map(r=>r.text()));assert.match(html[0],/user-a@example.invalid/);assert.doesNotMatch(html[0],/user-b@example.invalid/);assert.match(html[1],/user-b@example.invalid/);assert.doesNotMatch(html[1],/user-a@example.invalid/);
  }
 }finally{await ctx.mf.dispose();}
});
test('wrong project configuration blocks Auth and callback query never performs PKCE exchange',async()=>{
 const ctx=await setup();try{
  for(const path of ['/reset-password?code=synthetic','/auth/callback?token_hash=synthetic&type=recovery']){const r=await ctx.mf.dispatchFetch(TEST_ORIGIN+path,{redirect:'manual'});assert.equal(r.status,303);assert.ok(!r.headers.get('location').includes('?'));}
  assert.equal(ctx.auth.events.length,0);
  const rejected=await ctx.mf.dispatchFetch('http://127.0.0.1:8795/api/account/session');assert.equal(rejected.status,421);
 }finally{await ctx.mf.dispose();}
 const wrong=await setup({runtime:{bindings:{USERS_MODE:'production',USERS_PROJECT_REF:'tkehttvppaqkybqehjbn',USERS_SUPABASE_URL:'https://tkehttvppaqkybqehjbn.supabase.co',USERS_APP_ORIGIN:TEST_ORIGIN,USERS_PUBLISHABLE_KEY:'sb_publishable_SYNTHETIC_REAL_CONTRACT_ONLY'}}});
 try{assert.equal((await request(wrong,'login',{email:EMAIL,password:TEST_PASSWORD})).status,503);assert.equal(wrong.auth.events.length,0);}finally{await wrong.mf.dispose();}
});
test('recovery state does not block normal login or another account, and email substitution is rejected',async()=>{
 const ctx=await setup();try{
  await request(ctx,'recovery-otp-send',{email:EMAIL});
  assert.equal((await request(ctx,'recovery-otp-verify',{email:'user-b@example.invalid',token:'012345'})).status,401);assert.equal(apiCount(ctx.auth,'POST','/auth/v1/verify'),0);
  assert.equal((await request({...ctx,jar:new Map()},'recovery-otp-send',{email:'user-b@example.invalid'})).status,200);
  assert.equal((await request({...ctx,jar:new Map()},'login',{email:EMAIL,password:TEST_PASSWORD})).status,200);
  const first={...ctx,jar:new Map(ctx.jar)};assert.equal((await request(first,'recovery-otp-verify',{email:EMAIL,token:'012345'})).status,200);
  const original={...ctx,jar:new Map(ctx.jar)};assert.equal((await request(original,'recovery-otp-verify',{email:EMAIL,token:'012345'})).status,401);
 }finally{await ctx.mf.dispose();}
});
