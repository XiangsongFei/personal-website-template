'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {useUiLocale} from './ui-locale';

export type DashboardSection = 'overview' | 'website' | 'profile' | 'introduction';

type NavItem = {id: string; zh: string; en: string; href?: '#overview' | '/account' | '/dashboard/website' | '/dashboard/editor#profile' | '/dashboard/editor#introduction'};
const navigation: {id: string; zh: string; en: string; items: NavItem[]}[] = [
  {id: 'workspace', zh: '工作台', en: 'Workspace', items: [
    {id: 'overview', zh: '概览', en: 'Overview', href: '#overview'},
    {id: 'website', zh: '我的网站', en: 'My website', href: '/dashboard/website'},
  ]},
  {id: 'resume', zh: '个人简历', en: 'Resume', items: [
    {id: 'profile', zh: '个人资料', en: 'Profile', href: '/dashboard/editor#profile'},
    {id: 'introduction', zh: '个人介绍', en: 'Introduction', href: '/dashboard/editor#introduction'},
    {id: 'education', zh: '教育经历', en: 'Education'},
    {id: 'experience', zh: '工作经历', en: 'Experience'},
    {id: 'projects', zh: '项目经历', en: 'Projects'},
    {id: 'skills', zh: '技能', en: 'Skills'},
    {id: 'awards', zh: '荣誉奖项', en: 'Awards'},
    {id: 'contact', zh: '联系与链接', en: 'Contact & links'},
  ]},
  {id: 'tools', zh: '工具与发布', en: 'Tools & publishing', items: [
    {id: 'files', zh: '文件与媒体', en: 'Files & media'},
    {id: 'ai', zh: 'AI 助手', en: 'AI assistant'},
    {id: 'publish', zh: '预览与发布', en: 'Preview & publish'},
  ]},
  {id: 'settings', zh: '账户与设置', en: 'Account & settings', items: [
    {id: 'privacy', zh: '求职与隐私', en: 'Career & privacy'},
    {id: 'activity', zh: '活动记录', en: 'Activity log'},
    {id: 'history', zh: '版本历史', en: 'Version history'},
    {id: 'site-settings', zh: '网站设置', en: 'Website settings'},
    {id: 'account', zh: '账户与安全', en: 'Account & security', href: '/account'},
  ]},
];
const shortcuts = [
  ['个人资料', 'Profile', '基本信息与头像', 'Personal details and photo'],
  ['个人介绍', 'Introduction', '个人简介与职业方向', 'Introduction and career focus'],
  ['教育经历', 'Education', '院校、学位与课程', 'Schools, degrees and courses'],
  ['工作经历', 'Experience', '工作与实习经历', 'Work and internships'],
  ['项目经历', 'Projects', '项目、方法与成果', 'Projects, methods and outcomes'],
  ['技能与奖项', 'Skills & awards', '专业技能与荣誉', 'Skills and achievements'],
  ['联系与链接', 'Contact & links', '联系方式与个人链接', 'Contact details and links'],
] as const;

function Icon({kind}: {kind: string}) {
  const paths: Record<string, string> = {
    workspace: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    resume: 'M6 3h9l3 3v15H6z M9 10h6 M9 14h6 M9 18h4',
    tools: 'M4 7h16v14H4z M9 7V3h6v4 M4 12h16 M10 12v3h4v-3',
    settings: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    account: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
    website: 'M3 4h18v16H3z M3 9h18 M7 6.5h.01 M10 6.5h.01',
    ai: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    chevron: 'M8 10l4 4 4-4',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    close: 'M6 6l12 12 M6 18L18 6',
    arrow: 'M4 12h16 M14 6l6 6-6 6',
  };
  return <svg className="dashboard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[kind]}/></svg>;
}

function DashboardNavigation({mobile = false, onNavigate, section}: {mobile?: boolean; onNavigate: () => void; section: DashboardSection}) {
  const {locale} = useUiLocale();
  const inEditor = section === 'profile' || section === 'introduction';
  const noteId = mobile ? 'dashboard-nav-note-mobile' : 'dashboard-nav-note-desktop';
  return <>
    <p id={noteId} className="dashboard-nav-note">{locale === 'zh' ? '可使用概览、我的网站、账户安全及本地编辑。' : 'Overview, My website, account security and local editing are available.'}</p>
    {navigation.map(group => <details className="dashboard-nav-group" key={group.id} open>
      <summary><Icon kind={group.id}/><span>{locale === 'zh' ? group.zh : group.en}</span><Icon kind="chevron"/></summary>
      <ul aria-describedby={noteId}>{group.items.map(item => <li key={item.id}>
        {item.href ? <a className={`dashboard-nav-item${item.id === section ? ' dashboard-nav-current' : ''}`} href={item.href === '#overview' && section !== 'overview' ? '/dashboard#overview' : inEditor && item.href.startsWith('/dashboard/editor#') ? item.href.slice('/dashboard/editor'.length) : item.href} aria-current={item.id === section ? 'page' : undefined} onClick={onNavigate}>{locale === 'zh' ? item.zh : item.en}</a>
          : <span className="dashboard-nav-item dashboard-nav-disabled" aria-disabled="true">{item.id === 'ai' && <Icon kind="ai"/>}{locale === 'zh' ? item.zh : item.en}</span>}
      </li>)}</ul>
    </details>)}
  </>;
}

