'use client';

import {useId, useState} from 'react';
import {editorLocales} from '../../lib/editor/bilingual-review';
import type {ContentLocale} from '../../lib/editor/draft';
import {editTranslation, safeHttpUrl} from '../../lib/editor/records';
import {safePublicEmail, type LinksDraft, type PublicLinkText} from '../../lib/editor/site-links';
import {DashboardIcon, UnsavedDot} from './dashboard';
import {useHiddenFieldFeedback} from './field-feedback';
import {PreviewIcon} from './preview-icons';
import {RecordField} from './repeatable-editor';
import {useUiLocale} from './ui-locale';

const displayFields = [
  {field: 'linkedInDisplayName', language: 'shared'},
  {field: 'linkedInLabel', language: 'shared'},
  {field: 'linkedInLabel', language: 'zh'},
  {field: 'linkedInLabel', language: 'en'},
] as const;

export function SiteLinksEditor({draft, onChange}: {
  draft: LinksDraft; onChange: (next: LinksDraft) => void;
}) {
  const {locale} = useUiLocale();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsId = useId();
  const privacyId = useId();
  const settings = useHiddenFieldFeedback(displayFields);
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const shared = draft.shared;
  const urlError = (value: string) => value.trim() && !safeHttpUrl(value)
    ? text('请输入不含账号或密码的完整 HTTP 或 HTTPS 链接。', 'Enter a full HTTP or HTTPS URL without credentials.')
    : undefined;
  const sharedChange = (key: keyof LinksDraft['shared'], value: string) =>
    onChange({...draft, shared: {...shared, [key]: value}});
  const sharedField = (field: keyof LinksDraft['shared'], label: string) =>
    <RecordField identity={{field}} label={label} value={shared[field]} onChange={value => sharedChange(field, value)}/>;

  function localizedField(language: ContentLocale, field: keyof PublicLinkText) {
    const value = draft.translations[language]?.[field] ?? '';
    const address = field === 'linkedInHref';
    const label = address
      ? (language === 'zh' ? text('中文网址', 'Chinese URL') : text('英文网址', 'English URL'))
      : (language === 'zh' ? text('中文联系标签', 'Chinese contact label') : text('英文联系标签', 'English contact label'));
    return <RecordField key={language} identity={{field}} language={language} label={label}
      lang={language === 'zh' ? 'zh-CN' : 'en'} type={address ? 'url' : 'text'} maxLength={address ? 2048 : undefined}
      value={value} error={address ? urlError(value) : undefined} compact={address} reviewBelow
      onChange={next => onChange({...draft, translations: editTranslation(draft.translations, language, {[field]: next})})}/>;
  }

  return <div className="editor-public-links">
    <section className="editor-link-platform" aria-labelledby="editor-links-email">
      <div className="editor-link-platform-heading">
        <h3 id="editor-links-email"><PreviewIcon kind="mail"/>{text('电子邮箱', 'Email')}</h3>
      </div>
      <div className="editor-link-grid">
        <RecordField identity={{field: 'email'}} label={text('公开邮箱地址', 'Public email address')} type="email" maxLength={254} value={shared.email}
          describedBy={privacyId} error={shared.email.trim() && !safePublicEmail(shared.email)
            ? text('请输入单个有效的邮箱地址。', 'Enter a single valid email address.') : undefined}
          onChange={value => sharedChange('email', value)}/>
        {sharedField('emailLabel', text('邮箱联系标签', 'Email contact label'))}
      </div>
      <p id={privacyId} className="editor-note editor-link-privacy">
        {text('此邮箱会公开展示，与登录邮箱独立。', 'This address is public and separate from your login email.')}
      </p>
    </section>
    <section className="editor-link-platform" aria-labelledby="editor-links-github">
      <div className="editor-link-platform-heading">
        <h3 id="editor-links-github"><PreviewIcon kind="github"/>GitHub</h3>
      </div>
      <div className="editor-link-grid">
        <RecordField identity={{field: 'github'}} label={text('主页网址', 'Profile URL')} type="url" maxLength={2048} value={shared.github}
          error={urlError(shared.github)} onChange={value => sharedChange('github', value)}/>
        {sharedField('githubLabel', text('按钮文字', 'Button label'))}
      </div>
    </section>
    <section className="editor-link-platform" aria-labelledby="editor-links-linkedin">
      <div className="editor-link-platform-heading">
        <h3 id="editor-links-linkedin"><PreviewIcon kind="linkedin"/>LinkedIn</h3>
        <button type="button" className="dashboard-action dashboard-action-text link-display-toggle" aria-expanded={settingsOpen}
          aria-controls={settingsId} onClick={() => setSettingsOpen(open => !open)}>
          <DashboardIcon kind="chevron-right"/>
          <span className="dashboard-visually-hidden">LinkedIn · </span>
          {text('展示设置', 'Display settings')}
          {settings.modified && <UnsavedDot/>}
          {settings.pending && <span className="link-review-marker">{text('待双语检查', 'Translation review needed')}</span>}
        </button>
      </div>
      <div className="editor-link-grid editor-link-addresses">
        {editorLocales.map(language => localizedField(language, 'linkedInHref'))}
      </div>
      <div id={settingsId} className="editor-link-grid editor-link-settings" hidden={!settingsOpen}>
        {sharedField('linkedInDisplayName', text('显示名称', 'Display name'))}
        {sharedField('linkedInLabel', text('按钮文字', 'Button label'))}
        {editorLocales.map(language => localizedField(language, 'linkedInLabel'))}
      </div>
    </section>
  </div>;
}
