import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';
import {introductionPath,introductionText} from '../../lib/editor/introduction-dto.ts';
import {resumeTextPath,textCommand,textCommandDigest} from '../../lib/editor/resume-text.ts';
import {sectionTitleFields} from '../../lib/editor/site-text.ts';
import {countBrowserText} from './full-text.mjs';

const savePath=resumeTextPath+'/save';
const profileName='林见山', profileEnglish='Alice Lin';
const intro={zh:'虚构履历：研究无障碍数据工具。',en:'Synthetic resume: accessible data tools research.'};
const contactTitle=['联系林见山','Contact Alice'];
const headings={
  education:['学习档案','Education portfolio'],experience:['工作档案','Work portfolio'],
  projects:['项目档案','Project portfolio'],skills:['技能档案','Skills portfolio'],awards:['荣誉档案','Honors portfolio'],
};
const markers=Object.fromEntries(Object.entries(headings).map(([k,v])=>[k,v[0]]));
const contactEmail='alice.portfolio@example.invalid';
const selector=(key,locale)=>'[data-edit-field="'+(locale==='shared'?'shared:':'')+key+'"][data-edit-locale="'+locale+'"]';
const field=(root,key,locale)=>root.locator(selector(key,locale));
const button=(root,name)=>root.getByRole('button',{name,exact:true});
const link=(page,section)=>page.locator('.dashboard-sidebar a[href="#'+section+'"]');
const status=(page,label)=>page.getByRole('status').filter({hasText:label});
const hasText=(page,css,text)=>page.waitForFunction(([css,text])=>
  [...document.querySelectorAll(css)].some(node=>node.textContent.trim().includes(text)),[css,text]);
const value=(page,key,locale,expected)=>page.waitForFunction(([css,expected])=>
  [...document.querySelectorAll(css)].some(node=>!node.closest('[hidden]')&&node.value===expected),[selector(key,locale),expected]);
const editable=(page,key,locale)=>page.waitForFunction(css=>[...document.querySelectorAll(css)]
  .some(node=>!node.closest('[hidden]')&&!node.matches(':disabled')) ,selector(key,locale));
const rowOrder=page=>page.locator('.record-list > li').evaluateAll(nodes=>nodes.map(node=>node.dataset.entryId));
const edit=async(page,section)=>link(page,section).click();
const sub=async(page,section)=>page.locator('button[data-view-option="'+section+'"]').click();
async function fillPair(root,key,[zh,en]){
  await field(root,key,'zh').fill(zh);
  await field(root,key,'en').fill(en);
}

