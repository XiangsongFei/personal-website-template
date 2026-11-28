import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {applyTextContent,emptyTextContent,repeatableTextSections,resumeTextPath,textCommand,textCommandDigest,textSections} from '../../lib/editor/resume-text.ts';
import {introductionPath, workspaceScopeHeader} from '../../lib/editor/introduction-dto.ts';
import {sectionTitleFields} from '../../lib/editor/site-text.ts';
import {emptyDraft} from '../../lib/editor/draft.ts';
import {skillCategory,skillPresetTitles} from '../../lib/editor/records.ts';

export const s47Functions=[
  'site_api.read_resume_text(uuid,text)', 'site_api.save_resume_text(jsonb,text)',
  'site_api.read_resume_text_operation(uuid,text,uuid,text,bigint)',
  'site_api.read_introduction_receipt(uuid,uuid,text,bigint)',
];
export const s47RpcNames=s47Functions.map(signature=>signature.slice(9,signature.indexOf('(')));
const pair=(zh,en)=>({zh,en});
const row=(position,translations,extra={})=>({id:randomUUID(),position,...(translations?{translations}:{}),...extra});
const native=command=>({input:command,canonical:JSON.stringify(command)});
const labels=Object.fromEntries(Object.entries(sectionTitleFields).map(([section,key])=>[key,'验收 '+section]));
const selectors={profile:'name',introduction:'introduction'};
const introValues=pair('原键恢复的合成介绍','Synthetic introduction with original receipt');

export function sampleText(section){
  const content=emptyTextContent(section);
  if(section==='profile'){
    content.shared.footerName='Synthetic footer';
    content.shared.graduationValue='2030';
    Object.assign(content.translations.zh,{name:'甲 个人资料',graduationLabel:'毕业'});
    Object.assign(content.translations.en,{name:'Synthetic Alice',graduationLabel:'Graduation'});
  } else if(section==='contact'){
    content.translations=pair({contactLabel:'联系区',availability:'欢迎联系'},{contactLabel:'Contact Alice',availability:'Available'});
    content.focus=[row(0,pair({title:'方向',detail:'文字'},{title:'Focus',detail:'Text'}))];
    content.status=[row(0,pair({title:'开放'},{title:'Open'}),{statusType:'open'})];
  } else if(section==='links'){
    Object.assign(content.shared,{email:'public-resume@example.invalid',emailLabel:'Email',
      github:'https://github.com/example-cv-fixture',githubLabel:'GitHub',linkedInDisplayName:'Synthetic Alice'});
    content.translations=pair({linkedInLabel:'职业链接',linkedInHref:'https://www.linkedin.com/in/synthetic-fixture'},
      {linkedInLabel:'LinkedIn',linkedInHref:'https://www.linkedin.com/in/synthetic-fixture'});
  } else if(section==='site-text'){
    content.translations=pair({...labels,kaggleLabel:'项目链接',portfolioLabel:'简历',updatedAtLabel:'更新'},
      Object.fromEntries([...Object.keys(labels),'kaggleLabel','portfolioLabel','updatedAtLabel'].map(key=>[key,'Fixture '+key])));
    content.navigation=pair({experience:'任职',projects:'项目',skills:'技能',awards:'荣誉',contact:'联系'},
      {experience:'Work',projects:'Projects',skills:'Skills',awards:'Awards',contact:'Contact'});
  } else {
    content.entries=[0,1,2].map(position=>{
      const zh=(section==='awards'?{name:'荣誉 '+position,year:'2028'}:{title:'记录 '+position});
      const en=(section==='awards'?{name:'Award '+position,year:'2028'}:{title:'Record '+position});
      if(section==='experience')Object.assign(zh,{period:'2028—2030',description:'双语项目经历'});
      if(section==='experience')Object.assign(en,{period:'2028–2030',description:'Bilingual work description'});
      if(section==='skills'){
        Object.assign(zh,{title:skillPresetTitles.analytics.zh,items:'数据, 写作'});
        Object.assign(en,{title:skillPresetTitles.analytics.en,items:'Data, Writing'});
      }
      if(section==='projects')Object.assign(en,{href:'https://example.invalid/project/'+position,description:'Project details'});
      const extra=section==='education'?{category:'undergraduate'}:section==='projects'?
        {methods:pair([row(0,undefined,{value:'方法'})],[row(0,undefined,{value:'Method'})])}:{};
      return row(position,pair(zh,en),extra);
    });
  }
  return content;
}
export function editRecords(section,content){
  const entries=structuredClone(content.entries);
  const changed=entries[2];
  const field=section==='awards'?'name':'title';
  changed.translations.zh[field]='修改后的条目';
  changed.translations.en[field]='Updated item';
  if(section==='experience')changed.translations.zh.description='';
  return {entries:[{...changed,position:0},{...entries[0],position:1}]};
}

