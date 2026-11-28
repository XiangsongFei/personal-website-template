import assert from 'node:assert/strict';
import test from 'node:test';
import {introductionRuntime} from './fixtures/introduction-rpc.mjs';
import {names, request} from './helpers.mjs';
import {TEST_ORIGIN, TEST_PASSWORD} from './auth-fixture.mjs';
import {introductionText, mergeSavedIntroduction, prepareIntroduction, parseSaveReceipt} from '../lib/editor/introduction-dto.ts';

const path = '/api/sites/introduction';
const scopeHeader = 'X-Workspace-Draft-Scope';
const cookies = c => [...c.jar].map(([k,v])=>k+'='+v).join('; ');
async function login(c, account = 'a') {
  assert.equal((await request(c,'login',{email:`user-${account}@example.invalid`,password:TEST_PASSWORD})).status,200);
  const dashboard = await c.mf.dispatchFetch(TEST_ORIGIN+'/dashboard/editor',{method:'HEAD',headers:{Cookie:cookies(c)}});
  c.scope = dashboard.headers.get(scopeHeader);
  assert.match(c.scope, /^[a-f0-9]{64}$/);
}
async function api(c, {body, reconcile, headers, method, target} = {}) {
  const r = await c.mf.dispatchFetch(TEST_ORIGIN + (target ?? path + (reconcile ? '/operation' : '')), {
    method: method ?? (body ? 'POST' : 'GET'), redirect:'manual',
    headers:{Cookie:cookies(c),[scopeHeader]:c.scope ?? '', ...(body ? {Origin:TEST_ORIGIN,'Content-Type':'application/json'} : {}),...headers},
    ...(body ? {body:typeof body === 'string' ? body : JSON.stringify(body)} : {}),
  });
  assert.equal(r.headers.get('cache-control'),'private, no-store');
  assert.equal(r.headers.getSetCookie().length,0);
  return {status:r.status, value:r.status === 204 || method === 'HEAD' ? null : await r.json()};
}
async function fixture(t, options) {
  const c = await introductionRuntime(options);
  t.after(()=>c.mf.dispose());
  return c;
}
async function draft(c) {
  const r = await api(c);
  assert.equal(r.status, 200);
  return r.value;
}
const prepare = (draft, zh = '合成中文', en = 'Synthetic English') =>
  prepareIntroduction(draft, {zh, en}, crypto.randomUUID());
const writeCount = c => c.hits.filter(hit=>hit.operation==='save_text_draft').length;

test('enabled fixture reads bilingual content, saves as one operation, and reopens the same canonical baseline', async t => {
  const c = await fixture(t);
  await login(c);
  const original = await draft(c);
  assert.deepEqual(introductionText(original),{zh:'',en:''});
  const attempt = prepare(original,' 合成中文 ',' Synthetic English ');
  c.controls.normalize = true;
  const response = await api(c,{body:attempt.body});
  assert.equal(response.status,200);
  const saved = await parseSaveReceipt(response.value,attempt);
  assert.deepEqual(introductionText(saved),{zh:'合成中文',en:'Synthetic English'});
  assert.equal(saved.revision,1);
  const website = await c.mf.dispatchFetch(TEST_ORIGIN+'/dashboard/website',{headers:{Cookie:cookies(c)}});
  assert.match(await website.text(), /我的网站/);
  assert.deepEqual(await draft(c), saved);
  const clear = prepare(saved,'','');
  const confirmedClear = await api(c,{body:clear.body});
  assert.equal(confirmedClear.status,200);
  assert.deepEqual(introductionText(await draft(c)),{zh:'',en:''});
  assert.deepEqual(c.sites.get(c.auth.ids.A).draft_revisions.at(-1).payload.entries[0].translations,{zh:'',en:''});
  assert.equal(writeCount(c),2);
  assert.ok(c.hits.filter(hit=>hit.args.input).every(hit=>!JSON.stringify(hit.args.input).includes('Add your introduction.')));
});