export async function openDelegatedBrowser({origin,stageDir,take,witness,checkBudget}){
  const {chromium}=await import(pathToFileURL(process.env.S47_PLAYWRIGHT_MODULE).href);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1480,height:940},locale:'zh-CN',serviceWorkers:'block'});
  const page=await context.newPage();
  page.setDefaultTimeout(8500);
  const shots=join(stageDir,'screenshots');
  mkdirSync(shots,{mode:0o700});
  const network=[],consoleFaults=[],pageFaults=[],saves=[],index=[];
  witness.browser={chrome:browser.version(),network,consoleFaults,pageFaults,screenshots:index,saves};
  let held,activeOwner,fatal;
  const pending=new Map();
  await context.route('**/*',async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.origin!==origin)return route.abort('blockedbyclient');
    try {
      if(url.pathname.startsWith('/api/sites/'))checkBudget();
      countBrowserText(url.pathname,req.method(),take);
      if(req.method()==='POST'&&[introductionPath,savePath].includes(url.pathname)){
        assert.ok(activeOwner,'OWNER_NOT_BOUND');
        const command=req.postDataJSON();
        const requestId=command.requestId??command.command.request_id;
        pending.set(requestId,{owner:activeOwner,command,requestId});
        if(held&&url.pathname===savePath){
          const hook=held;
          held=undefined;
          const response=await route.fetch({maxRedirects:0,timeout:7500});
          hook.reached();
          await hook.released;
          return route.fulfill({response});
        }
      }
      await route.continue();
    } catch(error){
      fatal=error;
      await route.abort().catch(()=>{});
    }
  });
  page.on('pageerror',error=>pageFaults.push({name:error.name}));
  page.on('console',message=>{
    if(message.type()==='error'||message.type()==='warning'){
      const where=message.location().url;
      consoleFaults.push({type:message.type(),asset:where.startsWith(origin)?new URL(where).pathname:'browser'});
    }
  });
  context.on('response',response=>{
    const url=new URL(response.url());
    if(url.origin===origin&&url.pathname.startsWith('/api/'))
      network.push({browser:'Chrome',method:response.request().method(),path:url.pathname,
        section:url.searchParams.get('section')??undefined,status:response.status()});
  });
  const shot=async(name,label,target=page)=>{
    assert.ok(!target.url().includes('/login'));
    await target.screenshot({path:join(shots,name+'.png'),animations:'disabled',timeout:8000});
    index.push({file:'screenshots/'+name+'.png',label});
  };
  const signIn=async(owner,{adopt}={})=>{
    activeOwner=owner;
    await page.goto(origin+'/login');
    await page.locator('[name=email]').fill(owner.email);
    await page.locator('[name=password]').fill(owner.password);
    await page.locator('form.account-form button[type=submit]').click();
    await page.waitForURL(origin+'/dashboard');
    if(adopt)activeOwner=await adopt(owner);
    return activeOwner;
  };
  const signOut=async()=>{
    await page.locator('.dashboard-account-link').click();
    await button(page,'退出登录').click();
    await page.waitForURL(origin+'/login');
    assert.equal((await context.cookies(origin)).some(cookie=>cookie.name.startsWith('__Host-ecv-users-session')),false);
  };
  const save=async(section,{inFlight}={})=>{
    const path=section==='introduction'?introductionPath:savePath;
    const reply=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST');
    // A transport hold forwards the unchanged Worker reply after typing a second edit.
    // PostgreSQL has answered the first save before the input is changed.
    let release;
    if(inFlight){
      let reached;
      const delivered=new Promise(resolve=>{reached=resolve;});
      const released=new Promise(resolve=>{release=resolve;});
      held={reached,released};
      try{
        await button(page,'保存草稿').click();
        await Promise.race([delivered,wait(7500).then(()=>{throw Error('SAVE_HOLD_TIMEOUT');})]);
        await inFlight();
      } finally {release();}
    } else await button(page,'保存草稿').click();
    const response=await reply;
    const command=response.request().postDataJSON(), result=await response.json();
    assert.equal(response.status(),200);
    assert.equal(result.state,'saved');
    const requestId=command.requestId??command.command.request_id;
    assert.equal(result.requestId,requestId);
    const basis=command.expectedRevision??command.command.expected_draft_revision;
    const revision=result.snapshot?.revision??result.draft.revision;
    assert.equal(revision,basis+1);
    if(section==='introduction'){
      assert.equal(result.draft.siteId,activeOwner.site);
      assert.deepEqual(result.draft.record,command.command.payload.entries[0]);
    } else {
      assert.equal(result.snapshot.siteId,activeOwner.site);
      assert.equal(result.snapshot.section,section);
      assert.equal(result.digest,await textCommandDigest(textCommand(command)));
      assert.deepEqual(result.snapshot.content,command.content);
    }
    assert.match(result.digest,/^[0-9a-f]{64}$/);
    pending.delete(requestId);
    const receipt={browser:'Chrome',owner:activeOwner.name,section,status:response.status(),requestId,digest:result.digest,
      siteId:activeOwner.site,revision,content:result.snapshot?.content??result.draft.record};
    saves.push(receipt);
    await status(page,section==='introduction'?'已保存个人介绍':'已保存草稿').waitFor();
    return receipt;
  };
  return {browser,context,page,network,consoleFaults,pageFaults,saves,index,shots,shot,signIn,signOut,save,pending,
    assertHealthy:()=>{if(fatal)throw fatal;},close:()=>browser.close()};
}

