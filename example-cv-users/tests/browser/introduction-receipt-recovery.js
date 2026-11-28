// Playwright scenario against an HTTPS loopback fixture configured to lose one save response.
/* eslint-disable @typescript-eslint/no-unused-expressions -- Playwright evaluates the function expression. */
async page => {
  const origin=new URL(page.url()).origin;
  if(!/^https:\/\/localhost:\d+$/.test(origin))throw Error('Loopback only');
  const account='user-a@example.invalid';
  const values={zh:'刷新后核对个人介绍',en:'Read the original Introduction after refresh'};
  const selector=locale=>'[data-edit-field="introduction"][data-edit-locale="'+locale+'"]';
  const path='/api/sites/introduction';
  const scopeHeader='x-workspace-draft-scope';
  const login=async()=>{
    await page.locator('[name=email]').fill(account);
    await page.locator('[name=password]').fill('SYNTHETIC_REAL_ADAPTER_PASSWORD');
    await page.locator('form.account-form button[type=submit]').click();
    await page.waitForURL(origin+'/dashboard');
  };
  const checkValues=()=>Promise.all(Object.entries(values).map(([locale,expected])=>page.waitForFunction(
    ({selector,expected})=>document.querySelector(selector)?.value===expected,{selector:selector(locale),expected})));
  const writes=[];
  const lookups=[];
  page.on('dialog',dialog=>dialog.accept());
  page.on('request',request=>{
    if(request.method()!=='POST')return;
    const path=new URL(request.url()).pathname;
    if(path==='/api/sites/introduction')writes.push(request);
    if(path==='/api/sites/resume-text/introduction-receipt')lookups.push(request.postDataJSON());
  });
  await login();
  await page.goto(origin+'/dashboard/editor#introduction');
  for(const [locale,value] of Object.entries(values))await page.locator(selector(locale)).fill(value);
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.getByRole('status').filter({hasText:'保存结果待核对'}).waitFor();
  await page.reload();
  await checkValues();
  await page.getByRole('button',{name:'核对保存结果',exact:true}).click();
  await page.getByRole('status').filter({hasText:'已保存个人介绍'}).waitFor();
  if(writes.length!==1||lookups.length!==1||writes[0].postDataJSON().command.request_id!==lookups[0].requestId||
    Object.hasOwn(lookups[0],'command')||Object.values(values).some(value=>JSON.stringify(lookups[0]).includes(value)))
    throw Error('Original operation was not looked up safely');

  const body=writes[0].postData();
  const scope=await writes[0].headerValue(scopeHeader);
  if(!scope||!body)throw Error('Missing original scope or request body');
  const duplicate=await page.evaluate(async({path,scopeHeader,scope,body})=>{
    const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json',[scopeHeader]:scope},body});
    return {status:response.status,value:await response.json()};
  },{path,scopeHeader,scope,body});
  if(duplicate.status!==200||duplicate.value.requestId!==lookups[0].requestId||duplicate.value.digest!==lookups[0].digest||
    duplicate.value.draft.revision!==1||writes.length!==2||writes[1].postData()!==body)
    throw Error('The identical POST did not return the original revision and receipt');

  await page.goto(origin+'/account');
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await page.waitForURL(origin+'/login');
  await login();
  const read=page.waitForResponse(response=>response.url()===origin+path&&response.request().method()==='GET');
  await page.goto(origin+'/dashboard/editor#introduction');
  const response=await read;
  const renewedScope=await response.headerValue(scopeHeader);
  if(response.status()!==200||!renewedScope||renewedScope===scope)throw Error('Expected an independent session on re-login');
  const snapshot=await response.json();
  if(snapshot.siteId!==lookups[0].siteId||snapshot.revision!==1)throw Error('Re-login read a different site or revision');
  await checkValues();
  if(writes.length!==2||lookups.length!==1)throw Error('Re-login unexpectedly sent another write or recovery query');
  return {introductionRecovery:true,sameKeyDuplicate:true,revisionAfterRelogin:1,readOnlyReceiptPosts:1};
}
