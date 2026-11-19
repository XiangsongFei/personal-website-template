'use client';

import {
  changeEducationCategory, educationCategories, educationCategory, educationCategoryLabel, educationTitle,
  editTranslation, newEducation, type EducationCategory, type EducationDraft, type EducationText,
} from '../../lib/editor/records';
import type {ContentLocale} from '../../lib/editor/draft';
import {RecordField, RepeatableEditor} from './repeatable-editor';
import {useUiLocale} from './ui-locale';

export function EducationEditor({rows, contentLocale, onChange}: {
  rows: readonly EducationDraft[]; contentLocale: ContentLocale; onChange: (rows: readonly EducationDraft[]) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  return <RepeatableEditor rows={rows} onChange={onChange} create={newEducation}
    caption={(row, index) => {
      const custom = educationCategory(row) === 'custom' ? row.translations[contentLocale]?.customCategoryLabel?.trim() : '';
      return (index + 1) + '. ' + (educationTitle(row, contentLocale).trim() || custom || educationCategoryLabel(educationCategory(row), locale));
    }}
    addLabel={text('＋ 添加教育经历', '＋ Add education')}
    emptyLabel={text('暂无教育记录。', 'No education entries yet.')}
    fields={(row, update) => {
      const category = educationCategory(row);
      const values = row.translations[contentLocale];
      function change(field: keyof EducationText, value: string) {
        update({...row, translations: editTranslation(row.translations, contentLocale, {[field]: value})});
      }
      const field = (key: keyof EducationText, label: string, multiline = false) => <RecordField label={label}
        value={key === 'title' ? educationTitle(row, contentLocale) : values?.[key] ?? ''}
        multiline={multiline} onChange={value => change(key, value)}/>;

      return <>
        <div className="editor-fields record-field-grid">
          <label className="editor-field">{text('教育类别', 'Education category')}
            <select value={category ?? ''} onChange={event => {
              const choice = event.target.value as EducationCategory | '';
              update(changeEducationCategory(row, choice || null));
            }}>
              <option value="">{educationCategoryLabel(null, locale)}</option>
              {educationCategories.map(choice => <option key={choice} value={choice}>{educationCategoryLabel(choice, locale)}</option>)}
            </select>
          </label>
          {category === 'custom' && field('customCategoryLabel', text('自定义类别名称', 'Custom category name'))}
          {field('title', text('标题', 'Title'))}
          {field('program', text('学校、专业或项目', 'School, program or major'))}
          {field('period', text('时间范围', 'Period'))}
          {field('grade', text('成绩或 GPA', 'Grade or GPA'))}
          {category === 'summerSchool' && field('courseTitle', text('课程名称', 'Course title'))}
        </div>
        {category === 'summerSchool' && field('courseDescription', text('课程描述', 'Course description'), true)}
      </>;
    }}/>
}
