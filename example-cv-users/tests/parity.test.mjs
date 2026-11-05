import test from 'node:test';
import assert from 'node:assert/strict';
import {maxHeaderSize} from 'node:http';
import {setup,request,recover,EMAIL,apiCount,hash,names} from './helpers.mjs';
import {TEST_PASSWORD,TEST_OTP,TEST_ORIGIN} from './auth-fixture.mjs';
const cookie = ctx => [...ctx.jar].map(([name,value])=>name+'='+value).join('; ');
const dbFor = async ctx => ctx.mf.unsafeGetDurableObjectStorage('example-cv-users','RecoveryState',
  {name:'account:v1:'+await hash('isolated-users\0'+EMAIL)});
const login = ctx => request(ctx,'login',{email:EMAIL,password:TEST_PASSWORD});

test('registration validates both inputs at the API before signup and limits unconfirmed login to verification',async()=>{
  const c=await setup();
  try{
    const email='new-account@example.invalid';
    for(const extra of [{},{confirmPassword:'different'},{confirmPassword:TEST_PASSWORD,password:'short'}]){
      assert.equal((await request(c,'register',{email,password:TEST_PASSWORD,...extra})).status,400);
    }
    assert.equal(apiCount(c.auth,'POST','/auth/v1/signup'),0);
    assert.equal((await request(c,'register',{email,password:TEST_PASSWORD,confirmPassword:TEST_PASSWORD})).body.next,'/verify-email');
    const pending=await request(c,'login',{email,password:TEST_PASSWORD});
    assert.deepEqual([pending.status,pending.body.code,pending.body.next],[400,'unconfirmed','/verify-email']);
    const count=apiCount(c.auth,'POST','/auth/v1/verify');
    for(const token of ['12a345','12345','1234567'])assert.equal((await request(c,'verify-email',{email,token})).status,400);
    assert.equal(apiCount(c.auth,'POST','/auth/v1/verify'),count);
  }finally{await c.mf.dispose();}
});
test('signup auto-login cannot accept a current recovery token and never returns an unverified account jar',async()=>{
  const c=await setup();
  try{
    await request(c,'recovery-otp-send',{email:EMAIL});
    const fail=await request(c,'verify-email',{email:EMAIL,token:TEST_OTP});
    assert.equal(fail.status,400);assert.equal(fail.body.code,'badCode');
    assert.equal(c.auth.events.at(-1).otpType,'signup');assert.equal((await request(c,'session')).status,401);
    assert.equal((await request(c,'recovery-otp-verify',{email:EMAIL,token:TEST_OTP})).status,200);
    assert.equal((await request(c,'verify-email',{email:EMAIL,token:TEST_OTP})).status,409);
    await request(c,'recovery-logout',{});
    const email='mixed-confirm@example.invalid';await request(c,'register',{email,password:TEST_PASSWORD,confirmPassword:TEST_PASSWORD});
    c.auth.controls.user='mixed'; c.auth.controls.logout='unknown';
    const mixed=await request(c,'verify-email',{email,token:TEST_OTP});
    assert.equal(mixed.status,403);assert.equal(mixed.lines.length,0);
    c.auth.controls.user='ok';assert.equal((await request(c,'session')).status,401);
  }finally{await c.mf.dispose();}
});
test('fresh signup session replaces stale chunks from a different account in the same browser',async()=>{
  const c=await setup();
  try{
    // Exercise real multi-cookie responses within this test client's HTTP header budget.
    await login(c);const email='other-confirm@example.invalid'; c.auth.setPadding(Math.min(12000, Math.floor(maxHeaderSize / 2)));
    await request(c,'register',{email,password:TEST_PASSWORD,confirmPassword:TEST_PASSWORD});
    const confirmed=await request(c,'verify-email',{email,token:TEST_OTP});
    assert.equal(confirmed.status,200);assert.equal(c.jar.has(names.account),false);
    assert.ok([...c.jar.keys()].filter(k=>k.startsWith(names.account+'.')).length >= 2);
    const session=await request(c,'session');assert.equal(session.body.user.email,email);assert.equal(session.body.user.id,confirmed.body.user.id);
  }finally{await c.mf.dispose();}
});
test('read-only recovery step survives reload and eviction; a lost grant, transaction or expired row cannot resume',async()=>{
  const c=await setup();
  try{
    assert.equal((await request(c,'recovery-progress')).body.step,'start');
    await request(c,'recovery-otp-send',{email:EMAIL});const start=new Map(c.jar);const sentBefore=c.auth.events.length;
    await c.mf.unsafeEvictDurableObject('example-cv-users','RecoveryState',{name:'account:v1:'+await hash('isolated-users\0'+EMAIL)});
    for(let i=0;i<3;i++){
      const r=await request(c,'recovery-progress');assert.equal(r.body.step,'verify');assert.equal(r.lines.length,0);
      assert.ok(r.body.retryAfter>0 && r.body.retryAfter<=60);assert.doesNotMatch(JSON.stringify(r.body),/example\.invalid|\d{6}/);
    }
    assert.equal(c.auth.events.length,sentBefore);
    assert.equal((await request(c,'recovery-otp-verify',{email:EMAIL,token:TEST_OTP})).status,200);
    assert.equal((await request(c,'recovery-progress')).body.step,'reset');
    assert.equal((await request({...c,jar:start},'recovery-progress')).status,401);
    const wrong=new Map(c.jar);wrong.set(names.tx,'x');assert.equal((await request({...c,jar:wrong},'recovery-progress')).status,401);
    const db=await dbFor(c);await db.exec("UPDATE state SET value=json_set(value,'$.expires',0) WHERE key LIKE 'tx:%'");
    assert.equal((await request(c,'recovery-progress')).status,401);
    assert.equal(apiCount(c.auth,'POST','/auth/v1/recover'),1);assert.equal(apiCount(c.auth,'PUT','/auth/v1/user'),0);
  }finally{await c.mf.dispose();}
});
test('SQLite rolling attempts block sending after budget exhaustion and preserve recent attempts when the oldest expires',async()=>{
  const c=await setup();
  try{
    await request(c,'recovery-otp-send',{email:EMAIL});
    for(let i=0;i<5;i++)assert.equal((await request(c,'recovery-otp-verify',{email:EMAIL,token:'999999'})).status,400);
    const db=await dbFor(c);await db.exec("UPDATE state SET value='0' WHERE key='lastSend'");
    assert.equal((await request(c,'recovery-otp-send',{email:EMAIL})).status,429);assert.equal(apiCount(c.auth,'POST','/auth/v1/recover'),1);
    const now=Date.now();const times=[now-601000,now-500000,now-400000,now-300000,now-200000];
    await db.exec("UPDATE state SET value=? WHERE key='attempts'",JSON.stringify({times,expires:now+400000}));
    assert.equal((await request(c,'recovery-otp-verify',{email:EMAIL,token:'999999'})).status,400);
    assert.equal((await request(c,'recovery-otp-verify',{email:EMAIL,token:'999999'})).status,429);
    const row=JSON.parse((await db.exec("SELECT value FROM state WHERE key='attempts'"))[0].value);
    assert.deepEqual(row.times.slice(0,4),times.slice(1));assert.equal(row.times.length,5);
    await db.exec("UPDATE state SET value=? WHERE key='attempts'",JSON.stringify({until:now+20000,count:5}));
    assert.equal((await request(c,'recovery-otp-verify',{email:EMAIL,token:'999999'})).status,429);
  }finally{await c.mf.dispose();}
});
test('refresh and private SSR distinguish upstream network/rate errors from an expired session without discarding a valid jar',async()=>{
  const c=await setup();
  try{
    await login(c);const before=cookie(c);
    for(const [mode,status,code] of [['network',503,'network'],['limited',429,'limited']]){
      c.auth.controls.refresh=mode;const failure=await request(c,'refresh',{});
      assert.deepEqual([failure.status,failure.body.code],[status,code]);assert.equal(cookie(c),before);
      c.auth.controls.refresh='ok';c.auth.controls.user=mode;
      const session=await request(c,'session');assert.deepEqual([session.status,session.body.code],[status,code]);
      const page=await c.mf.dispatchFetch(TEST_ORIGIN+'/account',{headers:{Cookie:cookie(c)},redirect:'manual'});
      assert.equal(page.status,status);assert.equal(page.headers.get('cache-control'),'private, no-store');
      assert.doesNotMatch(await page.text(),/user-a@example\.invalid/);c.auth.controls.user='ok';
    }
    assert.equal((await request(c,'session')).status,200);
    await request(c,'logout',{});assert.equal((await request(c,'session')).body.code,'expiredSession');
  }finally{await c.mf.dispose();}
});
test('ordinary change allows a deliberate correction, retains the authenticated user after success and denies replay',async()=>{
  const c=await setup();
  try{
    await login(c);const op=crypto.randomUUID(),fixed=crypto.randomUUID();
    const common={newPassword:TEST_PASSWORD+'-changed',confirmNewPassword:TEST_PASSWORD+'-changed'};
    const wrong=await request(c,'change-password',{currentPassword:'incorrect',operation:op,...common});
    assert.deepEqual([wrong.status,wrong.body.code,wrong.body.correctable],[422,'wrongCurrent',true]);
    assert.equal((await request(c,'session')).body.user.id,c.auth.ids.A);
    assert.equal((await request(c,'change-password',{currentPassword:TEST_PASSWORD,operation:op,...common})).status,409);
    const results=await Promise.all([1,2].map(()=>request({...c,jar:new Map(c.jar)},'change-password',{currentPassword:TEST_PASSWORD,operation:fixed,...common})));
    assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal(apiCount(c.auth,'PUT','/auth/v1/user'),2);
    assert.equal((await request(c,'session')).body.user.id,c.auth.ids.A);assert.equal(apiCount(c.auth,'POST','/auth/v1/logout'),0);
    assert.equal((await request(c,'logout',{})).status,200);
  }finally{await c.mf.dispose();}
});
test('ordinary change with a lost receipt does not reopen a claimed session even for a fresh operation ID',async()=>{
  const c=await setup();
  try{
    await login(c);const snapshot=new Map(c.jar);
    c.auth.controls.update='lost';c.auth.controls.logout='unknown';
    const data={currentPassword:TEST_PASSWORD,newPassword:TEST_PASSWORD+'-other',operation:crypto.randomUUID()};
    const uncertain=await request(c,'change-password',data);
    assert.deepEqual([uncertain.status,uncertain.body.code,uncertain.body.cleanup],[503,'updateUnknown',true]);
    const replay=await request({...c,jar:snapshot},'change-password',{...data,operation:crypto.randomUUID()});
    assert.equal(replay.status,409);assert.equal(apiCount(c.auth,'PUT','/auth/v1/user'),1);
    c.auth.controls.logout='ok';await request(c,'logout',{});
  }finally{await c.mf.dispose();}
});
test('an unconfirmed upstream current-password policy disables ordinary changes before any PUT',async()=>{
  const bindings={USERS_MODE:'isolated',USERS_PROJECT_REF:'isolated-users',USERS_SUPABASE_URL:'https://users.auth.example.invalid',
    USERS_APP_ORIGIN:TEST_ORIGIN,USERS_PUBLISHABLE_KEY:'sb_publishable_SYNTHETIC_REAL_CONTRACT_ONLY'};
  const c=await setup({auth:{requireCurrentPassword:false},runtime:{bindings}});
  try{await login(c);const r=await request(c,'change-password',{currentPassword:'wrong',newPassword:TEST_PASSWORD+'-other'});
    assert.equal(r.status,503);assert.equal(apiCount(c.auth,'PUT','/auth/v1/user'),0);
  }finally{await c.mf.dispose();}
});
