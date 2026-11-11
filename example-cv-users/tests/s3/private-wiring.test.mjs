// All calls are in-process streams and mock bindings; no listener, DNS, or PostgreSQL socket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createIdentityAdapter } from '../../lib/business/identity.mjs';
import {PROJECT} from './fixtures/binding.mjs';
import { privateOrigin, privateHost, authIssuer } from './fixtures/binding.mjs';
import { handlePrivateRpc, createPrivateRpcServer } from './fixtures/private-ingress.mjs';
import { createRpcRepository } from './fixtures/repository.mjs';

const uid='d33a0000-0000-4000-8000-000000000001', sid='d33a0000-0000-4000-8000-000000000002';
const token='synthetic.payload.offline', pin=Array(32).fill('AC').join(':');
function authFixture(amr='password'){
  const user={id:uid,is_anonymous:false,email_confirmed_at:'2026-01-01'};
  return createIdentityAdapter({issuer:authIssuer,clock:()=>500,auth:{
    async getClaims(value){return {data:{claims:value===token && {iss:authIssuer,aud:'authenticated',role:'authenticated',
      sub:uid,session_id:sid,exp:501,is_anonymous:false,amr:[{method:amr}]}}};},
    async getUser(value){return {data:{user:value===token && user}};}
  }});
}
const input={schema_version:1,request_id:uid,slug:'alice-test',default_locale:'zh'};
const proof={version:1,project:PROJECT,purpose:'business',action:'issue',event:'password-login',uid,session_id:sid,
  epoch:1,proof_id:uid,payload_digest:'0'.repeat(64),key_id:'offline',issued_at:500,expires_at:520};
