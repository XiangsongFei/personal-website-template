'use client';
import {useEffect, useRef, useState, type FormEventHandler} from 'react';
import {useUiLocale} from './ui-locale';
import {PasswordField} from './form-fields';
import {CleanupAction, Feedback} from './account-actions';
import {sendAccountAction, type AccountResult} from '../../lib/account/client';
import {NEW_PASSWORD_MIN_LENGTH, NEW_PASSWORD_MAX_LENGTH, passwordIssue} from '../../lib/account/policy';
import {RECOVERY_COPY as copy} from '../../lib/account/recovery-copy';
import {hint} from '../../lib/account/messages';

export function ResetPasswordFields({ enabled, busy, message, success, onSubmit }: {
  enabled: boolean; busy: boolean; message?: string; success?: boolean; onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const { t } = useUiLocale();
  return <form className="account-form" method="post" action="/reset-password" onSubmit={onSubmit} aria-busy={busy}>
    <fieldset disabled={!enabled || busy || success}>
      <PasswordField id="reset-new-password" label="新密码" name="newPassword" placeholder={t('请输入新密码')} autoComplete="new-password" required minLength={NEW_PASSWORD_MIN_LENGTH} maxLength={NEW_PASSWORD_MAX_LENGTH} hint={hint.reset} />
      <PasswordField id="reset-confirm-password" label="确认新密码" name="confirmNewPassword" placeholder={t('请再次输入新密码')} autoComplete="new-password" required minLength={NEW_PASSWORD_MIN_LENGTH} maxLength={NEW_PASSWORD_MAX_LENGTH} />
      <button type="submit">{t(busy ? '正在重置密码…' : '重置密码')}</button>
    </fieldset>
    {message && <p role={success ? 'status' : 'alert'} aria-live="polite" className={success ? 'success' : 'feedback'}>{t(message)}</p>}
  </form>;
}

export function ResetPasswordNextStep({login,message}:{login:boolean;message?:string}) {
  const {t}=useUiLocale();
  if(login)return <a className="button-link" href="/login">{t('使用新密码重新登录')}</a>;
  return message === copy.restart ? null :<a className="text-link" href="/forgot-password">{t('重新申请恢复验证码')}</a>;
}

export function ResetPasswordForm() {
  const {t} = useUiLocale();
  const [ready,setReady] = useState(false), [checking,setChecking] = useState(true), [busy,setBusy] = useState(false);
  const [result,setResult] = useState<AccountResult>();
  const used = useRef(false);
  useEffect(() => {
    let current = true;
    void sendAccountAction('recovery-session').then(response => {
      if (!current) return;
      setChecking(false); setReady(response.ok);
      if (!response.ok) setResult(response);
    });
    return () => { current = false; };
  }, []);
  const submit: FormEventHandler<HTMLFormElement> = async event => {
    event.preventDefault();
    if (!ready || used.current) return;
    const form = event.currentTarget, fields = new FormData(form);
    const newPassword = String(fields.get('newPassword') ?? '');
    const confirmNewPassword = String(fields.get('confirmNewPassword') ?? '');
    const issue = passwordIssue(newPassword, confirmNewPassword);
    if (issue) {setResult({ok:false,message:issue});return;}
    used.current = true; setBusy(true); form.reset();
    try {
      const response = await sendAccountAction('reset-password', {newPassword, confirmNewPassword});
      setResult(response); setReady(false);
    } finally {setBusy(false);}
  };
  if (checking) return <p role="status">{t('正在检查本次操作…')}</p>;
  if (!ready && result?.message === copy.restart) return <section className="recovery-state" role="alert">
    <h2>{t('请重新开始恢复')}</h2><p>{t(copy.restart)}</p>
    <a className="button-link" href="/forgot-password">{t('重新申请恢复验证码')}</a></section>;
  if (!ready && !used.current) return <><Feedback result={result}/><a className="text-link" href="/reset-password">{t('重新载入')}</a></>;
  return <>
    {ready && <p className="hint">{t(copy.passwordWindow)}</p>}
    <ResetPasswordFields enabled={ready} busy={busy} message={result?.message} success={!!result?.ok} onSubmit={submit}/>
    {result?.cleanup ? <CleanupAction scope="recovery"/> :
      <ResetPasswordNextStep login={!!result?.ok || result?.next === '/login'} message={result?.message}/>}
  </>;
}
