// Playwright CLI run-code scenario for the isolated TLS fixture.
async page => {
  const base = new URL(page.url()).origin;
  if (!/^https:\/\/localhost:\d+$/.test(base)) throw Error('An isolated localhost TLS fixture is required');
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const prefix = await page.evaluate(() => /Firefox/.test(navigator.userAgent) ? 'firefox' :
    /Chrome/.test(navigator.userAgent) ? 'chrome' : 'webkit');
  const shot = name => page.screenshot({path: '.runtime/hotfix03/' + prefix + '-' + name + '.png'});
  const urls = [];
  const platforms = [];
  await page.context().route(/^https:\/\/(github\.com|www\.linkedin\.com)\/$/, route => {
    platforms.push(route.request().url());
    return route.fulfill({status: 200, body: 'Platform homepage navigation test'});
  });
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
  const exampleNodes = pane.locator('[data-preview-example], [data-preview-example-record], [data-preview-example-destination]');
  const unchanged = () => editor.getByRole('status').filter({hasText: '暂无修改'}).isVisible();
  await field('name', 'zh').waitFor();
  check(await field('name', 'zh').inputValue() === '' && await unchanged(), 'opening the guide dirtied the draft');
  check(await name.textContent() === '周晨' && await name.getAttribute('data-preview-example') === 'true', 'empty draft guide missing');
  check(await pane.locator('a[href^="mailto:"]:not([href="mailto:chen@example.org"]), [data-preview-project-url] a').count() === 0,
    'unexpected fictional destinations are actionable');
  check(!/平台示例|\bExample\b/.test(await pane.innerText()), 'visible platform badge remains');
  check(await name.textContent() === await field('name', 'zh').getAttribute('placeholder'), 'left and right Chinese name examples differ');
  check(platforms.length === 0, 'guide preloaded a platform');
  await follow('[data-preview-public-link="github"]', 'https://github.com/');
  await follow('[data-preview-public-link="linkedin-action"]', 'https://www.linkedin.com/');
  check(platforms.length === 2, 'unexpected platform navigation');
  check(await pane.locator('[data-preview-pdf-label] [aria-disabled="true"]').getByText('未开放', {exact: true}).isVisible(), 'PDF unavailable status is missing');
  const sampleInk = await name.evaluate(node => getComputedStyle(node).color);
  await shot('01-empty');
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);

  await exerciseMailto(pane.locator('[data-preview-public-link="contact-cta"] a'), 'mailto:chen@example.org');
  await pane.locator('[data-preview-nav="contact"]').click();
  await pane.locator('.public-contact-extension').waitFor();
  await exerciseMailto(pane.locator('[data-preview-public-link="email"] a'), 'mailto:chen@example.org');
  await section('awards');
  await page.waitForFunction(() => {
    const contact = document.querySelector('.public-contact-extension');
    const navBottom = document.querySelector('.site-preview-nav').getBoundingClientRect().bottom;
    const awardsTop = document.querySelector('[data-site-section="awards"]').getBoundingClientRect().top;
    return contact.hidden && Math.abs(awardsTop - navBottom) < 20;
  }, null, {timeout: 3000});
  await section('profile');

  await field('name', 'zh').fill('林禾');
  check(await name.textContent() === '林禾' && !await name.getAttribute('data-preview-example'), 'real display name did not replace its example');
  check(await name.evaluate(node => getComputedStyle(node).color) !== sampleInk, 'example and real content use the same color');
  check(!!await name.getAttribute('data-preview-edit-feedback'), 'real edit highlight missing');
  check(await name.evaluate(node => getComputedStyle(node).backgroundColor.startsWith('rgba(245, 183, 66,')), 'highlight is not amber');
  check(await pane.locator('[data-site-section="introduction"][data-preview-example]').count() === 1, 'name edit removed the introduction example');
  check(await pane.locator('[data-preview-example-record]').count() > 4, 'name edit erased other examples');
  await shot('02-partial');
  await language();
  check(await name.textContent() === 'Chen Zhou' && await name.getAttribute('data-preview-example') === 'true', 'Chinese edit leaked to English preview');
  check(await name.textContent() === await field('name', 'en').getAttribute('placeholder'), 'left and right English name examples differ');
  await field('name', 'en').fill('Alex Lin');
  await shot('03-english');
  check(await name.textContent() === 'Alex Lin' && !await name.getAttribute('data-preview-example'), 'English name did not update');
  await language();
  check(await name.textContent() === '林禾', 'English edit overwrote Chinese');
  await field('name', 'zh').fill('');
  check(await name.textContent() === '周晨' && await field('name', 'zh').getAttribute('placeholder') === '周晨', 'cleared name did not restore guidance');
  await shot('03b-cleared-name');
  await section('introduction');
  await section('profile');
  check(await name.textContent() === '周晨' && await field('name', 'zh').inputValue() === '', 'changing modules wrote an example into the draft');
  await sidebar.locator('.dashboard-brand').click();
  await page.waitForURL(base + '/dashboard');
  await sidebar.locator('a[href="/dashboard/editor#profile"]').click();
  await page.waitForURL(base + '/dashboard/editor#profile');
  check(await name.textContent() === '周晨' && await field('name', 'zh').inputValue() === '', 're-entering the editor wrote an example into the draft');
  await undo();
  check(await name.textContent() === '周晨' && await unchanged(), 'profile undo did not restore the original guidance');

  await field('graduationValue', 'shared').fill('2030');
  await field('avatarInitials', 'shared').fill('LH');
  for (const key of ['graduationValue', 'avatarInitials']) {
    const carrier = pane.locator('[data-preview-value="' + key + '"]');
    check(await carrier.locator('[data-preview-ink][data-preview-edit-feedback]').count() === 1, key + ' text highlight is missing');
    check(await carrier.evaluate(node => node.querySelector('[data-preview-ink]').getBoundingClientRect().width < node.getBoundingClientRect().width &&
      getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'), key + ' highlight covers its container');
  }
  await shot('07-amber-profile');
  await undo();
  await section('introduction');
  const introText = '我维护社区数据目录，与服务团队核对每个月的指标口径。确保双语报告长期可访问，并用测试结果持续改进。最后一行短。';
  await field('introduction', 'zh').fill(introText);
  const introInk = pane.locator('[data-preview-value="introduction"]');
  check(await introInk.textContent() === introText, 'real introduction did not replace the example');
  check(await introInk.evaluate(node => {
    const lines = Array.from(node.getClientRects());
    return lines.length > 1 && lines.at(-1).width < node.parentElement.getBoundingClientRect().width &&
      getComputedStyle(node.parentElement).backgroundColor === 'rgba(0, 0, 0, 0)';
  }), 'multiline intro highlight fills the block');
  await shot('08-amber-intro');
  await field('introduction', 'zh').fill('');
  check(await pane.locator('[data-site-section="introduction"][data-preview-example]').count() === 1 && await unchanged(),
    'cleared introduction did not restore guidance or was marked dirty');
  await section('education');
  await shot('04a-education-before');
  await editor.locator('.record-add').click();
  const education = pane.locator('[data-site-section="education"]');
  check(await education.locator('[data-preview-entry]').count() === 1 &&
    await education.locator('[data-preview-value="title"] [data-preview-example]').textContent() === await field('title', 'zh').getAttribute('placeholder'), 'new education did not display its own guidance');
  check(await field('title', 'zh').inputValue() === '', 'preview example entered the real row');
  await shot('04b-education-empty-row');
  await field('title', 'zh').fill('示范测试大学');
  check(await education.getByText('示范测试大学').count() === 1 && await education.locator('[data-preview-example-record]').count() === 0, 'real and fictional education records were mixed');
  check(await education.locator('[data-preview-value="period"] [data-preview-example]').count() === 1, 'example date disappeared after changing another field');
  await field('period', 'zh').fill('2030.09 – 2034.06');
  check(await education.locator('[data-preview-value="period"] [data-preview-edit-feedback]').count() === 1 &&
    await education.locator('[data-preview-value="period"] [data-preview-edit-feedback]').evaluate(node => node.getClientRects().length === 1), 'date highlight does not stay on one line');
  await shot('04-record');
  await language();
  check(await education.locator('[data-preview-example-record]').count() === 0, 'other locale restored the fictional collection');
  await language();
  await field('title', 'zh').fill('');
  check(await education.locator('[data-preview-value="title"] [data-preview-example]').textContent() === await field('title', 'zh').getAttribute('placeholder'),
    'cleared row text did not regain its guidance');
  await editor.locator('.record-delete').click();
  await editor.getByRole('button', {name: '确认删除'}).click();
  check(await education.locator('[data-preview-entry]').count() === 0 && await unchanged(), 'deleting the last real record restored the example');
  await shot('04c-education-deleted');
  await section('introduction');
  check(await pane.locator('[data-site-section="introduction"][data-preview-example]').count() === 1 &&
    await field('introduction', 'zh').inputValue() === '', 'switching modules wrote a guide paragraph into the draft');
  await section('education');
  await undo();
  await verifyHeadingsAndReveal();

  for (const [module, value] of [['experience', 'organization'], ['skills', 'items'], ['awards', 'name']]) {
    await section(module);
    await editor.locator('.record-add').click();
    const row = pane.locator('[data-site-section="' + module + '"] [data-preview-entry]');
    const input = field(value, 'zh');
    check(await row.count() === 1 && await input.inputValue() === '' &&
      await row.locator('[data-preview-value="' + value + '"] [data-preview-example]').textContent() === await input.getAttribute('placeholder'),
      module + ' preview does not correspond to its editable row');
    if (module === 'experience') {
      await field('description', 'zh').fill('第一项职责：与服务团队核对所有月报的统计口径，协调各团队改进数据收集流程。\n第二项职责：维护目录。');
      const bullets = row.locator('.public-bullets');
      check(await bullets.locator('li [data-preview-ink][data-preview-edit-feedback]').count() === 2 &&
        await bullets.evaluate(node => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'),
        'description highlight paints the list or misses a bullet');
      await shot('09-amber-description');
    }
    await undo();
  }
  await section('contact');
  for (const [group, name] of [['focus', '添加关注方向'], ['status', '添加状态']]) {
    await editor.getByRole('button', {name: new RegExp(name)}).click();
    const row = pane.locator('[data-preview-' + group + ']');
    const input = editor.locator('[data-edit-item^="' + group + ':"][data-edit-field="title"][data-edit-locale="zh"]');
    check(await row.count() === 1 && await input.inputValue() === '' &&
      await row.locator('[data-preview-value="title"] [data-preview-example]').textContent() === await input.getAttribute('placeholder'),
      group + ' preview does not correspond to its editable row');
  }
  await undo();

  await section('links', '#contact');
  await editor.locator('.link-display-toggle').click();
  for (const [fieldName, marker, previewField, label, home] of [
    ['githubLabel', 'github', 'githubLabel', '代码主页', 'https://github.com/'],
    ['linkedInLabel', 'linkedin-action', 'linkedInButtonLabel', '职业主页', 'https://www.linkedin.com/'],
  ]) {
    await field(fieldName, 'shared').fill(label);
    const action = pane.locator('[data-preview-public-link="' + marker + '"][data-preview-example-destination]');
    const ink = action.locator('[data-preview-value="' + previewField + '"]');
    check(await action.locator('a').getAttribute('href') === home && await ink.textContent() === label &&
      !await ink.getAttribute('data-preview-example') && !!await ink.getAttribute('data-preview-edit-feedback'),
      'real button label inherited its destination example');
  }
  await field('linkedInLabel', 'zh').fill('联系标签');
  await field('linkedInDisplayName', 'shared').fill('显示名称');
  for (const [key, label] of [['linkedInLabel', '联系标签'], ['linkedInDisplayName', '显示名称']]) {
    const ink = pane.locator('[data-preview-value="' + key + '"] [data-preview-ink]');
    check(await ink.textContent() === label && !await ink.getAttribute('data-preview-example') &&
      !!await ink.getAttribute('data-preview-edit-feedback'), 'real contact copy inherited its destination example');
  }
  await shot('05b-link-provenance');
  await undo();
  await field('github', 'shared').fill('https://example.net/acceptance/github');
  await field('email', 'shared').fill('alex+cv?@example.invalid');
  await field('linkedInHref', 'zh').fill('https://example.net/acceptance/linkedin-zh');
  await field('linkedInHref', 'en').fill('https://example.net/acceptance/linkedin-en');
  for (const key of ['githubLabel', 'linkedInButtonLabel']) {
    const ink = pane.locator('[data-preview-value="' + key + '"]');
    check(await ink.getAttribute('data-preview-example') === 'true' &&
      !await ink.getAttribute('data-preview-edit-feedback'), 'real URL marked an illustrative label as an edit');
  }
  check(urls.length === 0, 'preview preloaded an external destination');
  async function follow(marker, path) {
    const link = pane.locator(marker + ' a').first();
    const destination = path.startsWith('https:') ? path : 'https://example.net/acceptance/' + path;
    check(await link.getAttribute('href') === destination, 'wrong active destination: ' + path);
    check(await link.getAttribute('target') === '_blank' && await link.getAttribute('rel') === 'noopener noreferrer', 'unsafe link attributes');
    const [popup] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
    await popup.waitForURL(destination);
    check(await popup.evaluate(() => window.opener === null && document.referrer === ''), 'new tab can access the editor or its referrer');
    await popup.close();
  }
  await follow('[data-preview-public-link="github"]', 'github');
  await follow('[data-preview-public-link="linkedin-action"]', 'linkedin-zh');
  await language();
  await follow('[data-preview-public-link="linkedin-action"]', 'linkedin-en');
  await language();
  await home();
  const cta = pane.locator('[data-preview-public-link="contact-cta"] a');
  await exerciseMailto(cta);
  await pane.locator('[data-preview-nav="contact"]').click();
  await page.waitForFunction(() => {
    const bottom = document.querySelector('.site-preview-nav').getBoundingClientRect().bottom;
    const contactTop = document.querySelector('.public-contact').getBoundingClientRect().top;
    return Math.abs(contactTop - bottom) < 20;
  });
  check(await pane.locator('.public-contact-extension').isVisible(), 'contact action did not open contact details');
  async function exerciseMailto(link, address = 'mailto:alex%2Bcv%3F@example.invalid') {
    check(await link.getAttribute('href') === address, 'mailto payload is incorrect');
    check(await link.getAttribute('target') === null && await link.getAttribute('rel') === null, 'mailto does not use native navigation');
    await link.evaluate(node => node.addEventListener('click', event => {
      event.preventDefault(); window.__previewMailto = event.currentTarget.href;
    }, {once: true}));
    await link.click();
    check(await page.evaluate(() => {
      const intent = window.__previewMailto;
      delete window.__previewMailto;
      return intent;
    }) === address, 'mailto handler did not receive the encoded address');
  }
  await exerciseMailto(pane.locator('[data-preview-public-link="email"] a'));
  await shot('05-contact-links');
  await home();
  await page.waitForFunction(() => document.querySelector('.site-preview-viewport').scrollTop < 20);
  check(await field('github', 'shared').inputValue() === 'https://example.net/acceptance/github', 'external link wiped the draft');
  await field('github', 'shared').fill('https://user:password@example.net/acceptance/unsafe');
  check(await pane.locator('[data-preview-public-link="github"][aria-disabled="true"]').count() === 1, 'invalid address was clickable');
  await field('github', 'shared').fill('');
  check(await pane.locator('[data-preview-public-link="github"] a').count() === 0, 'cleared URL regained the platform example');
  await field('email', 'shared').fill('invalid');
  check(await pane.locator('[data-preview-public-link="contact-cta"][aria-disabled="true"]').getAttribute('title') === '请检查编辑区的公开邮箱地址。',
    'invalid email did not disable the hero action');
  await field('email', 'shared').fill('');
  check(await pane.locator('a[href^="mailto:"]').count() === 0, 'clearing a real email reactivated the guidance address');
  check(urls.length === 3, 'invalid or example link loaded unexpectedly');

  await section('projects');
  await editor.locator('.record-add').first().click();
  const project = pane.locator('[data-site-section="projects"] [data-preview-entry]');
  check(await project.locator('[data-preview-value="title"] [data-preview-example]').textContent() === await field('title', 'zh').getAttribute('placeholder'),
    'empty project guidance is missing');
  await editor.locator('[data-method-locale="zh"] .record-add').click();
  const method = editor.locator('[data-edit-field^="method:zh:"]');
  check(await project.locator('[data-preview-method] [data-preview-example]').textContent() === await method.getAttribute('placeholder'),
    'project method guidance is missing');
  await method.fill('访谈');
  check(await project.locator('[data-preview-method]').textContent() === '访谈', 'real method did not replace its guidance');
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
  async function verifyHeadingsAndReveal() {
    const headings = {
      education: 'educationLabel', experience: 'experienceLabel', projects: 'projectHeading', skills: 'skillsLabel', awards: 'honorsLabel',
    };
    const aligned = (section, key) => page.waitForFunction(({section, key}) => {
      const nav = document.querySelector('.site-preview-nav').getBoundingClientRect();
      const frame = document.querySelector('.site-preview-viewport').getBoundingClientRect();
      const target = document.querySelector('[data-site-section="' + section + '"] [data-preview-value="' + key + '"]')?.getBoundingClientRect();
      return target && target.top >= nav.bottom + 4 && target.bottom <= frame.bottom + 1;
    }, {section, key}, {timeout: 3000});
    for (const [module, heading] of Object.entries(headings)) {
      await section(module);
      const title = pane.locator('h2[data-preview-value="' + heading + '"]');
      check(await field(heading, 'zh').getAttribute('placeholder') === await title.textContent(), module + ' title is missing guidance');
      await field(heading, 'zh').fill('测试栏目 ' + module);
      check(await title.textContent() === '测试栏目 ' + module && await title.locator('[data-preview-edit-feedback]').count() === 1,
        module + ' custom title or highlight did not update');
      check(await editor.getByRole('status').filter({hasText: '请检查英文'}).isVisible(), module + ' is missing the English review reminder');
      await aligned(module, heading);
      await field(heading, 'en').fill('Custom heading: ' + module);
      await language();
      check(await title.textContent() === 'Custom heading: ' + module, module + ' English heading is out of sync');
      await language();
    }
    await section('site-text', '#contact');
    check(await field('educationLabel', 'zh').inputValue() === '测试栏目 education', 'centralized title editor is out of sync');
    await field('educationLabel', 'en').fill('Education and training');
    await field('updatedAtLabel', 'zh').fill('更新于');
    await section('education');
    check(await field('educationLabel', 'en').inputValue() === 'Education and training', 'title change did not sync back to the module');
    await shot('04d-section-title');
    await page.setViewportSize({width: 1250, height: 530});
    await editor.locator('.record-add').click();
    const school = field('title', 'zh');
    await school.fill('用于检测定位的学校名称'.repeat(3));
    await school.blur();
    await pane.evaluate(node => { node.scrollTop = 0; });
    await school.focus();
    await aligned('education', 'title');
    const currentTop = () => pane.evaluate(node => node.scrollTop);
    const initialTop = await currentTop();
    await school.press('End');
    await school.pressSequentially('（第一校区）');
    check(Math.abs(await currentTop() - initialTop) < 2, 'continuing to type scrolled the preview');
    await pane.evaluate(node => {
      node.dispatchEvent(new WheelEvent('wheel', {bubbles: true}));
      node.scrollTop = 0;
    });
    await school.press('End');
    await school.pressSequentially('校');
    await aligned('education', 'title');
    await shot('04e-field-reveal');
    await undo();
    check(await field('educationLabel', 'zh').inputValue() === '' && await education.locator('[data-preview-example-record]').count() > 0,
      'module undo failed to restore both heading and records');
    await page.setViewportSize({width: 1440, height: 900});
    await section('site-text', '#contact');
    check(await field('updatedAtLabel', 'zh').inputValue() === '更新于' &&
      await field('projectHeading', 'zh').inputValue() === '测试栏目 projects', 'module undo reset another heading or website copy');
    await undo();
    check(await unchanged(), 'centralized text undo left phantom dirty sections');
  }
  return {browser: prefix, clickedDestinations: urls, platformHomepages: platforms, mailtoIntentChecked: true};
}