function request(name='get_my_site',raw='{}',patch={}){
  const req=Readable.from([Buffer.from(raw)]);
  return Object.assign(req,{method:'POST',url:'/rpc/'+name,complete:true,
    rawHeaders:['Host',privateHost,'Content-Type','application/json','Authorization','Bearer '+token]},patch);
}
function transport(overrides={}){
  const calls=[];
  return {calls,peerFingerprint:pin,trustedFingerprint:pin,identity:authFixture(),signal:new AbortController().signal,
    send:async(name,body,bearer)=>{calls.push([name,body,bearer]);return {status:200,json:{schema_version:1}};},...overrides};
}
for(const [name,args] of Object.entries({get_my_site:{},read_create_operation:{input},create_site:{input},
  read_introduction:{target:uid},apply_business_grant:{envelope:{proof}}})){
  test('private peer, authenticated user, exact route '+name,async()=>{
    const ctx=transport(); const result=await handlePrivateRpc(request(name,JSON.stringify(args)),ctx);
    assert.equal(result.status,200); assert.deepEqual(ctx.calls,[[name,JSON.stringify(args),token]]);
  });
}
const rejected=[
 ['registrar route',request('register_business_ticket')],
 ['table',request('sites')],['query string',request('get_my_site?x=1')],
 ['GET',request(undefined,undefined,{method:'GET'})],['claimed uid',request('get_my_site',JSON.stringify({uid}))],
 ['claimed role',request('get_my_site',JSON.stringify({role:'authenticated'}))],
 ['declared verification',request('apply_business_grant','{"envelope":{"verified":true}}')],
 ['duplicate JSON',request('read_introduction','{"target":"'+uid+'","target":"'+uid+'"}')],
 ['wrong user',request('apply_business_grant',JSON.stringify({envelope:{proof:{...proof,uid:sid}}}))],
 ['wrong sid',request('apply_business_grant',JSON.stringify({envelope:{proof:{...proof,session_id:uid}}}))],
 ['wrong project',request('apply_business_grant',JSON.stringify({envelope:{proof:{...proof,project:'external'}}}))],
 ['overlong body',request('get_my_site',' '.repeat(8400))],
 ['missing peer',request(),{peerFingerprint:undefined}],
 ['other peer',request(),{peerFingerprint:Array(32).fill('AA').join(':')}],
 ['recovery',request(),{identity:authFixture('recovery')}],
 ['expired admission',request(),{signal:AbortSignal.abort()}],
 ['incomplete HTTP message',request(undefined,undefined,{complete:false})]
];
for(const [desc,key,value] of [['profile','Content-Profile','site_private'],['peer header','X-Client-Cert',pin],
 ['duplicate bearer','AUTHORIZATION','Bearer '+token],['admin API key','apikey','mock'],['GUC','request.jwt.claims','{}']]){
  const r=request();r.rawHeaders.push(key,value);rejected.push([desc,r]);
}
for(const [desc,req,overrides] of rejected){
  test('denied before upstream: '+desc,async()=>{
    const ctx=transport(overrides); const r=await handlePrivateRpc(req,ctx);
    assert.ok(r.status>=400);assert.equal(ctx.calls.length,0);
  });
}
test('upstream incomplete, redirect, unexpected 5xx or mismatched error status stays UNKNOWN once',async()=>{
  for(const sample of [[301,{}],[500,{code:'42501'}],[403,{code:'PT409'}],[200,null],null]){
    let calls=0;
    const ctx=transport({send:async()=>{calls++;if(!sample)throw Error('secret');return {status:sample[0],json:sample[1]};}});
    assert.deepEqual(await handlePrivateRpc(request(),ctx),{status:503,json:{code:'RESULT_UNKNOWN'}});
    assert.equal(calls,1);
  }
});
test('confirmed upstream refusal strips all diagnostic details',async()=>{
  const ctx=transport({send:async()=>({status:409,json:{code:'PT409',details:'sensitive'}})});
  assert.deepEqual(await handlePrivateRpc(request(),ctx),{status:409,json:{code:'PT409'}});
});
test('repository + authenticated private ingress preserve the original token, method and fixed destination',async()=>{
  const identity=authFixture(), peer=transport(), handle=await identity.verifyAccount(token);
  const config={enabled:true,project:PROJECT,endpoint:privateOrigin,identity,mtls:{async fetch(url,init){
    assert.equal(url,privateOrigin+'/rpc/get_my_site');assert.equal(init.redirect,'manual');
    assert.deepEqual(Object.keys(init.headers).sort(),['Authorization','Content-Type']);
    const req=request('get_my_site',init.body,{rawHeaders:['host',new URL(url).host,...Object.entries(init.headers).flat()]});
    const r=await handlePrivateRpc(req,peer);return Response.json(r.json,{status:r.status});
  }}};
  assert.deepEqual(await createRpcRepository(config).mine(handle),{schema_version:1});
  for(const endpoint of ['http://127.0.0.1:56321',privateOrigin+'/','https://other.invalid'])
    await assert.rejects(createRpcRepository({...config,endpoint}).mine(handle),{code:'NOT_CONFIGURED'});
  await assert.rejects(createRpcRepository(config).mine(await authFixture().verifyAccount(token)),{code:'IDENTITY_REQUIRED'});
  assert.equal(peer.calls.length,1);
  assert.throws(()=>createPrivateRpcServer(),{code:'NOT_CONFIGURED'});
});

test('actual PostgREST adapter uses only the fixed Unix socket, rebuilt profile and original JWT',async()=>{
  let calls=0;
  const open=(options,receive)=>{
    calls++;
    assert.equal(options.socketPath,'/run/ecv-s33a-internal/postgrest.sock');
    assert.equal(options.path,'/rpc/create_site');
    assert.equal(options.method,'POST'); assert.equal(options.agent,false);
    assert.deepEqual(options.headers,{'Content-Type':'application/json','Content-Profile':'site_api',
      'Accept-Profile':'site_api',Authorization:'Bearer '+token,'Content-Length':Buffer.byteLength(JSON.stringify({input}))});
    const outgoing=new EventEmitter();
    outgoing.end=body=>{
      assert.equal(body,JSON.stringify({input}));
      const reply=Readable.from([Buffer.from('{"ok":true}')]);
      receive(Object.assign(reply,{statusCode:200,headers:{'content-type':'application/json'},complete:true}));
    };
    return outgoing;
  };
  const ctx=transport({send:undefined,openUnixRequest:open});
  const result=await handlePrivateRpc(request('create_site',JSON.stringify({input})),ctx);
  assert.deepEqual(result,{status:200,json:{ok:true}});assert.equal(calls,1);
});
