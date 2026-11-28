'use client';

import type {ContentLocale} from '../../lib/editor/draft';
import {editTranslation} from '../../lib/editor/records';
import {
  editableNavigationSections, previewSections, sectionTitleFields, type SiteTextDraft,
} from '../../lib/editor/site-text';
import {FieldMatrix, PairedField} from './paired-field';
import {useUiLocale} from './ui-locale';

type SiteTextKey = keyof NonNullable<SiteTextDraft['translations'][ContentLocale]>;

export function SiteTextEditor({draft, onChange}: {
  draft: SiteTextDraft; onChange: (next: SiteTextDraft) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const sectionLabel = (section: keyof typeof previewSections) => previewSections[section][locale === 'zh' ? 0 : 1];
  const field = (key: SiteTextKey, label: string) => <PairedField key={key} identity={{field: key}} label={label} value={language => draft.translations[language]?.[key] ?? ''}
    onChange={(language, value) => onChange({...draft, translations: editTranslation(draft.translations, language, {[key]: value})})}/>;

  return <div className="editor-contact">
    <section aria-labelledby="editor-site-navigation">
      <h3 id="editor-site-navigation">{text('公开网站导航', 'Public website navigation')}</h3>
      <FieldMatrix>
        {editableNavigationSections.map(section =>
          <PairedField key={section} identity={{field: 'nav:' + section}} label={sectionLabel(section)} value={language => draft.navigation[language]?.[section] ?? ''}
            onChange={(language, value) => onChange({...draft, navigation: editTranslation(draft.navigation, language, {[section]: value})})}/>)}
      </FieldMatrix>
    </section>
    <section aria-labelledby="editor-site-headings">
      <h3 id="editor-site-headings">{text('栏目标题', 'Section headings')}</h3>
      <FieldMatrix>
        {(Object.keys(sectionTitleFields) as (keyof typeof sectionTitleFields)[]).map(section =>
          field(sectionTitleFields[section], sectionLabel(section)))}
        {field('kaggleLabel', text('项目链接文字', 'Project link label'))}
      </FieldMatrix>
    </section>
    <section aria-labelledby="editor-site-pdf">
      <h3 id="editor-site-pdf">{text('简历 PDF', 'Resume PDF')}</h3>
      <p className="editor-note editor-section-note">{text('PDF 上传、引用和下载尚未开放。此处只编辑按钮文字。',
        'PDF upload, referencing and download are unavailable. This field edits the button label.')}</p>
      <FieldMatrix>{field('portfolioLabel', text('简历 PDF 按钮文字', 'Resume PDF button label'))}</FieldMatrix>
    </section>
    <section aria-labelledby="editor-site-footer">
      <h3 id="editor-site-footer">{text('页脚', 'Footer')}</h3>
      <p className="editor-note editor-section-note">{text('编辑更新时间前的文字。更新时间由发布服务确认。',
        'Edit the label before the update date. The date requires a confirmed publication timestamp.')}</p>
      <FieldMatrix>{field('updatedAtLabel', text('更新时间标签', 'Updated-at label'))}</FieldMatrix>
    </section>
  </div>;
}
