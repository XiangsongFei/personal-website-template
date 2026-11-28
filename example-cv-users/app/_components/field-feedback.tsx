'use client';

import {createContext, useContext, useId, type ReactNode} from 'react';
import {bilingualFieldKey, fieldModified, type EditorFields, type FieldKey, type Reviews} from '../../lib/editor/bilingual-review';
import type {ContentLocale, EditorModule} from '../../lib/editor/draft';
import {guidePlaceholder} from '../../lib/editor/filling-guide';
import {useUiLocale} from './ui-locale';

type FeedbackContext = {
  module: EditorModule;
  baseline: EditorFields;
  current: EditorFields;
  reviews: Reviews;
  acknowledge: (field: FieldKey) => void;
};
export const FieldFeedbackContext = createContext<FeedbackContext | null>(null);

export function useFieldFeedback(field: FieldKey | undefined, language: ContentLocale | 'shared') {
  const state = useContext(FieldFeedbackContext);
  const {locale} = useUiLocale();
  const id = useId();
  if (!state || !field) return {modified: false};

  const review = state.reviews.get(bilingualFieldKey(field));
  const modified = fieldModified(state.current, state.baseline, field, language);
  const pending = language !== 'shared' && review?.pending && review.source !== language;
  const reminder = language === 'zh' ? (locale === 'zh' ? '请检查中文' : 'Review Chinese')
    : (locale === 'zh' ? '请检查英文' : 'Review English');
  return {modified, reminderId: pending ? id + '-review' : undefined, reminder,
    placeholder: guidePlaceholder(state.module, field.field, language, field.item),
    acknowledge: () => state.acknowledge(field)};
}

export function useHiddenFieldFeedback(fields: readonly {field: string; language: ContentLocale | 'shared'}[]) {
  const state = useContext(FieldFeedbackContext);
  if (!state) return {modified: false, pending: false};
  return {
    modified: fields.some(({field, language}) => fieldModified(state.current, state.baseline, {field}, language)),
    pending: fields.some(({field, language}) => {
      const review = state.reviews.get(bilingualFieldKey({field}));
      return language !== 'shared' && review?.pending && review.source !== language;
    }),
  };
}

export function ReviewField({id, onConfirm, children}: {id: string; onConfirm: () => void; children: ReactNode}) {
  const {locale} = useUiLocale();
  const noChange = locale === 'zh' ? '无需修改' : 'No changes needed';
  return <div className="field-review">
    <span id={id} role="status">{children}</span>
    <button type="button" className="dashboard-action dashboard-action-text" aria-describedby={id}
      onClick={event => {
        // If this action disappears, return focus to the related field/group.
        const owner = event.currentTarget.closest('.editor-field, .project-methods');
        owner?.querySelector<HTMLElement>('input, textarea, .record-add')?.focus();
        onConfirm();
      }}>{noChange}</button>
  </div>;
}
