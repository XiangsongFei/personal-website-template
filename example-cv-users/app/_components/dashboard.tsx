'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {WorkspaceLink} from './workspace-link';
import {useWorkspaceDirtyModules} from './workspace-draft';
import {useUiLocale} from './ui-locale';

import type {EditorModule} from '../../lib/editor/draft';
import {siteStatusTitle, type SiteViewModel} from '../../lib/site/model';

export type DashboardSection = 'overview' | 'website' | 'account' | 'password' | EditorModule;

type NavHref = '/dashboard' | '/account' | '/change-password' | '/dashboard/website' | `/dashboard/editor#${EditorModule}`;
type NavLabel = {id: string; zh: string; en: string};
type NavItem = NavLabel & {href?: NavHref; children?: (NavLabel & {href: NavHref})[]};
const navigation: {id: string; zh: string; en: string; items: NavItem[]}[] = [
  {id: 'workspace', zh: '工作台', en: 'Workspace', items: [
    {id: 'overview', zh: '概览', en: 'Overview', href: '/dashboard'},
    {id: 'website', zh: '我的网站', en: 'My website', href: '/dashboard/website'},
  ]},
  {id: 'resume', zh: '个人简历', en: 'Resume', items: [
    {id: 'profile', zh: '个人资料', en: 'Profile', href: '/dashboard/editor#profile'},
    {id: 'introduction', zh: '个人介绍', en: 'Introduction', href: '/dashboard/editor#introduction'},
    {id: 'education', zh: '教育经历', en: 'Education', href: '/dashboard/editor#education'},
    {id: 'experience', zh: '工作经历', en: 'Experience', href: '/dashboard/editor#experience'},
    {id: 'projects', zh: '项目经历', en: 'Projects', href: '/dashboard/editor#projects'},
    {id: 'skills', zh: '技能', en: 'Skills', href: '/dashboard/editor#skills'},
    {id: 'awards', zh: '荣誉奖项', en: 'Awards', href: '/dashboard/editor#awards'},
    {id: 'contact', zh: '联系与链接', en: 'Contact & links', href: '/dashboard/editor#contact'},
  ]},
  {id: 'tools', zh: '工具与发布', en: 'Tools & publishing', items: [
    {id: 'files', zh: '文件与媒体', en: 'Files & media'},
    {id: 'ai', zh: 'AI 助手', en: 'AI assistant'},
    {id: 'publish', zh: '预览与发布', en: 'Preview & publish'},
  ]},
  {id: 'settings', zh: '账户与设置', en: 'Account & settings', items: [
    {id: 'account', zh: '账户与安全', en: 'Account & security', href: '/account', children: [
      {id: 'password', zh: '修改密码', en: 'Change password', href: '/change-password'},
    ]},
    {id: 'privacy', zh: '求职与隐私', en: 'Career & privacy'},
    {id: 'activity', zh: '活动记录', en: 'Activity log'},
    {id: 'history', zh: '版本历史', en: 'Version history'},
    {id: 'site-settings', zh: '网站设置', en: 'Website settings'},
  ]},
];
const resumeNavigation = navigation.find(group => group.id === 'resume')?.items ?? [];
const shortcuts = [
  ['profile', '基本信息与头像', 'Personal details and photo'],
  ['introduction', '个人简介与职业方向', 'Introduction and career focus'],
  ['education', '院校、学位与课程', 'Schools, degrees and courses'],
  ['experience', '工作与实习经历', 'Work and internships'],
  ['projects', '项目、方法与成果', 'Projects, methods and outcomes'],
  ['skills', '技能分组与熟练度', 'Skill groups and proficiency'],
  ['awards', '荣誉与获奖经历', 'Honors and recognitions'],
  ['contact', '联系方式、链接与网站文字', 'Contact details, links and site text'],
] as const;

export function DashboardIcon({kind}: {kind: string}) {
  const paths: Record<string, string> = {
    workspace: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    resume: 'M6 3h9l3 3v15H6z M9 10h6 M9 14h6 M9 18h4',
    tools: 'M4 7h16v14H4z M9 7V3h6v4 M4 12h16 M10 12v3h4v-3',
    settings: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    account: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
    website: 'M3 4h18v16H3z M3 9h18 M7 6.5h.01 M10 6.5h.01',
    ai: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    chevron: 'M8 10l4 4 4-4',
    'chevron-right': 'M10 6l6 6-6 6',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    close: 'M6 6l12 12 M6 18L18 6',
    arrow: 'M4 12h16 M14 6l6 6-6 6',
    profile: 'M3 5h18v14H3z M7 10h.01 M5 16a2 2 0 0 1 4 0 M12 10h6 M12 14h6',
    introduction: 'M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5',
    education: 'M2 9l10-5 10 5-10 5z M6 11v5q6 5 12 0v-5 M22 9v6',
    experience: 'M3 7h18v13H3z M9 7V4h6v3 M3 12h18 M10 11h4v3h-4z',
    projects: 'M3 5h7l2 2h9v12H3z',
    skills: 'M5 5h14 M5 12h14 M5 19h14 M9 3v4 M15 10v4 M11 17v4',
    awards: 'M17 9a5 5 0 1 1-10 0 5 5 0 0 1 10 0 M8 13l-2 7 6-2 6 2-2-7',
    contact: 'M3 5h18v14H3z M3 6l9 7 9-7',
    lock: 'M5 10h14v11H5z M8 10V7a4 4 0 1 1 8 0v3 M12 14v3',
    logout: 'M10 4H4v16h6 M8 12h13 M17 8l4 4-4 4',
    session: 'M3 4h18v13H3z M8 21h8 M12 17v4 M8 10l3 3 5-5',
  };
  return <svg className="dashboard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[kind]}/></svg>;
}

