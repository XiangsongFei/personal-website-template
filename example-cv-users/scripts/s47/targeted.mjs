import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {introductionPath,introductionText,workspaceScopeHeader} from '../../lib/editor/introduction-dto.ts';
import {textDraftArgs} from '../../lib/business/introduction-repository.mjs';
import {emptyTextContent,resumeTextPath,textCommand,textCommandDigest} from '../../lib/editor/resume-text.ts';
import {sectionTitleFields} from '../../lib/editor/site-text.ts';
import {skillPresetTitles} from '../../lib/editor/records.ts';
import {countBrowserText,sampleText} from './full-text.mjs';

const intro={zh:'本机真实补验',en:'Local acceptance introduction'};
const scopeHeader=workspaceScopeHeader.toLowerCase();
const savePath=resumeTextPath+'/save', operationPath=resumeTextPath+'/operation';
const profileField='[data-edit-field="name"][data-edit-locale="zh"]';
const native=command=>({input:command,canonical:JSON.stringify(command)});
const make=(owner,section,expectedRevision,content)=>textCommand({siteId:owner.site,section,expectedRevision,content,requestId:randomUUID()});
const status=(page,label)=>page.getByRole('status').filter({hasText:label}).waitFor({timeout:8000});
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const select=(page,section)=>page.locator('.dashboard-sidebar a[href="#'+section+'"]').click();
const field=(page,key,locale)=>page.locator('[data-edit-field="'+key+'"][data-edit-locale="'+locale+'"]');
const markers=page=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('ecv:pending-text:'))
  .map(k=>JSON.parse(localStorage.getItem(k))));

function receiptState(obs,a,b){
  return obs(`SELECT json_build_object(
    'sites',(SELECT json_object_agg(id::text,draft_revision) FROM site_data.sites WHERE id IN ('${a.site}','${b.site}')),
    'history',(SELECT count(*) FROM site_data.draft_revisions),
    'audits',(SELECT count(*) FROM site_private.text_publication_audit),
    'operations',(SELECT count(*) FROM site_private.operation_requests),
    'records',(SELECT count(*) FROM site_data.draft_revisions h CROSS JOIN LATERAL jsonb_array_elements(h.payload->'entries') e
      WHERE h.site_revision>0),
    'outbox',(SELECT count(*) FROM site_private.publication_outbox));`);
}

