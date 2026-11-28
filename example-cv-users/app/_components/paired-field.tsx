'use client';

import {createContext, useContext, type ReactNode} from 'react';
import {editorLocales, type FieldKey} from '../../lib/editor/bilingual-review';
import type {ContentLocale} from '../../lib/editor/draft';
import {EditorAiActions, RecordField} from './repeatable-editor';

const localeNames = {zh: '中文', en: 'English'} as const;
const controlLanguage = {zh: 'zh-CN', en: 'en'} as const;
const MatrixContext = createContext(false);

export function FieldMatrix({children}: {children: ReactNode}) {
  return <MatrixContext.Provider value={true}>
    <div className="editor-field-matrix">
      <div className="editor-matrix-headings" aria-hidden="true">
        <span lang="zh-CN">中文</span><span lang="en">English</span>
      </div>
      {children}
    </div>
  </MatrixContext.Provider>;
}

export function PairedField({label, identity, value, onChange, multiline = false, long = false, hideLegend = false, compact = false, ai = false, type, maxLength, error, count}: {
  label: string; identity: FieldKey; value: (locale: ContentLocale) => string; onChange: (locale: ContentLocale, value: string) => void;
  multiline?: boolean; long?: boolean; hideLegend?: boolean; compact?: boolean; ai?: boolean; type?: 'text' | 'url'; maxLength?: number;
  error?: (value: string) => string | undefined; count?: (value: string) => string;
}) {
  const matrix = useContext(MatrixContext) && !multiline && type !== 'url';
  const layout = matrix ? 'matrix' : multiline || type === 'url' ? 'stacked' : 'paired';
  const controls = <div className="editor-pair-values" data-pair-layout={layout}>
    {editorLocales.map(language => {
      const current = value(language);
      return <RecordField key={language} label={localeNames[language]} accessibleLabel={label + ' · ' + localeNames[language]}
        lang={controlLanguage[language]} value={current} identity={identity} language={language}
        onChange={next => onChange(language, next)} multiline={multiline} long={long} compact={compact} type={type} maxLength={maxLength}
        error={error?.(current)} count={count?.(current)} matrix={matrix}/>;
    })}
  </div>;

  if (matrix) {
    return <div className="editor-pair editor-matrix-row" data-field={identity.field}>
      <span className="editor-matrix-label" aria-hidden="true">{label}</span>
      {controls}
    </div>;
  }
  return <fieldset className="editor-pair" data-field={identity.field}>
    <legend className={hideLegend ? 'dashboard-visually-hidden' : undefined}>{label}</legend>
    {controls}
    {ai && <EditorAiActions/>}
  </fieldset>;
}
