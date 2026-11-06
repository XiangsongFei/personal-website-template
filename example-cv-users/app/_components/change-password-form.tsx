'use client';
import {useRef, useState, type FormEventHandler} from 'react';
import {useUiLocale} from './ui-locale';
import {PasswordField} from './form-fields';
import {CleanupAction} from './account-actions';
import {sendAccountAction, type AccountResult} from '../../lib/account/client';
import {EXISTING_PASSWORD_MAX_LENGTH, NEW_PASSWORD_MIN_LENGTH, NEW_PASSWORD_MAX_LENGTH, passwordIssue} from '../../lib/account/policy';
import {hint, messages} from '../../lib/account/messages';

export function ChangePasswordFields({ enabled, busy, message, success, onSubmit }: {
  enabled: boolean; busy: boolean; message?: string; success?: boolean; onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const { t } = useUiLocale();
  return <form className="account-form" onSubmit={onSubmit} aria-busy={busy} method="post" action="/change-password">
    <fieldset disabled={!enabled || busy}>
      <PasswordField id="current-password" label="当前密码" name="currentPassword" placeholder={t('请输入当前密码')} autoComplete="current-password" required minLength={1} maxLength={EXISTING_PASSWORD_MAX_LENGTH} />
      <PasswordField id="new-password" label="新密码" name="newPassword" placeholder={t('请输入新密码')} autoComplete="new-password" required minLength={NEW_PASSWORD_MIN_LENGTH} maxLength={NEW_PASSWORD_MAX_LENGTH} hint={hint.change} />
      <PasswordField id="confirm-new-password" label="确认新密码" name="confirmNewPassword" placeholder={t('请再次输入新密码')} autoComplete="new-password" required minLength={NEW_PASSWORD_MIN_LENGTH} maxLength={NEW_PASSWORD_MAX_LENGTH} />
      <button type="submit">{t(busy ? '正在修改密码…' : '修改密码')}</button>
    </fieldset>
    {message && <p role={success ? 'status' : 'alert'} aria-live="polite" className={success ? 'success' : 'feedback'}>{t(message)}</p>}
  </form>;
}

export function ChangePasswordForm() {
  const {t} = useUiLocale();
  const lock = useRef(false);
  const operation = useRef<string | undefined>(undefined);
  const [busy,setBusy] = useState(false), [ended,setEnded] = useState(false);
  const [result,setResult] = useState<AccountResult>();
  const submit: FormEventHandler<HTMLFormElement> = async event => {
    event.preventDefault();
    if (lock.current || ended) return;
    const form = event.currentTarget, fields = new FormData(form);
    const currentPassword = String(fields.get('currentPassword') ?? '');
    const newPassword = String(fields.get('newPassword') ?? '');
    const confirmNewPassword = String(fields.get('confirmNewPassword') ?? '');
    const issue = passwordIssue(newPassword, confirmNewPassword, currentPassword);
    if (issue) {setResult({ok:false,message:issue});return;}
    lock.current = true; setBusy(true); setResult(undefined);
    operation.current ??= crypto.randomUUID();
    form.reset();
    try {
      const response = await sendAccountAction('change-password', {currentPassword,newPassword,confirmNewPassword,operation:operation.current});
      setResult(response);
      if (response.ok || response.correctable) operation.current = undefined;
      else setEnded(true);
    } finally {lock.current = false;setBusy(false);}
  };
  return <>
    <ChangePasswordFields enabled={!ended} busy={busy} success={result?.ok} message={result?.message} onSubmit={submit}/>
    {result?.cleanup ? <CleanupAction scope="account"/> :
      result?.next === '/login' || result?.message === messages.expiredSession ? <a className="text-link" href="/login">{t('返回登录')}</a> : null}
  </>;
}
