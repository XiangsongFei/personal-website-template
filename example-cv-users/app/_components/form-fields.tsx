'use client';
import { useState, type InputHTMLAttributes } from 'react';
import { useUiLocale } from './ui-locale';


export function PasswordField({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string }) {
  const { t } = useUiLocale();
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${props.id}-hint` : undefined;
  return <div className="form-field">
    <label htmlFor={props.id}>{t(label)}</label>
    <div className="password-control">
      <input {...props} type={visible ? 'text' : 'password'} aria-describedby={hintId ?? props['aria-describedby']} />
      <button className="password-toggle" type="button" aria-label={`${t(visible ? '隐藏密码' : '显示密码')} · ${t(label)}`}
        aria-controls={props.id} aria-pressed={visible} onClick={() => setVisible(value => !value)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
    {hint && <p id={hintId} className="hint">{t(hint)}</p>}
  </div>;
}

import { normalizeOtp, OTP_DIGITS } from '../../lib/account/policy';

export function CodeField({id, label = '验证码', hint, invalid = false}: {
  id: string; label?: string; hint?: string; invalid?: boolean;
}) {
  const {t} = useUiLocale();
  return <div className="form-field"><label htmlFor={id}>{t(label)}</label>
    <input id={id} name="token" className="otp-input" type="text" placeholder="000000" inputMode="numeric"
      pattern={`[0-9]{${OTP_DIGITS}}`} required minLength={OTP_DIGITS} maxLength={OTP_DIGITS}
      aria-describedby={hint ? id + '-hint' : undefined} aria-invalid={invalid} autoComplete="one-time-code"
      onChange={e => {e.currentTarget.value = normalizeOtp(e.currentTarget.value);}}
      onPaste={e => {
        e.preventDefault();
        const input = e.currentTarget;
        const start = input.selectionStart ?? 0, end = input.selectionEnd ?? input.value.length;
        input.value = normalizeOtp(input.value.slice(0, start) + e.clipboardData.getData('text') + input.value.slice(end));
      }}/>
    {hint && <p id={id + '-hint'} className="hint">{t(hint)}</p>}
  </div>;
}
