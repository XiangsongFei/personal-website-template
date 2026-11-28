import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from './helpers.mjs';
import {TEST_PASSWORD,TEST_ORIGIN} from './auth-fixture.mjs';
import {resumeTextRuntime} from './fixtures/resume-text-rpc.mjs';
import {emptyTextContent,textCommand,textCommandDigest} from '../lib/editor/resume-text.ts';

const apiPath='/api/sites/resume-text/';
const cookie=c=>[...c.jar].map(([k,v])=>k+'='+v).join('; ');
async function login(runtime, account='a') {
  const c={...runtime,jar:new Map()};
  assert.equal((await request(c,'login',{email:'user-'+account+'@example.invalid',password:TEST_PASSWORD})).status,200);
  const page=await c.mf.dispatchFetch(TEST_ORIGIN+'/dashboard/editor',{method:'HEAD',headers:{Cookie:cookie(c)}});
  c.scope=page.headers.get('x-workspace-draft-scope');
  assert.match(c.scope,/^[a-f0-9]{64}$/);
  return c;
}
const http=async(c,path,body,override={})=>{
  const response=await c.mf.dispatchFetch(TEST_ORIGIN+apiPath+path,{
    method:body?'POST':'GET',
    headers:{Cookie:cookie(c),'X-Workspace-Draft-Scope':c.scope,...(body?{Origin:TEST_ORIGIN,'Content-Type':'application/json'}:{}),...override},
    ...(body?{body:JSON.stringify(body)}:{})});
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.getSetCookie().length,0);
  return {status:response.status,value:await response.json()};
};
test('singular Worker read and private save protect callers, revisions and receipts',async t=>{
  const rt=await resumeTextRuntime();t.after(()=>rt.mf.dispose());
  const a=await login(rt),b=await login(rt,'b');
  const original=(await http(a,'profile')).value;
  assert.equal(original.revision,0);
  const body=textCommand({siteId:original.siteId,section:'profile',requestId:crypto.randomUUID(),expectedRevision:0,content:original.content});
  body.content.translations.zh.name='测试姓名';
  body.content.translations.en.name='Private test name';
  const digest=await textCommandDigest(body);
  const {content,...metadata}=body;
  rt.controls.lost=true;
  assert.equal((await http(a,'save',body)).value.code,'COMMIT_UNKNOWN');
  const receipt=await http(a,'operation',{...metadata,digest});
  assert.equal(receipt.status,200);
  assert.deepEqual(receipt.value.snapshot.content,content);
  assert.equal(receipt.value.snapshot.revision,1);
  assert.equal((await http(a,'save',body)).status,200);
  assert.equal(rt.writes,1);
  assert.equal((await http(a,'save',{...body,requestId:crypto.randomUUID()})).status,409);
  assert.equal((await http(a,'operation',{...metadata,digest:'c'.repeat(64)})).status,409);
  assert.equal((await http(b,'operation',{...metadata,digest})).status,403);
  assert.equal((await http(b,'save',body)).status,403);
  const bb=(await http(b,'profile')).value;
  assert.deepEqual(bb.content,emptyTextContent('profile'));
  assert.equal((await http(b,'profile',undefined,{'X-Workspace-Draft-Scope':a.scope})).status,409);
  assert.equal((await http(a,'save',body,{Origin:'https://other.invalid'})).status,403);
  rt.controls.denied.add(rt.auth.ids.A);
  assert.equal((await http(a,'operation',{...metadata,digest})).status,403);
});
test('ordinary worker instance leaves the new business route closed',async t=>{
  const rt=await resumeTextRuntime({enabled:false});t.after(()=>rt.mf.dispose());
  const a=await login(rt);
  assert.equal((await http(a,'profile')).status,404);
});

test('repeatable Worker persistence keeps per-site row identity, positions, order, and deletion atomic',async t=>{
  const rt=await resumeTextRuntime();t.after(()=>rt.mf.dispose());
  const a=await login(rt),b=await login(rt,'b');
  const first=(await http(a,'experience')).value;
  const second=(await http(b,'experience')).value;
  const body=(site,revision,entries)=>({siteId:site,section:'experience',expectedRevision:revision,requestId:crypto.randomUUID(),content:{entries}});
  const rows=['A','B','C'].map((title,position)=>({id:crypto.randomUUID(),position,translations:{zh:{title},en:{title}}}));
  const saved=await http(a,'save',body(first.siteId,0,rows));
  assert.equal(saved.status,200);
  assert.equal((await http(b,'save',body(second.siteId,0,[rows[0]]))).status,403);
  const reordered=[{...rows[2],position:0},{...rows[0],position:1}];
  const newer=await http(a,'save',body(first.siteId,1,reordered));
  assert.equal(newer.status,200);
  assert.deepEqual((await http(a,'experience')).value.content.entries,reordered);
  assert.deepEqual((await http(b,'experience')).value.content.entries,[]);
  assert.equal((await http(a,'save',body(first.siteId,1,rows))).status,409);
  assert.equal(rt.writes,2);
});
