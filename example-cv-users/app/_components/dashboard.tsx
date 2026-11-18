'use client';
import {useEffect, useRef, useState} from 'react';
import {useUiLocale} from './ui-locale';

const features = [
  ['01', '创建网站', 'Create a website', '网站创建功能尚未开放。', 'Website creation is not available yet.'],
  ['02', '简历编辑', 'Resume editing', '双语内容编辑与保存尚未开放。', 'Bilingual editing and saving are not available yet.'],
  ['03', '文件管理', 'Files', '头像与文件上传尚未开放。', 'Photo and document uploads are not available yet.'],
  ['04', '发布网站', 'Publishing', '发布与撤回功能尚未开放。', 'Publishing and unpublishing are not available yet.'],
  ['05', '活动与历史', 'Activity & history', '活动记录、版本历史与恢复尚未开放。', 'Activity, version history and restore are not available yet.'],
  ['06', 'AI 助手', 'AI assistance', 'AI 建议功能尚未开放。', 'AI suggestions are not available yet.'],
] as const;

export function Dashboard() {
  const {locale, setLocale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Never reveal a restored private page without a fresh server session check.
    const hide = () => { if (root.current) root.current.hidden = true; };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { hide(); location.reload(); } };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', restore); };
  }, []);
  const navigation = <>
    <p className="dashboard-nav-label">{text('工作区', 'WORKSPACE')}</p>
    <a className="dashboard-nav-current" href="#overview" aria-current="page" onClick={() => setOpen(false)}>{text('概览', 'Overview')}<span aria-hidden="true">↗</span></a>
    {features.map(([id, zh, en]) => <span className="dashboard-nav-disabled" aria-disabled="true" key={id}>
      <span>{text(zh, en)}</span><small>{text('未开放', 'Not available')}</small>
    </span>)}
    <p className="dashboard-nav-label dashboard-nav-account">{text('账户', 'ACCOUNT')}</p>
    <a href="/account" onClick={() => setOpen(false)}>{text('账户设置', 'Account settings')}<span aria-hidden="true">↗</span></a>
  </>;
  return <div className="dashboard" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); }
  }}>
    <a className="dashboard-skip" href="#dashboard-main">{text('跳至主要内容', 'Skip to main content')}</a>
    <aside className="dashboard-sidebar">
      <a className="dashboard-brand" href="/dashboard"><strong>EXAMPLE_CV</strong><span>{text('个人工作区', 'Personal workspace')}</span></a>
      <nav aria-label={text('工作区导航', 'Workspace navigation')}>{navigation}</nav>
      <p className="dashboard-sidebar-note">{text('从这里，准备你的下一步。', 'A place to prepare your next step.')}</p>
    </aside>
    <div className="dashboard-body">
      <header className="dashboard-header">
        <a className="dashboard-mobile-brand" href="/dashboard">EXAMPLE_CV</a>
        <span className="dashboard-breadcrumb">{text('个人工作区 / 概览', 'Workspace / Overview')}</span>
        <div className="dashboard-header-actions">
          <div className="ui-locale-switch" role="group" aria-label={text('界面语言', 'Interface language')}>
            <button type="button" aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button><span aria-hidden="true">/</span>
            <button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button>
          </div>
          <button className="dashboard-menu-toggle" ref={toggle} type="button" aria-expanded={open} aria-controls="dashboard-mobile-navigation" onClick={() => setOpen(!open)}>{text(open ? '关闭导航' : '打开导航', open ? 'Close navigation' : 'Open navigation')}</button>
        </div>
      </header>
      <nav className="dashboard-mobile-navigation" id="dashboard-mobile-navigation" hidden={!open} aria-label={text('移动端工作区导航', 'Mobile workspace navigation')}>{navigation}</nav>
      <main className="dashboard-main" id="dashboard-main" tabIndex={-1}>
        <section className="dashboard-intro" id="overview">
          <p className="dashboard-eyebrow">{text('你的下一章', 'YOUR NEXT CHAPTER')}</p>
          <h1>{text('工作区概览', 'Your workspace, at a glance.')}</h1>
          <p>{text('管理账户，了解简历工作区的功能进展。', 'Manage your account and see what is available in your resume workspace.')}</p>
        </section>
        <div className="dashboard-summary">
          <section><span className="dashboard-status"><i aria-hidden="true"/>{text('可使用', 'Available')}</span>
            <h2>{text('账户与安全', 'Account & security')}</h2><p>{text('查看账户状态，管理密码或退出登录。', 'Check your account, manage your password or sign out.')}</p>
            <a href="/account">{text('前往账户设置', 'Go to account settings')} <span aria-hidden="true">↗</span></a></section>
          <section><span className="dashboard-status dashboard-status-muted">{text('尚未开放', 'Not available yet')}</span>
            <h2>{text('简历内容功能', 'Resume workspace')}</h2><p>{text('当前提供工作区基础界面。网站与内容功能开放后将在这里显示。', 'The dashboard foundation is ready. Website and content features will appear here when available.')}</p>
            <span className="dashboard-summary-note">{text('界面语言不影响未来简历的内容语言。', 'Interface language is separate from future resume content languages.')}</span></section>
        </div>
        <section className="dashboard-capabilities" aria-labelledby="dashboard-capabilities-title">
          <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">{text('功能状态', 'FEATURE AVAILABILITY')}</p><h2 id="dashboard-capabilities-title">{text('接下来，在这里完成', 'What comes next')}</h2></div><span>{text('6 项功能尚未开放', '6 features not available yet')}</span></div>
          <p className="dashboard-section-description">{text('此页面不读取网站状态，也不执行内容保存或发布。', 'This page does not read website status, save content or publish a website.')}</p>
          <ul>{features.map(([id, zh, en, zhDescription, enDescription]) => <li key={id}>
            <span className="dashboard-feature-number" aria-hidden="true">{id}</span><div><h3>{text(zh, en)}</h3><p>{text(zhDescription, enDescription)}</p></div><span className="dashboard-feature-status">{text('未开放', 'Not available')}</span>
          </li>)}</ul>
        </section>
        <footer className="dashboard-footer"><span>EXAMPLE_CV</span><span>{text('每一步，都从准备开始。', 'Every next step starts with preparation.')}</span></footer>
      </main>
    </div>
  </div>;
}
