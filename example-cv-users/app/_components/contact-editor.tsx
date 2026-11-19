'use client';

import {useId} from 'react';
import {contactStatusLabels, newFocus, newStatus, type ContactDraft, type FocusDraft} from '../../lib/editor/contact';
import type {ContentLocale} from '../../lib/editor/draft';
import {editTranslation} from '../../lib/editor/records';
import {RecordField, RepeatableEditor} from './repeatable-editor';
import {useUiLocale} from './ui-locale';

export function ContactEditor({draft, contentLocale, onChange}: {
  draft: ContactDraft; contentLocale: ContentLocale; onChange: (next: ContactDraft) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const values = draft.translations[contentLocale];
  const statusFieldPrefix = useId();
  const caption = (row: FocusDraft, index: number, fallback: string) =>
    (index + 1) + '. ' + (row.translations[contentLocale]?.title?.trim() || fallback);

  function itemFields<T extends FocusDraft>(row: T, update: (next: T) => void, titleLabel: string) {
    const values = row.translations[contentLocale];
    return <>
      <RecordField label={titleLabel} value={values?.title ?? ''}
        onChange={title => update({...row, translations: editTranslation(row.translations, contentLocale, {title})})}/>
      <RecordField label={text('详情', 'Details')} value={values?.detail ?? ''} multiline ai={false}
        onChange={detail => update({...row, translations: editTranslation(row.translations, contentLocale, {detail})})}/>
    </>;
  }

  return <div className="editor-contact">
    <section aria-labelledby="editor-contact-text">
      <h3 id="editor-contact-text">{text('联系栏目', 'Contact text')}</h3>
      <div className="contact-field-stack">
        <RecordField label={text('联系栏目标题', 'Contact section title')} value={values?.contactLabel ?? ''}
          onChange={contactLabel => onChange({...draft, translations: editTranslation(draft.translations, contentLocale, {contactLabel})})}/>
        <RecordField label={text('可联系状态', 'Availability')} value={values?.availability ?? ''} multiline ai={false}
          onChange={availability => onChange({...draft, translations: editTranslation(draft.translations, contentLocale, {availability})})}/>
      </div>
    </section>
    <section aria-labelledby="editor-contact-focus">
      <h3 id="editor-contact-focus">{text('职业关注方向', 'Career interests')}</h3>
      <RepeatableEditor rows={draft.focus} onChange={focus => onChange({...draft, focus})} create={newFocus}
        caption={(row, index) => caption(row, index, text('关注方向', 'Focus item'))}
        addLabel={text('＋ 添加关注方向', '＋ Add focus item')} emptyLabel={text('暂无关注方向。', 'No focus items yet.')}
        fields={(row, update) => itemFields(row, update, text('关注方向标题', 'Focus title'))}/>
    </section>
    <section aria-labelledby="editor-contact-status">
      <h3 id="editor-contact-status">{text('当前状态', 'Current status')}</h3>
      <RepeatableEditor rows={draft.status} onChange={status => onChange({...draft, status})} create={newStatus}
        caption={(row, index) => caption(row, index, contactStatusLabels[row.statusType][locale])}
        addLabel={text('＋ 添加状态', '＋ Add status')} emptyLabel={text('暂无状态。', 'No status items yet.')}
        fields={(row, update) => {
          const fieldId = statusFieldPrefix + '-' + row.clientId;
          return <>
            <div className="editor-field contact-status-type">
              <label htmlFor={fieldId}>{text('状态类别', 'Status type')}</label>
              <select id={fieldId} value={row.statusType} onChange={event => {
                const statusType = event.target.value;
                if (Object.hasOwn(contactStatusLabels, statusType)) {
                  update({...row, statusType: statusType as typeof row.statusType});
                }
              }}>
                {Object.entries(contactStatusLabels).map(([value, labels]) =>
                  <option key={value} value={value}>{labels[locale]}</option>)}
              </select>
            </div>
            {itemFields(row, update, text('状态标题', 'Status title'))}
          </>;
        }}/>
    </section>
  </div>;
}