async function exerciseRecords(page,browser,{section,key,examples,secondary}){
  const add=page.locator('.editor-records > button.record-add');
  await edit(page,section);
  const ids=[];
  for(const [i,names] of examples.entries()){
    await add.click();
    const active=page.locator('.record-list li:has(.record-title[aria-expanded="true"])');
    ids.push(await active.getAttribute('data-entry-id'));
    await fillPair(active,key,names);
    if(secondary)await fillPair(active,secondary,['合成机构 '+i,'Synthetic institution '+i]);
  }
  const first=await browser.save(section);
  assert.equal(first.content.entries.length,3);
  assert.ok(ids.every((id,index)=>id.endsWith(first.content.entries[index].id)));
  assert.deepEqual(await rowOrder(page),ids);
  const row=id=>page.locator('.record-list > li[data-entry-id="'+id+'"]');
  await button(row(ids[2]),'上移').click();
  await button(row(ids[2]),'上移').click();
  await row(ids[1]).locator('button.record-delete').click();
  await button(page,'确认删除').click();
  assert.deepEqual(await rowOrder(page),[ids[2],ids[0]]);
  const selected=row(ids[2]).locator('.record-title');
  if(await selected.getAttribute('aria-expanded')!=='true')await selected.click();
  await fillPair(row(ids[2]),key,[examples[2][0]+'（修订）',examples[2][1]+' revised']);
  const receipt=await browser.save(section);
  assert.equal(receipt.revision,first.revision+1);
  assert.deepEqual(receipt.content.entries.map(entry=>entry.id),[first.content.entries[2].id,first.content.entries[0].id]);
  assert.deepEqual(receipt.content.entries.map(entry=>entry.translations.en[key]),[examples[2][1]+' revised',examples[0][1]]);
  assert.deepEqual(receipt.content.entries.map(entry=>entry.translations.zh[key]),[examples[2][0]+'（修订）',examples[0][0]]);
  assert.ok(receipt.content.entries.every(entry=>/^[a-f0-9-]{36}$/.test(entry.id)));
  return async()=>{
    await edit(page,section);
    const rows=page.locator('.record-list > li');
    await rows.nth(1).waitFor();
    const refreshed=await rowOrder(page);
    assert.equal(refreshed.length,2);
    assert.ok(refreshed.every((id,i)=>id.endsWith(receipt.content.entries[i].id)));
    await rows.first().locator('.record-title').click();
    await value(page,key,'en',examples[2][1]+' revised');
    await browser.shot(section,section+' 保存刷新后的顺序及双语字段');
  };
}

async function exerciseSkills(page,browser){
  await edit(page,'skills');
  await page.getByText('暂无技能分组。',{exact:true}).waitFor();
  const ids=[];
  for(const [i,preset] of ['dataSystems','tools','custom'].entries()){
    await page.locator('.editor-records > button.record-add').click();
    const active=page.locator('.record-list li:has(.record-title[aria-expanded="true"])');
    ids.push(await active.getAttribute('data-entry-id'));
    const categories=active.locator('select[data-edit-field="shared:category"]');
    assert.ok((await categories.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value))).includes(preset));
    await categories.selectOption(preset);
    if(preset==='custom')await fillPair(active,'title',['合成技能','Synthetic skills']);
    await fillPair(active,'items',['明确录入的技能 '+i,'Explicitly entered skill '+i]);
  }
  const first=await browser.save('skills');
  assert.equal(first.content.entries.length,3);
  assert.ok(ids.every((id,index)=>id.endsWith(first.content.entries[index].id)));
  assert.deepEqual(await rowOrder(page),ids);
  const row=id=>page.locator('.record-list > li[data-entry-id="'+id+'"]');
  await button(row(ids[2]),'上移').click();
  await button(row(ids[2]),'上移').click();
  await row(ids[1]).locator('button.record-delete').click();
  await button(page,'确认删除').click();
  assert.deepEqual(await rowOrder(page),[ids[2],ids[0]]);
  const toggle=row(ids[0]).locator('.record-title');
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  await fillPair(row(ids[0]),'items',['明确采用：技术写作','Explicitly adopted: technical writing']);
  const receipt=await browser.save('skills');
  assert.equal(receipt.revision,first.revision+1);
  assert.deepEqual(receipt.content.entries.map(entry=>entry.id),[first.content.entries[2].id,first.content.entries[0].id]);
  assert.deepEqual(receipt.content.entries.map(entry=>entry.translations.en.title),['Synthetic skills','Data & Systems']);
  assert.deepEqual(receipt.content.entries.map(entry=>entry.translations.en.items),
    ['Explicitly entered skill 2','Explicitly adopted: technical writing']);
  return async()=>{
    await edit(page,'skills');
    const rows=page.locator('.record-list > li');
    await rows.nth(1).waitFor();
    const refreshed=await rowOrder(page);
    assert.equal(refreshed.length,2);
    assert.ok(refreshed.every((id,i)=>id.endsWith(receipt.content.entries[i].id)));
    await rows.last().locator('.record-title').click();
    await value(page,'items','en','Explicitly adopted: technical writing');
    await browser.shot('skills','Skills 主动采用的预设、自定义技能及真实回读');
  };
}