export function UnsavedDot() {
  const {locale} = useUiLocale();
  const label = locale === 'zh' ? '有未保存的修改' : 'Unsaved changes';
  return <span className="dashboard-dirty-dot" data-unsaved-dot title={label}><span className="dashboard-visually-hidden"> · {label}</span></span>;
}

function DashboardNavigation({onNavigate, section}: {onNavigate?: () => void; section: DashboardSection}) {
  const {locale} = useUiLocale();
  const dirtyModules = useWorkspaceDirtyModules();
  const inEditor = section !== 'overview' && section !== 'website' && section !== 'account' && section !== 'password';

  return <>
    {navigation.map(group => <details className="dashboard-nav-group" key={group.id} open>
      <summary><DashboardIcon kind={group.id}/><span>{locale === 'zh' ? group.zh : group.en}</span><DashboardIcon kind="chevron"/></summary>
      <ul>{group.items.map(item => {
        const childActive = item.children?.some(child => child.id === section);
        const unsaved = dirtyModules.some(module => module === item.id ||
          (item.id === 'contact' && (module === 'links' || module === 'site-text')));
        const sameEditor = inEditor && item.href?.startsWith('/dashboard/editor#');
        const NavigationLink = sameEditor ? 'a' : WorkspaceLink;
        return <li key={item.id}>
          {item.href ? <NavigationLink className={`dashboard-nav-item${item.id === section ? ' dashboard-nav-current' : childActive ? ' dashboard-nav-parent' : ''}`} href={sameEditor ? item.href.slice('/dashboard/editor'.length) : item.href} aria-current={item.id === section ? 'page' : undefined} onClick={onNavigate}>{item[locale]}{unsaved && <UnsavedDot/>}</NavigationLink>
            : <span className="dashboard-nav-item dashboard-nav-disabled" aria-disabled="true">{item.id === 'ai' && <DashboardIcon kind="ai"/>}{item[locale]}</span>}
          {item.children && (item.id === section || childActive) && <ul className="dashboard-nav-children">
            {item.children.map(child => <li key={child.id}><WorkspaceLink className={`dashboard-nav-item${child.id === section ? ' dashboard-nav-current' : ''}`}
              href={child.href} aria-current={child.id === section ? 'page' : undefined} onClick={onNavigate}>{child[locale]}</WorkspaceLink></li>)}
          </ul>}
        </li>;
      })}</ul>
    </details>)}
  </>;
}

