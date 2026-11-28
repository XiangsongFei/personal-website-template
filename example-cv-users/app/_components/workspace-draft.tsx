'use client';

import {createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode} from 'react';
import {rejectWorkspaceHistory, resetWorkspaceHistory, setWorkspaceHistoryView, verifyUpcomingWorkspaceTraversal, verifyWorkspaceTraversal} from './workspace-history';
import {bilingualFieldKey, collectEditorFields, modifiedEditorFields, reviewChanges, type FieldKey, type Reviews} from '../../lib/editor/bilingual-review';
import {cancelModule, editorModules, moduleIsDirty, type EditorModule, type LocalDraft} from '../../lib/editor/draft';
import {guideFieldCleared, updateGuideOverrides, type GuideOverrides} from '../../lib/editor/preview-model';
import {guidePlaceholder} from '../../lib/editor/filling-guide';

type DraftEntry = {
  scope: string;
  draft: LocalDraft;
  reviews: Partial<Record<EditorModule, Reviews>>;
  dirtyModules: readonly EditorModule[];
  guideOverrides: GuideOverrides;
};
const noReviews: Reviews = new Map();
const noGuideOverrides: GuideOverrides = {};
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
    const verifyUpcoming = (event: Event) => {
      const {navigationType, destination} = event as Event & {
        navigationType: string; destination: {url: string; sameDocument: boolean};
      };
      if (navigationType === 'traverse' && destination.sameDocument)
        verifyUpcomingWorkspaceTraversal(reloadInvalidWorkspace, new URL(destination.url));
    };
    // Run before the client router restores a history entry. Both Safari and
    // Chromium expose the classic history state on this event.
    const verify = (event: PopStateEvent) => {
      const url = new URL(location.href);
      void verifyWorkspaceTraversal(reloadInvalidWorkspace, url, event.state);
    };
    navigation?.addEventListener('navigate', verifyUpcoming);
    window.addEventListener('popstate', verify, {capture: true});
    return () => {
      navigation?.removeEventListener('navigate', verifyUpcoming);
      window.removeEventListener('popstate', verify, {capture: true});
    };
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
  const update = (change: (previous: LocalDraft) => LocalDraft, undo = false) => {
    if (!scope || scope !== currentScope) return;
    const previous = read();
    const before = previous?.draft ?? initial;
    const next = change(before);
    const nextDirty = modules.filter(module => moduleIsDirty(next, module, initial));
    const guideOverrides = updateGuideOverrides(previous?.guideOverrides ?? noGuideOverrides, before, next, module, undo);
    if (!nextDirty.length && !Object.keys(guideOverrides).length) {
      clearWorkspaceDraft();
      return;
    }
    if (!entry) window.addEventListener('pagehide', clearWorkspaceDraft);
    if (nextDirty.length) window.addEventListener('beforeunload', warnBeforeLeaving);
    else window.removeEventListener('beforeunload', warnBeforeLeaving);
    const reviews = nextDirty.includes(module) ? reviewChanges(collectEditorFields(before, module),
      collectEditorFields(next, module), baseline, previous?.reviews[module] ?? noReviews).reviews : noReviews;
    entry = {scope, draft: nextDirty.length ? next : initial, dirtyModules: nextDirty, guideOverrides,
      reviews: {...previous?.reviews, [module]: reviews}};
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
  const guideOverrides = snapshot?.guideOverrides ?? noGuideOverrides;
  const placeholder = (field: FieldKey, language: 'zh' | 'en' | 'shared') =>
    guideFieldCleared(guideOverrides, module, field.field, language, field.item) ? undefined
      : guidePlaceholder(module, field.field, language, field.item, draft);
  const undo = () => update(current => cancelModule(current, module, initial), true);
  return {scope, draft, update, undo, guideOverrides, dirtyModules, modified, fields: {baseline, current, reviews, acknowledge, placeholder}};
}
