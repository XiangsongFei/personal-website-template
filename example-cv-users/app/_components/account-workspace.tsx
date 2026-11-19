'use client';
import {useEffect, useRef, type ReactNode} from 'react';
import {useUiLocale} from './ui-locale';

export function AccountWorkspace({section, children}: {section: 'account' | 'password'; children: ReactNode}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const root = useRef<HTMLDivElement>(null);
  const password = section === 'password';
  useEffect(() => {
    // A restored private account page must re-enter the existing server session check.
    const hide = () => { if (root.current) root.current.hidden = true; };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { hide(); location.reload(); } };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', restore); };
  }, []);
  return <div className={`account-workspace account-workspace-${section}`} ref={root}>
    <nav className="account-breadcrumb" aria-label={text('当前位置', 'Breadcrumb')}>
      <a href="/dashboard">{text('工作台', 'Workspace')}</a><span aria-hidden="true">/</span>
      {password ? <><a href="/account">{text('账户与安全', 'Account & security')}</a><span aria-hidden="true">/</span><span aria-current="page">{text('修改密码', 'Change password')}</span></> : <span aria-current="page">{text('账户与安全', 'Account & security')}</span>}
    </nav>
    <header className="account-page-heading"><h1>{text(password ? '修改密码' : '账户与安全', password ? 'Change password' : 'Account & security')}</h1>
      <p>{text(password ? '确认当前密码，然后设置新密码。' : '查看已验证的账户信息，管理密码与当前会话。', password ? 'Confirm your current password, then choose a new one.' : 'Review your verified account, password and current session.')}</p>
    </header>
    {children}
    <footer className="account-workspace-back"><a href={password ? '/account' : '/dashboard'}><span aria-hidden="true">← </span>{text(password ? '返回账户与安全' : '返回工作台', password ? 'Back to account & security' : 'Back to workspace')}</a></footer>
  </div>;
}
