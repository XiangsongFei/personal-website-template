'use client';

import type {ContentLocale} from '../../lib/editor/draft';
import {editTranslation} from '../../lib/editor/records';
import {
  editableNavigationSections, previewSections, sectionTitleFields, type SiteTextDraft,
} from '../../lib/editor/site-text';
import {RecordField} from './repeatable-editor';
import {useUiLocale} from './ui-locale';

type SiteTextKey = keyof NonNullable<SiteTextDraft['translations'][ContentLocale]>;

export function SiteTextEditor({draft, contentLocale, onChange}: {
  draft: SiteTextDraft; contentLocale: ContentLocale; onChange: (next: SiteTextDraft) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const sectionLabel = (section: keyof typeof previewSections) => previewSections[section][locale === 'zh' ? 0 : 1];
  const fields = draft.translations[contentLocale];
  const nav = draft.navigation[contentLocale];
  const field = (key: SiteTextKey, label: string) => <RecordField key={key} label={label} value={fields?.[key] ?? ''}
    onChange={value => onChange({...draft, translations: editTranslation(draft.translations, contentLocale, {[key]: value})})}/>;

  return <div className="editor-contact">
    <section aria-labelledby="editor-site-navigation">
      <h3 id="editor-site-navigation">{text('公开网站导航', 'Public website navigation')}</h3>
      <p className="editor-note editor-section-note">{text('只修改公开网站的导航文字。章节和顺序固定。',
        'Edit the public website labels. The sections and their order are fixed.')}</p>
      <div className="editor-fields record-field-grid">
        {editableNavigationSections.map(section =>
          <RecordField key={section} label={sectionLabel(section)} value={nav?.[section] ?? ''}
            onChange={value => onChange({...draft, navigation: editTranslation(draft.navigation, contentLocale, {[section]: value})})}/>)}
      </div>
    </section>
    <section aria-labelledby="editor-site-headings">
      <h3 id="editor-site-headings">{text('栏目标题', 'Section headings')}</h3>
      <div className="editor-fields record-field-grid">
        {(Object.keys(sectionTitleFields) as (keyof typeof sectionTitleFields)[]).map(section =>
          field(sectionTitleFields[section], sectionLabel(section)))}
        {field('kaggleLabel', text('项目链接文字', 'Project link label'))}
      </div>
    </section>
    <section aria-labelledby="editor-site-pdf">
      <h3 id="editor-site-pdf">{text('简历 PDF', 'Resume PDF')}</h3>
      <p className="editor-note editor-section-note">{text('PDF 上传、引用和下载尚未开放。此处只编辑按钮文字。',
        'PDF upload, referencing and download are unavailable. This field edits the button label.')}</p>
      {field('portfolioLabel', text('简历 PDF 按钮文字', 'Resume PDF button label'))}
    </section>
    <section aria-labelledby="editor-site-footer">
      <h3 id="editor-site-footer">{text('页脚', 'Footer')}</h3>
      <p className="editor-note editor-section-note">{text('编辑更新时间前的文字。更新时间由发布服务确认。',
        'Edit the label before the update date. The date requires a confirmed publication timestamp.')}</p>
      {field('updatedAtLabel', text('更新时间标签', 'Updated-at label'))}
    </section>
  </div>;
}
