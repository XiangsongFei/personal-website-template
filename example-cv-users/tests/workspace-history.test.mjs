import assert from 'node:assert/strict';
import test from 'node:test';
import {mountEditorSections, selectEditorSection} from '../app/_components/editor-section-history.ts';
import {resetWorkspaceHistory, setWorkspaceHistoryView, verifyUpcomingWorkspaceTraversal, verifyWorkspaceTraversal} from '../app/_components/workspace-history.ts';

test('only marked history from the current editor mount and verified identity can skip HEAD', async t => {
  const page = '/dashboard/editor';
  const editorUrl = new URL('https://localhost' + page + '#profile');
  const dataset = {};
  const requests = [];
  const selections = [];
  const unmounts = [];
  let frame;
  let invalid = 0;
  let scopeForResponse = 'current';
  const onInvalid = () => { invalid += 1; };
  const globals = {
    window: Object.assign(new EventTarget(), {setTimeout, clearTimeout}),
    location: editorUrl,
    document: {documentElement: {dataset, hasAttribute: () => 'workspaceVerifying' in dataset}},
    history: {
      state: null,
      replaceState(state) { this.state = state; },
      pushState(state, _, url) { this.state = state; globalThis.location = new URL(url); },
    },
    requestAnimationFrame: callback => { frame = callback; return 1; },
    cancelAnimationFrame: () => {},
    fetch: async (url, options) => {
      assert.ok('workspaceVerifying' in dataset, 'the old shell is hidden before protected history is restored');
      requests.push({url: url.href, ...options});
      return new Response(null, {headers: {'X-Workspace-Draft-Scope': scopeForResponse}});
    },
  };
  const originalGlobals = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  t.after(() => {
    for (const unmount of unmounts) unmount();
    resetWorkspaceHistory();
    for (const [key, original] of Object.entries(originalGlobals)) {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    }
  });

  setWorkspaceHistoryView({path: page, scope: 'current'}, onInvalid);
  const unmount = mountEditorSections('current', section => selections.push(section));
  unmounts.push(unmount);
  const initialState = history.state;
  assert.equal(selectEditorSection('links'), true);
  assert.equal(location.hash, '#links');
  assert.deepEqual(selections, ['profile', 'links']);
  verifyUpcomingWorkspaceTraversal(onInvalid, editorUrl);
  assert.equal(requests.length, 0, 'the early listener defers a live editor entry until popstate');
  globalThis.location = editorUrl;
  await verifyWorkspaceTraversal(onInvalid, editorUrl, initialState);
  window.dispatchEvent(new Event('hashchange'));
  assert.equal(selections.at(-1), 'profile');
  assert.equal(requests.length, 0);
  assert.equal(dataset.workspaceVerifying, undefined);
  globalThis.location = new URL('#introduction', editorUrl);
  window.dispatchEvent(new Event('hashchange'));
  assert.equal(selections.at(-1), 'introduction', 'a standalone fragment change updates the shown module');
  assert.equal(requests.length, 0);
  globalThis.location = editorUrl;

  await verifyWorkspaceTraversal(onInvalid, editorUrl, null);
  assert.equal(requests[0].method, 'HEAD');
  assert.equal(requests[0].cache, 'no-store');
  assert.equal(requests[0].redirect, 'manual');
  assert.equal(requests[0].url, 'https://localhost' + page);
  assert.equal(dataset.workspaceVerifying, undefined);

  unmount();
  unmounts.push(mountEditorSections('current', section => selections.push(section)));
  await verifyWorkspaceTraversal(onInvalid, editorUrl, initialState);
  assert.equal(requests.length, 2, 'an entry from a previous mount is revalidated');
  const newState = history.state;
  scopeForResponse = 'different-account';
  await verifyWorkspaceTraversal(onInvalid, editorUrl, null);
  assert.equal(invalid, 1);
  resetWorkspaceHistory();
  setWorkspaceHistoryView({path: page, scope: 'different-account'}, onInvalid);
  await verifyWorkspaceTraversal(onInvalid, editorUrl, newState);
  assert.equal(requests.length, 4, 'a different server scope cannot reuse an old mount marker');

  const account = new URL('/account', editorUrl);
  verifyUpcomingWorkspaceTraversal(onInvalid, account);
  globalThis.location = account;
  const requestsBeforePopstate = requests.length;
  const recheck = verifyWorkspaceTraversal(onInvalid, account, newState);
  assert.ok('workspaceVerifying' in dataset, 'cross-path history is hidden during revalidation');
  await recheck;
  assert.equal(requests.length, requestsBeforePopstate, 'both Chrome events share the same in-flight HEAD');
  assert.equal(requests.at(-1).url, account.href);
  assert.ok('workspaceVerifying' in dataset, 'a matching identity alone does not reveal an uncommitted route');
  setWorkspaceHistoryView({path: '/account', scope: 'different-account'}, onInvalid);
  assert.equal(dataset.workspaceVerifying, undefined);

  globalThis.location = new URL('#unknown', editorUrl);
  history.state = null;
  setWorkspaceHistoryView({path: page, scope: 'different-account'}, onInvalid);
  unmounts.push(mountEditorSections('different-account', section => selections.push(section)));
  assert.equal(history.state, null, 'an invalid initial fragment is not marked as a section');
  globalThis.location = new URL('#projects', editorUrl);
  frame();
  assert.equal(selections.at(-1), 'projects', 'the frame follows the client router’s committed fragment');
  const loadsBefore = requests.length;
  await verifyWorkspaceTraversal(onInvalid, location, history.state);
  assert.equal(requests.length, loadsBefore, 'the valid committed fragment belongs to the current editor');
});
