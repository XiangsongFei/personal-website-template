import test from 'node:test';
import assert from 'node:assert/strict';
import {setup, request, EMAIL} from './helpers.mjs';
import {TEST_PASSWORD, TEST_ORIGIN} from './auth-fixture.mjs';

const cookie = c => [...c.jar].map(([k,v]) => k+'='+v).join('; ');
const page = (c, path='/dashboard', options={}) => c.mf.dispatchFetch(TEST_ORIGIN+path, {
  redirect:'manual', ...options, headers:{Cookie:cookie(c),...options.headers},
});
const login = async (c, email=EMAIL) => {
  const r=await request(c,'login',{email,password:TEST_PASSWORD});
  assert.equal(r.status,200);assert.equal(r.body.next,'/account'); // S2 destination stays intact.
};
function privateResponse(r,status=200) {
  assert.equal(r.status,status);
  assert.equal(r.headers.get('cache-control'),'private, no-store');
  assert.match(r.headers.get('vary')??'',/Cookie/i);
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');
}

test('Dashboard and descendant documents, HEAD and RSC requests require a server session',async()=>{
  const c=await setup();
  try {
    for(const path of ['/dashboard','/dashboard/','/dashboard/private','/dashboard?__rsc=synthetic','/%64ashboard','/dashboard%2fprivate','//dashboard']) {
      const r=await page(c,path);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login');
      assert.equal(r.headers.get('cache-control'),'private, no-store');assert.doesNotMatch(await r.text(),/工作区概览/);
    }
    assert.equal((await page(c,'/dashboard',{method:'HEAD'})).status,303);
    assert.equal((await page(c,'/dashboard',{headers:{RSC:'1'}})).status,303);
  } finally {await c.mf.dispose();}
});

test('verified S2 identity renders only foundation status and account links, with private headers',async()=>{
  const c=await setup();
  try {
    await login(c);
    const r=await page(c);privateResponse(r);const html=await r.text();
    for(const expected of ['工作区概览','账户设置','尚未开放','界面语言']) assert.ok(html.includes(expected),expected);
    assert.match(html,/href="\/account"/);
    assert.doesNotMatch(html,/user-a@example\.invalid|__Host-ecv-users|access_token|已保存到服务器|发布成功/);
    privateResponse(await page(c,'/dashboard',{method:'HEAD'}));
    const rsc=await page(c,'/dashboard',{headers:{RSC:'1'}});
    privateResponse(rsc,307);assert.equal(rsc.headers.get('location'),'/dashboard?_rsc');
    privateResponse(await page(c,'/dashboard?_rsc',{headers:{RSC:'1'}}));
    const account=await page(c,'/account');privateResponse(account);
    const accountHtml=await account.text();assert.match(accountHtml,/href="\/dashboard"/);assert.match(accountHtml,/href="\/change-password"/);
  } finally {await c.mf.dispose();}
});

test('upstream revoked session and post-logout stale cookies cannot render Dashboard',async()=>{
  const c=await setup();
  try {
    await login(c);const oldJar=new Map(c.jar);
    assert.equal((await request(c,'logout',{})).status,200);
    for(const jar of [c.jar,oldJar]) {
      const r=await page({...c,jar});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login');
      assert.doesNotMatch(await r.text(),/工作区概览/);
    }
  } finally {await c.mf.dispose();}
});

for(const [fault,status] of [['network',503],['limited',429]])test('identity '+fault+' keeps a retryable error, without a private shell or false empty website',async()=>{
  const c=await setup();
  try {
    await login(c);c.auth.controls.user=fault;
    const r=await page(c);privateResponse(r,status);assert.equal(r.headers.get('location'),null);
    const html=await r.text();assert.match(html,/重新载入/);assert.doesNotMatch(html,/工作区概览|尚未创建网站|user-a@example\.invalid/);
    c.auth.controls.user='ok';privateResponse(await page(c));
  } finally {await c.mf.dispose();}
});

test('separate accounts and anonymous requests do not inherit another request identity',async()=>{
  const c=await setup();
  try {
    await login(c);const a={...c,jar:new Map(c.jar)};
    const b={...c,jar:new Map()};await login(b,'user-b@example.invalid');
    const results=await Promise.all([page(a),page(b),page({...c,jar:new Map()})]);
    assert.deepEqual(results.map(r=>r.status),[200,200,303]);
    for(const r of results.slice(0,2)) {privateResponse(r);assert.doesNotMatch(await r.text(),/user-[ab]@example\.invalid/);}
  } finally {await c.mf.dispose();}
});

test('Dashboard does not enable business APIs or allow noncanonical hosts',async()=>{
  const c=await setup();
  try {
    await login(c);
    const before=c.auth.events.length;
    for(const path of ['/api/sites/mine','/api/sites','/api/admin/v1/profile/save','/api/ai','/api/files'])assert.equal((await page(c,path)).status,404);
    assert.equal(c.auth.events.length,before);
    assert.equal((await c.mf.dispatchFetch('http://127.0.0.1:8795/dashboard',{headers:{Cookie:cookie(c)}})).status,421);
    assert.equal((await page(c,'/dashboard',{method:'POST'})).status,405);
    assert.ok(c.auth.events.every(e=>e.path.startsWith('/auth/v1/')));
  } finally {await c.mf.dispose();}
});
