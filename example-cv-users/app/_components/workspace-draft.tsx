'use client';

import {createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode} from 'react';
import {rejectWorkspaceHistory, resetWorkspaceHistory, setWorkspaceHistoryView, verifyWorkspaceTraversal} from './workspace-history';
import {bilingualFieldKey, collectEditorFields, modifiedEditorFields, reviewChanges, type FieldKey, type Reviews} from '../../lib/editor/bilingual-review';
import {editorModules, moduleIsDirty, type EditorModule, type LocalDraft} from '../../lib/editor/draft';

type DraftEntry = {
  scope: string;
  draft: LocalDraft;
  reviews: Partial<Record<EditorModule, Reviews>>;
  dirtyModules: readonly EditorModule[];
};
const noReviews: Reviews = new Map();
const DraftScope = createContext<string | undefined>(undefined);
const listeners = new Set<() => void>();
let currentScope: string | undefined;
let entry: DraftEntry | undefined;

function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function warnBeforeLeaving(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = true;
}
export function clearWorkspaceDraft() {
  if (!entry) return;
  entry = undefined;
  window.removeEventListener('beforeunload', warnBeforeLeaving);
  window.removeEventListener('pagehide', clearWorkspaceDraft);
  notify();
}

export function leaveWorkspace() {
  currentScope = undefined;
  clearWorkspaceDraft();
  resetWorkspaceHistory();
}

function reloadInvalidWorkspace() {
  currentScope = undefined;
  clearWorkspaceDraft();
  rejectWorkspaceHistory();
  location.reload();
}

export function WorkspaceDraftScope({scope, path, unavailable, children}: {
  scope?: string; path?: string; unavailable?: boolean; children: ReactNode;
}) {
  useLayoutEffect(() => {
    if (!unavailable) {
      if (currentScope !== scope) clearWorkspaceDraft();
      currentScope = scope;
    }
    setWorkspaceHistoryView({path, scope}, reloadInvalidWorkspace);
  }, [scope, path, unavailable]);

  useLayoutEffect(() => {
    const navigation = (window as Window & {navigation?: EventTarget}).navigation;
    if (navigation) {
      const verify = (event: Event) => {
        const {navigationType, destination} = event as Event & {
          navigationType: string; destination: {url: string; sameDocument: boolean};
        };
        if (navigationType === 'traverse' && destination.sameDocument)
          void verifyWorkspaceTraversal(reloadInvalidWorkspace, destination.url);
      };
      navigation.addEventListener('navigate', verify);
      return () => navigation.removeEventListener('navigate', verify);
    }
    const verify = () => { void verifyWorkspaceTraversal(reloadInvalidWorkspace); };
    window.addEventListener('popstate', verify, {capture: true});
    return () => window.removeEventListener('popstate', verify, {capture: true});
  }, []);

  return <DraftScope.Provider value={scope}>{children}</DraftScope.Provider>;
}

const modules = Object.keys(editorModules) as EditorModule[];
const noDirtyModules: readonly EditorModule[] = [];

function useDraftSnapshot() {
  const scope = useContext(DraftScope);
  const read = () => scope && entry?.scope === scope ? entry : undefined;
  return useSyncExternalStore(subscribe, read, () => undefined);
}

export function useWorkspaceDirtyModules() {
  return useDraftSnapshot()?.dirtyModules ?? noDirtyModules;
}

export function useWorkspaceDraft(initial: LocalDraft, module: EditorModule) {
  const scope = useContext(DraftScope);
  const read = () => scope && entry?.scope === scope ? entry : undefined;
  const snapshot = useDraftSnapshot();
  const draft = snapshot?.draft ?? initial;
  const dirtyModules = snapshot?.dirtyModules ?? noDirtyModules;
  const modified = useMemo(() => modifiedEditorFields(draft, initial, dirtyModules), [draft, initial, dirtyModules]);
  const baseline = useMemo(() => collectEditorFields(initial, module), [initial, module]);
  const current = useMemo(() => collectEditorFields(draft, module), [draft, module]);
  const reviews = snapshot?.reviews[module] ?? noReviews;
  const update = (change: (previous: LocalDraft) => LocalDraft) => {
    if (!scope || scope !== currentScope) return;
    const previous = read();
    const next = change(previous?.draft ?? initial);
    const nextDirty = modules.filter(module => moduleIsDirty(next, module, initial));
    if (!nextDirty.length) {
      clearWorkspaceDraft();
      return;
    }
    if (!entry) {
      window.addEventListener('beforeunload', warnBeforeLeaving);
      window.addEventListener('pagehide', clearWorkspaceDraft);
    }
    const reviewResult = reviewChanges(collectEditorFields(previous?.draft ?? initial, module),
      collectEditorFields(next, module), baseline, previous?.reviews[module] ?? noReviews);
    entry = {scope, draft: next, dirtyModules: nextDirty, reviews: {...previous?.reviews, [module]: reviewResult.reviews}};
    notify();
  };
  const acknowledge = (field: FieldKey) => {
    const previous = read();
    if (!previous || scope !== currentScope) return;
    const next = new Map(previous.reviews[module]);
    const key = bilingualFieldKey(field);
    const review = next.get(key);
    if (!review?.pending) return;
    next.set(key, {...review, pending: false});
    entry = {...previous, reviews: {...previous.reviews, [module]: next}};
    notify();
  };
  return {draft, update, dirtyModules, modified, fields: {baseline, current, reviews, acknowledge}};
}
