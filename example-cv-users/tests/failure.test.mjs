import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,request,recover,EMAIL,apiCount} from './helpers.mjs';
import {TEST_PASSWORD} from './auth-fixture.mjs';
const NEW='SYNTHETIC_UNCERTAIN_PASSWORD';
test('ordinary and email-confirmation logout failures retain their own cookie for explicit cleanup',async()=>{
 const ctx=await setup();try{
  await request(ctx,'login',{email:EMAIL,password:TEST_PASSWORD});ctx.auth.controls.logout='unknown';
  const failed=await request(ctx,'logout',{});assert.equal(failed.status,503);assert.equal(failed.body.cleanup,true);assert.equal((await request(ctx,'session')).status,200);
  ctx.auth.controls.logout='ok';assert.equal((await request(ctx,'logout',{})).status,200);assert.equal((await request(ctx,'session')).status,401);
  const email='cleanup-confirmation@example.invalid';await request(ctx,'register',{email,password:TEST_PASSWORD,confirmPassword:TEST_PASSWORD});ctx.auth.controls.logout='unknown';
  const verified=await request(ctx,'verify-email',{email,token:'012345'});assert.equal(verified.status,200);assert.equal(verified.body.next,'/account');
  const explicit=await request(ctx,'logout',{});assert.equal(explicit.status,503);assert.equal(explicit.body.cleanup,true);
  assert.equal((await request(ctx,'session')).body.user.email,email);
  ctx.auth.controls.logout='ok';assert.equal((await request(ctx,'logout',{})).status,200);assert.equal((await request(ctx,'session')).status,401);
 }finally{await ctx.mf.dispose();}
});
test('explicit recovery cancellation revokes the grant even when upstream logout is unconfirmed',async()=>{
 const ctx=await setup();try{await recover(ctx);const before=new Map(ctx.jar);ctx.auth.controls.logout='unknown';
  assert.equal((await request(ctx,'recovery-logout',{})).status,503);
  assert.equal((await request({...ctx,jar:before},'reset-password',{newPassword:NEW})).status,401);
  assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),0);
 }finally{await ctx.mf.dispose();}
});
for(const mode of ['lost','timeout','reject','limited'])test('password update '+mode+' never repeats the external operation',async()=>{
 const ctx=await setup();try{await recover(ctx);const previous=new Map(ctx.jar);ctx.auth.controls.update=mode;const start=Date.now();const r=await request(ctx,'reset-password',{newPassword:NEW});
  assert.equal(r.status,mode==='reject'?422:mode==='limited'?429:503);assert.equal(r.body.ok,false);assert.equal(r.body.cleanup,false);
  if(mode==='lost'||mode==='timeout')assert.match(r.body.message,/暂时无法确认密码是否已更新/);
  if(mode==='timeout'){assert.ok(Date.now()-start>=17500);assert.ok(Date.now()-start<23000);}
  assert.equal((await request({...ctx,jar:previous},'reset-password',{newPassword:NEW})).status,401);
  assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),1);
  if(mode==='lost'||mode==='timeout'){assert.equal((await request(ctx,'login',{email:EMAIL,password:NEW})).status,200);await request(ctx,'logout',{});assert.equal((await request(ctx,'login',{email:EMAIL,password:TEST_PASSWORD})).status,400);}
 }finally{await ctx.mf.dispose();}
});
test('unconfirmed recovery logout blocks independent login until explicit scoped cleanup succeeds',async()=>{
 const ctx=await setup();try{await recover(ctx);ctx.auth.controls.logout='unknown';const r=await request(ctx,'reset-password',{newPassword:NEW});assert.equal(r.status,200);assert.equal(r.body.cleanup,true);assert.equal(r.body.next,undefined);
  assert.equal((await request(ctx,'login',{email:EMAIL,password:NEW})).status,409);assert.equal(apiCount(ctx.auth,'POST','/auth/v1/token'),0);
  ctx.auth.controls.logout='ok';assert.equal((await request(ctx,'recovery-logout',{})).status,200);assert.equal((await request(ctx,'login',{email:EMAIL,password:NEW})).status,200);
 }finally{await ctx.mf.dispose();}
});
test('project / signed token identity / OTP AMR mismatch cannot authorize',async()=>{
 for(const auth of [{issuer:'https://wrong.auth.example.invalid/auth/v1'},{otpSessionMethod:'password'}]){const ctx=await setup({auth});try{await request(ctx,'recovery-otp-send',{email:EMAIL});assert.equal((await request(ctx,'recovery-otp-verify',{email:EMAIL,token:'012345'})).status,403);assert.equal((await request(ctx,'reset-password',{newPassword:NEW})).status,401);assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),0);}finally{await ctx.mf.dispose();}}
});
