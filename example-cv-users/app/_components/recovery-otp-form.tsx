'use client';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {useUiLocale} from './ui-locale';
import {CodeField} from './form-fields';
import {CleanupAction, Feedback, ResendLabel, useResendClock} from './account-actions';
import {sendAccountAction, type AccountResult} from '../../lib/account/client';
import {RECOVERY_COPY as copy} from '../../lib/account/recovery-copy';
import {messages} from '../../lib/account/messages';
import {EMAIL_MAX_LENGTH, isOtp, normalizeEmail, isRealEmail} from '../../lib/account/policy';

export function RecoveryRequestForm() {
  const {t} = useUiLocale();
  const form = useRef<HTMLFormElement>(null);
  const locked = useRef(false);
  const [step,setStep] = useState<'checking'|'start'|'verify'|'reset'|'restart'>('checking');
  const [busy,setBusy] = useState(false);
  const [result,setResult] = useState<AccountResult>();
  const clock = useResendClock();
  useEffect(() => {
    let current = true;
    void sendAccountAction('recovery-progress').then(response => {
      if (!current) return;
      if (response.ok && response.step) {
        setStep(response.step);
        if (response.retryAfter) clock.start(response.retryAfter);
      } else {setStep('restart'); setResult(response);}
    });
    return () => {current = false;};
  }, []);

  async function perform(send: boolean) {
    if (locked.current || !form.current || (send && clock.remaining)) return;
    const fields = new FormData(form.current);
    const email = normalizeEmail(String(fields.get('email') ?? ''));
    const token = String(fields.get('token') ?? '');
    if (!isRealEmail(email) || (!send && !isOtp(token))) {
      setResult({ok:false,message:send ? messages.invalidInput : copy.invalid}); return;
    }
    locked.current = true; setBusy(true); setResult(undefined);
    const code = form.current.elements.namedItem('token');
    if (code instanceof HTMLInputElement) code.value = '';
    try {
      const response = send ? await sendAccountAction('recovery-otp-send',{email}) :
        await sendAccountAction('recovery-otp-verify',{email,token});
      setResult(response);
      if (send) clock.start(response.retryAfter);
      if (response.ok && send) setStep('verify');
      else if (response.ok && response.next === '/reset-password') window.location.assign(response.next);
      else if ([copy.restart,copy.verifyUnknown].some(s => s === response.message)) setStep('restart');
    } finally {locked.current = false; setBusy(false);}
  }
  async function restart() {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try {
      const response = await sendAccountAction('recovery-logout', {});
      if (response.ok) {setStep('start');setResult(undefined);}
      else setResult(response);
    } finally {locked.current = false;setBusy(false);}
  }
  function submit(event: FormEvent<HTMLFormElement>) {event.preventDefault();void perform(step === 'start');}
  if (step === 'checking') return <p role="status">{t('正在检查本次操作…')}</p>;
  if (step === 'reset') return <a className="button-link" href="/reset-password">{t('继续设置新密码')}</a>;
  if (step === 'restart') return <section className="recovery-state"><h2>{t('请重新开始恢复')}</h2>
    <Feedback result={result}/><button type="button" onClick={restart} disabled={busy}>{t('重新开始')}</button></section>;
  return <form ref={form} className="account-form" method="post" action="/forgot-password" onSubmit={submit} aria-busy={busy}>
    <p className="hint">{t(copy.guidance)}</p>
    <fieldset disabled={busy}>
      <div className="form-field"><label htmlFor="recovery-email">{t('邮箱')}</label>
        <input id="recovery-email" name="email" type="email" required autoComplete="email" placeholder={t('请输入邮箱')} maxLength={EMAIL_MAX_LENGTH}/>
      </div>
      {step === 'verify' && <CodeField id="recovery-code" label="恢复验证码" invalid={result?.message === copy.invalid}/>}
      <button type="submit" disabled={step === 'start' && clock.remaining > 0}>
        {t(busy ? '正在提交…' : step === 'verify' ? '验证恢复验证码' : '发送恢复验证码')}
      </button>
      {step === 'verify' ? <button className="secondary" type="button" disabled={clock.remaining > 0} onClick={() => perform(true)}>
        <ResendLabel remaining={clock.remaining}/></button> :
        <button className="text-link" type="button" onClick={async () => {
          const current = await sendAccountAction('recovery-progress');
          if (current.step === 'verify' || current.step === 'reset') setStep(current.step);
          else { setStep('restart');setResult(current.ok ? {ok:false,message:copy.restart} : current); }
        }}>{t('我已有恢复验证码')}</button>}
    </fieldset>
    <Feedback result={result}/>
    {result?.cleanup && <CleanupAction scope={result.cleanupScope}/>}
  </form>;
}
