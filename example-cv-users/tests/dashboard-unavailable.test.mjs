import assert from 'node:assert/strict';
import test from 'node:test';
import {TEST_ORIGIN, TEST_PASSWORD} from './auth-fixture.mjs';
import {EMAIL, request, setup} from './helpers.mjs';

for (const [fault, status] of [['limited', 429], ['network', 503]]) {
  test('Dashboard identity ' + fault + ' serves a bilingual, reloadable document without private content', async () => {
    const context = await setup();
    try {
      assert.equal((await request(context, 'login', {email: EMAIL, password: TEST_PASSWORD})).status, 200);
      context.auth.controls.user = fault;
      const cookie = Array.from(context.jar, ([name, value]) => name + '=' + value).join('; ');
      const response = await context.mf.dispatchFetch(TEST_ORIGIN + '/dashboard', {headers: {Cookie: cookie}, redirect: 'manual'});
      const html = await response.text();

      assert.equal(response.status, status);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.match(response.headers.get('vary') ?? '', /Cookie/i);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.match(html, /<main\b[^>]*class="auth-screen"/);
      assert.match(html, /role="alert"/);
      assert.match(html, /<a\b[^>]*href="\/dashboard"[^>]*>重新载入<\/a>/);
      assert.match(html, /<details lang="en"><summary>English<\/summary>/);
      assert.match(html, /<a\b[^>]*href="\/dashboard"[^>]*>Reload<\/a>/);
      assert.doesNotMatch(html, /user-a@example\.invalid|access_token|refresh_token|dashboard-sidebar/);
      assert.ok(!html.includes(context.auth.ids.A));
    } finally {
      await context.mf.dispose();
    }
  });
}
