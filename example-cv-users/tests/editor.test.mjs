import test from 'node:test';
import assert from 'node:assert/strict';
import {setup, request, EMAIL} from './helpers.mjs';
import {TEST_ORIGIN, TEST_PASSWORD} from './auth-fixture.mjs';
import {
  emptyDraft, cancelModule, INTRODUCTION_LIMIT, moduleFromHash, moduleIsDirty, validIntroduction,
} from '../lib/editor/draft.ts';

const editorPath = '/dashboard/editor';
function page(ctx, path = editorPath, options = {}) {
  const cookie = [...ctx.jar].map(([key, value]) => key + '=' + value).join('; ');
  return ctx.mf.dispatchFetch(TEST_ORIGIN + path, {
    ...options, redirect: 'manual', headers: {Cookie: cookie, ...options.headers},
  });
}
const login = ctx => request(ctx, 'login', {email: EMAIL, password: TEST_PASSWORD});

test('both bilingual drafts are independent and cancel affects just the selected module', () => {
  const draft = {...emptyDraft, profile: {...emptyDraft.profile, shared: {...emptyDraft.profile.shared, footerName: 'Local name'}},
    introduction: {zh: '示例', en: 'Example'}};
  assert.equal(moduleIsDirty(draft, 'profile'), true);
  assert.equal(moduleIsDirty(draft, 'introduction'), true);
  const cancelled = cancelModule(draft, 'introduction');
  assert.equal(moduleIsDirty(cancelled, 'introduction'), false);
  assert.deepEqual(cancelled.profile, draft.profile);
  assert.equal(draft.introduction.en, 'Example');
  assert.equal(moduleFromHash('#introduction'), 'introduction');
  assert.equal(moduleFromHash('#profile'), 'profile');
  assert.equal(moduleFromHash('#dashboard-main'), undefined);
});

test('a supplied editor baseline stays clean and discarding restores its original section', () => {
  const baseline = {...emptyDraft, introduction: {zh: '示例', en: 'Example'}};
  const edited = {...baseline, introduction: {...baseline.introduction, en: 'Revised'}};
  assert.equal(moduleIsDirty(baseline, 'introduction', baseline), false);
  assert.equal(moduleIsDirty(edited, 'introduction', baseline), true);
  assert.deepEqual(cancelModule(edited, 'introduction', baseline), baseline);
});

test('Introduction applies the candidate UTF-16 limit and rejects malformed scalar text', () => {
  assert.equal(validIntroduction('🌿'.repeat(INTRODUCTION_LIMIT / 2)), true);
  assert.equal(validIntroduction('🌿'.repeat(INTRODUCTION_LIMIT / 2) + 'x'), false);
  assert.equal(validIntroduction('示例\n<p>plain text</p>'), true);
  assert.equal(validIntroduction('bad\0text'), false);
  assert.equal(validIntroduction('\ud800'), false);
});

test('only a current server session can render the editor, including HEAD and RSC', async () => {
  const ctx = await setup();
  try {
    for (const [path, options] of [
      [editorPath], ['/dashboard%2feditor'], [editorPath, {method: 'HEAD'}],
      [editorPath + '?_rsc', {headers: {RSC: '1'}}],
    ]) {
      const response = await page(ctx, path, options);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/login');
      assert.doesNotMatch(await response.text(), /site-preview-page/);
    }
    assert.equal((await login(ctx)).status, 200);
    const response = await page(ctx);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('vary'), /cookie/i);
    const html = await response.text();
    for (const section of ['profile','introduction','education','experience','projects','skills','awards','contact']) {
      assert.match(html, new RegExp('data-site-section="' + section + '"'));
    }
    assert.deepEqual([...html.matchAll(/data-preview-nav="([^"]+)"/g)].map(match => match[1]),
      ['profile', 'experience', 'projects', 'skills', 'awards', 'contact']);
    assert.match(html, /class="public-hero"[^>]*data-site-section="profile"[\s\S]+?class="public-intro" data-site-section="introduction"/);
    const publicPage = html.split('class="site-preview-page public-canvas"')[1]?.split('class="public-preview-scroll-space"')[0];
    assert.ok(publicPage);
    assert.doesNotMatch(publicPage, /<iframe\b|<img\b|<time\b/);
    const previewLinks = [...publicPage.matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
    assert.deepEqual([...new Set(previewLinks.map(link => link.match(/href="([^"]+)"/)?.[1]))].sort(),
      ['https://github.com/', 'https://www.linkedin.com/', 'mailto:chen@example.org']);
    for (const link of previewLinks) {
      if (link.includes('mailto:')) assert.doesNotMatch(link, /\btarget=|\brel=/);
      else assert.match(link, /target="_blank" rel="noopener noreferrer"/);
    }
    assert.match(html, /class="editor-save [^"]*" disabled=""/);
    assert.doesNotMatch(html, /保存服务尚未开放|Saving is unavailable|editor-language|editor-preview-heading|本地预览 · 未保存、未发布/);
    assert.equal([...html.matchAll(/class="public-nav-language"/g)].length, 1);
    assert.doesNotMatch(html, /user-a@example\.invalid|已保存成功|已发布成功/);
    const sampleQuery = await page(ctx, editorPath + '?sample=1');
    assert.equal(sampleQuery.status, 200);
    assert.doesNotMatch(await sampleQuery.text(), /Lin Example|合成研究学院/);
    const stale = new Map(ctx.jar);
    assert.equal((await request(ctx, 'logout', {})).status, 200);
    assert.equal((await page({...ctx, jar: stale})).status, 303);
  } finally {
    await ctx.mf.dispose();
  }
});

test('identity errors remain errors and editor and business write paths remain closed', async () => {
  const ctx = await setup();
  try {
    assert.equal((await login(ctx)).status, 200);
    const requestsBefore = ctx.auth.events.length;
    for (const path of ['/api/sites', '/api/sites/mine', '/api/ai', '/api/upload', '/api/profile', '/api/publish']) {
      assert.equal((await page(ctx, path, {method: 'POST'})).status, 404);
    }
    assert.equal(ctx.auth.events.length, requestsBefore);
    assert.equal((await page(ctx, editorPath, {method: 'POST'})).status, 405);
    for (const [fault, status] of [['network', 503], ['limited', 429]]) {
      ctx.auth.controls.user = fault;
      const response = await page(ctx);
      assert.equal(response.status, status);
      assert.doesNotMatch(await response.text(), /site-preview-page/);
    }
  } finally {
    await ctx.mf.dispose();
  }
});
