// Playwright CLI run-code scenario. Open the isolated TLS fixture's /login
// in a fresh browser first. This scenario never runs against production.
async page => {
  const base = new URL(page.url()).origin;
  if (!/^https:\/\/localhost:\d+$/.test(base)) throw Error('An isolated localhost TLS fixture is required');
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const requests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === base) requests.push({method: request.method(), path: url.pathname, type: request.resourceType()});
  });
  await page.setViewportSize({width: 1440, height: 900});
  const navigation = page.locator('.dashboard-sidebar');
  const editor = page.locator('.resume-editor');
  const preview = page.locator('.editor-preview');
  const profile = page.locator('[data-edit-field="name"][data-edit-locale="zh"]');
  const waitForPath = path => page.waitForURL(base + path);
  async function login(email) {
    await page.locator('[name=email]').fill(email);
    await page.locator('[name=password]').fill('SYNTHETIC_REAL_ADAPTER_PASSWORD');
    await page.locator('form.account-form button[type=submit]').click();
    await waitForPath('/dashboard');
  }
  async function trace() {
    await page.evaluate(() => {
      const trace = window.__workspaceTest = {origin: performance.timeOrigin, events: [], initialShell: document.querySelector('.dashboard')};
      const record = type => trace.events.push(type);
      for (const type of ['popstate', 'hashchange', 'pagehide', 'pageshow']) window.addEventListener(type, () => record(type));
      new MutationObserver(records => {
        for (const entry of records) {
          if (entry.target === document.documentElement &&
              (entry.oldValue !== null || document.documentElement.hasAttribute('data-workspace-verifying'))) record('verifying');
        }
      }).observe(document.documentElement, {attributes: true, attributeOldValue: true, attributeFilter: ['data-workspace-verifying']});
      const sample = () => {
        const shell = document.querySelector('.dashboard');
        if (!shell || !shell.querySelector('.dashboard-header')?.getClientRects().length ||
            !shell.querySelector('.dashboard-sidebar')?.getClientRects().length ||
            getComputedStyle(shell).visibility !== 'visible') record('hidden-frame');
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  }
  async function observedSection(action, hash) {
    const before = requests.length;
    const start = await page.evaluate(() => window.__workspaceTest.events.length);
    await action();
    await waitForPath('/dashboard/editor#' + hash);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const sample = await page.evaluate(start => ({
      sameDocument: !!window.__workspaceTest && window.__workspaceTest.origin === performance.timeOrigin,
      sameShell: window.__workspaceTest?.initialShell === document.querySelector('.dashboard'),
      events: window.__workspaceTest?.events.slice(start),
    }), start);
    check(sample.sameDocument && sample.sameShell, hash + ' replaced the live editor shell');
    check(!sample.events.some(event => ['verifying', 'hidden-frame', 'pagehide', 'pageshow'].includes(event)), hash + ' had a hidden interval: ' + sample.events);
    check(!requests.slice(before).some(request => request.method === 'HEAD' || request.type === 'document' || request.path === '/dashboard/editor'), hash + ' issued a history or document request');
    return sample.events;
  }
  const sidebarSection = section => navigation.locator('a[href="#' + section + '"]').click();
  const tab = section => editor.locator('button[data-view-option="' + section + '"]');

  await page.goto(base + '/dashboard/editor#projects');
  await page.waitForURL(url => url.pathname === '/login');
  await login('user-a@example.invalid');
  await navigation.locator('a[href="/dashboard/editor#profile"]').click();
  await waitForPath('/dashboard/editor#profile');
  await profile.waitFor();
  check(await profile.inputValue() === '' && !!await profile.getAttribute('placeholder'), 'guidance was written into the field');
  check(await preview.getAttribute('data-preview-source') === 'guide', 'an empty draft did not show the guide');
  check(await preview.getByText('周晨', {exact: true}).count() > 0, 'Chinese example missing');
  check(await preview.locator('a[href^="https://example.org"], a[href^="mailto:"]').count() === 0, 'example contact links are active');
  await preview.locator('.public-nav-language').click();
  check(await preview.getByText('Chen Zhou', {exact: true}).count() > 0, 'English example missing');

  await trace();
  const lifecycle = {};
  for (const section of ['introduction', 'profile', 'education', 'experience', 'projects', 'skills', 'awards', 'contact']) {
    lifecycle[section] = await observedSection(() => sidebarSection(section), section);
  }
  for (const section of ['links', 'site-text', 'contact']) {
    lifecycle['tab-' + section] = await observedSection(() => tab(section).click(), section);
    check(await tab(section).getAttribute('aria-pressed') === 'true', 'contact tab selection does not match the URL');
  }
  lifecycle.back = await observedSection(() => page.goBack(), 'site-text');
  lifecycle.forward = await observedSection(() => page.goForward(), 'contact');

  await page.evaluate(() => { location.hash = 'introduction'; });
  await waitForPath('/dashboard/editor#introduction');
  await editor.getByRole('heading', {name: '个人介绍', exact: true}).waitFor();
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-workspace-verifying'));

  await observedSection(() => sidebarSection('education'), 'education');
  await editor.locator('.record-add').click();
  const program = editor.locator('[data-edit-field="program"][data-edit-locale="en"]');
  check(await program.inputValue() === '' && !!await program.getAttribute('placeholder'), 'new records did not keep placeholders separate');
  check(await preview.getAttribute('data-preview-source') === 'guide', 'adding an empty record replaced the guide');
  await editor.getByRole('button', {name: '撤销修改'}).click();

  await observedSection(() => sidebarSection('profile'), 'profile');
  await profile.fill('我的实际姓名');
  check(await preview.getAttribute('data-preview-source') === 'draft', 'typing did not select the real draft');
  check(await preview.getByText('周晨', {exact: true}).count() === 0 && await preview.getByText('Chen Zhou', {exact: true}).count() === 0, 'real draft and guide were mixed');
  await preview.getByRole('button', {name: '查看填写示例'}).click();
  check(await preview.getAttribute('data-preview-source') === 'guide' && await profile.inputValue() === '我的实际姓名', 'reopening the example changed the draft');
  await preview.getByRole('button', {name: '查看我的草稿'}).click();
  await observedSection(() => sidebarSection('introduction'), 'introduction');
  await observedSection(() => sidebarSection('profile'), 'profile');
  check(await profile.inputValue() === '我的实际姓名' && await editor.getByText('请检查英文', {exact: true}).isVisible(), 'navigation lost draft or bilingual review');

  const documentOrigin = await page.evaluate(() => performance.timeOrigin);
  await navigation.locator('.dashboard-brand').click();
  await waitForPath('/dashboard');
  await navigation.locator('a[href="/dashboard/website"]').click();
  await waitForPath('/dashboard/website');
  await navigation.locator('a[href="/dashboard/editor#profile"]').click();
  await waitForPath('/dashboard/editor#profile');
  check(await profile.inputValue() === '我的实际姓名', 'cross-page navigation lost the draft');
  await page.locator('.dashboard-header .dashboard-account-link').click();
  await waitForPath('/account');
  await navigation.locator('a[href="/change-password"]').click();
  await waitForPath('/change-password');
  check(await page.evaluate(() => performance.timeOrigin) === documentOrigin, 'ordinary cross-route links reloaded the document');
  const beforeBack = requests.length;
  const identityCheck = page.waitForResponse(response => response.request().method() === 'HEAD' && new URL(response.url()).pathname === '/account');
  await page.goBack();
  await waitForPath('/account');
  check((await identityCheck).ok(), 'protected history failed to verify the current session');
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-workspace-verifying'));
  check(requests.slice(beforeBack).filter(request => request.method === 'HEAD' && request.path === '/account').length === 1, 'cross-path history should verify the identity once');
  await page.goForward();
  await waitForPath('/change-password');
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-workspace-verifying'));

  const secondTab = await page.context().newPage();
  await secondTab.goto(base + '/account');
  await secondTab.getByRole('button', {name: '退出登录'}).click();
  await secondTab.waitForURL(base + '/login');
  await secondTab.close();
  const beforeRevocation = requests.length;
  await page.goBack();
  await waitForPath('/login');
  check(requests.slice(beforeRevocation).some(request => request.method === 'HEAD' && request.path === '/account'), 'revoked session missed the history guard');
  check(await page.locator('.dashboard').count() === 0, 'revoked history exposed the workspace');
  await login('user-b@example.invalid');
  await navigation.locator('a[href="/dashboard/editor#profile"]').click();
  await waitForPath('/dashboard/editor#profile');
  check(await profile.inputValue() === '' && await preview.getAttribute('data-preview-source') === 'guide', 'draft crossed accounts');

  const documentRestorations = [];
  page.on('console', message => {
    if (message.text() === 'workspace-bfcache-restored') documentRestorations.push('persisted');
  });
  await page.addInitScript(() => window.addEventListener('pageshow', event => {
    if (location.pathname === '/dashboard/editor' && event.persisted) console.debug('workspace-bfcache-restored');
  }));
  await page.goto(base + '/login');
  await page.goto(base + '/dashboard/editor#unknown');
  await profile.waitFor();
  await trace();
  await observedSection(() => sidebarSection('projects'), 'projects');
  await page.goto(base + '/login');
  await page.goto(base + '/dashboard/editor#projects');
  await editor.getByRole('heading', {name: '项目经历', exact: true}).waitFor();
  await page.goto(base + '/login');
  const revokeDocument = await page.context().newPage();
  await revokeDocument.goto(base + '/account');
  await revokeDocument.getByRole('button', {name: '退出登录'}).click();
  await revokeDocument.waitForURL(base + '/login');
  await revokeDocument.close();
  const revalidatedDocument = page.waitForRequest(request => request.resourceType() === 'document' && new URL(request.url()).pathname === '/dashboard/editor');
  await page.goBack();
  await revalidatedDocument;
  await page.waitForURL(url => url.pathname === '/login');
  check(await page.locator('.dashboard').count() === 0, 'document history exposed a revoked workspace');
  const browserRestoredFromBFCache = documentRestorations.length > 0;

  // Exercise persisted pageshow even when a particular browser declines to
  // keep a private, no-store page in its actual back-forward cache.
  await login('user-b@example.invalid');
  await navigation.locator('a[href="/dashboard/editor#profile"]').click();
  await waitForPath('/dashboard/editor#profile');
  await profile.waitFor();
  const restoredRequest = page.waitForRequest(request => request.resourceType() === 'document' && new URL(request.url()).pathname === '/dashboard/editor');
  const concealed = await page.evaluate(() => {
    const shell = document.querySelector('.dashboard');
    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
    return shell.hidden;
  });
  check(concealed, 'persisted pageshow did not conceal the old private shell synchronously');
  await restoredRequest;
  await profile.waitFor();
  return {browser: await page.evaluate(() => navigator.userAgent), lifecycle, directHash: true, guidance: true, crossRouteVerification: true, revocation: true, accountIsolation: true,
    documentHistoryProtected: true, browserRestoredFromBFCache, persistedPageGuard: true};
}
