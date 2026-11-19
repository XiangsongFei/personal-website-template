'use client';

import {editTranslation, newExperience, type ExperienceDraft, type ExperienceText} from '../../lib/editor/records';
import type {ContentLocale} from '../../lib/editor/draft';
import {RecordField, RepeatableEditor} from './repeatable-editor';
import {useUiLocale} from './ui-locale';

export function ExperienceEditor({rows, contentLocale, onChange}: {
  rows: readonly ExperienceDraft[]; contentLocale: ContentLocale; onChange: (rows: readonly ExperienceDraft[]) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  return <RepeatableEditor rows={rows} onChange={onChange} create={newExperience}
    caption={(row, index) => {
      const values = row.translations[contentLocale];
      return (index + 1) + '. ' + (values?.title?.trim() || values?.organization?.trim() || text('工作经历', 'Experience'));
    }}
    addLabel={text('＋ 添加工作经历', '＋ Add experience')}
    emptyLabel={text('暂无工作记录。', 'No experience entries yet.')}
    fields={(row, update) => {
      const values = row.translations[contentLocale];
      const field = (key: keyof ExperienceText, label: string, multiline = false) => <RecordField label={label}
        value={values?.[key] ?? ''} multiline={multiline}
        onChange={value => update({...row, translations: editTranslation(row.translations, contentLocale, {[key]: value})})}/>;
      return <>
        <div className="editor-fields record-field-grid">
          {field('organization', text('公司或组织', 'Company or organization'))}
          {field('title', text('职位或角色', 'Position or role'))}
          {field('period', text('时间范围', 'Period'))}
          {field('location', text('地点', 'Location'))}
        </div>
        {field('description', text('工作描述', 'Work description'), true)}
      </>;
    }}/>
}
