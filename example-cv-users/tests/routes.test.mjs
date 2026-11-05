import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './runtime.mjs';
test('locked vinext build uses root routes in actual workerd', async () => {
  const mf=runtime();
  try {
    const req=p=>mf.dispatchFetch('http://localhost:8795'+p,{redirect:'manual'});
    const root=await req('/');assert.equal(root.status,307);assert.equal(new URL(root.headers.get('location'),'http://localhost:8795').pathname,'/login');
    for(const path of ['/user','/user/login','/overview','/profile']) assert.equal((await req(path)).status,404);
    for(const path of ['/login','/register','/verify-email','/forgot-password','/reset-password','/auth/callback']){const r=await req(path);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');}
    for(const path of ['/account','/change-password']){const r=await req(path);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login');}
    const page=await req('/login');assert.equal(page.status,200);
    const html=await page.text();assert.match(html,/Example CV/);
    const assets=[...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)].map(m=>m[1]);
    assert.ok(assets.length>0);
    for(const path of assets){assert.ok(path.startsWith('/_next/static/'),path);const r=await req(path);assert.equal(r.status,200);assert.doesNotMatch(r.headers.get('content-type')??'',/text\/html/);}
    const api=await req('/api/account/session');assert.equal(api.status,401);assert.equal((await api.json()).ok,false);
    for(const path of ['/api/account/not-an-action','/api/admin/v1/profile/save']){const r=await req(path);assert.equal(r.status,404);assert.match(r.headers.get('content-type'),/application\/json/);}
    assert.equal((await req('/login')).status,200);
  } finally { await mf.dispose(); }
});