export function countBrowserText(path,method,take) {
  if(path!==introductionPath && !path.startsWith(introductionPath+'/') &&
    !path.startsWith(resumeTextPath+'/'))return false;
  const save=method==='POST'&&(path===introductionPath||path===resumeTextPath+'/save');
  take('textHTTP',...(save?['allSaveEntrances','workerSaves']:[]));
  return true;
}

async function browserChecks({origin,a,b,adoptBrowserSession,take,lostKey,mark,obs,freeze,resumeAfterProof,dispatch,witness,journal,ensureBudget,followUp}){
  assert.ok(process.env.S47_PLAYWRIGHT_MODULE,'PLAYWRIGHT_NOT_CONFIGURED');
  const {chromium,firefox,webkit}=await import(pathToFileURL(process.env.S47_PLAYWRIGHT_MODULE).href);
  // Includes a lost reply, a second tab, reload, receipt-only recovery, duplicate POST and logout/re-login.
  const titlesToVerify=followUp?Object.keys(sectionTitleFields):['experience'];
  ensureBudget({textHTTP:74+(titlesToVerify.length-1)*4,allSaveEntrances:3,lookups:3,
    sqlObservation:4,passwordLogins:2,grants:2},'CHROME');
  const sameHost=await chromium.launch({channel:'chrome'});
  const context=await sameHost.newContext({ignoreHTTPSErrors:true});
  let browserActor;
  const attach=async session=>session.route('**/*',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    if(url.origin!==origin)return route.abort();
    try{
      countBrowserText(url.pathname,request.method(),take);
    } catch {
      await route.abort();
      return;
    }
    // A real database save completes before its reply is withheld by the local binding.
    if(url.pathname===introductionPath&&request.method()==='POST'&&!witness.browserLostCommandObserved){
      const body=request.postDataJSON();
      assert.ok(browserActor&&body.siteId===browserActor.site);
      lostKey(body.command.request_id);
      witness.browserLostCommandObserved=true;
      journal({section:'introduction',siteId:body.siteId,requestId:body.command.request_id,
        digest:await textCommandDigestIntroduction(body.command),expectedRevision:body.command.expected_draft_revision,
        uid:browserActor.uid,sid:browserActor.sid,outcome:'pending'});
    }
    await route.continue();
  });
  const openField=(page,section,locale)=>page.locator('[data-edit-field="'+selectors[section]+'"][data-edit-locale="'+locale+'"]');
  const value=async(locator,expected)=>{
    await locator.waitFor({timeout:8000});
    const field=await locator.getAttribute('data-edit-field'), locale=await locator.getAttribute('data-edit-locale');
    await locator.page().waitForFunction(({field,locale,expected})=>
      document.querySelector('[data-edit-field="'+field+'"][data-edit-locale="'+locale+'"]')?.value===expected,
      {field,locale,expected},{timeout:8000});
  };
  const login=async(page,owner)=>{
    await page.goto(origin+'/login');
    await page.locator('[name=email]').fill(owner.email);
    await page.locator('[name=password]').fill(owner.password);
    await page.locator('form.account-form button[type=submit]').click();
    await page.waitForURL(origin+'/dashboard',{timeout:8000});
    return adoptBrowserSession(owner);
  };
  await attach(context);
  try{
    const page=await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('dialog',dialog=>dialog.accept());
    const actor=await login(page,a);
    browserActor=actor;
    await page.goto(origin+'/dashboard/editor#introduction');
    await value(openField(page,'introduction','zh'),'');
    for(const locale of ['zh','en'])await openField(page,'introduction',locale).fill(introValues[locale]);
    const request=page.waitForRequest(req=>req.method()==='POST'&&new URL(req.url()).pathname===introductionPath);
    await page.getByRole('button',{name:'保存草稿',exact:true}).click();
    const body=(await request).postDataJSON();
    const digest=await textCommandDigestIntroduction(body.command);
    const pending={section:'introduction',siteId:a.site,requestId:body.command.request_id,
      expectedRevision:body.command.expected_draft_revision,digest};
    await page.getByRole('status').filter({hasText:'保存结果待核对'}).waitFor();
    assert.ok(witness.deliberatelyLostCommittedReply);
    freeze();
    const inspect=()=>obs(`SELECT json_build_object(
      'operations',(SELECT count(*) FROM site_private.operation_requests WHERE site_id='${a.site}' AND request_id='${pending.requestId}'
        AND payload_digest='${digest}' AND actor_auth_user_id='${a.uid}' AND actor_session_id='${actor.sid}' AND state='succeeded'),
      'history',(SELECT count(*) FROM site_data.draft_revisions WHERE site_id='${a.site}' AND site_revision=1),
      'audits',(SELECT count(*) FROM site_private.text_publication_audit WHERE site_id='${a.site}'),
      'revision',(SELECT draft_revision FROM site_data.sites WHERE id='${a.site}'));`);
    const committed=inspect();
    assert.deepEqual(committed,{operations:1,history:1,audits:1,revision:1});
    const stored=async tab=>(await tab.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ecv:pending-text:'))
      .map(key=>JSON.parse(localStorage.getItem(key)))));
    assert.deepEqual(await stored(page),[pending]);
    const other=await context.newPage();
    try{
      await other.goto(origin+'/dashboard/editor#introduction');
      await value(openField(other,'introduction','zh'),introValues.zh);
      assert.deepEqual(await stored(other),[pending]);
    } finally {await other.close();}
    await page.reload();
    await value(openField(page,'introduction','zh'),introValues.zh);
    assert.deepEqual(await stored(page),[pending]);
    const lookup=page.waitForRequest(req=>req.method()==='POST'&&new URL(req.url()).pathname===resumeTextPath+'/introduction-receipt');
    await page.getByRole('button',{name:'核对保存结果',exact:true}).click();
    assert.deepEqual((await lookup).postDataJSON(),pending);
    await page.getByRole('status').filter({hasText:'已保存个人介绍'}).waitFor();
    assert.deepEqual(await stored(page),[]);
    assert.deepEqual(inspect(),committed);
    mark('Chrome real Introduction lost-response refresh and read-only original-key reconciliation',
      {requestId:pending.requestId,digest,secondTabPreserved:true,metadataOnly:true,...committed});
    journal({...pending,uid:a.uid,sid:actor.sid,outcome:'reconciled'});
    lostKey(undefined);
    resumeAfterProof();
    const cookie=(await context.cookies(origin)).map(({name,value:secret})=>name+'='+secret).join('; ');
    const duplicate=await dispatch({...actor,cookie},{attempt:{body}});
    assert.equal(duplicate.status,200,duplicate.value.code);
    assert.equal(duplicate.value.requestId,pending.requestId);
    assert.equal(duplicate.value.digest,digest);
    assert.deepEqual(inspect(),committed);
    mark('Introduction same-key real duplicate POST left transaction and audit counters unchanged',committed);
    await page.goto(origin+'/account');
    await page.getByRole('button',{name:'退出登录',exact:true}).click();
    await page.waitForURL(origin+'/login');
    assert.deepEqual(await stored(page),[]);
    await login(page,a);
    await page.goto(origin+'/dashboard/editor#introduction');
    await value(openField(page,'introduction','en'),introValues.en);
    mark('Chrome real logout, password re-login and persisted bilingual Introduction');
    for(const section of titlesToVerify){
      const title=labels[sectionTitleFields[section]];
      const link=page.locator('.dashboard-sidebar a[href="#'+section+'"]');
      await link.click();
      await page.waitForFunction(expected=>document.querySelector('.editor-heading h1')?.textContent===expected,title);
      assert.ok((await link.innerText()).includes(title));
      assert.ok((await page.locator('.dashboard-breadcrumb').innerText()).includes(title));
      assert.ok((await page.locator('.editor-preview').innerText()).includes(title));
    }
    mark('Chrome real saved title in editor heading, breadcrumb, navigation and preview',{sections:titlesToVerify});
  } finally {await sameHost.close();}

  for(const [name,engine] of [['Firefox',firefox],['Playwright WebKit',webkit]]){
    ensureBudget({textHTTP:18},'BROWSER_READ');
    const browser=await engine.launch();
    try{
      const other=await browser.newContext({ignoreHTTPSErrors:true});
      await attach(other);
      await other.addCookies(b.cookie.split('; ').map(fragment=>{
        const index=fragment.indexOf('=');
        return {name:fragment.slice(0,index),value:fragment.slice(index+1),url:origin,secure:true,httpOnly:true};
      }));
      const page=await other.newPage();
      await page.goto(origin+'/dashboard/editor#profile');
      await value(openField(page,'profile','zh'),'');
      await page.locator('.dashboard-sidebar a[href="#experience"]').click();
      await page.getByText('暂无工作记录。',{exact:true}).waitFor({timeout:8000});
      mark(name+' real Bob private read and cross-account browser isolation');
    } finally {await browser.close();}
  }
}

