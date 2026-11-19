'use client';

import {useId, useRef, useState, type ReactNode} from 'react';
import {moveRecord, removeRecord, type OrderedDraftRecord} from '../../lib/editor/records';
import {useUiLocale} from './ui-locale';

export function EditorAiActions({reasonId}: {reasonId: string}) {
  const {locale} = useUiLocale();
  return <div className="editor-ai" aria-describedby={reasonId}>
    <button type="button" disabled><span aria-hidden="true">✧</span> {locale === 'zh' ? 'AI 优化' : 'AI refine'}</button>
    <button type="button" disabled><span aria-hidden="true">✧</span> {locale === 'zh' ? 'AI 生成' : 'AI generate'}</button>
  </div>;
}

export function RecordField({label, accessibleLabel, value, onChange, multiline = false, maxLength,
  type = 'text', error, hint, lang}: {
  label: string; accessibleLabel?: string; value: string; onChange: (value: string) => void;
  multiline?: boolean; maxLength?: number; type?: 'text' | 'url' | 'email';
  error?: string; hint?: string; lang?: string;
}) {
  const id = useId();
  const feedbackId = id + '-feedback';
  const props = {
    id, value, lang, 'aria-label': accessibleLabel,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error || hint ? feedbackId : undefined,
  };
  return <div className={multiline ? 'editor-field record-description' : 'editor-field'}>
    <label htmlFor={id}>{label}</label>
    {multiline ? <textarea {...props} maxLength={maxLength ?? 20_000} onChange={event => onChange(event.target.value)}/>
      : <input {...props} type={type} maxLength={maxLength ?? 500} autoComplete="off" spellCheck={type === 'text' ? undefined : false}
        onChange={event => onChange(event.target.value)}/>}
    {(error || hint) && <p id={feedbackId} className="editor-note" role={error ? 'status' : undefined}>{error || hint}</p>}
  </div>;
}

export function RepeatableEditor<T extends OrderedDraftRecord>({rows, onChange, create, caption, addLabel, emptyLabel, fields}: {
  rows: readonly T[];
  onChange: (rows: readonly T[]) => void;
  create: (clientId: string, position: number) => T;
  caption: (row: T, index: number) => string;
  addLabel: string;
  emptyLabel: string;
  fields: (row: T, update: (next: T) => void) => ReactNode;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [expanded, setExpanded] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<string>();
  const add = useRef<HTMLButtonElement>(null);
  const listId = useId();

  function append() {
    const row = create('local-' + crypto.randomUUID(), rows.length);
    onChange([...rows, row]);
    setExpanded(row.clientId);
    setPendingDelete(undefined);
  }

  return <div className="editor-records">
    <button type="button" className="record-add" ref={add} onClick={append}>{addLabel}</button>
    {rows.length === 0 && <p className="editor-note">{emptyLabel}</p>}
    {rows.length > 0 && <ol className="record-list">
      {rows.map((row, index) => {
        const open = row.clientId === expanded;
        const deleting = row.clientId === pendingDelete;
        const panelId = listId + '-' + row.clientId;
        return <li key={row.clientId} data-entry-id={row.clientId} data-position={row.position}>
          <div className="record-header">
            <button type="button" className="record-title" id={panelId + '-toggle'} aria-expanded={open} aria-controls={panelId} onClick={() => {
              setExpanded(open ? undefined : row.clientId);
              setPendingDelete(undefined);
            }}><span aria-hidden="true">{open ? '−' : '+'}</span> {caption(row, index)}</button>
            <div className="record-actions" role="group" aria-label={text('记录操作', 'Entry actions')}>
              <button type="button" disabled={index === 0} onClick={() => onChange(moveRecord(rows, row.clientId, -1))}>{text('上移', 'Move up')}</button>
              <button type="button" disabled={index === rows.length - 1} onClick={() => onChange(moveRecord(rows, row.clientId, 1))}>{text('下移', 'Move down')}</button>
              <button type="button" aria-expanded={deleting} onClick={() => setPendingDelete(deleting ? undefined : row.clientId)}>{text('删除', 'Delete')}</button>
            </div>
          </div>
          {deleting && <div className="record-confirm" role="group" aria-label={text('确认删除本地记录', 'Confirm local deletion')}>
            <p>{text('删除这条本地记录及其两种语言的内容？', 'Remove this local entry and its content in both languages?')}</p>
            <button type="button" onClick={() => {
              onChange(removeRecord(rows, row.clientId));
              setPendingDelete(undefined);
              if (open) setExpanded(undefined);
              add.current?.focus();
            }}>{text('确认删除', 'Confirm deletion')}</button>
            <button type="button" onClick={() => {
              setPendingDelete(undefined);
              document.getElementById(panelId + '-toggle')?.focus();
            }}>{text('保留记录', 'Keep entry')}</button>
          </div>}
          <div className="record-fields" id={panelId} hidden={!open}>
            {open && fields(row, next => onChange(rows.map(item => item.clientId === row.clientId ? next : item)))}
          </div>
        </li>;
      })}
    </ol>}
  </div>;
}