export function DashboardShell({children, section = 'overview'}: {children: ReactNode; section?: DashboardSection}) {
  const {locale, setLocale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const sectionLabel = section === 'password' ? text('修改密码', 'Change password')
    : navigation.flatMap(group => group.items).find(item => item.id === section)?.[locale];
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
  useEffect(() => {
    const keyboardModality = (event: KeyboardEvent) => {
      const dashboard = root.current;
      const target = event.target;
      const activating = (event.key === 'Enter' || event.key === ' ') && target instanceof HTMLElement &&
        dashboard?.contains(target) && target.closest('button, a, summary');
      if (dashboard && (event.key === 'Tab' || activating)) dashboard.dataset.inputModality = 'keyboard';
    };
    document.addEventListener('keydown', keyboardModality, true);
    return () => document.removeEventListener('keydown', keyboardModality, true);
  }, []);
  const closeNavigation = () => { setOpen(false); main.current?.focus(); };
  return <div className="dashboard" ref={root} onPointerDownCapture={event => {
    event.currentTarget.dataset.inputModality = 'pointer';
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); toggle.current?.focus(); }
  }}>
    <a className="dashboard-skip" href="#dashboard-main">{text('跳至主要内容', 'Skip to main content')}</a>
    <aside className="dashboard-sidebar">
      <WorkspaceLink className="dashboard-brand" href="/dashboard"><strong>EXAMPLE_CV</strong><span>{text('个人工作台', 'Personal workspace')}</span></WorkspaceLink>
      <nav aria-label={text('工作台导航', 'Workspace navigation')}><DashboardNavigation section={section}/></nav>
    </aside>
    <div className="dashboard-body">
      <header className="dashboard-header">
        <div className="dashboard-header-location">
          <button className="dashboard-menu-toggle dashboard-action dashboard-action-icon" ref={toggle} type="button" aria-label={text(open ? '关闭导航' : '打开导航', open ? 'Close navigation' : 'Open navigation')} aria-expanded={open} aria-controls="dashboard-mobile-navigation" onClick={event => {
            event.currentTarget.focus();
            setOpen(!open);
          }}><DashboardIcon kind={open ? 'close' : 'menu'}/></button>
          <WorkspaceLink className="dashboard-mobile-brand" href="/dashboard">EXAMPLE_CV</WorkspaceLink>
          <span className="dashboard-breadcrumb"><span className="dashboard-breadcrumb-prefix">{text('工作台', 'Workspace')}<span aria-hidden="true"> / </span></span>{section === 'password' && <><WorkspaceLink href="/account">{text('账户与安全', 'Account & security')}</WorkspaceLink><span aria-hidden="true"> / </span></>}{sectionLabel}</span>
        </div>
        <div className="dashboard-header-actions">
          <div className="ui-locale-switch" role="group" aria-label={text('界面语言', 'Interface language')}>
            <button className="dashboard-action dashboard-action-text" type="button" aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button><span aria-hidden="true">/</span>
            <button className="dashboard-action dashboard-action-text" type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button>
          </div>
          <WorkspaceLink className="dashboard-account-link dashboard-action dashboard-action-icon" href="/account" aria-label={text('账户与安全', 'Account & security')}><DashboardIcon kind="account"/><span>{text('账户', 'Account')}</span></WorkspaceLink>
        </div>
      </header>
      <nav className="dashboard-mobile-navigation" id="dashboard-mobile-navigation" hidden={!open} aria-label={text('移动端工作台导航', 'Mobile workspace navigation')}><DashboardNavigation section={section} onNavigate={closeNavigation}/></nav>
      <main className="dashboard-main" id="dashboard-main" ref={main} tabIndex={-1}>
        {children}
      </main>
    </div>
  </div>;
}

export function Dashboard({site}: {site: SiteViewModel}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  return <DashboardShell>
    <section className="dashboard-intro" id="overview">
      <h1>{text('我的工作台', 'My workspace')}</h1>
      <p>{text('编辑简历，管理你的个人网站与账户。', 'Edit your resume and manage your personal website and account.')}</p>
    </section>
    <section className="dashboard-website" aria-labelledby="dashboard-website-title">
      <div className="dashboard-overview-label">
        <DashboardIcon kind="website"/>
        <div><h2 id="dashboard-website-title">{text('我的个人网站', 'My personal website')}</h2>
          <p>{siteStatusTitle(site, locale)}</p></div>
      </div>
      <WorkspaceLink className="dashboard-action dashboard-action-text" href="/dashboard/website">{text('查看网站状态', 'View website status')}<DashboardIcon kind="arrow"/></WorkspaceLink>
    </section>
    <section className="dashboard-content" aria-labelledby="dashboard-content-title" aria-describedby="dashboard-availability">
      <div className="dashboard-section-heading">
        <div><h2 id="dashboard-content-title">{text('个人简历', 'Your resume')}</h2>
          <p id="dashboard-availability">{text('编辑时可实时预览。在线保存与发布尚未开放。', 'Preview updates as you edit. Online saving and publishing are unavailable.')}</p></div>
        <WorkspaceLink className="dashboard-action dashboard-action-primary" href="/dashboard/editor#profile">{text('编辑简历', 'Edit resume')}<DashboardIcon kind="arrow"/></WorkspaceLink>
      </div>
      <ul className="dashboard-shortcuts">{shortcuts.map(([module, zhDescription, enDescription]) => {
        const item = resumeNavigation.find(item => item.id === module);
        return <li key={module}><WorkspaceLink href={`/dashboard/editor#${module}`}>
          <DashboardIcon kind={module}/><div><h3>{item?.[locale]}</h3><p>{text(zhDescription, enDescription)}</p></div>
        </WorkspaceLink></li>;
      })}</ul>
    </section>
    <section className="dashboard-account" aria-labelledby="dashboard-account-title">
      <div className="dashboard-overview-label"><DashboardIcon kind="account"/><div>
        <h2 id="dashboard-account-title">{text('账户与安全', 'Account & security')}</h2>
        <p>{text('查看登录状态与管理密码。', 'Check your session and manage your password.')}</p>
      </div></div>
      <WorkspaceLink className="dashboard-action dashboard-action-text" href="/account">{text('管理账户', 'Manage account')}<DashboardIcon kind="arrow"/></WorkspaceLink>
    </section>
  </DashboardShell>;
}
