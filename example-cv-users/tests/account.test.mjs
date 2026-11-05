import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,request,recover,EMAIL,apiCount,names} from './helpers.mjs';
import {TEST_PASSWORD,TEST_OTP,TEST_ORIGIN} from './auth-fixture.mjs';
const NEW='SYNTHETIC_NEW_PASSWORD_ONLY';
test('actual Worker: registration, confirmation, password login, refresh and local logout',async()=>{
 const ctx=await setup();try{
  const email='new-user@example.invalid';
  assert.equal((await request(ctx,'register',{email,password:TEST_PASSWORD,confirmPassword:TEST_PASSWORD})).status,200);
  assert.equal((await request(ctx,'resend-confirmation',{email})).status,429);
  const verification=await request(ctx,'verify-email',{email,token:TEST_OTP});
  assert.equal(verification.status,200);assert.equal(verification.body.next,'/account');
  assert.equal((await request(ctx,'session')).body.user.id,verification.body.user.id);
  assert.equal(ctx.auth.events.filter(e=>e.path.endsWith('/logout')).length,0);
  assert.equal((await request(ctx,'logout',{})).status,200);
  const login=await request(ctx,'login',{email,password:TEST_PASSWORD});assert.equal(login.status,200,login.body.message);assert.equal(login.body.user.email,email);
  assert.ok(login.lines.every(x=>x.startsWith(names.account)));assert.equal((await request(ctx,'session')).status,200);
  assert.equal((await request(ctx,'refresh',{})).status,200);
  const page=await ctx.mf.dispatchFetch(TEST_ORIGIN+'/account',{headers:{Cookie:[...ctx.jar].map(([k,v])=>k+'='+v).join('; ')},redirect:'manual'});
  assert.equal(page.status,200);assert.match(await page.text(),/new-user@example.invalid/);assert.equal(page.headers.get('cache-control'),'private, no-store');
  assert.equal((await request(ctx,'logout',{})).status,200);assert.equal((await request(ctx,'session')).status,401);
  assert.ok(ctx.auth.events.filter(e=>e.path.endsWith('/logout')).length===2);
 }finally{await ctx.mf.dispose();}
});
test('actual Worker: full recovery, one update, fresh new login and old password rejection',async()=>{
 const ctx=await setup();try{
  await recover(ctx);
  assert.equal((await request(ctx,'recovery-session')).status,200);
  const snapshot=new Map(ctx.jar);const update=await request(ctx,'reset-password',{newPassword:NEW});assert.equal(update.status,200,update.body.message);assert.equal(update.body.cleanup,false);
  assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),1);
  assert.equal((await request({...ctx,jar:snapshot},'reset-password',{newPassword:NEW})).status,401);
  const login=await request(ctx,'login',{email:EMAIL,password:NEW});assert.equal(login.status,200);assert.equal(login.body.user.id,ctx.auth.ids.A);assert.equal(login.body.user.email,EMAIL);
  assert.equal((await request(ctx,'logout',{})).status,200);
  const rejected=await request(ctx,'login',{email:EMAIL,password:TEST_PASSWORD});assert.equal(rejected.status,400);assert.equal(rejected.body.message,'账号或密码不正确，请重新输入。');
  assert.equal(ctx.auth.events.find(e=>e.path.endsWith('/verify')).otpType,'recovery');
 }finally{await ctx.mf.dispose();}
});
test('signed-in password change uses current password and consumes its operation before update',async()=>{
 const ctx=await setup();try{await request(ctx,'login',{email:EMAIL,password:TEST_PASSWORD});const old=new Map(ctx.jar);assert.equal((await request(ctx,'change-password',{currentPassword:TEST_PASSWORD,newPassword:NEW})).status,200);assert.equal((await request({...ctx,jar:old},'change-password',{currentPassword:TEST_PASSWORD,newPassword:NEW})).status,409);assert.equal((await request(ctx,'session')).status,200);assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),1);}finally{await ctx.mf.dispose();}
});
test('input, Origin, return URL, methods, old CMS API, cookies and friendly failure mapping',async()=>{
 const ctx=await setup();try{
  assert.equal((await request(ctx,'login',{email:EMAIL,password:TEST_PASSWORD},{headers:{Origin:'https://cms-admin.example-cv.com'}})).status,403);
  assert.equal((await request(ctx,'login',{email:EMAIL,password:TEST_PASSWORD,returnTo:'https://evil.invalid'})).status,400);
  assert.equal((await request(ctx,'logout')).status,405);
  assert.equal((await request(ctx,'reset-password',{newPassword:NEW})).status,401);
  assert.equal(ctx.auth.events.length,0);
  ctx.auth.controls.login='limited';assert.equal((await request(ctx,'login',{email:EMAIL,password:TEST_PASSWORD})).body.message,'操作太频繁，请稍后再试。');
  ctx.auth.controls.login='network';assert.equal((await request(ctx,'login',{email:EMAIL,password:TEST_PASSWORD})).body.message,'暂时无法连接，请稍后重试。');
  ctx.auth.controls.login='ok';ctx.jar.set('sb-tkehttvppaqkybqehjbn-auth-token','untrusted-cms-cookie');assert.equal((await request(ctx,'session')).status,401);
  const en=await request(ctx,'login',{email:EMAIL,password:'wrong'},{headers:{'X-Users-Language':'en'}});assert.match(en.body.message,/account or password is incorrect/);
 }finally{await ctx.mf.dispose();}
});
