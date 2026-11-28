'use client';

import {useId, useRef, useState, type ClipboardEvent, type ReactNode, type SelectHTMLAttributes} from 'react';
import {type FieldKey} from '../../lib/editor/bilingual-review';
import {type ContentLocale} from '../../lib/editor/draft';
import {ReviewField, useFieldFeedback} from './field-feedback';
import {moveRecord, removeRecord, type OrderedDraftRecord} from '../../lib/editor/records';
import {useUiLocale} from './ui-locale';
import {DashboardIcon} from './dashboard';
import {ConfirmDraftDeletion} from './confirm-draft-deletion';

export function EditorAiActions() {
  const {locale} = useUiLocale();
  return <div className="editor-ai" role="group" aria-label={locale === 'zh' ? 'AI 工具（尚未开放）' : 'AI tools (unavailable)'}>
    <button type="button" className="dashboard-action dashboard-action-text" disabled><span aria-hidden="true">✧</span> {locale === 'zh' ? 'AI 优化' : 'AI refine'}</button>
    <button type="button" className="dashboard-action dashboard-action-text" disabled><span aria-hidden="true">✧</span> {locale === 'zh' ? 'AI 生成' : 'AI generate'}</button>
  </div>;
}

function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, ' ');
}

export function RecordField({label, accessibleLabel, value, onChange, multiline = false, long = false, maxLength,
  type = 'text', error, hint, count, describedBy, lang, identity, language = 'shared', matrix = false, compact = false, sharedRow = false, reviewBelow = false}: {
  label: string; accessibleLabel?: string; value: string; onChange: (value: string) => void;
  multiline?: boolean; long?: boolean; maxLength?: number; type?: 'text' | 'url' | 'email';
  error?: string; hint?: string; count?: string; describedBy?: string; lang?: string; identity?: FieldKey; language?: ContentLocale | 'shared';
  matrix?: boolean; compact?: boolean; sharedRow?: boolean; reviewBelow?: boolean;
}) {
  const id = useId();
  const feedbackId = id + '-feedback';
  const feedback = useFieldFeedback(identity, language);
  const descriptions = [error || hint || count ? feedbackId : undefined, feedback.reminderId, describedBy].filter(Boolean);
  const limit = maxLength ?? (multiline ? 20_000 : 500);
  const props = {
    id, value, lang, 'aria-label': accessibleLabel, maxLength: limit,
    'data-edit-field': identity && (language === 'shared' ? 'shared:' : '') + identity.field,
    'data-edit-item': identity?.item, 'data-edit-locale': language,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': descriptions.length ? descriptions.join(' ') : undefined,
  };
  const review = feedback.reminderId && feedback.acknowledge &&
    <ReviewField id={feedback.reminderId} onConfirm={feedback.acknowledge}>{feedback.reminder}</ReviewField>;

  function paste(event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData('text');
    const address = type !== 'text';
    if (!/[\r\n]/.test(pasted) && (!address || pasted === pasted.trim())) return;
    event.preventDefault();
    const input = event.currentTarget;
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const remaining = limit - input.value.length + selectionEnd - selectionStart;
    const normalized = address ? pasted.trim().replace(/[\r\n]/g, '') : singleLine(pasted);
    const data = normalized.slice(0, Math.max(0, remaining));
    if (!data) return;
    // Use the browser's editing command to preserve selection, input events and undo history.
    if (!document.execCommand('insertText', false, data)) {
      input.setRangeText(data, selectionStart, selectionEnd, 'end');
      onChange(input.value);
    }
  }

  const kind = multiline ? long ? 'long' : 'multiline' : compact ? 'short' : type === 'text' ? 'growing' : 'address';
  const addressMode = type !== 'text' ? type : undefined;
  const reviewAfterControl = matrix || sharedRow || Boolean(addressMode) || reviewBelow;
  return <div className={multiline ? 'editor-field record-description' : 'editor-field'} data-text-kind={kind}
    data-shared-row={sharedRow || undefined} data-matrix-control={matrix || undefined}
    data-address={addressMode} data-field={identity?.field} data-field-modified={feedback.modified || undefined}>
    <div className="editor-field-label"><label htmlFor={id}>{label}</label>
      {!reviewAfterControl && review}
    </div>
    {compact ? <input {...props} type="text" inputMode={addressMode} autoComplete="off" autoCapitalize={addressMode ? 'none' : undefined}
      spellCheck={addressMode ? false : undefined} onPaste={addressMode ? paste : undefined}
      onChange={event => onChange(event.target.value)}/> :
      <div className="editor-grow" data-value={value}>
        <textarea {...props} rows={1} aria-multiline={multiline} inputMode={addressMode} autoComplete="off" autoCapitalize={addressMode ? 'none' : undefined}
          spellCheck={addressMode ? false : undefined}
          onPaste={multiline ? undefined : paste}
          onKeyDown={multiline ? undefined : event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) event.preventDefault();
          }}
          onChange={event => {
            const control = event.currentTarget;
            const next = multiline ? control.value : addressMode ? control.value.replace(/[\r\n]/g, '') : singleLine(control.value);
            if (next !== control.value) {
              const from = control.selectionStart;
              const to = control.selectionEnd;
              const preserve = (offset: number) => addressMode
                ? control.value.slice(0, offset).replace(/[\r\n]/g, '').length
                : singleLine(control.value.slice(0, offset)).length;
              const start = preserve(from);
              const end = preserve(to);
              control.value = next;
              control.setSelectionRange(start, end);
            }
            onChange(next);
          }}/>
      </div>}
    {reviewAfterControl && review}
    {(error || hint || count) && <p id={feedbackId} className={count && !error ? 'editor-note editor-character-count' : 'editor-note'}
      role={error ? 'status' : undefined}>{error || hint || count}</p>}
  </div>;
}

