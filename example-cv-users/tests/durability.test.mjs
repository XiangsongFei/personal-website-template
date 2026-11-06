import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setup,request,recover,EMAIL,apiCount,names,hash,object} from './helpers.mjs';
import {runtime} from './runtime.mjs';
const NEW='SYNTHETIC_DIFFERENT_PASSWORD';
test('synthetic upstream applies the 120-second code boundary to both signup and recovery',async()=>{
 let now=Date.now();const ctx=await setup({auth:{now:()=>now}});
 try{assert.equal((await request(ctx,'register',{email:'expiry@example.invalid',password:NEW,confirmPassword:NEW})).status,200);await request(ctx,'recovery-otp-send',{email:EMAIL});
  now+=120000;
  assert.equal((await request(ctx,'verify-email',{email:'expiry@example.invalid',token:'012345'})).status,400);
  assert.equal((await request(ctx,'recovery-otp-verify',{email:EMAIL,token:'012345'})).status,400);
  assert.equal(ctx.jar.has(names.grant),false);
 }finally{await ctx.mf.dispose();}
});
async function sql(ctx){const name='account:v1:'+await hash('isolated-users\0'+EMAIL);return ctx.mf.unsafeGetDurableObjectStorage('example-cv-users','RecoveryState',{name});}
test('real SQLite persistence survives workerd destruction, concurrent grant consumption enters one external update',async()=>{
 const dir=await mkdtemp(resolve('.runtime/persistence-'));const ctx=await setup({runtime:{resourcePersistencePath:dir}});
 try{
  await recover(ctx);const cookie=new Map(ctx.jar);await ctx.mf.dispose();
  assert.ok((await readdir(dir,{recursive:true})).some(x=>x.endsWith('.sqlite')));
  ctx.mf=runtime({resourcePersistencePath:dir,outboundService:r=>ctx.auth.fetch(r)});
  assert.equal((await request(ctx,'recovery-session')).status,200);
  const results=await Promise.all([1,2].map(()=>request({...ctx,jar:new Map(cookie)},'reset-password',{newPassword:NEW})));
  assert.deepEqual(results.map(x=>x.status).sort(),[200,401]);assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),1);
  await ctx.mf.dispose();ctx.mf=runtime({resourcePersistencePath:dir,outboundService:r=>ctx.auth.fetch(r)});
  assert.equal((await request({...ctx,jar:cookie},'reset-password',{newPassword:NEW})).status,401);assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),1);
 }finally{await ctx.mf.dispose();await rm(dir,{recursive:true,force:true});}
});
test('crash after durable claim and before external call does not re-open grant on workerd restart',async()=>{
 const dir=await mkdtemp(resolve('.runtime/interruption-'));const ctx=await setup({runtime:{resourcePersistencePath:dir}});
 try{await recover(ctx);const tx=ctx.jar.get(names.tx).split('.')[1];const digest=await hash(ctx.jar.get(names.grant));
  const row=JSON.parse((await(await sql(ctx)).exec("SELECT value FROM state WHERE key LIKE 'grant:%'"))[0].value);
  assert.equal(await(await object(ctx)).grant(digest,tx,row.user,row.session,true),true);
  await ctx.mf.dispose();ctx.mf=runtime({resourcePersistencePath:dir,outboundService:r=>ctx.auth.fetch(r)});
  assert.equal((await request(ctx,'reset-password',{newPassword:NEW})).status,401);assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),0);
 }finally{await ctx.mf.dispose();await rm(dir,{recursive:true,force:true});}
});
test('a lost update receipt remains consumed after a real workerd restart',async()=>{
 const dir=await mkdtemp(resolve('.runtime/unknown-restart-'));
 const ctx=await setup({runtime:{resourcePersistencePath:dir}});
 try{
  await recover(ctx);const originalCookies=new Map(ctx.jar);
  ctx.auth.controls.update='lost';
  const receipt=await request(ctx,'reset-password',{newPassword:NEW});
  assert.equal(receipt.body.code,'updateUnknown');
  assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),1);
  await ctx.mf.dispose();
  assert.ok((await readdir(dir,{recursive:true})).some(path=>path.endsWith('.sqlite')));
  ctx.mf=runtime({resourcePersistencePath:dir,outboundService:r=>ctx.auth.fetch(r)});
  const tx=originalCookies.get(names.tx).split('.')[1];
  const digest=await hash(originalCookies.get(names.grant));
  assert.equal(await(await object(ctx)).grant(digest,tx),false);
  const replay=await request({...ctx,jar:originalCookies},'reset-password',{newPassword:NEW});
  assert.equal(replay.status,401);
  assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),1);
 }finally{await ctx.mf.dispose();await rm(dir,{recursive:true,force:true});}
});
test('grant expiry is checked at use, independently of code expiry and alarm execution',async()=>{
 const ctx=await setup();try{await recover(ctx);const db=await sql(ctx);
  const rows=await db.exec("SELECT key,value FROM state WHERE key LIKE 'grant:%'");assert.equal(rows.length,1);assert.ok(JSON.parse(rows[0].value).expires>Date.now()+590000);
  const row=JSON.parse(rows[0].value);row.expires=Date.now()-1;await db.exec('UPDATE state SET value=? WHERE key=?',JSON.stringify(row),rows[0].key);
  assert.equal((await request(ctx,'reset-password',{newPassword:NEW})).status,401);assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),0);
 }finally{await ctx.mf.dispose();}
});
test('wrong, replaced, expired and used codes cannot issue a recovery grant; attempts persist',async()=>{
 const ctx=await setup();try{
  assert.equal((await request(ctx,'recovery-otp-send',{email:EMAIL})).status,200);
  const originalTx=new Map(ctx.jar);assert.equal((await request(ctx,'recovery-otp-send',{email:EMAIL.toUpperCase()})).status,429);
  assert.equal((await request(ctx,'recovery-otp-verify',{email:EMAIL,token:'999999'})).status,400);
  const db=await sql(ctx);await db.exec("UPDATE state SET value='0' WHERE key='lastSend'");ctx.auth.rotateCode();
  assert.equal((await request(ctx,'recovery-otp-send',{email:EMAIL})).status,200);
  assert.equal((await request({...ctx,jar:originalTx},'recovery-otp-verify',{email:EMAIL,token:'012345'})).status,401);
  assert.equal((await request(ctx,'recovery-otp-verify',{email:EMAIL,token:'012345'})).status,400);
  ctx.auth.expireCodes();assert.equal((await request(ctx,'recovery-otp-verify',{email:EMAIL,token:'654321'})).status,400);
  await ctx.mf.unsafeEvictDurableObject('example-cv-users','RecoveryState',{name:'account:v1:'+await hash('isolated-users\0'+EMAIL)});
  for(let i=0;i<2;i++)assert.equal((await request(ctx,'recovery-otp-verify',{email:EMAIL,token:'000000'})).status,400);
  assert.equal((await request(ctx,'recovery-otp-verify',{email:EMAIL,token:'000000'})).status,429);
  assert.equal(ctx.jar.has(names.grant),false);
 }finally{await ctx.mf.dispose();}
});
test('loss of transaction or recovery session and session substitution are safely denied',async()=>{
 const ctx=await setup();try{
  await recover(ctx);const good=new Map(ctx.jar);
  ctx.jar.delete(names.tx);assert.equal((await request(ctx,'reset-password',{newPassword:NEW})).status,401);
  ctx.jar=new Map(good);for(const key of ctx.jar.keys())if(key.startsWith(names.recovery))ctx.jar.delete(key);
  assert.equal((await request(ctx,'reset-password',{newPassword:NEW})).status,401);
  const ordinary={...ctx,jar:new Map()};await request(ordinary,'login',{email:'user-b@example.invalid',password:'SYNTHETIC_REAL_ADAPTER_PASSWORD'});
  for(const [key,value] of ordinary.jar)if(key.startsWith(names.account))ctx.jar.set(key.replace(names.account,names.recovery),value);
  assert.equal((await request(ctx,'reset-password',{newPassword:NEW})).status,401);
  ctx.jar=new Map(good);ctx.auth.controls.user='mixed';assert.equal((await request(ctx,'reset-password',{newPassword:NEW})).status,401);
  assert.equal(apiCount(ctx.auth,'PUT','/auth/v1/user'),0);
 }finally{await ctx.mf.dispose();}
});
