'use client';
import {useRef, useState} from 'react';
import {useUiLocale} from './ui-locale';
import {sendAccountAction, type AccountResult} from '../../lib/account/client';
import {Feedback} from './account-actions';
import {messages} from '../../lib/account/messages';

export function AccountStatus({ userId, email, busy, error }: { userId?: string; email?: string; busy: boolean; error?: string }) {
  const { t } = useUiLocale();
  return <section className="account-identity" aria-live="polite" aria-busy={busy}>
    {busy ? <p role="status">{t('正在验证登录状态…')}</p> : userId ? <>
      <p className="identity-title">{t('个人账户')}</p><p className="session-status"><span aria-hidden="true" />{t('已登录')}</p>
      <details className="identity-details"><summary>{t('账户标识')}</summary><code className="user-id">{userId}</code><p className="hint">{t('邮箱已确认')} · {email}</p></details>
    </> : <p role="alert">{t(error ?? '请先登录。')}</p>}
  </section>;
}
export function AccountActions({ busy, onLogout }: { busy: boolean; onLogout: () => void }) {
  const { t } = useUiLocale();
  return <><a className="button-link" href="/change-password">{t('修改密码')}</a>
    <button className="outline-button" disabled={busy} onClick={onLogout}>{t(busy ? '正在退出…' : '退出登录')}</button></>;
}
export function AccountHome({user}: {user: {id:string;email:string}}) {
  const {t} = useUiLocale();
  const lock = useRef(false);
  const [busy,setBusy] = useState(false);
  const [identity,setIdentity] = useState<typeof user | undefined>(user);
  const [result,setResult] = useState<AccountResult>();
  async function run(action: 'refresh'|'logout') {
    if (lock.current) return;
    lock.current = true;setBusy(true);
    try {
      const response = await sendAccountAction(action, {});
      if (action === 'logout' && response.ok) {window.location.replace('/login');return;}
      if (response.ok && response.user) setIdentity(response.user);
      if (!response.ok && response.message === messages.expiredSession) setIdentity(undefined);
      setResult(response);
    } finally {lock.current = false;setBusy(false);}
  }
  return <>
    <AccountStatus userId={identity?.id} email={identity?.email} busy={false}/>
    {identity ? <><AccountActions busy={busy} onLogout={() => run('logout')}/>
      <button type="button" className="secondary" disabled={busy} onClick={() => run('refresh')}>{t('刷新账户状态')}</button></> :
      <a className="button-link" href="/login">{t('返回登录')}</a>}
    <Feedback result={result}/>
  </>;
}