export function RecordSelect({label, identity, ...props}: {
  id: string; label: string; identity: FieldKey;
} & Pick<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'>) {
  const feedback = useFieldFeedback(identity, 'shared');
  return <div className="editor-field" data-text-kind="short" data-shared-row data-field-modified={feedback.modified || undefined}>
    <div className="editor-field-label"><label htmlFor={props.id}>{label}</label></div>
    <select {...props} data-edit-field={'shared:' + identity.field} data-edit-item={identity.item} data-edit-locale="shared"/>
  </div>;
}

export function RepeatableEditor<T extends OrderedDraftRecord>({rows, onChange, create, caption, addLabel, emptyLabel, fields}: {
  rows: readonly T[];
  onChange: (rows: readonly T[]) => void;
  create: (clientId: string, position: number) => T;
  caption: (row: T) => string;
  addLabel: string;
  emptyLabel: string;
  fields: (row: T, update: (next: T) => void) => ReactNode;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [expanded, setExpanded] = useState<string>();
  const add = useRef<HTMLButtonElement>(null);
  const listId = useId();

  function append() {
    const row = create('local-' + crypto.randomUUID(), rows.length);
    onChange([...rows, row]);
    setExpanded(row.clientId);
  }

  return <div className="editor-records">
    <button type="button" className="record-add dashboard-action dashboard-action-text" ref={add} onClick={append}>{addLabel}</button>
    {rows.length === 0 && <p className="editor-note">{emptyLabel}</p>}
    {rows.length > 0 && <ol className="record-list">
      {rows.map((row, index) => {
        const open = row.clientId === expanded;
        const title = caption(row);
        const panelId = listId + '-' + row.clientId;
        return <li key={row.clientId} data-entry-id={row.clientId} data-position={row.position}>
          <div className="record-header">
            <button type="button" className="record-title dashboard-action dashboard-action-text" id={panelId + '-toggle'} aria-expanded={open} aria-controls={panelId} onClick={() => setExpanded(open ? undefined : row.clientId)}><DashboardIcon kind="chevron-right"/><span className="record-sequence" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span>{title}</span></button>
            <div className="record-actions" role="group" aria-label={text('记录操作', 'Entry actions')}>
              <button type="button" className="dashboard-action dashboard-action-text" disabled={index === 0} onClick={() => onChange(moveRecord(rows, row.clientId, -1))}>{text('上移', 'Move up')}</button>
              <button type="button" className="dashboard-action dashboard-action-text" disabled={index === rows.length - 1} onClick={() => onChange(moveRecord(rows, row.clientId, 1))}>{text('下移', 'Move down')}</button>
              <ConfirmDraftDeletion title={title} onConfirm={() => {
                onChange(removeRecord(rows, row.clientId));
                if (open) setExpanded(undefined);
                add.current?.focus();
              }}/>
            </div>
          </div>
          <div className="record-fields" id={panelId} hidden={!open}>
            {open && fields(row, next => onChange(rows.map(item => item.clientId === row.clientId ? next : item)))}
          </div>
        </li>;
      })}
    </ol>}
  </div>;
}