async function titleChecks(page,browser){
  const switcher=page.locator('.ui-locale-switch');
  for(const [locale,i] of [['zh',0],['en',1]]){
    await button(switcher,i?'English':'中文').click();
    await switcher.locator('button[aria-pressed="true"]').filter({hasText:i?'English':'中文'}).waitFor();
    const preview=page.locator('.editor-preview');
    const previewLanguage=preview.locator('button.public-nav-language');
    if((await previewLanguage.innerText()).trim()===(i?'EN':'中文'))await previewLanguage.click();
    for(const [section,titles] of Object.entries({...headings,contact:contactTitle})){
      await edit(page,section);
      try {await hasText(page,'.editor-heading h1',titles[i]);} catch {
        throw Error('TITLE_MISMATCH_'+section.toUpperCase()+'_'+locale.toUpperCase(),{cause:await page.locator('.editor-heading h1').textContent()});
      }
      assert.ok((await link(page,section).innerText()).includes(titles[i]));
      assert.ok((await page.locator('.dashboard-breadcrumb').innerText()).includes(titles[i]));
      const key=sectionTitleFields[section]??'contactLabel';
      await hasText(page,'.editor-preview [data-site-section="'+section+'"] [data-preview-value="'+key+'"]',titles[i]);
    }
    await edit(page,'projects');
    const first=page.locator('.record-list > li').first().locator('.record-title');
    if(await first.getAttribute('aria-expanded')!=='true')await first.click();
    await field(page,'title',locale).fill(i?'Unsaved project name':'项目记录的新名称');
    assert.equal(await page.locator('.editor-heading h1').textContent(),headings.projects[i]);
    await hasText(page,'[role="status"][data-dirty="true"]',headings.projects[i]);
    assert.equal(await link(page,'projects').locator('[data-unsaved-dot]').count(),1);
    await browser.shot(i?'custom-titles-en':'custom-titles-zh','双语自定义栏目标题、独立记录名及未保存状态',page);
    await button(page,i?'Undo changes':'撤销修改').click();
  }
  await button(switcher,'中文').click();
}

