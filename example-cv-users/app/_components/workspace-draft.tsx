'use client';

import {createContext, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode} from 'react';
import {rejectWorkspaceHistory, resetWorkspaceHistory, setWorkspaceHistoryView, verifyUpcomingWorkspaceTraversal, verifyWorkspaceTraversal} from './workspace-history';
import {bilingualFieldKey, collectEditorFields, modifiedEditorFields, reviewChanges, type FieldKey, type Reviews} from '../../lib/editor/bilingual-review';
import {cancelModule, editorModules, moduleIsDirty, type EditorModule, type LocalDraft} from '../../lib/editor/draft';
import {guideFieldCleared, updateGuideOverrides, type GuideOverrides} from '../../lib/editor/preview-model';
import {guidePlaceholder} from '../../lib/editor/filling-guide';
import {introductionPath, introductionText, mergeSavedIntroduction, parseIntroduction, parseSaveReceipt,
  prepareIntroduction, workspaceScopeHeader, type Introduction, type SaveAttempt} from '../../lib/editor/introduction-dto';

import {applyTextContent, isTextSection, parseTextSnapshot, resumeTextPath, textCommand, textCommandDigest,
  textContent, type TextReceiptKey, type TextSection, type TextSnapshot} from '../../lib/editor/resume-text';
import {readPendingText, recordPendingText, removePendingText, removePendingScope} from '../../lib/editor/pending-text';

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
type IntroductionState = {scope: string} & (
  {state: 'loading' | 'no-site' | 'read-error' | 'session-expiring' | 'unavailable' | 'denied' | 'unsupported'} |
  {state: 'ready'; baseline: Introduction;
    outcome?: 'saved' | 'saving' | 'unknown' | 'session-expiring' | 'conflict' | 'advanced' | 'invalid' | 'denied';
    attempt?: SaveAttempt; retryUnsent?: boolean});
let introduction: IntroductionState | undefined;
type TextPersistence = {phase:'loading'|'ready'|'saving'|'unknown'|'failure'|'conflict'|'denied'|'no-site'|'renewal'|'invalid'|'saved';
  snapshot?:TextSnapshot; pending?:TextReceiptKey};
let textDrafts: ReadonlyMap<TextSection,TextPersistence> = new Map();
let operationSequence=0;

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
  if (!entry && !introduction && !textDrafts.size) return;
  entry = undefined;
  introduction = undefined;
  textDrafts = new Map();
  operationSequence++;
  window.removeEventListener('beforeunload', warnBeforeLeaving);
  window.removeEventListener('pagehide', clearWorkspaceDraft);
  notify();
}

function forgetTextScope(scope?: string) {
  if (scope) try {removePendingScope(window.localStorage,scope);} catch {}
}
export function leaveWorkspace() {
  forgetTextScope(currentScope);
  currentScope = undefined;
  clearWorkspaceDraft();
  resetWorkspaceHistory();
}

