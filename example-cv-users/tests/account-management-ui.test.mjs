import test from 'node:test';
import assert from 'node:assert/strict';
import {setup, request, EMAIL} from './helpers.mjs';
import {TEST_ORIGIN, TEST_PASSWORD} from './auth-fixture.mjs';

const cookie = c => [...c.jar].map(([k,v])=>k+'='+v).join('; ');
const page = (c,path) => c.mf.dispatchFetch(TEST_ORIGIN+path,{redirect:'manual',headers:{Cookie:cookie(c)}});
async function login(c) {assert.equal((await request(c,'login',{email:EMAIL,password:TEST_PASSWORD})).status,200);}
function privatePage(r,status=200) {
  assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.match(r.headers.get('vary')??'',/Cookie/i);
}

test('anonymous account and password pages cannot render private account information',async()=>{
  const c=await setup();try {
    for(const path of ['/account','/change-password']) {
      const r=await page(c,path);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login');
      assert.equal(r.headers.get('cache-control'),'private, no-store');assert.doesNotMatch(await r.text(),/user-a@example\.invalid/);
    }
  }finally{await c.mf.dispose();}
});

test('verified account and password pages share the Dashboard and select the nested password page',async()=>{
  const c=await setup();try {
    await login(c);const r=await page(c,'/account');privatePage(r);const html=await r.text();
    assert.match(html,/<h1[^>]*>账户与安全<\/h1>/);assert.match(html,/user-a@example\.invalid/);assert.match(html,/邮箱已确认/);
    assert.doesNotMatch(html,/账户标识|Account identifier|identity-details|auth-screen/);
    assert.ok(!html.includes(c.auth.ids.A));
    assert.match(html,/class="dashboard-header"/);
    assert.match(html,/<a(?=[^>]*dashboard-nav-current")(?=[^>]*href="\/account")(?=[^>]*aria-current="page")/);
    for(const href of ['/dashboard','/change-password'])assert.ok(html.includes('href="'+href+'"'));
    for(const label of ['当前会话','刷新账户状态','退出登录'])assert.ok(html.includes(label));
    assert.doesNotMatch(html,/最近登录|Last signed in|全部设备|All devices/);
    const p=await page(c,'/change-password');privatePage(p);const form=await p.text();
    assert.match(form,/class="dashboard-header"/);
    assert.match(form,/<a(?=[^>]*dashboard-nav-parent")(?=[^>]*href="\/account")/);
    assert.match(form,/<a(?=[^>]*dashboard-nav-current")(?=[^>]*href="\/change-password")(?=[^>]*aria-current="page")/);
    assert.match(form,/dashboard-breadcrumb[^<]*>[\s\S]*?<a[^>]*href="\/account"[^>]*>账户与安全<\/a>[\s\S]*?修改密码/);
    assert.doesNotMatch(html,/返回工作台|account-workspace-back/);
    assert.doesNotMatch(html,/account-password-panel/);
    assert.match(form,/class="account-overview".+?user-a@example\.invalid.+?邮箱已确认/);
    assert.match(form,/class="account-password-panel".+?关闭修改密码/);
    assert.match(form,/class="account-password-actions"[\s\S]*?href="\/account"[\s\S]*?取消/);
    assert.doesNotMatch(form,/auth-screen/);
    for(const name of ['currentPassword','newPassword','confirmNewPassword'])assert.ok(form.includes('name="'+name+'"'));
    assert.match(form,/action="\/change-password"/);assert.match(form,/href="\/account"/);assert.match(form,/href="\/dashboard"/);
  }finally{await c.mf.dispose();}
});

test('temporary identity failures stay retryable and do not leak account data into either page',async()=>{
  const c=await setup();try {
    await login(c);
    for(const [fault,status] of [['network',503],['limited',429]]) {
      c.auth.controls.user=fault;
      for(const path of ['/account','/change-password']) {
        const r=await page(c,path);privatePage(r,status);assert.equal(r.headers.get('location'),null);
        const html=await r.text();assert.match(html,/重新载入/);assert.doesNotMatch(html,/user-a@example\.invalid/);assert.ok(!html.includes(c.auth.ids.A));
      }
    }
  }finally{await c.mf.dispose();}
});

test('refresh and logout retain the S2 APIs and stale cookies cannot reopen private account pages',async()=>{
  const c=await setup();try {
    await login(c);assert.equal((await request(c,'refresh',{})).body.user.email,EMAIL);const prior=new Map(c.jar);
    assert.equal((await request(c,'logout',{})).status,200);
    for(const jar of [c.jar,prior])for(const path of ['/account','/change-password','/dashboard']) {
      const r=await page({...c,jar},path);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login');
    }
  }finally{await c.mf.dispose();}
});
