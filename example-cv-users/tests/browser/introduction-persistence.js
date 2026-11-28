// Playwright CLI run-code. Use a fresh loopback Worker with introduction-rpc.mjs.
async page => {
  const origin = new URL(page.url()).origin;
  if (!/^https?:\/\/localhost:\d+$/.test(origin)) throw Error('Loopback fixture required');
  const path = '/api/sites/introduction';
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const save = page.getByRole('button', {name:'保存草稿', exact:true});
  const checkStatus = page.getByRole('button', {name:'核对保存结果', exact:true});
  const input = locale => page.locator('[data-edit-field="introduction"][data-edit-locale="' + locale + '"]');
  const state = message => page.getByRole('status').filter({hasText:message}).waitFor();
  const value = (locale, expected) => page.waitForFunction(({locale,expected}) =>
    document.querySelector('[data-edit-field="introduction"][data-edit-locale="' + locale + '"]')?.value === expected,
  {locale,expected});
  const sidebar = section => page.locator('.dashboard-sidebar a[href="#' + section + '"]');
  const sent = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith(path))
      sent.push({path:new URL(request.url()).pathname, body:request.postDataJSON()});
  });
  async function login(account) {
    await page.goto(origin + '/login');
    await page.locator('[name=email]').fill('user-' + account + '@example.invalid');
    await page.locator('[name=password]').fill('SYNTHETIC_REAL_ADAPTER_PASSWORD');
    await page.locator('form.account-form button[type=submit]').click();
    await page.waitForURL(origin + '/dashboard');
    await page.goto(origin + '/dashboard/editor#introduction');
    await input('en').waitFor();
  }
  page.on('dialog', dialog => dialog.accept());
  await page.setViewportSize({width:1440,height:900});
  await login('a');
  await page.waitForFunction(() => !document.querySelector('.editor-introduction fieldset')?.disabled);
  await value('zh','');
  check(!!await input('zh').getAttribute('placeholder'), 'The example should remain a placeholder');
  check(await save.isDisabled(), 'An untouched introduction allows a write');
  await sidebar('profile').click();
  const profile = page.locator('[data-edit-field="name"][data-edit-locale="zh"]');
  await profile.fill('未保存的其他栏目');
  await sidebar('introduction').click();
  await input('zh').fill('  第一次  ');
  await input('en').fill('  First English  ');
  await save.click();
  await state('正在核对保存回执');
  await page.locator('button.editor-save').evaluate(button => button.click());
  await input('zh').fill('在途继续编辑');
  await state('已保存个人介绍');
  await value('zh','在途继续编辑');
  await value('en','First English');
  check(sent.length === 1, 'Duplicate click sent a second command');
  check((await save.isEnabled()), 'Later edit was cleared');
  await sidebar('profile').click();
  check(await profile.inputValue() === '未保存的其他栏目', 'Other module lost edits');
  await sidebar('introduction').click();

  // Configure the synthetic transport to lose the first committed reply
  // whose Chinese payload is 在途继续编辑.
  await save.click();
  await state('保存结果待核对');
  check(await input('zh').inputValue() === '在途继续编辑', 'Unknown commit cleared draft');
  await checkStatus.click();
  await state('已保存个人介绍');
  check(sent.length === 3 && sent[2].path.endsWith('/operation') &&
    JSON.stringify(sent[2].body) === JSON.stringify(sent[1].body), 'Reconciliation did not use the original command');
  await sidebar('profile').click();
  await page.getByRole('button',{name:'撤销修改',exact:true}).click();
  await sidebar('introduction').click();
  await input('en').fill('');
  await save.click();
  await state('已保存个人介绍');
  await page.reload();
  await value('zh','在途继续编辑');
  await value('en','');
  check(await save.isDisabled(), 'Reload did not establish the persisted baseline');

  await page.goto(origin + '/account');
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await page.waitForURL(url => url.pathname === '/login');
  await login('b');
  await value('zh','合成乙');
  await value('en','Synthetic B');
  check(await save.isDisabled(), 'Bob inherited Alice draft state');
  return {read:'pass', atomicSave:'synthetic', duplicate:'pass', inFlight:'pass', originalKey:'pass',
    explicitClear:'pass', reload:'pass', switchAccount:'pass'};
}
