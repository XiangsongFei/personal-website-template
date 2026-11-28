'use client';

import {moduleFromHash, type EditorModule} from '../../lib/editor/draft.ts';

const stateKey = 'exampleCvEditorMount';
type MountedEditor = {id: string; scope: string; page?: string; select: (section: EditorModule) => void};
let mounted: MountedEditor | undefined;

const pageKey = (url: URL) => url.origin + url.pathname + url.search;
const sectionAt = (url: URL) => moduleFromHash(url.hash) ?? (url.hash === '' ? 'profile' : undefined);

export function mountEditorSections(scope: string | undefined, select: MountedEditor['select']) {
  if (!scope) return;
  const editor: MountedEditor = {id: crypto.randomUUID(), scope, select};
  mounted = editor;
  function claimCurrentEntry() {
    const url = new URL(location.href);
    if (mounted !== editor || editor.page || url.pathname !== '/dashboard/editor') return;
    editor.page = pageKey(url);
    const section = sectionAt(url);
    if (!section) return;
    // Vinext's public History API patch retains its route and scroll metadata.
    history.replaceState({[stateKey]: editor.id}, '', url);
    editor.select(section);
  }
  claimCurrentEntry();
  // Client navigation can finish committing the URL after the editor mounts.
  const frame = requestAnimationFrame(claimCurrentEntry);
  const syncFragment = () => syncEditorSection(new URL(location.href));
  window.addEventListener('hashchange', syncFragment);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('hashchange', syncFragment);
    if (mounted === editor) mounted = undefined;
  };
}

export function selectEditorSection(section: EditorModule) {
  const url = new URL(location.href);
  if (!mounted || mounted.page !== pageKey(url) || document.documentElement.hasAttribute('data-workspace-verifying')) return false;
  if (url.hash !== '#' + section) {
    url.hash = section;
    history.pushState({[stateKey]: mounted.id}, '', url);
  }
  mounted.select(section);
  return true;
}

export function isMountedEditorDestination(url: URL, scope: string) {
  return mounted?.scope === scope && mounted.page === pageKey(url) && !!sectionAt(url);
}

export function isMountedEditorEntry(url: URL, state: unknown, scope: string) {
  return isMountedEditorDestination(url, scope) &&
    typeof state === 'object' && state !== null && (state as Record<string, unknown>)[stateKey] === mounted?.id;
}

function syncEditorSection(url: URL) {
  const section = sectionAt(url);
  if (mounted?.page === pageKey(url) && section) mounted.select(section);
}
