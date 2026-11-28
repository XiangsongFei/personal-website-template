// Playwright scenario against the in-memory resume-text HTTPS fixture.
/* eslint-disable @typescript-eslint/no-unused-expressions -- Playwright evaluates the function expression. */
async page => {
  const origin = new URL(page.url()).origin;
  if (!/^https:\/\/localhost:\d+$/.test(origin)) throw Error('Loopback only');

  const context = page.context();
  const check = (condition, message) => {if (!condition) throw Error(message);};
  const editor = origin + '/dashboard/editor#';
  const savePath = '/api/sites/resume-text/save';
  const operationPath = '/api/sites/resume-text/operation';
  const profileField = '[data-edit-field="name"][data-edit-locale="zh"]';
  const button = (tab, name) => tab.getByRole('button', {name, exact:true});
  const status = (tab, message) => tab.getByRole('status').filter({hasText:message}).waitFor({timeout:10000});
  const fieldValue = (tab, selector, expected) => tab.waitForFunction(
    ({selector,expected}) => document.querySelector(selector)?.value === expected, {selector,expected});
  const markers = tab => tab.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('ecv:pending-text:'))
    .map(key => JSON.parse(localStorage.getItem(key))));
  const login = async (tab, account) => {
    await tab.goto(origin + '/login');
    await tab.waitForFunction(() => document.readyState === 'complete');
    await tab.locator('[name=email]').fill('user-' + account + '@example.invalid');
    await tab.locator('[name=password]').fill('SYNTHETIC_REAL_ADAPTER_PASSWORD');
    await tab.locator('form.account-form button[type=submit]').click();
    await tab.waitForURL(origin + '/dashboard');
  };

  const saves = [];
  const operations = [];
  const observed = request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path === savePath) saves.push(request.postDataJSON());
    if (path === operationPath) operations.push(request.postDataJSON());
  };
  context.on('request', observed);
  const pendingResponses = new Map();
  const hold = async route => {
    const command = route.request().postDataJSON();
    const response = await route.fetch({maxRedirects:0});
    let release;
    const disposition = new Promise(resolve => {release=resolve;});
    pendingResponses.set(command.section, {response, release});
    const lose = await disposition;
    pendingResponses.delete(command.section);
    check(response.status() === 200, 'fixture save did not succeed');
    if (lose) await route.fulfill({response,status:503,json:{code:'SIMULATED_RESPONSE_LOSS'}});
    else await route.fulfill({response});
  };
  const waitHeld = async section => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (pendingResponses.has(section)) return pendingResponses.get(section);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw Error('No held response for ' + section);
  };

  await context.route(origin + savePath, hold);
  page.on('dialog', dialog => dialog.accept());
  const other = await context.newPage();
  other.on('dialog', dialog => dialog.accept());
  try {
    await login(page, 'a');
    await page.goto(editor + 'profile');
    await page.locator(profileField).fill('已提交字段');
    await button(page, '保存草稿').click();
    const first = await waitHeld('profile');
    await page.locator(profileField).fill('继续编辑的新文字');
    first.release(false);
    await status(page, '已保存草稿');
    await fieldValue(page, profileField, '继续编辑的新文字');
    await status(page, '未保存：个人资料');
    await button(page, '撤销修改').click();
    await fieldValue(page, profileField, '已提交字段');
    await status(page, '暂无修改');

    await other.goto(editor + 'experience');
    await other.locator('button.record-add').click();
    await other.locator('[data-edit-field="title"][data-edit-locale="zh"]').fill('第二标签页记录');
    await page.locator(profileField).fill('甲的待核对资料');
    await Promise.all([button(page,'保存草稿').click(),button(other,'保存草稿').click()]);
    const [profileReply,experienceReply] = await Promise.all([waitHeld('profile'),waitHeld('experience')]);
    profileReply.release(true);
    experienceReply.release(true);
    await Promise.all([status(page,'保存结果待核对'),status(other,'保存结果待核对')]);

    const pending = await markers(page);
    check(pending.length === 2 && pending.every(marker => Object.keys(marker).length === 5) &&
      new Set(pending.map(marker => marker.requestId)).size === 2, 'both operations did not retain distinct locators');
    check(!JSON.stringify(pending).includes('甲的待核对资料') && !JSON.stringify(pending).includes('第二标签页记录'),
      'private text escaped into locator storage');
    const profile = pending.find(marker => marker.section === 'profile');
    const experience = pending.find(marker => marker.section === 'experience');
    check(profile && experience, 'missing section-scoped locators');

    await page.reload();
    await fieldValue(page, profileField, '甲的待核对资料');
    check((await markers(other)).length === 2 && saves.length === 3, 'refresh wrote again or replaced another locator');
    await button(page,'核对保存结果').click();
    await status(page,'已保存草稿');
    check(operations.length === 1 && operations[0].requestId === profile.requestId &&
      operations[0].digest === profile.digest && !Object.hasOwn(operations[0],'content'), 'recovery did not use the original locator only');
    const remaining = await markers(other);
    check(remaining.length === 1 && remaining[0].requestId === experience.requestId, 'recovering one save removed the other locator');

    await other.reload();
    await other.getByText('第二标签页记录',{exact:true}).first().waitFor();
    await button(other,'核对保存结果').waitFor();
    check(saves.length === 3 && operations.length === 1, 'second refresh contacted a write or started recovery automatically');
    await page.goto(origin + '/account');
    await button(page,'退出登录').click();
    await page.waitForURL(origin + '/login');
    check((await markers(page)).length === 0, 'logout retained a previous account locator');
    await login(page,'b');
    await page.goto(editor + 'profile');
    await fieldValue(page,profileField,'');
    check((await markers(page)).length === 0 && saves.length === 3 && operations.length === 1,
      'new account inherited a locator or dispatched a write');
    return {inFlightEditRetained:true,distinctTabs:true,readOnlyRecovery:true,logoutClearedUnresolved:true};
  } finally {
    for (const reply of pendingResponses.values()) reply.release(false);
    await context.unroute(origin + savePath, hold);
    context.off('request', observed);
    await other.close();
  }
}
