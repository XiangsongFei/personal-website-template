// Playwright scenario against an HTTPS loopback fixture configured to lose one save response.
/* eslint-disable @typescript-eslint/no-unused-expressions -- Playwright evaluates the function expression. */
async page => {
  const origin=new URL(page.url()).origin;
  if(!/^https:\/\/localhost:\d+$/.test(origin))throw Error('Loopback only');
  const account='user-a@example.invalid';
  const selector='[data-edit-field="introduction"][data-edit-locale="zh"]';
  const value='刷新后核对个人介绍';
  const writes=[];
  const lookups=[];
  page.on('dialog',dialog=>dialog.accept());
  page.on('request',request=>{
    if(request.method()!=='POST')return;
    const path=new URL(request.url()).pathname;
    if(path==='/api/sites/introduction')writes.push(request.postDataJSON());
    if(path==='/api/sites/resume-text/introduction-receipt')lookups.push(request.postDataJSON());
  });
  await page.locator('[name=email]').fill(account);
  await page.locator('[name=password]').fill('SYNTHETIC_REAL_ADAPTER_PASSWORD');
  await page.locator('form.account-form button[type=submit]').click();
  await page.waitForURL(origin+'/dashboard');
  await page.goto(origin+'/dashboard/editor#introduction');
  await page.locator(selector).fill(value);
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.getByRole('status').filter({hasText:'保存结果待核对'}).waitFor();
  await page.reload();
  await page.waitForFunction(({selector,value})=>document.querySelector(selector)?.value===value,{selector,value});
  await page.getByRole('button',{name:'核对保存结果',exact:true}).click();
  await page.getByRole('status').filter({hasText:'已保存个人介绍'}).waitFor();
  if(writes.length!==1||lookups.length!==1||writes[0].command.request_id!==lookups[0].requestId||
    Object.hasOwn(lookups[0],'command')||JSON.stringify(lookups[0]).includes(value))throw Error('Original operation was not looked up safely');
  return {introductionRecovery:true,savePosts:1,readOnlyReceiptPosts:1};
}