export async function runDelegated({browser:session,a,b,origin,phase,mark,adoptBrowserSession,observe,verifyLogout,runSafari,bobIntroduction=''}){
  const {page,shot,save,signIn,signOut}=session;
  const sections=['profile','introduction','education','experience','projects','skills','awards','contact'];
  phase('delegated-Chrome-dashboard');
  await page.reload();
  await page.locator('.dashboard-main h1').waitFor();
  for(const section of sections)await page.locator('.dashboard-sidebar a[href$="#'+section+'"]').waitFor();
  await shot('dashboard','Chrome，真实登录后的工作台概览');
  await page.locator('.dashboard-sidebar a[href$="#profile"]').click();
  await editable(page,'name','zh');
  await page.evaluate(()=>{
    window.s47Navigation={urls:0,workspaceMissing:0};
    const observer=new MutationObserver(()=>{
      if(!document.querySelector('.resume-editor'))window.s47Navigation.workspaceMissing++;
    });
    observer.observe(document.querySelector('.dashboard-main'),{subtree:true,childList:true});
    addEventListener('beforeunload',()=>window.s47Navigation.urls++);
  });

  phase('delegated-Chrome-profile-introduction');
  await fillPair(page,'name',[profileName,profileEnglish]);
  await field(page,'footerName','shared').fill('Alice Lin Portfolio');
  await edit(page,'introduction');
  await editable(page,'introduction','zh');
  await fillPair(page,'introduction',[intro.zh,intro.en]);
  assert.equal(await link(page,'introduction').locator('[data-unsaved-dot]').count(),1);
  await edit(page,'profile');
  assert.equal(await link(page,'profile').locator('[data-unsaved-dot]').count(),1);
  const first=await save('profile',{inFlight:async()=>field(page,'name','zh').fill('保存后继续编辑')});
  assert.equal(first.content.shared.footerName,'Alice Lin Portfolio');
  assert.equal(first.content.translations.zh.name,profileName);
  assert.equal(first.content.translations.en.name,profileEnglish);
  await value(page,'name','zh','保存后继续编辑');
  assert.equal(await link(page,'profile').locator('[data-unsaved-dot]').count(),1);
  assert.equal(await link(page,'introduction').locator('[data-unsaved-dot]').count(),1);
  await shot('save-success','保存回执已返回，提交期间新编辑及其他栏目圆点仍在');
  await button(page,'撤销修改').click();
  await value(page,'name','zh',profileName);
  await hasText(page,'.editor-preview [data-preview-value="name"]',profileName);
  await shot('profile','Profile 两种姓名与共享页脚');
  await edit(page,'introduction');
  await value(page,'introduction','zh',intro.zh);
  const introReceipt=await save('introduction');
  assert.deepEqual(introductionText({record:introReceipt.content}),intro);
  assert.deepEqual(await page.evaluate(()=>window.s47Navigation),{urls:0,workspaceMissing:0});
  await page.reload();
  await value(page,'introduction','zh',intro.zh);
  await value(page,'introduction','en',intro.en);
  await shot('introduction','Introduction 双语保存后的刷新');
  await fillPair(page,'introduction',['','']);
  if(await button(page,'显示示例').count())await button(page,'显示示例').click();
  await hasText(page,'.editor-preview-guide','灰色为填写示例，不会保存');
  assert.equal(await field(page,'introduction','zh').inputValue(),'');
  assert.ok(await field(page,'introduction','zh').getAttribute('placeholder'));
  await shot('introduction-guide','清空字段后可见灰色示例，输入仍为空');
  await button(page,'隐藏示例').click();
  await button(page,'撤销修改').click();
  await value(page,'introduction','zh',intro.zh);
  await edit(page,'profile');
  await value(page,'name','zh',profileName);
  await value(page,'name','en',profileEnglish);
  await value(page,'footerName','shared','Alice Lin Portfolio');
  await shot('post-refresh','重新读取后保留原有已保存资料');
  mark('Chrome Dashboard, Profile, Introduction, dirty isolation and in-flight typing');

  phase('delegated-Chrome-records');
  const reloadChecks=[];
  for(const spec of [
    {section:'education',key:'title',secondary:'program',examples:[['初始学校','First school'],['删除学校','Deleted school'],['虚构研究院','Synthetic institute']]},
    {section:'experience',key:'title',secondary:'organization',examples:[['研究助理','Research assistant'],['删除职位','Deleted role'],['工程师','Engineer']]},
    {section:'projects',key:'title',examples:[['资料包','Data kit'],['删除项目','Deleted project'],['无障碍工具','Accessibility tool']]},
    {section:'awards',key:'name',examples:[['研究奖','Research award'],['删除奖项','Deleted award'],['协作奖','Collaboration award']]},
  ]){
    reloadChecks.push(['Chrome '+spec.section+' add, edit, delete, reorder and reload',
      await exerciseRecords(page,session,spec)]);
  }
  reloadChecks.push(['Chrome Skills explicit preset selection, edit, delete, reorder and reload',
    await exerciseSkills(page,session)]);
  // Each following module makes a new read after a single full document reload.
  await page.reload();
  for(const [label,verify] of reloadChecks){
    await verify();
    mark(label);
  }

  phase('delegated-Chrome-contact-links-titles');
  await edit(page,'contact');
  await fillPair(page,'contactLabel',contactTitle);
  await fillPair(page,'availability',['欢迎合成合作邀请','Available for synthetic collaboration']);
  await save('contact');
  await page.reload();
  await value(page,'contactLabel','zh',contactTitle[0]);
  await value(page,'contactLabel','en',contactTitle[1]);
  await shot('contact','Contact 真实保存后刷新');
  await sub(page,'links');
  await value(page,'email','shared','');
  const github='https://github.com/synthetic-example-cv';
  const linkedIn=['https://www.linkedin.com/in/synthetic-alice-zh','https://www.linkedin.com/in/synthetic-alice-en'];
  await field(page,'email','shared').fill(contactEmail);
  await field(page,'github','shared').fill(github);
  await fillPair(page,'linkedInHref',linkedIn);
  assert.equal(await page.locator('.editor-preview [data-preview-public-link="email"] a').getAttribute('href'),'mailto:'+contactEmail);
  assert.equal(await page.locator('.editor-preview [data-preview-public-link="github"] a').getAttribute('href'),github);
  const previewLanguage=page.locator('.editor-preview .public-nav-language');
  const linkedInAction=page.locator('.editor-preview [data-preview-public-link="linkedin-action"] a');
  assert.equal(await linkedInAction.getAttribute('href'),linkedIn[0]);
  await previewLanguage.click();
  assert.equal(await linkedInAction.getAttribute('href'),linkedIn[1]);
  await previewLanguage.click();
  await save('links');
  await page.reload();
  await sub(page,'links');
  await value(page,'email','shared',contactEmail);
  await value(page,'github','shared',github);
  await value(page,'linkedInHref','zh',linkedIn[0]);
  await value(page,'linkedInHref','en',linkedIn[1]);
  await shot('links','公开邮箱和合法链接，未沿用登录邮箱');
  await sub(page,'site-text');
  await fillPair(page,'portfolioLabel',['查看虚构简历','View synthetic résumé']);
  for(const [section,key] of Object.entries(sectionTitleFields))await fillPair(page,key,headings[section]);
  const siteText=await save('site-text');
  for(const [section,key] of Object.entries(sectionTitleFields)){
    assert.equal(siteText.content.translations.zh[key],headings[section][0]);
    assert.equal(siteText.content.translations.en[key],headings[section][1]);
  }
  await page.reload();
  await sub(page,'site-text');
  await value(page,'portfolioLabel','zh','查看虚构简历');
  await value(page,'portfolioLabel','en','View synthetic résumé');
  await shot('site-text','Website Text 双语网站文案及栏目名称');
  const direct=await session.context.newPage();
  direct.setDefaultTimeout(8500);
  try {
    await direct.goto(origin+'/dashboard/editor#projects');
    try {await hasText(direct,'.editor-heading h1',headings.projects[0]);} catch {
      throw Error('DIRECT_CUSTOM_TITLE_NOT_READY',{cause:{url:new URL(direct.url()).pathname+new URL(direct.url()).hash,
        heading:await direct.locator('.editor-heading h1').allTextContents(),
        navigation:await link(direct,'projects').allTextContents(),
        api:session.network.slice(-12)}});
    }
    await titleChecks(direct,session);
  } finally {await direct.close();}
  await button(page.locator('.ui-locale-switch'),'中文').click();
  mark('Chrome Contact, Links, Website Text and six custom titles in both languages');
  observe(a,b,session.saves,0);
  await signOut();
  const renewed=await signIn(a,{adopt:adoptBrowserSession});
  await verifyLogout(a,renewed);
  await page.goto(origin+'/dashboard/editor#profile');
  await value(page,'name','zh',profileName);
  await value(page,'name','en',profileEnglish);
  await edit(page,'introduction');
  await value(page,'introduction','zh',intro.zh);
  await value(page,'introduction','en',intro.en);
  await edit(page,'projects');
  await hasText(page,'.editor-heading h1',markers.projects);
  await shot('alice-relogin','Alice 重登后从真实站点读回自定义标题及内容');
  await signOut();
  const bob=await signIn(b,{adopt:adoptBrowserSession});
  await verifyLogout(renewed,bob);
  await page.goto(origin+'/dashboard/editor#profile');
  await editable(page,'name','zh');
  await value(page,'name','zh','');
  await value(page,'name','en','');
  await edit(page,'introduction');
  await editable(page,'introduction','zh');
  await value(page,'introduction','zh',bobIntroduction);
  await edit(page,'projects');
  await page.getByText('暂无项目。',{exact:true}).waitFor();
  assert.equal(await page.locator('.dashboard-sidebar').getByText(markers.projects,{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('ecv:pending-text:'))),false);
  await shot('bob-isolation','Bob 重登后看到独立、空白的合成站点');
  mark('Chrome logout, real relogin and site isolation');
  await runSafari(bob,await session.context.cookies(origin));
  observe(a,b,session.saves,1);
  session.assertHealthy();
  assert.equal(session.pending.size,0);
  assert.equal(session.pageFaults.length,0);
  const duplicateSaves=session.saves.length-new Set(session.saves.map(save=>save.requestId)).size;
  assert.equal(duplicateSaves,0);
  mark('browser request integrity and zero uncaught page errors',{distinctSaveKeys:session.saves.length});
  return {gRead:'LOCAL_PASS',gSave:'LOCAL_PASS'};
}