async function textCommandDigestIntroduction(command){
  const bytes=new TextEncoder().encode(JSON.stringify({operation:'save_text_draft',...command}));
  const result=await crypto.subtle.digest('SHA-256',bytes);
  return Buffer.from(result).toString('hex');
}

export async function runFullText(ctx){
  const {a,b,mf,origin,phase,mark,obs,rest,take,counts,witness,sql,journal,freeze,checkDenial,deniedRoles,ensureBudget,followUp}=ctx;
  const send=async(actor,section,body)=>{
    const path=resumeTextPath+'/'+section;
    const method=body?'POST':'GET';
    countBrowserText(path,method,take);
    const r=await mf.dispatchFetch(origin+path,{
      method,headers:{
        ...(actor?{Cookie:actor.cookie,[workspaceScopeHeader]:actor.scope}:{}),
        ...(body?{Origin:origin,'Content-Type':'application/json'}:{}),
      },...(body?{body:JSON.stringify(body)}:{}),
    });
    assert.equal(r.headers.get('cache-control'),'private, no-store');
    return {status:r.status,value:await r.json()};
  };
  const mk=(actor,section,expectedRevision,content)=>textCommand({siteId:actor.site,section,expectedRevision,content,requestId:randomUUID()});
  async function save(command,{allowConflict=false}={}){
    ensureBudget({textHTTP:11,allSaveEntrances:2,lookups:1,sqlObservation:1},'SAVE_WITH_RECONCILIATION');
    const {content,...metadata}=command;
    const digest=await textCommandDigest(command);
    const pending={...metadata,digest,uid:a.uid,sid:a.sid};
    journal({...pending,outcome:'pending'});
    let reply;
    try {reply=await send(a,'save',command);} catch {reply=undefined;}
    if(!reply||reply.status>=500||reply.status===200&&(reply.value.state!=='saved'||reply.value.digest!==digest)){
      freeze();
      journal({...pending,outcome:'UNKNOWN'});
      const reply=await send(a,'operation',{...metadata,digest});
      const independent=obs(`SELECT json_build_object('committed',EXISTS(SELECT FROM site_private.resume_text_receipts
        WHERE site_id='${a.site}' AND section='${command.section}' AND request_id='${command.requestId}'
          AND digest='${digest}' AND actor_uid='${a.uid}' AND actor_sid='${a.sid}' AND basis_revision=${command.expectedRevision}));`);
      if(reply.status===200&&reply.value.state==='saved'&&independent.committed){
        journal({...pending,outcome:'reconciled'});
      }
      throw Error('UNEXPECTED_SAVE_REPLY_STOPPED');
    }
    if(allowConflict&&reply.status===409&&reply.value.code==='REQUEST_CONFLICT'){
      journal({...pending,outcome:'rejected'});
      return;
    }
    assert.equal(reply.status,200,reply.value.code);
    assert.deepEqual(reply.value,{state:'saved',requestId:command.requestId,digest,
      snapshot:{siteId:a.site,section:command.section,revision:command.expectedRevision+1,content}});
    journal({...pending,outcome:'confirmed'});
    return reply.value.snapshot;
  }
  phase('full-ordinary-reads-and-saves');
  assert.equal((await send(null,'profile')).status,401);
  const sections=followUp?['profile','site-text','experience','skills']:textSections;
  const emptySections=['profile','site-text','experience'];
  for(const section of emptySections)
    assert.deepEqual(await send(b,section),{status:200,value:{siteId:b.site,section,revision:0,content:emptyTextContent(section)}});
  witness.gRead='LOCAL_PASS';
  const final=new Map();
  const history=new Map();
  for(const section of sections){
    const initial=await save(mk(a,section,0,sampleText(section)));
    history.set(section,[initial.content]);
    const repeated=!followUp&&repeatableTextSections.includes(section);
    const snapshot=repeated?await save(mk(a,section,1,editRecords(section,initial.content))):initial;
    if(repeated)history.get(section).push(snapshot.content);
    assert.deepEqual(await send(a,section),{status:200,value:snapshot});
    final.set(section,snapshot);
    mark('ordinary Worker read, save and canonical re-read',{section,revision:snapshot.revision,
      created:repeated?3:undefined,modified:repeated?1:undefined,deleted:repeated?1:undefined,reordered:repeated||undefined});
  }
  if(followUp){
    ensureBudget({textHTTP:17,allSaveEntrances:4,lookups:2,sqlObservation:2},'CONCURRENT_CAS');
    const profile=final.get('profile');
    const commands=['Concurrent synthetic A','Concurrent synthetic B'].map(name=>{
      const content=structuredClone(profile.content);
      content.translations.en.name=name;
      return mk(a,'profile',profile.revision,content);
    });
    const results=await Promise.allSettled(commands.map(command=>save(command,{allowConflict:true})));
    const failure=results.find(result=>result.status==='rejected');
    if(failure)throw failure.reason;
    const winners=results.flatMap(result=>result.value?[result.value]:[]);
    assert.equal(winners.length,1);
    assert.equal(winners[0].revision,2);
    assert.deepEqual(await send(a,'profile'),{status:200,value:winners[0]});
    final.set('profile',winners[0]);
    history.get('profile').push(winners[0].content);
    mark('concurrent ordinary Worker commands from one basis commit one revision', {revision:2});
    const skill=applyTextContent(emptyDraft,'skills',final.get('skills').content).skills[0];
    assert.equal(skillCategory(skill),'analytics');
    mark('native-backed Skills preset restored from its two persisted titles');
  }
  phase('full-native-durability-and-denials');
  const observe=()=>obs(`SELECT json_build_object(
    'revisions',(SELECT json_agg(json_build_object('section',section,'revision',revision,'content',content,
      'audit',actor_uid='${a.uid}' AND occurred_at IS NOT NULL,'receipt',EXISTS(SELECT FROM site_private.resume_text_receipts rr
      WHERE (rr.site_id,rr.section,rr.revision,rr.request_id)=(v.site_id,v.section,v.revision,v.request_id)
       AND rr.actor_uid=v.actor_uid AND rr.actor_sid='${a.sid}' AND rr.basis_revision=v.revision-1))
      ORDER BY section,revision) FROM site_private.resume_text_revisions v WHERE site_id='${a.site}'),
    'foreign',(SELECT count(*) FROM site_private.resume_text_revisions WHERE site_id<>'${a.site}'),
    'outbox',(SELECT count(*) FROM site_private.publication_outbox));`);
  const expected=observe();
  assert.equal(expected.foreign,0);
  assert.equal(expected.outbox,0);
  const revisions=followUp?5:14;
  assert.equal(expected.revisions.length,revisions);
  for(const rev of expected.revisions){
    assert.ok(rev.audit&&rev.receipt);
    assert.deepEqual(rev.content,history.get(rev.section)[rev.revision-1]);
  }
  mark('independent PostgreSQL lifecycle, revision, full content, actor and persisted receipts',
    {revisions,matchedAuditFields:revisions,matchedReceipts:revisions,bobRevisions:0,outbox:0});
  if(!followUp){
  for(const role of deniedRoles)
    checkDenial('supabase_admin',`SET SESSION AUTHORIZATION ${role}; SELECT site_api.read_resume_text('${a.site}','profile');`);
  mark('direct database roles rejected for private text read',{roles:deniedRoles,sqlstate:'42501'});
  const cross=await rest('read_resume_text',{target:b.site,section_key:'profile'},a.token);
  assert.deepEqual([cross.status,cross.value.code],[403,'42501']);
  const protectedReceipt=await rest('read_resume_text_operation',
    {target:a.site,section_key:'profile',operation_id:randomUUID(),request_digest:'0'.repeat(64),basis:0},b.token);
  assert.deepEqual([protectedReceipt.status,protectedReceipt.value.code],[403,'42501']);
  const ownership=await rest('save_resume_text',native(mk(b,'experience',0,final.get('experience').content)),b.token);
  assert.deepEqual([ownership.status,ownership.value.code],[403,'42501']);
  const stale=await rest('save_resume_text',native(mk(a,'profile',0,final.get('profile').content)),a.token);
  assert.deepEqual([stale.status,stale.value.code],[409,'PT409']);
  const rollback=await rest('save_resume_text',native(mk(a,'profile',1,final.get('profile').content)),a.token,{rollback:true});
  assert.equal(rollback.status,200,rollback.value.code);
  assert.equal(rollback.rolledBack,true);
  assert.equal(rollback.value.snapshot.revision,2);
  const bad=structuredClone(final.get('links').content);
  bad.shared.github='javascript:void(0)';
  const invalid=await send(a,'save',{siteId:a.site,section:'links',expectedRevision:1,requestId:randomUUID(),content:bad});
  assert.deepEqual(invalid,{status:400,value:{code:'INVALID_INPUT'}});
  assert.deepEqual(observe(),expected);
  mark('native cross-site read/receipt and record ownership, stale CAS, forced rollback, invalid URL and unchanged database',
    {ownership:'42501',cas:'PT409',rollback:true});
  }
  witness.gSave='LOCAL_CORE_PASS';
  phase('full-real-browser-and-original-receipt');
  await browserChecks(ctx);
  assert.deepEqual(observe(),expected);
  phase('full-revocation-and-expiry');
  ensureBudget({textHTTP:9,allSaveEntrances:2,sqlObservation:1},'REVOCATION');
  sql(`UPDATE site_private.business_session_grants SET revoked_at=clock_timestamp(),reason='user_logout'
      WHERE id='${a.grant}' AND auth_user_id='${a.uid}' AND auth_session_id='${a.sid}' AND revoked_at IS NULL;
      UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 minute' WHERE id='${b.sid}' AND user_id='${b.uid}';`);
  assert.equal((await send(a,'profile')).status,403);
  assert.ok([401,403].includes((await send(b,'profile')).status));
  if(followUp){
    assert.equal((await send(a,'save',mk(a,'profile',1,final.get('profile').content))).status,403);
    assert.ok([401,403].includes((await send(b,'save',mk(b,'profile',0,sampleText('profile')))).status));
  }
  assert.deepEqual(observe(),expected);
  mark('native-backed read denied after grant revocation and expired Session; unchanged revisions',
    {sqlObservations:counts.sqlObservation});
  return {gRead:'LOCAL_PASS',gSave:'LOCAL_PASS'};
}