function reloadInvalidWorkspace() {
  forgetTextScope(currentScope);
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
      if (currentScope !== scope) { forgetTextScope(currentScope); clearWorkspaceDraft(); }
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

function updateDraftGuards() {
  if (entry || introduction || textDrafts.size) window.addEventListener('pagehide', clearWorkspaceDraft);
  if (entry?.dirtyModules.length || (introduction?.state === 'ready' && introduction.attempt) ||
      [...textDrafts.values()].some(value=>value.pending))
    window.addEventListener('beforeunload', warnBeforeLeaving);
  else window.removeEventListener('beforeunload', warnBeforeLeaving);
}

function setIntroduction(value: IntroductionState) {
  introduction = value;
  updateDraftGuards();
  notify();
}

const loadIntroduction = async (scope: string, attempt?: SaveAttempt, reconcile = false) => {
  const controller = new AbortController();
  const deadline = window.setTimeout(() => controller.abort(), 30_000);
  const headers = {[workspaceScopeHeader]: scope};
  // Match the S2 account transport so browsers send Origin on JSON POSTs
  // even when the document's Referrer-Policy is no-referrer.
  const options = {headers, signal: controller.signal, cache: 'no-store', redirect: 'error', credentials: 'same-origin'} as const;
  try {
    const response = await fetch(introductionPath + (reconcile ? '/operation' : ''), attempt ?
      {...options, method: 'POST', headers: {...headers, 'Content-Type': 'application/json'}, body: JSON.stringify(attempt.body)} : options);
    const value = await response.json() as {code?: string; state?: string} | null;
    if (!response.ok && (value?.code === 'WORKSPACE_CHANGED' || value?.code === 'IDENTITY_REQUIRED'))
      return {code: 'IDENTITY_REQUIRED'};
    if (!response.ok && value?.code === 'SESSION_REFRESH_REQUIRED')
      return {code: 'SESSION_REFRESH_REQUIRED', beforeDispatch: true};
    if (response.headers.get(workspaceScopeHeader) !== scope) return {code: 'BUSINESS_UNAVAILABLE'};
    if (!response.ok) return {code: typeof value?.code === 'string' ? value.code : 'BUSINESS_UNAVAILABLE'};
    // The original response can arrive after the account cookie has changed in another tab.
    const check = await fetch(introductionPath, {...options, method: 'HEAD'});
    if (check.status === 409 || check.status === 401) return {code: 'IDENTITY_REQUIRED'};
    if (check.headers.get('X-Workspace-Session-Renewal') === 'required')
      return {code: 'SESSION_REFRESH_REQUIRED'};
    if (!check.ok || check.headers.get(workspaceScopeHeader) !== scope) return {code: 'BUSINESS_UNAVAILABLE'};
    return {value};
  } catch { return {code: 'BUSINESS_UNAVAILABLE'}; }
  finally { window.clearTimeout(deadline); }
};

function acceptSavedIntroduction(scope: string, initial: LocalDraft, previous: Introduction, saved: Introduction, attempt: SaveAttempt) {
  const confirmed = introductionText(saved);
  const previousEntry = entry?.scope === scope ? entry : undefined;
  const {draft, reviews, guideOverrides} = previousEntry ?? {
    draft: {...initial, introduction: introductionText(previous)}, reviews: {}, guideOverrides: noGuideOverrides,
  };
  const baseline = {...initial, introduction: confirmed};
  const next = {...draft, introduction: mergeSavedIntroduction(draft.introduction, attempt.submitted, confirmed)};
  const dirtyModules = modules.filter(owner => moduleIsDirty(next, owner, baseline));
  const introductionReviews = reviewChanges(collectEditorFields(draft, 'introduction'),
    collectEditorFields(next, 'introduction'), collectEditorFields(baseline, 'introduction'),
    reviews.introduction ?? noReviews).reviews;
  // A cleared, now-saved field can show the gray guide again.
  const overrides = {...guideOverrides};
  if (!dirtyModules.includes('introduction')) delete overrides.introduction;
  entry = dirtyModules.length || Object.keys(overrides).length ? {
    scope, draft: next, dirtyModules, reviews: {...reviews, introduction: introductionReviews}, guideOverrides: overrides,
  } : undefined;
  setIntroduction({scope, state: 'ready', baseline: saved, outcome: 'saved'});
}

function useIntroduction(scope: string | undefined, enabled: boolean, initial: LocalDraft) {
  const read = () => enabled && scope && introduction?.scope === scope ? introduction : undefined;
  const state = useSyncExternalStore(subscribe, read, () => undefined);
  async function refresh() {
    if (!enabled || !scope || scope !== currentScope || read()?.state === 'loading' || read()?.state === 'ready') return;
    const operation = {scope, state: 'loading'} as const;
    setIntroduction(operation);
    const {value, code} = await loadIntroduction(scope);
    if (scope !== currentScope || introduction !== operation) return;
    if (code === 'IDENTITY_REQUIRED') return reloadInvalidWorkspace();
    const baseline = parseIntroduction(value);
    if (baseline) {
      // Other modules may have been edited while Introduction was loading.
      if (entry?.scope === scope)
        entry = {...entry, draft: {...entry.draft, introduction: introductionText(baseline)}};
      return setIntroduction({scope, state: 'ready', baseline});
    }
    setIntroduction({scope, state: value?.state === 'no-site' ? 'no-site' :
      code === 'BUSINESS_DENIED' ? 'denied' : code === 'SESSION_REFRESH_REQUIRED' ? 'session-expiring' : code === 'NOT_CONFIGURED' ? 'unavailable' :
      code === 'UNSUPPORTED_INTRODUCTION' ? 'unsupported' : 'read-error'});
  }
  useEffect(() => { if (!read()) void refresh(); }, [scope, enabled]);
  async function save() {
    const previous = read();
    if (!scope || scope !== currentScope || previous?.state !== 'ready' ||
        previous.outcome === 'saving' || previous.outcome === 'conflict' || previous.outcome === 'advanced') return;
    const baseline = introductionText(previous.baseline);
    const text = entry?.scope === scope ? entry.draft.introduction : baseline;
    if (!previous.attempt && baseline.zh === text.zh && baseline.en === text.en) return;
    let attempt;
    try { attempt = previous.attempt ?? prepareIntroduction(previous.baseline, text, crypto.randomUUID()); }
    catch { return setIntroduction({...previous, outcome: 'invalid'}); }

    const operation = {...previous, attempt, outcome: 'saving'} as const;
    setIntroduction(operation);
    const lookup = !!previous.attempt && !previous.retryUnsent;
    const {value, code, beforeDispatch} = await loadIntroduction(scope, attempt, lookup);
    const saved = await parseSaveReceipt(value, attempt).catch(() => undefined);
    if (scope !== currentScope || introduction !== operation) return;
    if (code === 'IDENTITY_REQUIRED') return reloadInvalidWorkspace();
    if (saved) return acceptSavedIntroduction(scope, initial, previous.baseline, saved, attempt);
    const outcome = code === 'REQUEST_CONFLICT' ? 'conflict' : code === 'DRAFT_ADVANCED' ? 'advanced' :
      code === 'SESSION_REFRESH_REQUIRED' ? 'session-expiring' :
      code === 'INVALID_INPUT' && !lookup ? 'invalid' :
      code === 'BUSINESS_DENIED' ? 'denied' : 'unknown';
    const unresolved = outcome === 'unknown' || outcome === 'denied' || outcome === 'session-expiring';
    setIntroduction({...previous, outcome, attempt: unresolved ? attempt : undefined,
      retryUnsent: outcome === 'session-expiring' && !lookup && beforeDispatch === true});
  }
  return {state, refresh, save};
}

function setTextState(section: TextSection, value: TextPersistence) {
  textDrafts=new Map(textDrafts).set(section,value);
  updateDraftGuards();
  notify();
}

async function requestText(suffix: string, section: TextSection, scope: string, body?: unknown) {
  const controller = new AbortController();
  const timeout = window.setTimeout(()=>controller.abort(),30_000);
  const headers={[workspaceScopeHeader]:scope};
  const options={credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal} as const;
  const headerScope=(response: Response)=>response.headers.get(workspaceScopeHeader)===scope;
  try {
    const response=await fetch(resumeTextPath+'/'+suffix,{...options,headers:body===undefined?headers:
      {...headers,'Content-Type':'application/json'},method:body===undefined?'GET':'POST',
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json() as {code?: string; state?: string; requestId?:string; digest?:string; snapshot?:unknown};
    if(value?.code==='IDENTITY_REQUIRED'||value?.code==='WORKSPACE_CHANGED')return {code:'WORKSPACE_CHANGED'};
    if(value?.code==='SESSION_REFRESH_REQUIRED')return {code:'SESSION_REFRESH_REQUIRED',beforeDispatch:true};
    if(!headerScope(response))return {code:'BUSINESS_UNAVAILABLE'};
    if(!response.ok)return {code:value?.code ?? 'BUSINESS_UNAVAILABLE'};
    const check=await fetch(resumeTextPath+'/'+section,{...options,method:'HEAD',headers});
    if(check.status===401||check.status===409)return {code:'WORKSPACE_CHANGED'};
    if(check.headers.get('X-Workspace-Session-Renewal')==='required')return {code:'SESSION_REFRESH_REQUIRED'};
    if(!check.ok||!headerScope(check))return {code:'BUSINESS_UNAVAILABLE'};
    return {value};
  } catch {return {code:'BUSINESS_UNAVAILABLE'};}
  finally {window.clearTimeout(timeout);}
}

function withSavedText(draft: LocalDraft, states: ReadonlyMap<TextSection,TextPersistence>) {
  for(const [section,state] of states) {
    if(state.snapshot) draft=applyTextContent(draft,section,state.snapshot.content);
  }
  return draft;
}

function useTextPersistence(scope: string | undefined, section: TextSection | undefined, initial: LocalDraft) {
  const read=()=>section&&scope===currentScope ? textDrafts.get(section) : undefined;
  const state=useSyncExternalStore(subscribe,read,()=>undefined);
  const savedStates=useSyncExternalStore(subscribe,()=>scope&&scope===currentScope?textDrafts:undefined,()=>undefined);
  const valid=(generation: number)=>scope===currentScope&&operationSequence===generation;

  const apply = (section: TextSection, snapshot: TextSnapshot, pending?: TextReceiptKey) => {
    const nextState={snapshot,phase:pending?'saved':'ready'} as const;
    const previousEntry=entry;
    if(previousEntry && previousEntry.scope===scope){
      const previous=textDrafts.get(section)?.snapshot;
      // Loading a section cannot replace local edits made in other sections.
      let draft=previousEntry.draft;
      try {
        if(previous && JSON.stringify(textContent(section,draft))===JSON.stringify(previous.content) && !pending)
          draft=applyTextContent(draft,section,snapshot.content);
        else if(!previous && !moduleIsDirty(draft,section,initial))
          draft=applyTextContent(draft,section,snapshot.content);
      } catch { /* Preserve invalid in-progress input for correction. */ }
      const baseline=withSavedText(initial,new Map(textDrafts).set(section,nextState));
      const dirtyModules=modules.filter(owner=>moduleIsDirty(draft,owner,baseline));
      const guideOverrides={...previousEntry.guideOverrides};
      if(!dirtyModules.includes(section)) delete guideOverrides[section];
      entry=dirtyModules.length||Object.keys(guideOverrides).length?
        {...previousEntry,draft,dirtyModules,guideOverrides,reviews:{...previousEntry.reviews,
          [section]:dirtyModules.includes(section)?previousEntry.reviews[section]:noReviews}}:undefined;
    }
    if(pending && scope) try {removePendingText(window.localStorage,scope,pending);} catch {}
    setTextState(section,nextState);
  };

  async function refresh() {
    if(!section||!scope||scope!==currentScope||read()?.phase==='loading')return;
    const generation=operationSequence;
    setTextState(section,{phase:'loading'});
    const {value,code}=await requestText(section,section,scope);
    if(!valid(generation))return;
    if(code==='WORKSPACE_CHANGED')return reloadInvalidWorkspace();
    const snapshot=parseTextSnapshot(value,section);
    if(snapshot) {
      let pending;
      try {pending=readPendingText(window.localStorage,scope,section);} catch {}
      if(pending?.siteId===snapshot.siteId) {
        apply(section,snapshot);
        return setTextState(section,{phase:'unknown', snapshot,pending});
      }
      return apply(section,snapshot);
    }
    setTextState(section,{phase:value?.state==='no-site'?'no-site':code==='SESSION_REFRESH_REQUIRED'?'renewal':
      code==='BUSINESS_DENIED'?'denied':'failure'});
  }
  useEffect(()=>{if(section&&!read())void refresh();},[scope,section]);

  async function save() {
    const previous=read();
    if(!section||!scope||scope!==currentScope||!previous?.snapshot||previous.phase==='saving'||previous.phase==='conflict')return;
    const generation=operationSequence;
    const snapshot=previous.snapshot;
    let pending=previous.pending;
    if(!pending){
      try {pending=readPendingText(window.localStorage,scope,section);} catch {}
    }
    const lookup=!!pending;
    let payload: unknown=pending;
    if(!pending){
      const draft=entry?.scope===scope?entry.draft:withSavedText(initial,textDrafts);
      let command;
      try {
        command=textCommand({siteId:snapshot.siteId,section,requestId:crypto.randomUUID(),
          expectedRevision:snapshot.revision,content:textContent(section,draft)});
        if(JSON.stringify(command.content)===JSON.stringify(snapshot.content))return;
        pending={siteId:command.siteId,section,requestId:command.requestId,expectedRevision:command.expectedRevision,
          digest:await textCommandDigest(command)};
        if(!valid(generation)||read()!==previous)return;
        if(!recordPendingText(window.localStorage,scope,pending)){
          const existing=readPendingText(window.localStorage,scope,section);
          return setTextState(section,{phase:existing?'unknown':'failure',snapshot,pending:existing});
        }
        payload=command;
      } catch {if(valid(generation))setTextState(section,{phase:'invalid',snapshot});return;}
    }
    if(pending.siteId!==snapshot.siteId)return setTextState(section,{phase:'conflict',snapshot});
    setTextState(section,{phase:'saving',snapshot,pending});
    const {code,value,beforeDispatch}=await requestText(lookup?'operation':'save',section,scope,payload);
    if(!valid(generation))return;
    if(code==='WORKSPACE_CHANGED')return reloadInvalidWorkspace();
    const next=parseTextSnapshot(value?.snapshot,section);
    if(value?.state==='saved'&&value.requestId===pending.requestId&&value.digest===pending.digest&&
       next?.siteId===pending.siteId&&next.revision===pending.expectedRevision+1){
      // A recovered historical receipt must never replace newer content fetched after reload.
      return apply(section,next.revision<snapshot.revision?snapshot:next,pending);
    }
    if(!lookup&&(['REQUEST_CONFLICT','INVALID_INPUT'].includes(code??'')||
        (code==='SESSION_REFRESH_REQUIRED'&&beforeDispatch))){
      try {removePendingText(window.localStorage,scope,pending);} catch {}
      return setTextState(section,{phase:code==='REQUEST_CONFLICT'?'conflict':code==='SESSION_REFRESH_REQUIRED'?'renewal':'invalid',snapshot});
    }
    setTextState(section,{phase:code==='BUSINESS_DENIED'?'denied':code==='SESSION_REFRESH_REQUIRED'?'renewal':'unknown',snapshot,pending});
  }
  let dirty=false;
  if(section && state?.snapshot && entry?.scope===scope && entry) {
    try {dirty=JSON.stringify(textContent(section,entry.draft))!==JSON.stringify(state.snapshot.content);}
    catch {dirty=moduleIsDirty(entry.draft,section,initial);}
  }
  return {state,savedStates,save,refresh,dirty};
}

export function useWorkspaceSnapshot() {
  const scope = useContext(DraftScope);
  const read = () => scope && entry?.scope === scope ? entry : undefined;
  return useSyncExternalStore(subscribe, read, () => undefined);
}

export function useWorkspaceDraft(initialDraft: LocalDraft, module: EditorModule, introductionEnabled = false, resumeTextEnabled = false) {
  const scope = useContext(DraftScope);
  const persistence = useIntroduction(scope, introductionEnabled, initialDraft);
  const saved = persistence.state?.state === 'ready' ? persistence.state.baseline : undefined;
  const introductionBaseline = useMemo(() => saved ? {...initialDraft, introduction: introductionText(saved)} : initialDraft, [initialDraft, saved]);
  const textPersistence=useTextPersistence(scope,resumeTextEnabled&&isTextSection(module)?module:undefined,introductionBaseline);
  const initial=useMemo(()=>textPersistence.savedStates?withSavedText(introductionBaseline,textPersistence.savedStates):introductionBaseline,
    [introductionBaseline,textPersistence.savedStates]);
  const read = () => scope && entry?.scope === scope ? entry : undefined;
  const snapshot = useWorkspaceSnapshot();
  const draft = snapshot?.draft ?? initial;
  const dirtyModules = snapshot?.dirtyModules ?? noDirtyModules;
  const modified = useMemo(() => modifiedEditorFields(draft, initial, dirtyModules), [draft, initial, dirtyModules]);
  const baseline = useMemo(() => collectEditorFields(initial, module), [initial, module]);
  const current = useMemo(() => collectEditorFields(draft, module), [draft, module]);
  const siteBaseline = useMemo(() => collectEditorFields(initial, 'site-text'), [initial]);
  const siteCurrent = useMemo(() => collectEditorFields(draft, 'site-text'), [draft]);
  const update = (change: (previous: LocalDraft) => LocalDraft, undo = false) => {
    if (!scope || scope !== currentScope) return;
    const previous = read();
    const before = previous?.draft ?? initial;
    const next = change(before);
    const nextDirty = modules.filter(module => moduleIsDirty(next, module, initial));
    const guideOverrides = updateGuideOverrides(previous?.guideOverrides ?? noGuideOverrides, before, next, module, undo);
    if (!nextDirty.length && !Object.keys(guideOverrides).length) {
      entry = undefined;
      updateDraftGuards();
      notify();
      return;
    }
    const reviews = {...previous?.reviews};
    const affected: EditorModule[] = [module];
    if (module !== 'site-text' && before['site-text'] !== next['site-text']) affected.push('site-text');
    for (const owner of affected) {
      reviews[owner] = nextDirty.includes(owner) ? reviewChanges(collectEditorFields(before, owner),
        collectEditorFields(next, owner), owner === 'site-text' ? siteBaseline : baseline, reviews[owner] ?? noReviews).reviews : noReviews;
    }
    entry = {scope, draft: nextDirty.length ? next : initial, dirtyModules: nextDirty, guideOverrides, reviews};
    updateDraftGuards();
    notify();
  };
  const acknowledge = (owner: EditorModule, field: FieldKey) => {
    const previous = read();
    if (!previous || scope !== currentScope) return;
    const next = new Map(previous.reviews[owner]);
    const key = bilingualFieldKey(field);
    const review = next.get(key);
    if (!review?.pending) return;
    next.set(key, {...review, pending: false});
    entry = {...previous, reviews: {...previous.reviews, [owner]: next}};
    notify();
  };
  const guideOverrides = snapshot?.guideOverrides ?? noGuideOverrides;
  const feedback = (owner: EditorModule, baseline: ReturnType<typeof collectEditorFields>, current: ReturnType<typeof collectEditorFields>) => ({
    baseline, current, reviews: snapshot?.reviews[owner] ?? noReviews,
    acknowledge: (field: FieldKey) => acknowledge(owner, field),
    placeholder: (field: FieldKey, language: 'zh' | 'en' | 'shared') =>
      guideFieldCleared(guideOverrides, owner, field.field, language, field.item) ? undefined
        : guidePlaceholder(owner, field.field, language, field.item, draft),
  });
  const undo = () => update(current => cancelModule(current, module, initial), true);
  return {scope, draft, persistence, textPersistence, update, undo, guideOverrides, dirtyModules, modified, fields: feedback(module, baseline, current),
    siteTextFields: feedback('site-text', siteBaseline, siteCurrent)};
}
