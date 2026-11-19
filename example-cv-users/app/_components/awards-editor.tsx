'use client';

import type {ContentLocale} from '../../lib/editor/draft';
import {awardYearsDiffer, editTranslation, newAward, type AwardDraft} from '../../lib/editor/records';
import {RecordField, RepeatableEditor} from './repeatable-editor';
import {useUiLocale} from './ui-locale';

export function AwardsEditor({rows, contentLocale, onChange}: {
  rows: readonly AwardDraft[]; contentLocale: ContentLocale; onChange: (rows: readonly AwardDraft[]) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  return <RepeatableEditor rows={rows} onChange={onChange} create={newAward}
    caption={(row, index) => (index + 1) + '. ' + (row.translations[contentLocale]?.name?.trim() || text('荣誉奖项', 'Award'))}
    addLabel={text('＋ 添加奖项', '＋ Add award')}
    emptyLabel={text('暂无奖项。', 'No awards yet.')}
    fields={(row, update) => {
      const values = row.translations[contentLocale];
      return <div className="award-fields">
        <RecordField label={text('奖项名称', 'Award name')} value={values?.name ?? ''} multiline ai={false}
          onChange={name => update({...row, translations: editTranslation(row.translations, contentLocale, {name})})}/>
        <RecordField label={text('年份', 'Year')} value={values?.year ?? ''}
          onChange={year => update({...row, translations: editTranslation(row.translations, contentLocale, {year})})}/>
        {awardYearsDiffer(row) && <p className="editor-note">
          {text('两种语言的年份不同，可分别编辑。', 'The years differ by language. Edit each separately.')}
        </p>}
      </div>;
    }}/>
}
