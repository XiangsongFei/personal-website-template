'use client';
import {clearWorkspaceDraft} from './workspace-draft';
import {WorkspaceLink} from './workspace-link';
import {useRef, useState} from 'react';
import {useUiLocale} from './ui-locale';
import {sendAccountAction, type AccountResult} from '../../lib/account/client';
import {Feedback} from './account-actions';
import {DashboardIcon} from './dashboard';
import {messages} from '../../lib/account/messages';

function AccountStatus({email}: {email?: string}) {
  const {t} = useUiLocale();
  return <section className="account-identity" aria-live="polite">
    {email ? <>
      <div className="account-settings-row">
        <div className="account-row-label">
          <div className="account-avatar"><DashboardIcon kind="account"/></div>
          <div><p className="account-email">{email}</p>
            <span className="account-confirmed">{t('邮箱已确认')}</span>
          </div>
        </div>
      </div>
    </> : <p role="alert">{t('请先登录。')}</p>}
  </section>;
}
export function AccountHome({email, passwordOpen}: {email: string; passwordOpen: boolean}) {
  const {t, locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const lock = useRef(false);
  const [busy,setBusy] = useState(false);
  const [pendingAction,setPendingAction] = useState<'refresh'|'logout'>();
  const [identityEmail,setIdentityEmail] = useState<string | undefined>(email);
  const [result,setResult] = useState<AccountResult>();
  async function run(action: 'refresh'|'logout') {
    if (lock.current) return;
    lock.current = true;setBusy(true);setPendingAction(action);
    try {
      const response = await sendAccountAction(action, {});
      if (action === 'logout' && response.ok) {
        clearWorkspaceDraft();
        window.location.replace('/login');
        return;
      }
      if (response.ok && response.user) setIdentityEmail(response.user.email);
      if (!response.ok && response.message === messages.expiredSession) {
        clearWorkspaceDraft();
        setIdentityEmail(undefined);
      }
      setResult(response);
    } finally {lock.current = false;setBusy(false);setPendingAction(undefined);}
  }
  return <>
    <AccountStatus email={identityEmail}/>
    {identityEmail ? <section className="account-security" aria-labelledby="account-security-title">
      <h2 id="account-security-title">{text('安全设置', 'Security settings')}</h2>
      <div className="account-settings-row">
        <div className="account-row-label"><DashboardIcon kind="lock"/><h3>{text('登录密码', 'Sign-in password')}</h3></div>
        <WorkspaceLink className="dashboard-action dashboard-action-text" href="/change-password" aria-current={passwordOpen ? 'page' : undefined}>
          {t('修改密码')}<DashboardIcon kind="arrow"/>
        </WorkspaceLink>
      </div>
      <div className="account-settings-row">
        <div className="account-row-label"><DashboardIcon kind="session"/>
          <div><h3>{text('当前会话', 'Current session')}</h3>
            <p className="session-status"><span aria-hidden="true" />{t('已登录')}</p>
          </div>
        </div>
        <button type="button" className="dashboard-action dashboard-action-text" disabled={busy}
          aria-busy={pendingAction === 'refresh'} onClick={() => run('refresh')}>
          {pendingAction === 'refresh' ? text('正在刷新…', 'Refreshing…') : t('刷新账户状态')}
        </button>
      </div>
      <div className="account-settings-row">
        <div className="account-row-label"><DashboardIcon kind="logout"/><h3>{text('当前浏览器', 'Current browser')}</h3></div>
        <button type="button" className="dashboard-action dashboard-action-text" disabled={busy}
          aria-busy={pendingAction === 'logout'} onClick={() => run('logout')}>
          {t(pendingAction === 'logout' ? '正在退出…' : '退出登录')}
        </button>
      </div>
    </section> :
      <a className="dashboard-action dashboard-action-secondary" href="/login">{t('返回登录')}</a>}
    <Feedback result={result}/>
  </>;
}