export function writeScreenshotIndex(stageDir,index){
  writeFileSync(join(stageDir,'SCREENSHOTS.md'),[
    '# S4.7 委托用户验收截图','',
    ...index.map(({file,label})=>'- ['+label+']('+file+')'),'',
  ].join('\n'),{mode:0o600});
}

export async function nativeSafari({driver,origin,browser,owner,cookies,take,checkBudget,mark}){
  assert.match(driver,/^http:\/\/127\.0\.0\.1:\d+$/);
  checkBudget(24);
  const wire=async(path,method,body)=>{
    const response=await fetch(driver+'/session'+path,{method,redirect:'error',signal:AbortSignal.timeout(8500),
      ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
    assert.ok(response.ok,'SAFARI_WEBDRIVER_'+response.status);
    return (await response.json()).value;
  };
  const {sessionId,capabilities}=await wire('','POST',{capabilities:{alwaysMatch:{browserName:'safari',acceptInsecureCerts:true}}});
  const session='/'+sessionId;
  const execute=(script,args=[])=>wire(session+'/execute/sync','POST',{script,args});
  const navigator=path=>wire(session+'/url','POST',{url:origin+path});
  const waitFor=async(script,args=[])=>{
    for(let attempt=0;attempt<65;attempt++){
      if(await execute(script,args))return;
      await wait(85);
    }
    throw Error('SAFARI_UI_NOT_READY');
  };
  const fieldSelector=selector('name','zh');
  const countResources=async(saved)=>{
    const paths=await execute('return performance.getEntriesByType("resource").map(r=>({path:new URL(r.name).pathname,status:r.responseStatus??null})).filter(r=>r.path.startsWith("/api/sites/"));');
    assert.ok(paths.length<=10);
    assert.equal(paths.filter(request=>request.path===savePath).length,saved?1:0);
    for(const request of paths){
      if(request.path!==savePath)countBrowserText(request.path,'GET',take);
      browser.network.push({browser:'Safari',method:request.path===savePath?'POST':'GET',path:request.path,status:request.status});
    }
    await execute('performance.clearResourceTimings()');
  };
  const name='鲍勃 Safari 合成履历';
  try {
    await wire(session+'/window/rect','POST',{width:1400,height:900,x:0,y:0});
    await navigator('/login');
    const appCookies=cookies.filter(cookie=>cookie.name.startsWith('__Host-ecv-users-session'));
    assert.ok(appCookies.length>0);
    for(const {name,value} of appCookies)await wire(session+'/cookie','POST',{cookie:{name,value,path:'/',secure:true,httpOnly:true}});
    await navigator('/dashboard/editor#profile');
    await waitFor('const input=document.querySelector(arguments[0]);return input?.value===""&&!input.matches(":disabled");',[fieldSelector]);
    await countResources(false);
    const geometry=await execute('const pane=document.querySelector(".editor-pane"),preview=document.querySelector(".editor-preview");return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,pane:pane?.getBoundingClientRect().width,preview:preview?.getBoundingClientRect().width,canScroll:pane.querySelector(".editor-pane-body").scrollHeight>pane.querySelector(".editor-pane-body").clientHeight};');
    assert.ok(geometry.documentWidth<=geometry.width+2&&geometry.pane>160&&geometry.preview>200&&geometry.canScroll);
    await execute('const [selector,text]=arguments,input=document.querySelector(selector);input.focus();Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),"value").set.call(input,text);input.dispatchEvent(new Event("input",{bubbles:true}));',[fieldSelector,name]);
    await waitFor('return [...document.querySelectorAll("button")].some(button=>button.textContent.trim()==="保存草稿"&&!button.disabled)');
    await execute('const path=arguments[0];window.s47Save=null;window.s47Pending=null;const original=window.fetch;window.fetch=async function(input,init){const isSave=init?.method==="POST"&&new URL(typeof input==="string"?input:input.url,location.href).pathname===path;if(isSave)window.s47Pending=init.body;const response=await original.call(this,input,init);if(isSave)window.s47Save={status:response.status,result:await response.clone().json()};return response;};',[savePath]);
    checkBudget(15);
    countBrowserText(savePath,'POST',take);
    try {
      await execute('[...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="保存草稿"&&!button.disabled).click()');
      await waitFor('return !!window.s47Save');
      const {status,result}=await execute('return window.s47Save');
      const command=textCommand(JSON.parse(await execute('return window.s47Pending')));
      assert.equal(status,200);
      assert.equal(command.siteId,owner.site);
      assert.equal(command.section,'profile');
      assert.equal(command.expectedRevision,0);
      assert.equal(result.state,'saved');
      assert.equal(result.requestId,command.requestId);
      assert.equal(result.digest,await textCommandDigest(command));
      assert.deepEqual(result.snapshot.content,command.content);
      assert.equal(result.snapshot.revision,1);
      assert.equal(result.snapshot.siteId,owner.site);
      assert.equal(result.snapshot.content.translations.zh.name,name);
      browser.saves.push({browser:'Safari',owner:owner.name,section:'profile',siteId:owner.site,revision:1,
        status,requestId:command.requestId,digest:result.digest,content:result.snapshot.content});
    } catch(error){
      const raw=await execute('return window.s47Pending');
      const command=raw?JSON.parse(raw):null;
      if(command?.requestId)browser.pending.set(command.requestId,{owner,requestId:command.requestId,command});
      throw error;
    }
    await waitFor('return [...document.querySelectorAll("[role=status]")].some(node=>node.textContent.includes("已保存草稿"))');
    await countResources(true);
    await wire(session+'/refresh','POST',{});
    await waitFor('return document.querySelector(arguments[0])?.value===arguments[1]',[fieldSelector,name]);
    await countResources(false);
    writeFileSync(join(browser.shots,'safari-profile.png'),Buffer.from(await wire(session+'/screenshot','GET'),'base64'),{mode:0o600});
    browser.index.push({file:'screenshots/safari-profile.png',label:'原生 Safari Bob 站点编辑、保存及刷新'});
    mark('Native Safari real read, profile edit, receipt, refresh and viewport',{version:capabilities.browserVersion,geometry});
  } finally {await wire(session,'DELETE');}
}