test('same key replays one transaction and rejects a different digest', async t => {
  const c = await fixture(t);
  await login(c);
  const original = await draft(c);
  const attempt = prepare(original);
  const results = await Promise.all([api(c,{body:attempt.body}),api(c,{body:attempt.body})]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);
  assert.deepEqual(results[0].value,results[1].value);
  const different = prepareIntroduction(original,{zh:'别的合成文字',en:'Another'},attempt.body.command.request_id);
  assert.deepEqual(await api(c,{body:different.body}),{status:409,value:{code:'REQUEST_CONFLICT'}});
  assert.equal(c.sites.get(c.auth.ids.A).operations.length,1);
});

test('competing keys respect CAS and an older persisted receipt cannot acknowledge the newer aggregate', async t => {
  const c = await fixture(t);
  await login(c);
  const original = await draft(c);
  const attempts = [prepare(original),prepare(original,'竞争','Competing')];
  const results = await Promise.all(attempts.map(attempt=>api(c,{body:attempt.body})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winning = attempts[results.findIndex(r=>r.status===200)];
  const latest = await draft(c);
  assert.equal((await api(c,{body:prepare(latest,'下一版本','Newer version').body})).status,200);
  assert.deepEqual(await api(c,{body:winning.body,reconcile:true}),{status:409,value:{code:'DRAFT_ADVANCED'}});
  assert.equal((await draft(c)).revision,2);
});

test('lost, missing, malformed and rolled-back replies need a same-key read-only reconciliation', async t => {
  const c = await fixture(t);
  await login(c);
  const original = await draft(c);
  const prior = prepare(original);
  c.controls.rollback = true;
  assert.equal((await api(c,{body:prior.body})).value.code,'COMMIT_UNKNOWN');
  assert.deepEqual(await draft(c),original);
  assert.equal((await api(c,{body:prior.body,reconcile:true})).value.code,'COMMIT_UNKNOWN');
  c.controls.rollback = false;
  c.controls.lost = true;
  const committed = prepare(original);
  assert.equal((await api(c,{body:committed.body})).value.code,'COMMIT_UNKNOWN');
  assert.equal((await api(c,{body:committed.body,reconcile:true})).value.state,'saved');
  c.controls.corrupt = true;
  const corrupt = prepare(await draft(c),'三','Three');
  assert.equal((await api(c,{body:corrupt.body})).value.code,'COMMIT_UNKNOWN');
  assert.equal((await api(c,{body:corrupt.body,reconcile:true})).value.requestId,corrupt.body.command.request_id);
  assert.equal(writeCount(c),3);
  assert.equal(c.sites.get(c.auth.ids.A).operations.length,2);
});

test('ownership, Session, Grant and request scope checks deny stale or foreign operations', async t => {
  const a = await fixture(t);
  const b = {...a,jar:new Map()};
  assert.deepEqual(await api(a),{status:401,value:{code:'IDENTITY_REQUIRED'}});
  await login(a);
  await login(b,'b');
  const original = await draft(a), foreign = prepare(original);
  const bDraft = await draft(b);
  assert.deepEqual(introductionText(bDraft),{zh:'合成乙',en:'Synthetic B'});
  assert.equal((await api(b,{body:foreign.body})).status,403);
  assert.equal((await api(b,{body:foreign.body,reconcile:true})).status,403);
  assert.equal((await api(b,{headers:{[scopeHeader]:a.scope},method:'HEAD'})).status,409);
  const wrongRecord = structuredClone(foreign.body);
  wrongRecord.command.payload.entries[0].id = bDraft.record.id;
  assert.equal((await api(a,{body:wrongRecord})).status,400);
  assert.equal((await api(a,{body:foreign.body,headers:{Origin:'https://different.example.invalid'}})).status,403);
  assert.equal((await api(a,{body:foreign.body,headers:{Origin:'null'}})).status,403);
  a.controls.denied.add(a.auth.ids.A);
  assert.equal((await api(a,{body:foreign.body})).status,403);
  assert.equal((await api(a)).status,403);
  const old = {...a,jar:new Map(a.jar)};
  assert.equal((await request(a,'logout',{})).status,200);
  assert.equal((await api(old,{body:foreign.body})).status,401);
  assert.equal(writeCount(a),0);
});

test('missing site, temporary read failure, empty content and default business closure stay distinct', async t => {
  const off = await fixture(t,{enabled:false});
  assert.equal((await api(off)).status,404);
  assert.equal(off.hits.length,0);
  const c = await fixture(t);
  await login(c);
  assert.equal((await draft(c)).state,'ready');
  c.sites.delete(c.auth.ids.A);
  assert.deepEqual(await draft(c),{state:'no-site'});
  c.controls.readsFail = true;
  assert.equal((await api(c)).status,503);
  assert.equal((await api(c,{target:path+'?mode=synthetic'})).status,404);
  assert.equal((await api(c,{body:'{"siteId":"x","siteId":"y","command":{}}'})).status,400);
});

test('saved fields use canonical text and leave edits made in flight dirty', () => {
  const saved={zh:'规范值',en:'canonical'};
  const submitted={zh:'待保存',en:'submitted'};
  assert.deepEqual(mergeSavedIntroduction({zh:'继续修改',en:'submitted'}, submitted, saved),{zh:'继续修改',en:'canonical'});
  assert.deepEqual(mergeSavedIntroduction({zh:'',en:'submitted'}, submitted, saved),{zh:'',en:'canonical'});
});


test('draft API leaves a rotating refresh token untouched and preserves the same scope after S2 renewal', async t => {
  const c = await fixture(t);
  await login(c);
  const attempt = prepare(await draft(c));
  const chunks = [...c.jar].filter(([key])=>key===names.account || key.startsWith(names.account+'.')).sort();
  const encoded = chunks.map(([,value])=>decodeURIComponent(value)).join('');
  const session = JSON.parse(Buffer.from(encoded.slice(7),'base64url').toString());
  session.expires_at = 1;
  for (const [key] of chunks) c.jar.delete(key);
  c.jar.set(names.account,encodeURIComponent('base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')));
  const expected = {status:503,value:{code:'SESSION_REFRESH_REQUIRED'}};
  assert.deepEqual(await api(c,{body:attempt.body}),expected);
  assert.deepEqual(await api(c),expected);
  assert.equal((await api(c,{method:'HEAD'})).status,503);
  assert.equal(c.auth.events.filter(e=>e.grant==='refresh_token').length,0);
  assert.equal(writeCount(c),0);
  assert.equal((await request(c,'session')).status,200);
  assert.equal(c.auth.events.filter(e=>e.grant==='refresh_token').length,1);
  assert.equal((await api(c,{method:'HEAD'})).status,200);
  assert.equal((await api(c,{body:attempt.body})).status,200);
  assert.equal(writeCount(c),1);
});

test('a reload can reconcile an original Introduction receipt without retaining text or replaying the save',async t=>{
  const a=await fixture(t,{receiptRecovery:true});
  await login(a);
  const original=await draft(a);
  const attempt=prepare(original,'提交后刷新','Reload after the lost reply');
  a.controls.lost=true;
  assert.equal((await api(a,{body:attempt.body})).value.code,'COMMIT_UNKNOWN');
  const marker={section:'introduction',siteId:attempt.body.siteId,requestId:attempt.body.command.request_id,
    expectedRevision:attempt.body.command.expected_draft_revision,digest:await attempt.digest};
  const target='/api/sites/resume-text/introduction-receipt';
  const confirmed=await api(a,{body:marker,target});
  assert.equal(confirmed.value.state,'saved');
  assert.equal(confirmed.value.draft.revision,1);
  assert.equal(confirmed.value.digest,marker.digest);
  assert.equal(writeCount(a),1);
  assert.equal((await api(a,{body:{...marker,digest:'c'.repeat(64)},target})).status,409);
  const otherSession={...a,jar:new Map()};
  await login(otherSession);
  assert.equal((await api(otherSession,{body:marker,target})).value.state,'unknown');
  await login(otherSession,'b');
  assert.equal((await api(otherSession,{body:marker,target})).status,403);
});
