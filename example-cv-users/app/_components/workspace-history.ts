'use client';

import {isMountedEditorDestination, isMountedEditorEntry} from './editor-section-history.ts';

type WorkspaceView = {path?: string; scope?: string};
type Traversal = {path: string; scope: string; controller: AbortController; deadline: number; verified: boolean};

let shown: WorkspaceView = {};
let traversal: Traversal | undefined;

function workspacePath(path: string) {
  try { return decodeURIComponent(path).replace(/\/+/g, '/'); }
  catch { return path; }
}

function clearTraversal() {
  if (traversal) {
    traversal.controller.abort();
    window.clearTimeout(traversal.deadline);
  }
  traversal = undefined;
  delete document.documentElement.dataset.workspaceVerifying;
}

function settleTraversal(onInvalid: () => void) {
  if (!traversal?.verified || traversal.path !== shown.path) return;
  if (traversal.scope === shown.scope) clearTraversal();
  else onInvalid();
}

export function setWorkspaceHistoryView(view: WorkspaceView, onInvalid: () => void) {
  shown = view;
  settleTraversal(onInvalid);
}

export function rejectWorkspaceHistory() {
  clearTraversal();
  document.documentElement.dataset.workspaceVerifying = '';
}

export function resetWorkspaceHistory() {
  shown = {};
  clearTraversal();
}

export function verifyUpcomingWorkspaceTraversal(onInvalid: () => void, url: URL) {
  // A live editor can prove a section entry once popstate exposes its classic
  // history state. Other traversals can be concealed before the router commits.
  if (shown.scope && shown.path === workspacePath(url.pathname) && isMountedEditorDestination(url, shown.scope)) return;
  void verifyWorkspaceTraversal(onInvalid, url, undefined);
}

export async function verifyWorkspaceTraversal(onInvalid: () => void, url: URL, state: unknown) {
  const path = workspacePath(url.pathname);
  const {path: previous, scope} = shown;
  if (url.origin !== location.origin || !scope || traversal?.path === path) return;
  if (!traversal && previous === path && isMountedEditorEntry(url, state, scope)) return;
  if (!/^\/(?:dashboard(?:\/|$)|account$|change-password$)/.test(path)) {
    clearTraversal();
    return;
  }

  // Vinext may restore history from memory even for a dynamic, non-prefetched route.
  // Keep any restored workspace out of view until its identity has been checked again.
  clearTraversal();
  document.documentElement.dataset.workspaceVerifying = '';
  const controller = new AbortController();
  const reject = () => {
    if (traversal !== request) return;
    if (workspacePath(location.pathname) === path) onInvalid();
    else clearTraversal();
  };
  const request = {path, scope, controller, deadline: window.setTimeout(reject, 12000), verified: false};
  traversal = request;
  try {
    const verifyUrl = new URL(url);
    verifyUrl.hash = '';
    const response = await fetch(verifyUrl, {method: 'HEAD', cache: 'no-store', redirect: 'manual', signal: controller.signal});
    if (traversal !== request || workspacePath(location.pathname) !== path) return;
    if (response.ok && response.headers.get('X-Workspace-Draft-Scope') === scope) {
      request.verified = true;
      settleTraversal(onInvalid);
    } else onInvalid();
  } catch {
    reject();
  }
}
