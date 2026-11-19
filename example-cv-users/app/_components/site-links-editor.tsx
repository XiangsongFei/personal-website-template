'use client';

import type {ContentLocale} from '../../lib/editor/draft';
import {editTranslation, safeHttpUrl} from '../../lib/editor/records';
import {linkedInUrlsDiffer, safePublicEmail, type LinksDraft} from '../../lib/editor/site-links';
import {RecordField} from './repeatable-editor';
import {PairedField} from './paired-field';
import {useUiLocale} from './ui-locale';

export function SiteLinksEditor({draft, onChange}: {
  draft: LinksDraft; onChange: (next: LinksDraft) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const shared = draft.shared;
  const urlHint = text('请输入不含账号或密码的完整 HTTP 或 HTTPS 链接。', 'Enter a full HTTP or HTTPS URL without credentials.');
  const sharedChange = (key: keyof LinksDraft['shared'], value: string) =>
    onChange({...draft, shared: {...shared, [key]: value}});
  const localizedChange = (language: ContentLocale, key: 'linkedInLabel' | 'linkedInHref', value: string) =>
    onChange({...draft, translations: editTranslation(draft.translations, language, {[key]: value})});

  return <div className="editor-contact">
    <section aria-labelledby="editor-links-email">
      <h3 id="editor-links-email">{text('公开邮箱', 'Public email')}</h3>
      <p className="editor-note editor-section-note">{text('仅在愿意公开时填写。此处与登录邮箱独立，两种内容语言共用。',
        'Enter an address only if you want it public. It is separate from your login email and shared by both content languages.')}</p>
      <div className="editor-fields record-field-grid">
        <RecordField label={text('公开邮箱地址', 'Public email address')} type="email" maxLength={254} value={shared.email}
          error={shared.email.trim() && !safePublicEmail(shared.email) ? text('请输入单个有效的邮箱地址。', 'Enter a single valid email address.') : undefined}
          onChange={value => sharedChange('email', value)}/>
        <RecordField label={text('邮箱联系标签', 'Email contact label')} value={shared.emailLabel}
          onChange={value => sharedChange('emailLabel', value)}/>
      </div>
    </section>
    <section aria-labelledby="editor-links-github">
      <h3 id="editor-links-github">GitHub</h3>
      <div className="editor-fields record-field-grid">
        <RecordField label={text('GitHub 网址', 'GitHub URL')} type="url" maxLength={2048} value={shared.github}
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
          <PairedField label={text('LinkedIn 网址', 'LinkedIn URL')} type="url" maxLength={2048}
            value={language => draft.translations[language]?.linkedInHref ?? ''}
            error={value => value.trim() && !safeHttpUrl(value) ? urlHint : undefined}
            onChange={(language, value) => localizedChange(language, 'linkedInHref', value)}/>
          <PairedField label={text('LinkedIn 联系标签', 'LinkedIn contact label')}
            value={language => draft.translations[language]?.linkedInLabel ?? ''}
            onChange={(language, value) => localizedChange(language, 'linkedInLabel', value)}/>
        </div>
        <p className="editor-note" role="status">{linkedInUrlsDiffer(draft)
          ? text('中英文网址不同，并已分别保留。可以分别修改两个输入。',
            'The Chinese and English URLs differ and are kept separately. You can edit either URL individually.')
          : text('网址和联系标签按内容语言分别编辑。显示名称和按钮文字由两种语言共用。',
            'Edit the URL and contact label for each content language. Both languages share the display name and button label.')}</p>
      </div>
    </section>
  </div>;
}
