import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {TEST_PASSWORD} from '../auth-fixture.mjs';
import {resumeTextRuntime} from '../fixtures/resume-text-rpc.mjs';

const {chromium}=await import(pathToFileURL(process.env.S47_PLAYWRIGHT_MODULE).href);
const savePath='/api/sites/resume-text/save';
const nav=(page,section)=>page.locator('.dashboard-sidebar a[href="#'+section+'"]');
const control=(page,field,locale='zh')=>page.locator('[data-edit-field="'+field+'"][data-edit-locale="'+locale+'"]');
const saveButton=page=>page.getByRole('button',{name:'保存草稿',exact:true});
const status=page=>page.getByRole('status').filter({hasText:'已保存草稿'});
const dot=(page,section)=>nav(page,section).locator('[data-unsaved-dot]');
const activeRow=page=>page.locator('.record-list li:has(.record-title[aria-expanded="true"])');
const add=page=>page.locator('.editor-records > button.record-add').click();
const waitValue=(page,field,expected,locale='zh')=>page.waitForFunction(([field,locale,expected])=>
  [...document.querySelectorAll('[data-edit-field="'+field+'"][data-edit-locale="'+locale+'"]')].some(input=>
    !input.closest('[hidden]')&&input.value===expected),[field,locale,expected]);

async function workspace(t,path){
  const listener=createServer().listen(0,'127.0.0.1');
  await once(listener,'listening');
  const port=listener.address().port;
  await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
  const origin='https://localhost:'+port;
  const fixture=await resumeTextRuntime({port,origin});
  t.after(()=>fixture.mf.dispose());
  await fixture.mf.ready;
  const browser=await chromium.launch({channel:'chrome'});
  t.after(()=>browser.close());
  const context=await browser.newContext({ignoreHTTPSErrors:true,locale:'zh-CN',serviceWorkers:'block'});
  const page=await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(origin+'/login');
  await page.locator('[name=email]').fill('user-a@example.invalid');
  await page.locator('[name=password]').fill(TEST_PASSWORD);
  await page.locator('form.account-form button[type=submit]').click();
  await page.waitForURL(origin+'/dashboard');
  await page.goto(origin+'/dashboard/editor#'+path);
  return {context,page,origin};
}

async function save(page){
  const reply=page.waitForResponse(response=>new URL(response.url()).pathname===savePath&&response.request().method()==='POST');
  await saveButton(page).click();
  const response=await reply;
  assert.equal(response.status(),200);
  const receipt=await response.json();
  assert.equal(receipt.state,'saved');
  await status(page).waitFor();
  return receipt.snapshot;
}

test('unsubmitted Website Text title never hides existing Education entries',async t=>{
  const {page,origin}=await workspace(t,'education');
  await add(page);
  await control(activeRow(page),'title').fill('已有教育记录');
  const first=await save(page);
  await page.goto(origin+'/dashboard/editor#site-text');
  await page.reload();
  await control(page,'educationLabel').fill('尚未保存的标题');
  await nav(page,'education').click();
  await page.getByRole('button',{name:'已有教育记录',exact:true}).waitFor();
  assert.equal(await saveButton(page).isDisabled(),true);
  await page.getByRole('button',{name:'已有教育记录',exact:true}).click();
  await control(activeRow(page),'program').fill('真实表单新增专业');
  const second=await save(page);
  assert.equal(second.revision,2);
  assert.equal(second.content.entries.length,1);
  assert.equal(second.content.entries[0].id,first.content.entries[0].id);
  assert.equal(second.content.entries[0].translations.zh.program,'真实表单新增专业');
  assert.equal(await page.locator('.editor-heading h1').textContent(),'尚未保存的标题');
  await nav(page,'contact').click();
  await page.locator('button[data-view-option="site-text"]').click();
  assert.equal(await control(page,'educationLabel').inputValue(),'尚未保存的标题');
  assert.equal(await saveButton(page).isEnabled(),true);
  const title=await save(page);
  assert.equal(title.content.translations.zh.educationLabel,'尚未保存的标题');
});

test('confirmed categorized Education and preset Skills are clean immediately',async t=>{
  const {page}=await workspace(t,'education');
  for(const [section,category,textField] of [['education','graduate','program'],['skills','tools','items']]){
    if(section==='skills')await nav(page,section).click();
    await add(page);
    await control(activeRow(page),'shared:category','shared').selectOption(category);
    await control(activeRow(page),textField).fill('明确录入');
    assert.equal(await dot(page,section).count(),1);
    await save(page);
    assert.equal(await dot(page,section).count(),0,section+' still appears unsaved');
    assert.equal(await saveButton(page).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'撤销修改',exact:true}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
  }
});

test('a return to the prior baseline while a confirmed save is in flight remains dirty',async t=>{
  const {context,page}=await workspace(t,'profile');
  const name=control(page,'name');
  await name.fill('原来的姓名');
  const first=await save(page);
  assert.equal(first.revision,1);
  await name.fill('提交中的姓名');
  let arrive,release;
  const arrived=new Promise(resolve=>{arrive=resolve;});
  const released=new Promise(resolve=>{release=resolve;});
  await context.route('**'+savePath,async route=>{
    const response=await route.fetch({maxRedirects:0,timeout:5000});
    arrive({status:response.status(),receipt:await response.json()});
    await released;
    await route.fulfill({response});
  },{times:1});
  await saveButton(page).click();
  try{
    const {status,receipt}=await arrived;
    assert.equal(status,200);
    assert.equal(receipt.snapshot.revision,2);
    assert.equal(receipt.snapshot.content.translations.zh.name,'提交中的姓名');
    await name.fill('原来的姓名');
  } finally {release();}
  await status(page).waitFor();
  assert.equal(await name.inputValue(),'原来的姓名');
  assert.equal(await dot(page,'profile').count(),1);
  const restored=await save(page);
  assert.equal(restored.revision,3);
  assert.equal(restored.content.translations.zh.name,'原来的姓名');
  await page.reload();
  await waitValue(page,'name','原来的姓名');
  assert.equal(await dot(page,'profile').count(),0);
});
