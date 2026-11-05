'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useUiLocale } from './ui-locale';
import { CodeField, PasswordField } from './form-fields';
import { CleanupAction, Feedback, ResendLabel, useResendClock } from './account-actions';
import { sendAccountAction, type AccountResult } from '../../lib/account/client';
import { messages, hint } from '../../lib/account/messages';
import { EMAIL_MAX_LENGTH, EXISTING_PASSWORD_MAX_LENGTH, NEW_PASSWORD_MIN_LENGTH, NEW_PASSWORD_MAX_LENGTH,
  normalizeEmail, isRealEmail, isOtp, passwordIssue } from '../../lib/account/policy';

export function ContinueVerification({needed, email}: {needed: boolean; email: string}) {
  const {t} = useUiLocale();
  if (!needed) return null;
  return <a className="text-link" href={'/verify-email?email=' + encodeURIComponent(email)}>{t('继续验证邮箱')}</a>;
}
type FormMode = 'signup' | 'verify' | 'login';
export function AccountForm({mode}: {mode: FormMode}) {
  const {t} = useUiLocale();
  const form = useRef<HTMLFormElement>(null);
  const locked = useRef(false);
  const [busy,setBusy] = useState(false);
  const [result,setResult] = useState<AccountResult>();
  const [verificationEmail,setVerificationEmail] = useState('');
  const clock = useResendClock();

  useEffect(() => {
    if (mode !== 'verify') return;
    const query = new URLSearchParams(location.search);
    const email = normalizeEmail(query.get('email') ?? '');
    const field = form.current?.elements.namedItem('email');
    if (isRealEmail(email) && field instanceof HTMLInputElement) field.value = email;
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const fields = new FormData(event.currentTarget);
    const email = normalizeEmail(String(fields.get('email') ?? ''));
    const password = String(fields.get('password') ?? '');
    const confirmPassword = String(fields.get('confirmPassword') ?? '');
    const token = String(fields.get('token') ?? '');
    let issue: string | null = null;
    if (!isRealEmail(email)) issue = messages.invalidInput;
    else if (mode === 'signup') issue = passwordIssue(password, confirmPassword);
    else if (mode === 'verify' && !isOtp(token)) issue = messages.badCode;
    if (issue) {setResult({ok: false, message: issue}); return;}
    locked.current = true;
    setBusy(true); setResult(undefined); setVerificationEmail('');
    try {
      let response: AccountResult;
      if (mode === 'signup') response = await sendAccountAction('register', {email, password, confirmPassword});
      else if (mode === 'verify') response = await sendAccountAction('verify-email', {email, token});
      else response = await sendAccountAction('login', {email, password});
      setResult(response);
      if (response.ok && mode === 'signup' && response.next === '/verify-email')
        window.location.assign('/verify-email?email=' + encodeURIComponent(email));
      else if (response.ok && response.next === '/account') window.location.assign('/account');
      else if (!response.ok && response.next === '/verify-email') setVerificationEmail(email);
    } finally {
      for (const name of ['password','confirmPassword','token']) {
        const field = form.current?.elements.namedItem(name);
        if (field instanceof HTMLInputElement) field.value = '';
      }
      locked.current = false; setBusy(false);
    }
  }
  async function resend() {
    if (locked.current || clock.remaining) return;
    const email = normalizeEmail(String(new FormData(form.current!).get('email') ?? ''));
    if (!isRealEmail(email)) {setResult({ok:false, message:messages.invalidInput});return;}
    locked.current = true; setBusy(true);
    try {
      const response = await sendAccountAction('resend-confirmation', {email});
      setResult(response); clock.start(response.retryAfter);
    } finally {locked.current = false; setBusy(false);}
  }
  return <form ref={form} onSubmit={submit} method="post" aria-busy={busy} className="account-form">
    <fieldset disabled={busy}>
      <div className="form-field"><label htmlFor="email">{t('邮箱')}</label>
        <input id="email" name="email" type="email" placeholder={t('请输入邮箱')} required maxLength={EMAIL_MAX_LENGTH}
          autoComplete={mode === 'verify' ? 'email' : 'username'} onChange={() => setVerificationEmail('')}/>
      </div>
      {mode !== 'verify' && <>
        <PasswordField id="password" name="password" label="密码" placeholder={t('请输入密码')} required
          minLength={mode === 'signup' ? NEW_PASSWORD_MIN_LENGTH : 1}
          maxLength={mode === 'signup' ? NEW_PASSWORD_MAX_LENGTH : EXISTING_PASSWORD_MAX_LENGTH}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} hint={mode === 'signup' ? hint.signup : undefined}/>
        {mode === 'signup' && <PasswordField id="confirmation" name="confirmPassword" label="确认密码"
          placeholder={t('请再次输入密码')} required minLength={NEW_PASSWORD_MIN_LENGTH} maxLength={NEW_PASSWORD_MAX_LENGTH} autoComplete="new-password"/>}
      </>}
      {mode === 'verify' && <CodeField id="token" hint={hint.code} invalid={result?.message === messages.badCode}/>}
      <button type="submit">{t(busy ? '正在提交…' : mode === 'signup' ? '注册账号' : mode === 'verify' ? '验证邮箱' : '登录')}</button>
      {mode === 'verify' && <button className="secondary" type="button" onClick={resend} disabled={clock.remaining > 0}><ResendLabel remaining={clock.remaining}/></button>}
    </fieldset>
    <Feedback result={result}/>
    <ContinueVerification needed={!!verificationEmail} email={verificationEmail}/>
    {result?.cleanup && <CleanupAction scope={result.cleanupScope}/>}
  </form>;
}
