'use client';

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

export async function verifyWorkspaceTraversal(onInvalid: () => void, destination?: string) {
  const url = new URL(destination ?? location.href);
  const path = workspacePath(url.pathname);
  const {path: previous, scope} = shown;
  // The URL can update before the workspace using that path has committed.
  const staysInShownPage = destination && previous === path && workspacePath(location.pathname) === path;
  if (url.origin !== location.origin || !scope || staysInShownPage || traversal?.path === path) return;
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
    url.hash = '';
    const response = await fetch(url, {method: 'HEAD', cache: 'no-store', redirect: 'manual', signal: controller.signal});
    if (traversal !== request || workspacePath(location.pathname) !== path) return;
    if (response.ok && response.headers.get('X-Workspace-Draft-Scope') === scope) {
      request.verified = true;
      settleTraversal(onInvalid);
    } else onInvalid();
  } catch {
    reject();
  }
}
