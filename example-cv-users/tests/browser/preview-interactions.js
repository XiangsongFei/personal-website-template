// Playwright CLI run-code scenario for the isolated TLS fixture.
async page => {
  const base = new URL(page.url()).origin;
  if (!/^https:\/\/localhost:\d+$/.test(base)) throw Error('An isolated localhost TLS fixture is required');
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const prefix = await page.evaluate(() => /Firefox/.test(navigator.userAgent) ? 'firefox' :
    /Chrome/.test(navigator.userAgent) ? 'chrome' : 'webkit');
  const shot = name => page.screenshot({path: '.runtime/hotfix02/' + prefix + '-' + name + '.png'});
  const urls = [];
  await page.context().route('https://example.net/acceptance/**', route => {
    urls.push(route.request().url());
    return route.fulfill({status: 200, body: 'Isolated browser-test destination'});
  });
  await page.setViewportSize({width: 1440, height: 900});
  await page.waitForFunction(() => Object.keys(document.querySelector('form.account-form') ?? {}).some(key => key.startsWith('__reactProps')));
  await page.locator('[name=email]').fill('user-a@example.invalid');
  await page.locator('[name=password]').fill('SYNTHETIC_REAL_ADAPTER_PASSWORD');
  await page.locator('form.account-form button[type=submit]').click();
  await page.waitForURL(base + '/dashboard');
  const sidebar = page.locator('.dashboard-sidebar');
  await sidebar.locator('a[href="/dashboard/editor#profile"]').click();
  const preview = page.locator('.editor-preview');
  const editor = page.locator('.resume-editor');
  const pane = page.locator('.site-preview-viewport');
  const name = pane.locator('#site-preview-name > span');
  const field = (key, locale) => editor.locator('[data-edit-field="' +
    (locale === 'shared' ? 'shared:' : '') + key + '"][data-edit-locale="' + locale + '"]');
  const section = async (module, href = '#' + module) => {
    await sidebar.locator('a[href="' + href + '"]').click();
    if (module !== href.slice(1)) await editor.locator('button[data-view-option="' + module + '"]').click();
    await page.waitForURL(base + '/dashboard/editor#' + module);
  };
  const home = () => pane.locator('[data-preview-nav="profile"]').click();
  const language = () => pane.locator('.public-nav-language').click();
  const undo = () => editor.getByRole('button', {name: '撤销修改'}).click();
  const exampleNodes = pane.locator('[data-preview-example], [data-preview-example-record]');
  const unchanged = () => editor.getByRole('status').filter({hasText: '暂无修改'}).isVisible();
  await field('name', 'zh').waitFor();
  check(await field('name', 'zh').inputValue() === '' && await unchanged(), 'opening the guide dirtied the draft');
  check(await name.textContent() === '周晨' && await name.getAttribute('data-preview-example') === 'true', 'empty draft guide missing');
  check(await pane.locator('a[href^="mailto:"], a[target="_blank"]').count() === 0, 'fictional destinations are actionable');
  const sampleInk = await name.evaluate(node => getComputedStyle(node).color);
  await shot('01-empty');
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);

  await field('name', 'zh').fill('林禾');
  check(await name.textContent() === '林禾' && !await name.getAttribute('data-preview-example'), 'real display name did not replace its example');
  check(await name.evaluate(node => getComputedStyle(node).color) !== sampleInk, 'example and real content use the same color');
  check(!!await name.getAttribute('data-preview-edit-feedback'), 'real edit highlight missing');
  check(await pane.locator('[data-site-section="introduction"][data-preview-example]').count() === 1, 'name edit removed the introduction example');
  check(await pane.locator('[data-preview-example-record]').count() > 4, 'name edit erased other examples');
  await shot('02-partial');
  await language();
  check(await name.textContent() === 'Chen Zhou' && await name.getAttribute('data-preview-example') === 'true', 'Chinese edit leaked to English preview');
  await field('name', 'en').fill('Alex Lin');
  await shot('03-english');
  check(await name.textContent() === 'Alex Lin' && !await name.getAttribute('data-preview-example'), 'English name did not update');
  await language();
  check(await name.textContent() === '林禾', 'English edit overwrote Chinese');
  await field('name', 'zh').fill('');
  check(await name.textContent() === '你的名字', 'active clear restored the fictional name');
  await undo();
  check(await name.textContent() === '周晨' && await unchanged(), 'profile undo did not restore the original guidance');

  await section('introduction');
  await field('introduction', 'zh').fill('我维护社区数据目录。');
  check(await pane.locator('[data-preview-value="introduction"]').textContent() === '我维护社区数据目录。', 'real introduction did not replace the example');
  await field('introduction', 'zh').fill('');
  check(await pane.locator('[data-preview-value="introduction"]').count() === 0 && await unchanged(), 'cleared introduction returned or was marked dirty');
  await section('education');
  await editor.locator('.record-add').click();
  await field('title', 'zh').fill('示范测试大学');
  const education = pane.locator('[data-site-section="education"]');
  check(await education.getByText('示范测试大学').count() === 1 && await education.locator('[data-preview-example-record]').count() === 0, 'real and fictional education records were mixed');
  check(await education.locator('[data-preview-value="period"]').count() === 0, 'example date filled a real record');
  await shot('04-record');
  await language();
  check(await education.locator('[data-preview-example-record]').count() === 0, 'other locale restored the fictional collection');
  await language();
  await editor.locator('.record-delete').click();
  await editor.getByRole('button', {name: '确认删除'}).click();
  check(await education.locator('[data-preview-entry]').count() === 0 && await unchanged(), 'deleting the last real record restored the example');
  await section('introduction');
  check(await pane.locator('[data-preview-value="introduction"]').count() === 0, 'switching modules lost the explicit clear');
  await undo();
  check(await pane.locator('[data-site-section="introduction"][data-preview-example]').count() === 1, 'undo did not restore the cleared example');

  await section('links', '#contact');
  await field('github', 'shared').fill('https://example.net/acceptance/github');
  await field('email', 'shared').fill('alex+cv?@example.invalid');
  await field('linkedInHref', 'zh').fill('https://example.net/acceptance/linkedin-zh');
  await field('linkedInHref', 'en').fill('https://example.net/acceptance/linkedin-en');
  check(urls.length === 0, 'preview preloaded an external destination');
  async function follow(marker, path) {
    const link = pane.locator(marker + ' a').first();
    check(await link.getAttribute('href') === 'https://example.net/acceptance/' + path, 'wrong active destination: ' + path);
    check(await link.getAttribute('target') === '_blank' && await link.getAttribute('rel') === 'noopener noreferrer', 'unsafe link attributes');
    const [popup] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
    await popup.waitForURL('https://example.net/acceptance/' + path);
    check(await popup.evaluate(() => window.opener === null && document.referrer === ''), 'new tab can access the editor or its referrer');
    await popup.close();
  }
  await follow('[data-preview-public-link="github"]', 'github');
  await follow('[data-preview-public-link="linkedin-action"]', 'linkedin-zh');
  await language();
  await follow('[data-preview-public-link="linkedin-action"]', 'linkedin-en');
  await language();
  await home();
  await pane.locator('button[data-preview-public-link="contact-cta"]').click();
  await page.waitForFunction(() => {
    const bottom = document.querySelector('.site-preview-nav').getBoundingClientRect().bottom;
    const contactTop = document.querySelector('.public-contact').getBoundingClientRect().top;
    return Math.abs(contactTop - bottom) < 20;
  });
  check(await pane.locator('.public-contact-extension').isVisible(), 'contact action did not open contact details');
  const email = pane.locator('[data-preview-public-link="email"] a');
  check(await email.getAttribute('href') === 'mailto:alex%2Bcv%3F@example.invalid', 'mailto payload is incorrect');
  await email.evaluate(node => node.addEventListener('click', event => {
    event.preventDefault(); window.__previewMailto = event.currentTarget.href;
  }, {once: true}));
  await email.click();
  check(await page.evaluate(() => window.__previewMailto) === 'mailto:alex%2Bcv%3F@example.invalid', 'mailto handler did not receive the encoded address');
  await shot('05-contact-links');
  await home();
  await page.waitForFunction(() => document.querySelector('.site-preview-viewport').scrollTop < 20);
  check(await field('github', 'shared').inputValue() === 'https://example.net/acceptance/github', 'external link wiped the draft');
  await field('github', 'shared').fill('https://user:password@example.net/acceptance/unsafe');
  check(await pane.locator('[data-preview-public-link="github"][aria-disabled="true"]').count() === 1, 'invalid address was clickable');
  check(urls.length === 3, 'invalid or example link loaded unexpectedly');

  await section('projects');
  await editor.locator('.record-add').click();
  await field('title', 'zh').fill('试验项目');
  await field('href', 'zh').fill('https://example.net/acceptance/project-zh');
  await field('href', 'en').fill('https://example.net/acceptance/project-en');
  await pane.locator('[data-preview-nav="projects"]').click();
  await follow('[data-preview-project-url]', 'project-zh');
  await language();
  await follow('[data-preview-project-url]', 'project-en');
  check(await preview.locator('[data-preview-pdf-label] a, a[download]').count() === 0, 'PDF became actionable');
  await preview.getByRole('button', {name: '隐藏示例'}).click();
  check(await exampleNodes.count() === 0 && await field('href', 'en').inputValue() !== '', 'hiding examples modified the draft');
  check(await pane.getAttribute('lang') === 'en', 'hiding examples reset preview language');
  await shot('06-hidden');
  await section('profile');
  check(await exampleNodes.count() === 0, 'changing modules reset the example toggle');
  check(await page.evaluate(() => performance.timeOrigin) === timeOrigin, 'preview interaction replaced the document');
  check(urls.length === 5, 'a destination was requested without an explicit click');
  return {browser: prefix, scenarios: 14, clickedDestinations: urls, mailtoIntentChecked: true};
}
