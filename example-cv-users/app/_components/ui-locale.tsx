'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translate, type UiLocale } from '../../lib/account/messages';
export const UI_LOCALE_KEY = 'example-cv-users:locale';
const LocaleContext = createContext({ locale: 'zh' as UiLocale, setLocale: (_: UiLocale) => {}, t: (text: string) => text });

export function UiLocaleProvider({ children, initialLocale = 'zh' }: { children: ReactNode; initialLocale?: UiLocale }) {
  const [locale, setLocaleState] = useState<UiLocale>(initialLocale);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(UI_LOCALE_KEY);
      if (saved === 'zh' || saved === 'en') setLocaleState(saved);
    } catch { /* A blocked preference store must not block the form. */ }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title = locale === 'zh' ? 'EXAMPLE_CV · 账户' : 'EXAMPLE_CV · Account';
  }, [locale]);
  const value = useMemo(() => ({ locale, t: (text: string) => translate(text, locale), setLocale: (next: UiLocale) => {
    setLocaleState(next);
    try { window.localStorage.setItem(UI_LOCALE_KEY, next); } catch { /* Best-effort presentation preference. */ }
  } }), [locale]);
  // Keep the same child tree: changing language must not remount forms or recovery effects.
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export function useUiLocale() { return useContext(LocaleContext); }
export function UiText({ text }: { text: string }) { return <>{useUiLocale().t(text)}</>; }
export function PageIntro({ title, description }: { title: string; description?: string }) {
  const { t } = useUiLocale();
  return <><h1>{t(title)}</h1>{description && <p className="account-description">{t(description)}</p>}</>;
}

export function AccountShell({ children }: { children: ReactNode }) {
  const { locale, setLocale, t } = useUiLocale();
  return <main className="auth-screen"><section className="auth-content">
    <header className="auth-header">
      <a className="auth-brand" href="/"><span>EXAMPLE_CV</span><span>{t('账户中心')}</span></a>
      <div className="ui-locale-switch" role="group" aria-label={t('界面语言')}>
        <button type="button" aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button>
        <span aria-hidden="true">|</span>
        <button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button>
      </div>
    </header>
    {children}
  </section></main>;
}