export async function runTargeted({a,b,origin,mf,obs,sql,rest,phase,mark,take,witness,adoptBrowserSession,ensureBudget,journal,freeze,resumeAfterProof}){
  ensureBudget({textHTTP:165,allSaveEntrances:16,lookups:7,sqlObservation:9,passwordLogins:2,grants:2},'C2');
  const {chromium,firefox,webkit}=await import(pathToFileURL(process.env.S47_PLAYWRIGHT_MODULE).href);
  const verifyPayload=(command,snapshot)=>{
    assert.equal(snapshot.siteId,command.siteId);
    assert.equal(snapshot.revision,command.expectedRevision+1);
    assert.deepEqual(textCommand({...command,content:snapshot.content}).content,command.content);
  };
  const expected=new Map();
  function observeText(){
    const rows=obs(`SELECT json_build_object(
      'rows',(SELECT json_agg(json_build_object('section',v.section,'revision',v.revision,'content',v.content,
        'hasReceipt',r.request_id IS NOT NULL AND r.actor_uid=v.actor_uid AND r.basis_revision=v.revision-1,
        'audited',v.occurred_at IS NOT NULL AND v.actor_uid='${a.uid}'))
        FROM site_private.resume_text_revisions v LEFT JOIN site_private.resume_text_receipts r
          USING(site_id,section,revision,request_id) WHERE v.site_id='${a.site}'),
      'bob',(SELECT count(*) FROM site_private.resume_text_revisions WHERE site_id='${b.site}'),
      'outbox',(SELECT count(*) FROM site_private.publication_outbox));`);
    assert.equal(rows.bob,0);
    assert.equal(rows.outbox,0);
    assert.equal(rows.rows.length,expected.size);
    for(const row of rows.rows){
      assert.ok(row.hasReceipt&&row.audited);
      assert.deepEqual(row.content,expected.get(row.section+':'+row.revision));
    }
    return rows;
  }
  const seed=async section=>{
    const command=make(a,section,0,sampleText(section));
    const digest=await textCommandDigest(command);
    const result=await rest('save_resume_text',native(command),a.token);
    assert.equal(result.status,200,result.value.code);
    assert.equal(result.value.requestId,command.requestId);
    assert.equal(result.value.digest,digest);
    verifyPayload(command,result.value.snapshot);
    expected.set(section+':1',command.content);
  };
  phase('C2-titles-fixtures');
  await seed('site-text');
  await seed('contact');

  const savedPosts=[], lookups=[];
  let activeOwner, safariOwner;
  const holdSections=new Set(), held=new Map();
  const attach=async context=>context.route('**/*',async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.origin!==origin)return route.abort();
    try{countBrowserText(url.pathname,req.method(),take);}
    catch {return route.abort();}
    if(req.method()==='POST'&&url.pathname===operationPath)lookups.push(req.postDataJSON());
    if(req.method()==='POST'&&url.pathname===savePath){
      const command=req.postDataJSON();
      savedPosts.push(command);
      if(holdSections.has(command.section)){
        const digest=await textCommandDigest(command);
        const pending={section:command.section,siteId:command.siteId,requestId:command.requestId,
          expectedRevision:command.expectedRevision,digest};
        journal({...pending,uid:activeOwner.uid,sid:activeOwner.sid,outcome:'pending'});
        const backing=await route.fetch({maxRedirects:0,timeout:8000});
        let release;
        const disposition=new Promise(resolve=>{release=resolve;});
        held.set(command.section,{command,pending,release,status:backing.status(),value:await backing.json()});
        await disposition;
        return route.fulfill({response:backing,status:503,json:{code:'LOCAL_RESPONSE_LOST'}});
      }
    }
    await route.continue();
  });
  const waitHeld=async section=>{
    for(let i=0;i<160;i++){
      if(held.has(section))return held.get(section);
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('C2_HELD_RESPONSE_MISSING');
  };
  const go=async (page,where)=>page.goto(origin+where,{waitUntil:'domcontentloaded',timeout:8000});
  const editor=(page,section)=>go(page,'/dashboard/editor#'+section);
  const value=(page,selector,expected)=>page.waitForFunction(({selector,expected})=>
    document.querySelector(selector)?.value===expected,{selector,expected},{timeout:8000});
  const readOn=(page,path)=>page.waitForResponse(response=>response.url()===origin+path &&
    response.request().method()==='GET',{timeout:8000});
  const login=async page=>{
    await go(page,'/login');
    await page.locator('[name=email]').fill(a.email);
    await page.locator('[name=password]').fill(a.password);
    await page.locator('form.account-form button[type=submit]').click();
    await page.waitForURL(origin+'/dashboard',{timeout:8000});
    return adoptBrowserSession(a);
  };
  const chrome=await chromium.launch({channel:'chrome',timeout:10000});
  try{
    const context=await chrome.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}});
    await attach(context);
    const page=await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('dialog',dialog=>dialog.accept());
    activeOwner=await login(page);
    const firstOwner=activeOwner;

    phase('C2-native-idempotency');
    await editor(page,'introduction');
    for(const [locale,text] of Object.entries(intro))await field(page,'introduction',locale).fill(text);
    const firstResponse=page.waitForResponse(response=>response.url()===origin+introductionPath &&
      response.request().method()==='POST',{timeout:8000});
    await button(page,'保存草稿').click();
    const original=await firstResponse;
    assert.equal(original.status(),200);
    const receipt=await original.json();
    const body=original.request().postDataJSON();
    assert.deepEqual(introductionText(receipt.draft),intro);
    assert.equal(receipt.draft.revision,1);
    const args=textDraftArgs(a.site,body.command);
    const before=receiptState(obs,a,b);
    assert.deepEqual(Object.values(before.sites).sort(),[0,1]);
    assert.equal(before.audits,1);
    const duplicate=await rest('save_text_draft',args,firstOwner.token);
    assert.equal(duplicate.status,200,duplicate.value.code);
    assert.equal(duplicate.value.request_id,receipt.requestId);
    assert.equal(duplicate.value.draft_revision,receipt.draft.revision);
    assert.equal(duplicate.value.changed,receipt.changed);
    assert.equal(await textCommandDigestIntroduction(args.canonical_request),receipt.digest);
    assert.deepEqual(receiptState(obs,a,b),before);
    mark('C2.1 same canonical command reached native save; PostgreSQL state unchanged',
      {rpc:'save_text_draft',requestId:receipt.requestId,digest:receipt.digest,revision:1,
        sites:before.sites,history:before.history,audits:before.audits,operations:before.operations,records:before.records});

    phase('C2-bilingual-titles');
    const titles=sampleText('site-text').translations;
    const contacts=sampleText('contact').translations;
    const visitTitles=async locale=>{
      for(const [section,key] of [...Object.entries(sectionTitleFields),['contact','contactLabel']]){
        const label=section==='contact'?contacts[locale].contactLabel:titles[locale][key];
        const link=page.locator('.dashboard-sidebar a[href="#'+section+'"]');
        await link.click();
        await page.waitForFunction(label=>document.querySelector('.editor-heading h1')?.textContent===label,label,{timeout:8000});
        assert.ok((await link.innerText()).includes(label));
        assert.ok((await page.locator('.dashboard-breadcrumb').innerText()).includes(label));
        const heading=page.locator('.editor-preview [data-site-section="'+section+'"] [data-preview-value="'+key+'"]');
        await heading.waitFor({timeout:8000});
        assert.equal((await heading.textContent())?.trim(),label);
      }
    };
    await editor(page,'experience');
    await visitTitles('zh');
    await select(page,'experience');
    await page.locator('button.record-add').click();
    await field(page,'title','zh').fill('本地记录名称');
    await status(page,'未保存：'+titles.zh.experienceLabel);
    assert.equal(await page.locator('.editor-heading h1').innerText(),titles.zh.experienceLabel);
    await button(page,'撤销修改').click();
    await page.locator('.dashboard-header .ui-locale-switch').getByRole('button',{name:'English',exact:true}).click();
    await page.locator('.public-nav-language').click();
    await visitTitles('en');
    await select(page,'experience');
    await page.locator('button.record-add').click();
    await field(page,'title','en').fill('A local record name');
    await status(page,'Unsaved: '+titles.en.experienceLabel);
    assert.equal(await page.locator('.editor-heading h1').innerText(),titles.en.experienceLabel);
    await button(page,'Undo changes').click();
    await page.locator('.public-nav-language').click();
    await page.locator('.dashboard-header .ui-locale-switch').getByRole('button',{name:'中文',exact:true}).click();
    mark('C2.3 six native-backed titles in both locales and unsaved labels; row name stays independent',{titleCount:6});

    phase('C2-skills-and-overlap');
    const other=await context.newPage();
    other.setDefaultTimeout(8000);
    other.on('dialog',dialog=>dialog.accept());
    try{
      const skillsBase=readOn(other,resumeTextPath+'/skills');
      await editor(other,'skills');
      const empty=await skillsBase;
      assert.equal(empty.status(),200);
      assert.deepEqual(await empty.json(),{siteId:a.site,section:'skills',revision:0,content:{entries:[]}});
      for(const [category,zh,en] of [['analytics','查询','Queries'],['programming','构建','Build'],['tools','写作','Writing']]){
        await other.locator('button.record-add').click();
        await other.getByLabel('技能类别').selectOption(category);
        await field(other,'items','zh').fill(zh);
        await field(other,'items','en').fill(en);
      }
      const first=other.waitForResponse(response=>response.url()===origin+savePath&&response.request().method()==='POST',{timeout:8000});
      await button(other,'保存草稿').click();
      const firstSave=await first;
      assert.equal(firstSave.status(),200);
      const firstSkills=savedPosts.at(-1);
      const initialSkills=(await firstSave.json()).snapshot;
      verifyPayload(firstSkills,initialSkills);
      assert.deepEqual(initialSkills.content.entries.map(row=>row.translations.zh.title),
        ['analytics','programming','tools'].map(key=>skillPresetTitles[key].zh));
      expected.set('skills:1',initialSkills.content);
      await status(other,'已保存草稿');
      await button(other,'上移').nth(2).click();
      await other.locator('button.record-delete').nth(2).click();
      await button(other,'确认删除').click();
      const firstRow=other.locator('.record-list .record-title').first();
      if(await firstRow.getAttribute('aria-expanded')!=='true')await firstRow.click();
      await field(other,'items','en').fill('Edited writing');
      await select(page,'profile');
      await page.locator(profileField).fill('已经提交的姓名');
      holdSections.add('profile');
      holdSections.add('skills');
      await Promise.all([button(page,'保存草稿').click(),button(other,'保存草稿').click()]);
      const [profile,skills]=await Promise.all([waitHeld('profile'),waitHeld('skills')]);
      for(const saved of [profile,skills]){
        assert.equal(saved.status,200,saved.value.code);
        verifyPayload(saved.command,saved.value.snapshot);
        expected.set(saved.command.section+':'+saved.value.snapshot.revision,saved.value.snapshot.content);
      }
      assert.deepEqual(skills.value.snapshot.content.entries.map(row=>row.id),
        [initialSkills.content.entries[2].id,initialSkills.content.entries[0].id]);
      assert.equal(skills.value.snapshot.content.entries[0].translations.en.items,'Edited writing');
      freeze();
      await page.locator(profileField).fill('继续输入仍未保存');
      await select(page,'contact');
      await field(page,'availability','zh').fill('另一个栏目未保存');
      await select(page,'profile');
      profile.release();
      skills.release();
      await Promise.all([status(page,'保存结果待核对'),status(other,'保存结果待核对')]);
      const pending=[profile.pending,skills.pending];
      assert.deepEqual((await markers(page)).sort((x,y)=>x.section.localeCompare(y.section)),pending);
      const countBefore=savedPosts.length;
      await other.reload({waitUntil:'domcontentloaded',timeout:8000});
      await button(other,'核对保存结果').waitFor();
      assert.deepEqual((await markers(other)).sort((x,y)=>x.section.localeCompare(y.section)),pending);
      await button(page,'核对保存结果').click();
      await status(page,'已保存草稿');
      assert.deepEqual(await markers(other),[skills.pending]);
      await value(page,profileField,'继续输入仍未保存');
      await status(page,'未保存：');
      await select(page,'contact');
      assert.equal(await field(page,'availability','zh').inputValue(),'另一个栏目未保存');
      await button(other,'核对保存结果').click();
      await status(other,'已保存草稿');
      assert.deepEqual(await markers(page),[]);
      assert.deepEqual(lookups.slice(-2),pending);
      assert.equal(savedPosts.length,countBefore);
      for(const marker of pending)journal({...marker,uid:activeOwner.uid,sid:activeOwner.sid,outcome:'reconciled'});
      const state=observeText();
      resumeAfterProof();
      const stale=make(firstOwner,'profile',0,sampleText('profile'));
      const conflict=await rest('save_resume_text',native(stale),firstOwner.token);
      assert.deepEqual([conflict.status,conflict.value.code],[409,'PT409']);
      assert.deepEqual(observeText(),state);
      mark('C2.4 overlapping native commits, independent pending locators, dirty edits, and stale CAS',{staleSqlState:'PT409',pending:pending.map(p=>p.requestId)});
      const rows=await other.locator('.record-list .record-title > span:last-child').allTextContents();
      assert.deepEqual(rows,[skillPresetTitles.tools.zh,skillPresetTitles.analytics.zh]);
      const rowToggle=other.locator('.record-list .record-title').first();
      if(await rowToggle.getAttribute('aria-expanded')!=='true')await rowToggle.click();
      assert.equal(await field(other,'items','en').inputValue(),'Edited writing');
      mark('C2.5 explicit Skills adoption, edit, delete and order with native revision and refreshed UI',
        {revisions:[1,2],ids:skills.value.snapshot.content.entries.map(row=>row.id),guidePersisted:false});
    } finally {
      for(const item of held.values())item.release();
      await other.close();
    }

    phase('C2-relogin');
    const oldCookie=(await context.cookies(origin)).map(({name,value})=>name+'='+value).join('; ');
    await go(page,'/account');
    await button(page,'退出登录').click();
    await page.waitForURL(origin+'/login',{timeout:8000});
    assert.deepEqual(await markers(page),[]);
    const renewed=await login(page);
    assert.notEqual(renewed.sid,firstOwner.sid);
    const introRead=readOn(page,introductionPath);
    await editor(page,'introduction');
    const reread=await introRead;
    assert.equal(reread.status(),200);
    assert.equal(await reread.headerValue(scopeHeader),renewed.scope);
    const snapshot=await reread.json();
    assert.equal(snapshot.siteId,a.site);
    assert.equal(snapshot.revision,1);
    assert.deepEqual(introductionText(snapshot),intro);
    const sessionClosed=obs(`SELECT json_build_object('oldSessionGone',NOT EXISTS(SELECT FROM auth.sessions WHERE id='${firstOwner.sid}'),
      'oldRefreshUsable',EXISTS(SELECT FROM auth.refresh_tokens WHERE session_id='${firstOwner.sid}' AND NOT revoked),
      'newSessionPresent',EXISTS(SELECT FROM auth.sessions WHERE id='${renewed.sid}' AND user_id='${a.uid}'));`);
    assert.deepEqual(sessionClosed,{oldSessionGone:true,oldRefreshUsable:false,newSessionPresent:true});
    take('textHTTP');
    const old=await mf.dispatchFetch(origin+introductionPath,
      {headers:{Cookie:oldCookie,[workspaceScopeHeader]:firstOwner.scope}});
    assert.ok([401,403].includes(old.status));
    safariOwner={scope:renewed.scope,cookies:await context.cookies(origin)};
    mark('C2.2 old session revoked; new GoTrue session reads original bilingual draft',
      {...sessionClosed,oldHttpStatus:old.status,revision:snapshot.revision});
  } finally {await chrome.close();}

  phase('C2-browser-bob');
  await verifyBobBrowsers();
  if(process.env.S47_SAFARI_DRIVER){
    ensureBudget({textHTTP:10,allSaveEntrances:2,sqlObservation:2},'C2_SAFARI_AND_DENIALS');
    try{
      await verifyNativeSafari(process.env.S47_SAFARI_DRIVER,safariOwner);
      mark('C2.7 native Safari actual Alice HTTP reads original Introduction and saved titles',{revision:1});
    } catch {
      // Keep the required qualification probes available even if the native browser is unavailable.
      witness.nativeSafari='READ_NOT_CONFIRMED';
    }
  }

  phase('C2-native-denials');
  ensureBudget({textHTTP:8,allSaveEntrances:2,sqlObservation:2},'C2_DENIALS');
  const beforeDenied=observeText();
  for(const [owner,revision] of [[a,1],[b,0]]){
    const allowed=await rest('read_resume_text',{target:owner.site,section_key:'profile'},owner.token);
    assert.equal(allowed.status,200,allowed.value.code);
    assert.equal(allowed.value.siteId,owner.site);
    assert.equal(allowed.value.revision,revision);
  }
  sql(`UPDATE site_private.business_session_grants SET revoked_at=clock_timestamp(),reason='user_logout'
    WHERE id='${a.grant}' AND auth_user_id='${a.uid}' AND auth_session_id='${a.sid}' AND revoked_at IS NULL;
    UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 minute' WHERE id='${b.sid}' AND user_id='${b.uid}';`);
  for(const owner of [a,b]){
    const read=await rest('read_resume_text',{target:owner.site,section_key:'profile'},owner.token);
    assert.deepEqual([read.status,read.value.code],[403,'42501']);
    const write=await rest('save_resume_text',native(make(owner,'profile',0,sampleText('profile'))),owner.token);
    assert.deepEqual([write.status,write.value.code],[403,'42501']);
  }
  assert.deepEqual(observeText(),beforeDenied);
  mark('C2.6 native read and save denied after Grant revocation or Session expiry',
    {sqlstate:'42501',versionsAndReceiptsUnchanged:true});

  return {gRead:'LOCAL_PASS',gSave:'LOCAL_PASS'};

  async function verifyBobBrowsers(){
    for(const [name,engine] of [['Firefox',firefox],['Playwright WebKit',webkit]]){
      ensureBudget({textHTTP:14,allSaveEntrances:2},'C2_BROWSER_READ');
      const browser=await engine.launch({timeout:10000});
      try{
        const context=await browser.newContext({ignoreHTTPSErrors:true});
        await attach(context);
        await context.addCookies(b.cookie.split('; ').map(fragment=>{
          const i=fragment.indexOf('=');
          return {name:fragment.slice(0,i),value:fragment.slice(i+1),url:origin,secure:true,httpOnly:true};
        }));
        const page=await context.newPage();
        const pending=readOn(page,resumeTextPath+'/profile');
        await editor(page,'profile');
        const response=await pending;
        assert.equal(response.status(),200);
        assert.deepEqual(await response.json(),{siteId:b.site,section:'profile',revision:0,content:emptyTextContent('profile')});
        mark('C2.7 '+name+' actual Bob HTTP read',{revision:0,status:200});
      } finally {await browser.close();}
    }
  }

  async function verifyNativeSafari(driver,owner){
    assert.match(driver,/^http:\/\/127\.0\.0\.1:\d+$/);
    const wire=async(path,method,body)=>{
      const response=await fetch(driver+'/session'+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),
        ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
      assert.ok(response.ok,'SAFARI_DRIVER_HTTP');
      return (await response.json()).value;
    };
    const {sessionId}=await wire('','POST',{capabilities:{alwaysMatch:{browserName:'safari',acceptInsecureCerts:true}}});
    const session='/'+sessionId;
    try{
      await wire(session+'/url','POST',{url:origin+'/login'});
      for(const {name,value} of owner.cookies)
        await wire(session+'/cookie','POST',{cookie:{name,value,path:'/',secure:true,httpOnly:true}});
      for(const path of [introductionPath,resumeTextPath+'/site-text']){
        take('textHTTP');
        const response=await wire(session+'/execute/async','POST',{script:
          'const [path,header,scope,done]=arguments; fetch(path,{headers:{[header]:scope}}).then(async r=>done({status:r.status,value:await r.json()}),()=>done(null));',
          args:[path,workspaceScopeHeader,owner.scope]});
        assert.equal(response?.status,200);
        assert.equal(response.value.siteId,a.site);
        assert.equal(response.value.revision,1);
        if(path===introductionPath)assert.deepEqual(introductionText(response.value),intro);
        else assert.deepEqual(response.value.content,sampleText('site-text'));
      }
    } finally {await wire(session,'DELETE');}
  }
}

async function textCommandDigestIntroduction(canonical){
  return Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical))).toString('hex');
}
