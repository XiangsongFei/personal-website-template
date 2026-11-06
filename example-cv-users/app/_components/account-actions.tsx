'use client';
import { useEffect, useRef, useState } from 'react';
import { sendAccountAction, type AccountResult } from '../../lib/account/client';
import { RESEND_SECONDS } from '../../lib/account/policy';
import { useUiLocale } from './ui-locale';

export function Feedback({result}: {result?: AccountResult}) {
  const {t} = useUiLocale();
  if (!result?.message) return null;
  return <p role={result.ok ? 'status' : 'alert'} aria-live="polite" className={result.ok ? 'success' : 'feedback'}>{t(result.message)}</p>;
}

export function CleanupAction({scope = 'recovery'}: {scope?: 'account' | 'recovery'}) {
  const {t} = useUiLocale();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AccountResult>();
  async function finish() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const response = await sendAccountAction(scope === 'account' ? 'logout' : 'recovery-logout', {});
      if (response.ok) window.location.replace('/login');
      else setResult(response);
    } finally { lock.current = false; setBusy(false); }
  }
  return <><button type="button" className="outline-button" disabled={busy} onClick={finish}>{t('完成退出')}</button><Feedback result={result}/></>;
}

export function useResendClock() {
  const [deadline, setDeadline] = useState(0);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(() => {tick(); if (Date.now() >= deadline) clearInterval(timer);}, 500);
    return () => clearInterval(timer);
  }, [deadline]);
  function start(seconds = RESEND_SECONDS) {
    const wait = Math.max(0, Math.min(RESEND_SECONDS, seconds));
    setRemaining(wait);
    setDeadline(Date.now() + wait * 1000);
  }
  return {remaining, start};
}
export function ResendLabel({remaining}: {remaining: number}) {
  const {t, locale} = useUiLocale();
  if (!remaining) return t('重新获取验证码');
  return locale === 'zh' ? `${remaining} 秒后可重新申请` : `Request again in ${remaining}s`;
}
