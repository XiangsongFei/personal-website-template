'use client';

import {useId, useLayoutEffect, useRef, useState} from 'react';
import type {ContentLocale} from '../../lib/editor/draft';
import {stackPairedControls} from '../../lib/editor/paired-fit';
import {EditorAiActions, RecordField} from './repeatable-editor';
import {useUiLocale} from './ui-locale';

export const editorLocales = ['zh', 'en'] as const;
const localeNames = {zh: '中文', en: 'English'} as const;
const controlLanguage = {zh: 'zh-CN', en: 'en'} as const;
let canvasContext: CanvasRenderingContext2D | null | undefined;

function requiredWidth(input: HTMLInputElement) {
  canvasContext ??= document.createElement('canvas').getContext('2d');
  if (!canvasContext) return NaN;
  const style = getComputedStyle(input);
  canvasContext.font = [style.fontStyle, style.fontVariant, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
  canvasContext.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  const chrome = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
    .reduce((sum, dimension) => sum + (Number.parseFloat(dimension) || 0), 0);
  return canvasContext.measureText(input.value).width + chrome;
}

export function PairedField({label, value, onChange, multiline = false, ai = false, type, maxLength, error, hint}: {
  label: string; value: (locale: ContentLocale) => string; onChange: (locale: ContentLocale, value: string) => void;
  multiline?: boolean; ai?: boolean; type?: 'text' | 'url'; maxLength?: number;
  error?: (value: string) => string | undefined; hint?: (value: string) => string;
}) {
  const {locale} = useUiLocale();
  const reasonId = useId();
  const area = useRef<HTMLDivElement>(null);
  const lastLayout = useRef(false);
  const [stacked, setStacked] = useState(false);
  const zh = value('zh');
  const en = value('en');

  useLayoutEffect(() => {
    const pair = area.current;
    if (!pair || multiline) return;
    const controls = Array.from(pair.querySelectorAll('input'));
    const measure = () => {
      if (!pair.clientWidth || controls.length !== 2) return;
      const gap = Number.parseFloat(getComputedStyle(pair).columnGap);
      const next = stackPairedControls(pair.clientWidth, gap, controls.map(requiredWidth), lastLayout.current);
      if (next !== lastLayout.current) {
        lastLayout.current = next;
        setStacked(next);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pair, {box: 'border-box'});
    document.fonts?.addEventListener('loadingdone', measure);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [zh, en, multiline]);

  return <fieldset className="editor-pair">
    <legend>{label}</legend>
    {ai && <EditorAiActions reasonId={reasonId}/>}
    <div className="editor-pair-values" ref={area} data-pair-layout={stacked || multiline ? 'stacked' : 'paired'}>
      {editorLocales.map((language, index) => {
        const current = index ? en : zh;
        return <RecordField key={language} label={localeNames[language]} accessibleLabel={label + ' · ' + localeNames[language]}
          lang={controlLanguage[language]} value={current}
          onChange={next => onChange(language, next)} multiline={multiline} type={type} maxLength={maxLength}
          error={error?.(current)} hint={hint?.(current)}/>;
      })}
    </div>
    {ai && <p id={reasonId} className="editor-note">{locale === 'zh' ? 'AI 优化与生成尚未开放。' : 'AI refinement and generation are unavailable.'}</p>}
  </fieldset>;
}
