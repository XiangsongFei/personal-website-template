'use client';

import type {ContentLocale} from '../../lib/editor/draft';
import {awardYearsDiffer, editTranslation, newAward, type AwardDraft} from '../../lib/editor/records';
import {RepeatableEditor} from './repeatable-editor';
import {FieldMatrix, PairedField} from './paired-field';
import {useUiLocale} from './ui-locale';

export function AwardsEditor({rows, contentLocale, onChange}: {
  rows: readonly AwardDraft[]; contentLocale: ContentLocale; onChange: (rows: readonly AwardDraft[]) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  return <RepeatableEditor rows={rows} onChange={onChange} create={newAward}
    caption={row => (row.translations[contentLocale]?.name?.trim() || text('荣誉奖项', 'Award'))}
    addLabel={text('＋ 添加奖项', '＋ Add award')}
    emptyLabel={text('暂无奖项。', 'No awards yet.')}
    fields={(row, update) => {
      return <div className="award-fields">
        <FieldMatrix>
          <PairedField identity={{item: row.clientId, field: 'name'}} label={text('奖项名称', 'Award name')} value={language => row.translations[language]?.name ?? ''} maxLength={20_000}
          onChange={(language, name) => update({...row, translations: editTranslation(row.translations, language, {name})})}/>
        <PairedField identity={{item: row.clientId, field: 'year'}} compact label={text('年份', 'Year')} value={language => row.translations[language]?.year ?? ''}
          onChange={(language, year) => update({...row, translations: editTranslation(row.translations, language, {year})})}/>
        </FieldMatrix>
        {awardYearsDiffer(row) && <p className="editor-note">
          {text('两种语言的年份不同，可分别编辑。', 'The years differ by language. Edit each separately.')}
        </p>}
      </div>;
    }}/>
}
