'use client';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {useUiLocale} from './ui-locale';
import {validSiteSlug, type SiteCreationIntent, type SiteViewModel} from '../../lib/site/model';

export function WebsiteWorkspace({model}: {model: SiteViewModel}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [guide, setGuide] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const guideAvailable = ['empty', 'unavailable'].includes(model.state);
  const titles = {
    loading: text('正在读取站点状态', 'Reading website status'),
    empty: text('已确认没有网站', 'No website found'),
    ready: text('我的网站', 'Your website'),
    denied: text('暂无站点访问权限', 'Website access denied'),
    revoked: text('建站资格已撤销', 'Website eligibility revoked'),
    unavailable: text(model.state === 'unavailable' && model.reason === 'not-connected' ? '站点服务尚未接入' : '暂时无法读取站点状态', model.state === 'unavailable' && model.reason === 'not-connected' ? 'Website service is not connected' : 'Website status is unavailable'),
  };
  return <div className="website-workspace">
    <section className="dashboard-intro"><h1>{text('我的网站', 'My website')}</h1><p>{text('查看站点状态，了解首次建站步骤。', 'Review your website status and plan your first website.')}</p></section>
    {model.source === 'synthetic' && <p className="website-fixture-note" role="note">{text('合成数据 · 仅供离线界面验收，不代表真实账户或网站。', 'Synthetic data · Offline UI review only. These are not real websites or account facts.')}</p>}
    <section className="website-status" aria-labelledby="website-status-title" aria-busy={model.state === 'loading'}>
      <div className="website-status-heading"><h2 id="website-status-title">{titles[model.state]}</h2><span className="website-state-label">{text('站点状态', 'Website status')}</span></div>
      <div role={['denied','revoked','unavailable'].includes(model.state) ? 'alert' : 'status'}>
        {model.state === 'loading' && <p>{text('正在确认你的网站信息，请稍候。', 'Checking your website information. Please wait.')}</p>}
        {model.state === 'empty' && <p>{text('当前账户还没有网站。你可以查看建站引导，真实创建尚未开放。', 'This account has no website yet. Explore the setup guide; real creation is not available.')}</p>}
        {model.state === 'unavailable' && <p>{text('目前无法确认你是否已有网站。服务未接入或暂时故障，不等于没有网站。', 'We cannot confirm whether you already have a website. An unavailable service does not mean that no website exists.')}</p>}
        {model.state === 'denied' && <p>{text('当前账户未获站点读取授权。不会展示站点资料，也不会将权限拒绝解释为没有网站。', 'This account is not authorized to read website information. Access denial is not treated as an empty account.')}</p>}
        {model.state === 'revoked' && <p>{text('站点业务资格已撤销。站点读取与创建保持关闭；账户与安全仍可使用。', 'Website eligibility has been revoked. Website reads and creation remain closed; account security is still available.')}</p>}
      </div>
      {model.state === 'ready' && model.sites.map(site => <div className="website-summary" key={site.siteId}>
        <h3>{site.name ?? text('网站名称暂不可用', 'Website name unavailable')}</h3>
        <dl><div><dt>Slug</dt><dd>{site.slug ?? text('暂不可用', 'Unavailable')}</dd></div><div><dt>{text('内容语言', 'Content language')}</dt><dd>{site.contentLanguage === 'zh' ? '中文' : site.contentLanguage === 'en' ? 'English' : text('暂不可用', 'Unavailable')}</dd></div></dl>
        <details><summary>{text('站点标识', 'Website identifier')}</summary><code>{site.siteId}</code></details>
        <p>{text('第一版每个账户仅支持一个网站。编辑、保存与发布尚未开放。', 'The first version supports one website per account. Editing, saving and publishing are not open.')}</p>
      </div>)}
      {guideAvailable && !guide && <button ref={trigger} type="button" className="website-primary" onClick={()=>setGuide(true)}>{text('查看首次建站引导', 'Explore the setup guide')}</button>}
      {model.state === 'unavailable' && !guide && <button type="button" className="website-text-button" onClick={()=>location.reload()}>{text('重新读取状态', 'Reload status')}</button>}
    </section>
    {guide && guideAvailable && <WebsiteGuide onClose={()=>{setGuide(false);requestAnimationFrame(()=>trigger.current?.focus());}}/>}
    <section className="website-boundary"><h2>{text('当前可用范围', 'What is available')}</h2><p>{text('本页仅提供状态展示与建站引导。不会创建、保存或发布网站，不预留 Slug，也不生成正式公开网址。', 'This page provides status information and a setup guide. It does not create, save or publish websites, reserve slugs or generate public URLs.')}</p><a href="/account">{text('账户与安全', 'Account & security')} →</a></section>
  </div>;
}