export function DashboardShell({children, section = 'overview'}: {children: ReactNode; section?: DashboardSection}) {
  const {locale, setLocale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const sectionLabel = navigation.flatMap(group => group.items).find(item => item.id === section)?.[locale];
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    // Never reveal a restored private page without a fresh server session check.
    const hide = () => { if (root.current) root.current.hidden = true; };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { hide(); location.reload(); } };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', restore); };
  }, []);
  const closeNavigation = () => { setOpen(false); main.current?.focus(); };
  return <div className="dashboard" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); }
  }}>
    <a className="dashboard-skip" href="#dashboard-main">{text('跳至主要内容', 'Skip to main content')}</a>
    <aside className="dashboard-sidebar">
      <a className="dashboard-brand" href="/dashboard"><strong>EXAMPLE_CV</strong><span>{text('个人工作台', 'Personal workspace')}</span></a>
      <nav aria-label={text('工作台导航', 'Workspace navigation')}><DashboardNavigation section={section} onNavigate={closeNavigation}/></nav>
    </aside>
    <div className="dashboard-body">
      <header className="dashboard-header">
        <div className="dashboard-header-location">
          <button className="dashboard-menu-toggle" ref={toggle} type="button" aria-label={text(open ? '关闭导航' : '打开导航', open ? 'Close navigation' : 'Open navigation')} aria-expanded={open} aria-controls="dashboard-mobile-navigation" onClick={() => setOpen(!open)}><Icon kind={open ? 'close' : 'menu'}/></button>
          <span className="dashboard-breadcrumb"><span className="dashboard-breadcrumb-prefix">{text('工作台', 'Workspace')}<span aria-hidden="true"> / </span></span>{sectionLabel}</span>
        </div>
        <div className="dashboard-header-actions">
          <div className="ui-locale-switch" role="group" aria-label={text('界面语言', 'Interface language')}>
            <button type="button" aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button><span aria-hidden="true">/</span>
            <button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button>
          </div>
          <a className="dashboard-account-link" href="/account" aria-label={text('账户与安全', 'Account & security')}><Icon kind="account"/><span>{text('账户', 'Account')}</span></a>
        </div>
      </header>
      <nav className="dashboard-mobile-navigation" id="dashboard-mobile-navigation" hidden={!open} aria-label={text('移动端工作台导航', 'Mobile workspace navigation')}><DashboardNavigation section={section} mobile onNavigate={closeNavigation}/></nav>
      <main className="dashboard-main" id="dashboard-main" ref={main} tabIndex={-1}>
        {children}
        <footer className="dashboard-footer"><span>EXAMPLE_CV</span><span>{text('界面语言与简历内容语言独立。', 'Interface and resume content languages are separate.')}</span></footer>
      </main>
    </div>
  </div>;
}

export function Dashboard() {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  return <DashboardShell>
        <section className="dashboard-intro" id="overview">
          <h1>{text('我的工作台', 'My workspace')}</h1>
          <p>{text('管理个人简历内容与账户安全。', 'Manage your resume content and account security.')}</p>
        </section>
        <section className="dashboard-website" aria-labelledby="dashboard-website-title">
          <h2 id="dashboard-website-title">{text('我的网站', 'My website')}</h2>
          <div className="dashboard-site-placeholder"><Icon kind="website"/><div>
            <h3>{text('网站功能尚未开放', 'Website features are not available yet')}</h3>
            <p>{text('开放后，可在这里管理网站内容与发布状态。', 'Manage website content and publishing here when available.')}</p>
          </div></div>
        </section>
        <section className="dashboard-content" aria-labelledby="dashboard-content-title" aria-describedby="dashboard-availability">
          <div className="dashboard-section-heading"><h2 id="dashboard-content-title">{text('内容管理', 'Content management')}</h2><span>{text('个人简历', 'Your resume')}</span></div>
          <ul className="dashboard-shortcuts">{shortcuts.map(([zh, en, zhDescription, enDescription]) => <li key={en} aria-disabled="true"><h3>{text(zh, en)}</h3><p>{text(zhDescription, enDescription)}</p></li>)}</ul>
          <p className="dashboard-availability" id="dashboard-availability">{text('真实保存、文件、AI、发布与历史功能均未开放。', 'Saving, files, AI, publishing and history are not available yet.')}</p>
        </section>
        <section className="dashboard-account" aria-labelledby="dashboard-account-title"><div>
          <h2 id="dashboard-account-title">{text('账户与安全', 'Account & security')}</h2>
          <p>{text('查看账户状态、管理密码或安全退出。', 'Check your account, manage your password or sign out securely.')}</p>
        </div><a className="dashboard-primary-link" href="/account">{text('管理账户', 'Manage account')}<Icon kind="arrow"/></a></section>
  </DashboardShell>;
}
