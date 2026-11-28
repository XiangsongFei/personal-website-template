'use client';

import {useId} from 'react';
import {
  changeEducationCategory, educationCategories, educationCategory, educationCategoryLabel, educationTitle,
  editTranslation, newEducation, type EducationCategory, type EducationDraft, type EducationText,
} from '../../lib/editor/records';
import type {ContentLocale} from '../../lib/editor/draft';
import {RecordSelect, RepeatableEditor} from './repeatable-editor';
import {FieldMatrix, PairedField} from './paired-field';
import {useUiLocale} from './ui-locale';

export function EducationEditor({rows, contentLocale, onChange}: {
  rows: readonly EducationDraft[]; contentLocale: ContentLocale; onChange: (rows: readonly EducationDraft[]) => void;
}) {
  const {locale} = useUiLocale();
  const categoryId = useId();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  return <RepeatableEditor rows={rows} onChange={onChange} create={newEducation}
    caption={row => {
      const custom = educationCategory(row) === 'custom' ? row.translations[contentLocale]?.customCategoryLabel?.trim() : '';
      return (educationTitle(row, contentLocale).trim() || custom || educationCategoryLabel(educationCategory(row), locale));
    }}
    addLabel={text('＋ 添加教育经历', '＋ Add education')}
    emptyLabel={text('暂无教育记录。', 'No education entries yet.')}
    fields={(row, update) => {
      const category = educationCategory(row);
      function change(language: ContentLocale, field: keyof EducationText, value: string) {
        update({...row, translations: editTranslation(row.translations, language, {[field]: value})});
      }
      const field = (key: keyof EducationText, label: string, multiline = false) => <PairedField identity={{item: row.clientId, field: key}} label={label}
        value={language => key === 'title' ? educationTitle(row, language) : row.translations[language]?.[key] ?? ''}
        multiline={multiline} ai={multiline} onChange={(language, value) => change(language, key, value)}/>;

      return <>
        <div className="editor-fields record-field-grid">
          <RecordSelect label={text('教育类别', 'Education category')} identity={{item: row.clientId, field: 'category'}} id={categoryId} value={category ?? ''} onChange={event => {
              const choice = event.target.value as EducationCategory | '';
              update(changeEducationCategory(row, choice || null));
            }}>
              <option value="">{educationCategoryLabel(null, locale)}</option>
              {educationCategories.map(choice => <option key={choice} value={choice}>{educationCategoryLabel(choice, locale)}</option>)}
            </RecordSelect>
          <FieldMatrix>
            {category === 'custom' && field('customCategoryLabel', text('自定义类别名称', 'Custom category name'))}
            {field('title', text('标题', 'Title'))}
            {field('program', text('学校、专业或项目', 'School, program or major'))}
            {field('period', text('时间范围', 'Period'))}
            {field('grade', text('成绩或 GPA', 'Grade or GPA'))}
            {category === 'summerSchool' && field('courseTitle', text('课程名称', 'Course title'))}
          </FieldMatrix>
        </div>
        {category === 'summerSchool' && field('courseDescription', text('课程描述', 'Course description'), true)}
      </>;
    }}/>
}