function WebsiteGuide({onClose}: {onClose: () => void}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState<SiteCreationIntent>({name:'',slug:'',contentLanguage:'zh',initialTemplate:'minimal-resume'});
  const [errors, setErrors] = useState<{name?: boolean; slug?: boolean}>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const nameField = useRef<HTMLInputElement>(null), slugField = useRef<HTMLInputElement>(null);
  useEffect(()=>{heading.current?.focus();},[step]);
  const names = [text('网站信息', 'Website details'),text('语言与模板', 'Language & template'),text('检查建站意向', 'Review your choices')];
  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(step === 0) {
      const invalid = {name: !intent.name.trim() || intent.name.length>80, slug: !validSiteSlug(intent.slug)};setErrors(invalid);
      if(invalid.name || invalid.slug) {requestAnimationFrame(()=>{(invalid.name ? nameField : slugField).current?.focus();});return;}
    }
    setStep(Math.min(step+1,2));
  }
  return <section className="website-guide" aria-labelledby="website-guide-title">
    <div className="website-guide-heading"><h2 id="website-guide-title" tabIndex={-1} ref={heading}>{text('首次建站引导', 'First website guide')}</h2><button className="website-text-button" type="button" onClick={onClose}>{text('关闭引导', 'Close guide')}</button></div>
    <p className="website-local-note">{text('输入仅保留在当前页面；关闭、刷新或离开即清空。这里不会执行创建，也不会检查 Slug 是否可用。', 'Your input stays on this page only and is cleared when you close, reload or leave. This guide does not create a website or check slug availability.')}</p>
    <ol className="website-steps" aria-label={text('建站步骤', 'Setup steps')}>{names.map((name,i)=><li key={i} aria-current={i===step?'step':undefined}><span>{i+1}</span>{name}</li>)}</ol>
    <form className="website-guide-form" onSubmit={next} method="post" action="/dashboard/website" noValidate>
      <h3>{names[step]}</h3>
      {step===0 && <>
        <div className="website-field"><label htmlFor="site-name">{text('网站名称', 'Website name')}</label><input ref={nameField} id="site-name" name="name" value={intent.name} maxLength={80} required autoComplete="off" aria-invalid={errors.name || undefined} aria-describedby={errors.name?'site-name-error':undefined} onChange={e=>{setIntent({...intent,name:e.target.value});setErrors(previous=>({...previous,name:false}));}}/>{errors.name && <p id="site-name-error" role="alert">{text('请输入 1–80 个字符的网站名称。', 'Enter a website name of 1–80 characters.')}</p>}</div>
        <div className="website-field"><label htmlFor="site-slug">Slug</label><input ref={slugField} id="site-slug" name="slug" value={intent.slug} maxLength={48} required autoCapitalize="none" spellCheck={false} autoComplete="off" aria-invalid={errors.slug || undefined} aria-describedby={'site-slug-hint'+(errors.slug?' site-slug-error':'')} onChange={e=>{setIntent({...intent,slug:e.target.value});setErrors(previous=>({...previous,slug:false}));}}/><p id="site-slug-hint">{text('3–48 位小写英文字母、数字或连字符，字母开头、字母或数字结尾，不使用保留名称。仅检查格式，不代表可用或已预留。', 'Use 3–48 lowercase letters, digits or hyphens; start with a letter, end with a letter or digit, and avoid reserved names. Format checks do not confirm availability or reserve a slug.')}</p>{errors.slug && <p id="site-slug-error" role="alert">{text('请按上述规则调整 Slug。', 'Adjust the slug to match the format above.')}</p>}</div>
      </>}
      {step===1 && <>
        <fieldset><legend>{text('简历内容语言', 'Resume content language')}</legend><p>{text('与右上角的界面语言独立。后续双语编辑另行开放。', 'Separate from the interface language. Bilingual content editing will be available later.')}</p><div className="website-options">{(['zh','en'] as const).map(l=><label key={l}><input type="radio" name="contentLanguage" checked={intent.contentLanguage===l} onChange={()=>setIntent({...intent,contentLanguage:l})}/>{l==='zh'?'中文':'English'}</label>)}</div></fieldset>
        <fieldset><legend>{text('初始模板意向', 'Initial template preference')}</legend><label className="website-template"><input type="radio" name="initialTemplate" checked readOnly value="minimal-resume"/><span><strong>{text('简约履历', 'Minimal resume')}</strong><span>{text('清晰文字层次与细线分区。这里只记录页面内的选择，模板应用尚未开放。', 'Clear typography and fine dividers. This is a page-only preference; applying a template is not available.')}</span></span></label></fieldset>
      </>}
      {step===2 && <>
        <dl className="website-review"><div><dt>{text('网站名称', 'Website name')}</dt><dd>{intent.name.trim()}</dd></div><div><dt>Slug</dt><dd>{intent.slug}</dd></div><div><dt>{text('内容语言', 'Content language')}</dt><dd>{intent.contentLanguage==='zh'?'中文':'English'}</dd></div><div><dt>{text('初始模板意向', 'Initial template preference')}</dt><dd>{text('简约履历', 'Minimal resume')}</dd></div></dl>
        <aside className="website-privacy"><h3>{text('隐私与公开范围', 'Privacy & visibility')}</h3><p>{text('当前没有数据写入或公开分享。未来建站应先生成私有草稿，只有经明确发布操作后才可公开；该流程仍待服务验收。请勿在此填写身份证号等敏感资料。', 'Nothing is written or shared publicly here. Future setup should start as a private draft and become public only after an explicit publish action; that workflow still needs service acceptance. Avoid entering sensitive personal data.')}</p></aside>
        <p className="website-create-note" id="website-create-note">{text('真实建站服务尚未开放。以下按钮不可用；当前选择未保存，网站未创建。', 'Real website creation is not available. The button below is disabled; your choices are not saved and no website has been created.')}</p>
      </>}
      <div className="website-guide-actions">{step>0 && <button className="website-secondary" type="button" onClick={()=>setStep(step-1)}>{text('上一步', 'Back')}</button>}{step<2 ? <button className="website-primary" type="submit">{text('下一步', 'Next')}</button> : <button className="website-primary" type="button" disabled aria-describedby="website-create-note">{text('创建网站 · 尚未开放', 'Create website · Not available')}</button>}</div>
    </form>
  </section>;
}
