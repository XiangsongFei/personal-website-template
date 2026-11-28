// Playwright scenario against an HTTPS loopback fixture.
/* eslint-disable @typescript-eslint/no-unused-expressions -- Playwright evaluates the function expression. */
async page => {
  const origin=new URL(page.url()).origin;
  if(!/^https:\/\/localhost:\d+$/.test(origin))throw Error('Loopback only');
  const check=(value,message)=>{if(!value)throw Error(message);};
  const expectValue=(selector,expected)=>page.waitForFunction(
    ({selector,expected})=>document.querySelector(selector)?.value===expected,{selector,expected});
  const status = message=>page.getByRole('status').filter({hasText:message}).waitFor({timeout:10000});
  const profileField='[data-edit-field="name"][data-edit-locale="zh"]';
  const profile=page.locator(profileField);
  const role=(name)=>page.getByRole('button',{name,exact:true});
  const save=()=>role('保存草稿').click();
  const select=section=>page.locator('.dashboard-sidebar a[href="#'+section+'"]').click();
  const title=page.locator('[data-edit-field="title"][data-edit-locale="zh"]');
  const add=page.locator('button.record-add');
  const rowTitles=()=>page.locator('.record-list .record-title > span:last-child').allTextContents();
  const seen=[];
  page.on('request',req=>{
    if(req.method()==='POST'&&new URL(req.url()).pathname.startsWith('/api/sites/resume-text/'))
      seen.push([new URL(req.url()).pathname,req.postDataJSON()]);
  });
  page.on('dialog', dialog=>dialog.accept());
  await page.setViewportSize({width:1440,height:900});
  const login=async account=>{
    await page.goto(origin+'/login');
    await page.waitForFunction(()=>document.readyState==='complete');
    await page.locator('[name=email]').fill('user-'+account+'@example.invalid');
    await page.locator('[name=password]').fill('SYNTHETIC_REAL_ADAPTER_PASSWORD');
    await page.locator('form.account-form button[type=submit]').click();
    await page.waitForURL(origin+'/dashboard');
    await page.goto(origin+'/dashboard/editor#profile');
  };
  await login('a');
  await profile.fill('合成甲');
  await save();
  await status('保存结果待核对');
  const markers=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('ecv:pending-text:')).map(k=>JSON.parse(localStorage.getItem(k))));
  check(markers.length===1&&Object.keys(markers[0]).length===5&&!JSON.stringify(markers).includes('合成甲'),'unsafe or missing locator');
  await page.reload();
  await expectValue(profileField,'合成甲');
  await role('核对保存结果').click();
  await status('已保存草稿');
  check(seen.length===2&&seen[0][0].endsWith('/save')&&seen[1][0].endsWith('/operation')&&
    seen[0][1].requestId===seen[1][1].requestId&&!Object.hasOwn(seen[1][1],'content'),'reload repeated the write');

  await profile.fill('本地未保存');
  await select('experience');
  for(const value of ['A','B','C']){
    await add.click();
    await title.fill(value);
  }
  await role('上移').nth(2).click();
  await save();
  await status('已保存草稿');
  await select('profile');
  check(await profile.inputValue()==='本地未保存','another section lost its dirty text');
  await role('撤销修改').click();
  await select('experience');
  check(JSON.stringify(await rowTitles())==='["A","C","B"]','unexpected order before deletion');
  await page.locator('button.record-delete').nth(1).click();
  await role('确认删除').click();
  await save();
  await status('已保存草稿');
  await page.reload();
  await page.waitForFunction(()=>[...document.querySelectorAll('.record-list .record-title > span:last-child')].map(e=>e.textContent).join(',')==='A,B');
  const headingField='[data-edit-field="experienceLabel"][data-edit-locale="zh"]';
  await page.locator(headingField).fill('任职记录');
  await select('contact');
  await page.locator('button[data-view-option="site-text"]').click();
  await save();
  await status('已保存草稿');
  const direct=await page.context().newPage();
  try {
    await direct.goto(origin+'/dashboard/editor#experience');
    await direct.waitForFunction(selector=>document.querySelector(selector)?.value==='任职记录',headingField);
    check(await direct.locator('.editor-heading h1').innerText()==='任职记录','saved title missing on a direct section link');
  } finally {await direct.close();}
  await page.goto(origin+'/account');
  await role('退出登录').click();
  await page.waitForURL(origin+'/login');
  await login('b');
  await expectValue(profileField,'');
  await select('experience');
  await page.getByText('暂无工作记录。',{exact:true}).waitFor();
  check((await rowTitles()).length===0,'other owner saw saved entries');
  return {unknownAcrossReload:true,originalKey:true,dirtyIsolation:true,recordOrder:true,delete:true,customTitle:true,accountIsolation:true};
}
