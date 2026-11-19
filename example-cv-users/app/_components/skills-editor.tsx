'use client';

import {useId} from 'react';
import type {ContentLocale} from '../../lib/editor/draft';
import {
  editTranslation, newSkill, skillCategories, skillCategory, skillPresetTitles, skillTitle,
  type SkillCategory, type SkillDraft,
} from '../../lib/editor/records';
import {RepeatableEditor} from './repeatable-editor';
import {PairedField} from './paired-field';
import {useUiLocale} from './ui-locale';

export function SkillsEditor({rows, contentLocale, onChange}: {
  rows: readonly SkillDraft[]; contentLocale: ContentLocale; onChange: (rows: readonly SkillDraft[]) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const categoryId = useId();
  return <RepeatableEditor rows={rows} onChange={onChange} create={newSkill}
    caption={(row, index) => (index + 1) + '. ' + (skillTitle(row, contentLocale).trim() || text('技能分组', 'Skill group'))}
    addLabel={text('＋ 添加技能分组', '＋ Add skill group')}
    emptyLabel={text('暂无技能分组。', 'No skill groups yet.')}
    fields={(row, update) => {
      const category = skillCategory(row);
      const fieldId = categoryId + '-' + row.clientId;
      return <>
        <div className="editor-fields record-field-grid">
          <div className="editor-field">
            <label htmlFor={fieldId}>{text('技能类别', 'Skill category')}</label>
            <select id={fieldId} value={category} onChange={event =>
              update({...row, category: event.target.value as SkillCategory})}>
              {skillCategories.map(choice => <option key={choice} value={choice}>
                {choice === 'custom' ? text('自定义', 'Custom') : skillPresetTitles[choice][locale]}
              </option>)}
            </select>
          </div>
          {category === 'custom' ? <PairedField label={text('技能分组名称', 'Skill group name')} value={language => row.translations[language]?.title ?? ''}
            onChange={(language, title) => update({...row, category: 'custom', translations: editTranslation(row.translations, language, {title})})}/> :
            <div className="editor-field">
              <span>{text('预设名称', 'Preset name')}</span>
              <p className="editor-note">{skillTitle(row, contentLocale)} · {text('切回自定义可编辑原名称。', 'Switch to Custom to edit your own name.')}</p>
            </div>}
        </div>
        <PairedField label={text('技能内容', 'Skills content')} value={language => row.translations[language]?.items ?? ''} multiline
          onChange={(language, items) => update({...row, translations: editTranslation(row.translations, language, {items})})}/>
      </>;
    }}/>
}
