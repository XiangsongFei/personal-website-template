'use client';

import {useId} from 'react';
import type {ContentLocale} from '../../lib/editor/draft';
import {editTranslation, safeHttpUrl} from '../../lib/editor/records';
import {linkedInUrlsDiffer, safePublicEmail, type LinksDraft} from '../../lib/editor/site-links';
import {RecordField} from './repeatable-editor';
import {useUiLocale} from './ui-locale';

function ValidatedLinkField({label, type, value, onChange, error}: {
  label: string; type: 'email' | 'url'; value: string; onChange: (value: string) => void; error?: string;
}) {
  const id = useId();
  return <div className="editor-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type={type} value={value} maxLength={type === 'email' ? 254 : 2048}
      autoComplete="off" spellCheck={false} aria-invalid={error ? true : undefined}
      aria-describedby={error ? id + '-error' : undefined}
      onChange={event => onChange(event.target.value)}/>
    {error && <p id={id + '-error'} className="editor-note" role="status">{error}</p>}
  </div>;
}

export function SiteLinksEditor({draft, contentLocale, onChange}: {
  draft: LinksDraft; contentLocale: ContentLocale; onChange: (next: LinksDraft) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const shared = draft.shared;
  const localized = draft.translations[contentLocale];
  const linkedInHref = localized?.linkedInHref ?? '';
  const urlHint = text('请输入不含账号或密码的完整 HTTP 或 HTTPS 链接。', 'Enter a full HTTP or HTTPS URL without credentials.');
  const sharedChange = (key: keyof LinksDraft['shared'], value: string) =>
    onChange({...draft, shared: {...shared, [key]: value}});
  const localizedChange = (key: 'linkedInLabel' | 'linkedInHref', value: string) =>
    onChange({...draft, translations: editTranslation(draft.translations, contentLocale, {[key]: value})});

  return <div className="editor-contact">
    <section aria-labelledby="editor-links-email">
      <h3 id="editor-links-email">{text('公开邮箱', 'Public email')}</h3>
      <p className="editor-note editor-section-note">{text('仅在愿意公开时填写。此处与登录邮箱独立，两种内容语言共用。',
        'Enter an address only if you want it public. It is separate from your login email and shared by both content languages.')}</p>
      <div className="editor-fields record-field-grid">
        <ValidatedLinkField label={text('公开邮箱地址', 'Public email address')} type="email" value={shared.email}
          error={shared.email.trim() && !safePublicEmail(shared.email) ? text('请输入单个有效的邮箱地址。', 'Enter a single valid email address.') : undefined}
          onChange={value => sharedChange('email', value)}/>
        <RecordField label={text('邮箱联系标签', 'Email contact label')} value={shared.emailLabel}
          onChange={value => sharedChange('emailLabel', value)}/>
      </div>
    </section>
    <section aria-labelledby="editor-links-github">
      <h3 id="editor-links-github">GitHub</h3>
      <div className="editor-fields record-field-grid">
        <ValidatedLinkField label={text('GitHub 网址', 'GitHub URL')} type="url" value={shared.github}
          error={shared.github.trim() && !safeHttpUrl(shared.github) ? urlHint : undefined} onChange={value => sharedChange('github', value)}/>
        <RecordField label={text('GitHub 按钮文字', 'GitHub button label')} value={shared.githubLabel}
          onChange={value => sharedChange('githubLabel', value)}/>
      </div>
    </section>
    <section aria-labelledby="editor-links-linkedin">
      <h3 id="editor-links-linkedin">LinkedIn</h3>
      <div className="contact-field-stack">
        <div className="editor-fields record-field-grid">
          <RecordField label={text('LinkedIn 显示名称', 'LinkedIn display name')} value={shared.linkedInDisplayName}
            onChange={value => sharedChange('linkedInDisplayName', value)}/>
          <RecordField label={text('LinkedIn 按钮文字', 'LinkedIn button label')} value={shared.linkedInLabel}
            onChange={value => sharedChange('linkedInLabel', value)}/>
          <ValidatedLinkField label={text('LinkedIn 网址', 'LinkedIn URL')} type="url" value={linkedInHref}
            error={linkedInHref.trim() && !safeHttpUrl(linkedInHref) ? urlHint : undefined} onChange={value => localizedChange('linkedInHref', value)}/>
          <RecordField label={text('LinkedIn 联系标签', 'LinkedIn contact label')} value={localized?.linkedInLabel ?? ''}
            onChange={value => localizedChange('linkedInLabel', value)}/>
        </div>
        <p className="editor-note" role="status">{linkedInUrlsDiffer(draft)
          ? text('中英文网址不同，并已分别保留。切换内容语言可修改另一份网址。',
            'The Chinese and English URLs differ and are kept separately. Switch content language to edit the other URL.')
          : text('网址和联系标签按内容语言分别编辑。显示名称和按钮文字由两种语言共用。',
            'Edit the URL and contact label for each content language. Both languages share the display name and button label.')}</p>
      </div>
    </section>
  </div>;
}
