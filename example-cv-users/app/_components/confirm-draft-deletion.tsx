'use client';

import {createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {useUiLocale} from './ui-locale';

type DeletionRequest = {
  trigger: HTMLButtonElement;
  title: string;
  method: boolean;
  confirm: () => void;
};

const DeletionContext = createContext<{
  request: (entry: DeletionRequest) => void;
  detach: (trigger: HTMLButtonElement) => void;
} | null>(null);

export function DraftDeletionScope({children, actions}: {children: ReactNode; actions: ReactNode}) {
  const [pending, setPending] = useState<DeletionRequest | null>(null);
  const detach = useCallback((trigger: HTMLButtonElement) => {
    setPending(current => current?.trigger === trigger ? null : current);
  }, []);

  function cancel(entry: DeletionRequest) {
    setPending(null);
    if (entry.trigger.isConnected) entry.trigger.focus({preventScroll: true});
  }

  useEffect(() => {
    if (!pending) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        cancel(pending);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [pending]);

  return <DeletionContext.Provider value={{request: setPending, detach}}>
    {children}
    <div className="editor-actions">
      {pending ? <DeletionFooter entry={pending} cancel={() => cancel(pending)} confirm={() => {
        setPending(null);
        if (pending.trigger.isConnected) pending.confirm();
      }}/> : actions}
    </div>
  </DeletionContext.Provider>;
}

function DeletionFooter({entry, cancel, confirm}: {entry: DeletionRequest; cancel: () => void; confirm: () => void}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const id = useId();
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { keep.current?.focus({preventScroll: true}); }, [entry]);

  return <div className="record-confirm" role="group" aria-labelledby={id} aria-describedby={id + '-scope'}>
    <div className="record-confirm-copy">
      <strong id={id}>{text('删除', 'Delete')}「{entry.title}」</strong>
      <p id={id + '-scope'}>{entry.method
        ? text('仅删除当前语言的本地方法。', 'Remove this local method in the current language.')
        : text('同时删除该记录的中文与英文内容。', 'Remove both the Chinese and English content for this entry.')}</p>
    </div>
    <div className="record-confirm-actions">
      <button type="button" className="dashboard-action dashboard-action-secondary" ref={keep} onClick={cancel}>{text('取消', 'Cancel')}</button>
      <button type="button" className="record-delete dashboard-action dashboard-action-destructive" onClick={confirm}>{text('确认删除', 'Confirm deletion')}</button>
    </div>
  </div>;
}

export function ConfirmDraftDeletion({title, onConfirm, method = false}: {title: string; onConfirm: () => void; method?: boolean}) {
  const {locale} = useUiLocale();
  const scope = useContext(DeletionContext);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirmLatest = useRef(onConfirm);
  const detach = scope?.detach;

  useLayoutEffect(() => { confirmLatest.current = onConfirm; }, [onConfirm]);
  useLayoutEffect(() => {
    const button = trigger.current;
    return () => { if (button) detach?.(button); };
  }, [detach]);

  const label = locale === 'zh' ? '删除' : 'Delete';
  return <button className="record-delete dashboard-action dashboard-action-destructive" type="button" ref={trigger} aria-label={label + ' ' + title}
    onClick={event => scope?.request({trigger: event.currentTarget, title, method, confirm: () => confirmLatest.current()})}>{label}</button>;
}
