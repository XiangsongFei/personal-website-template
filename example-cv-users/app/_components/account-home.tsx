'use client';
import {useRef, useState} from 'react';
import {useUiLocale} from './ui-locale';
import {sendAccountAction, type AccountResult} from '../../lib/account/client';
import {Feedback} from './account-actions';
import {messages} from '../../lib/account/messages';

export function AccountStatus({ userId, email, busy, error }: { userId?: string; email?: string; busy: boolean; error?: string }) {
  const { t, locale } = useUiLocale();
  return <section className="account-identity" aria-live="polite" aria-busy={busy}>
    {busy ? <p role="status">{t('正在验证登录状态…')}</p> : userId ? <>
      <div className="account-identity-heading"><h2>{locale === 'zh' ? '当前账户' : 'Your account'}</h2><p className="session-status"><span aria-hidden="true" />{t('已登录')}</p></div>
      <p className="account-email">{email}</p><p className="hint">{t('邮箱已确认')}</p>
      <details className="identity-details"><summary>{t('账户标识')}</summary><code className="user-id">{userId}</code></details>
    </> : <p role="alert">{t(error ?? '请先登录。')}</p>}
  </section>;
}
export function AccountHome({user}: {user: {id:string;email:string}}) {
  const {t, locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const lock = useRef(false);
  const [busy,setBusy] = useState(false);
  const [pendingAction,setPendingAction] = useState<'refresh'|'logout'>();
  const [identity,setIdentity] = useState<typeof user | undefined>(user);
  const [result,setResult] = useState<AccountResult>();
  async function run(action: 'refresh'|'logout') {
    if (lock.current) return;
    lock.current = true;setBusy(true);setPendingAction(action);
    try {
      const response = await sendAccountAction(action, {});
      if (action === 'logout' && response.ok) {window.location.replace('/login');return;}
      if (response.ok && response.user) setIdentity(response.user);
      if (!response.ok && response.message === messages.expiredSession) setIdentity(undefined);
      setResult(response);
    } finally {lock.current = false;setBusy(false);setPendingAction(undefined);}
  }
  return <>
    <AccountStatus userId={identity?.id} email={identity?.email} busy={false}/>
    {identity ? <>
      <section className="account-management-section" aria-labelledby="account-password-title"><div><h2 id="account-password-title">{text('密码管理', 'Password')}</h2><p>{text('使用当前密码确认身份后，设置新密码。', 'Confirm your current password to choose a new one.')}</p></div>
        <a className="account-action-link" href="/change-password">{t('修改密码')}</a></section>
      <section className="account-management-section" aria-labelledby="account-session-title"><div><h2 id="account-session-title">{text('当前会话', 'Current session')}</h2><p>{text('刷新账户状态，或退出此浏览器的登录。', 'Refresh your account status or sign out of this browser.')}</p></div>
        <div className="account-session-actions" aria-busy={busy}><button type="button" className="secondary" disabled={busy} onClick={() => run('refresh')}>{pendingAction === 'refresh' ? text('正在刷新…', 'Refreshing…') : t('刷新账户状态')}</button>
          <button className="outline-button" disabled={busy} onClick={() => run('logout')}>{t(pendingAction === 'logout' ? '正在退出…' : '退出登录')}</button></div></section>
    </> :
      <a className="button-link" href="/login">{t('返回登录')}</a>}
    <Feedback result={result}/>
  </>;
}
