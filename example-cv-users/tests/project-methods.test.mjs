import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editTranslation, moveRecord, newProject, projectDisplay, removeRecord, safeProjectUrl, updateProjectMethods,
} from '../lib/editor/records.ts';
import {cancelModule, emptyDraft, moduleFromHash, moduleIsDirty} from '../lib/editor/draft.ts';

test('project URLs accept only complete HTTP(S) addresses without credentials', () => {
  for (const value of [
    undefined, '', 'example.invalid', '/path', '//example.invalid', 'data:text/plain,hello',
    'javascript:void(0)', 'file:///tmp/test', 'mailto:example.invalid', 'https:example.invalid',
    'https:///example.invalid', 'https://', 'https://exa mple.invalid', 'https://a.invalid\\test',
    'https://author:test@example.invalid', 'https://exam\nple.invalid',
  ]) assert.equal(safeProjectUrl(value), undefined, value);
  assert.equal(safeProjectUrl(' https://example.invalid/path?q=1 '), 'https://example.invalid/path?q=1');
  assert.equal(safeProjectUrl('http://example.invalid'), 'http://example.invalid/');
});

test('localized project fields and divergent links are never synchronized', () => {
  const zh = {title: '合成项目', subtitle: '合成副标题', period: '2025 年春', description: '<样例>\n&', href: 'https://example.invalid/zh'};
  const en = {title: 'Sample', subtitle: 'Sample subtitle', period: 'Spring 2025', description: 'Sample text', href: 'data:text/plain,ignored'};
  const p = newProject('local-parent', 0);
  const translations = editTranslation(editTranslation(p.translations, 'zh', zh), 'en', en);
  const draft = {...p, translations};
  assert.deepEqual(projectDisplay(draft, 'zh'), {...zh, methods: []});
  assert.deepEqual(projectDisplay(draft, 'en'), {...en, href: undefined, methods: []});
  assert.equal(draft.translations.en.href, en.href);
});

test('nested methods have independent parent and locale orders', () => {
  const [a,b,c] = ['a','b','c'].map((key,position)=>({clientId:'local-'+key,position,value:key}));
  const zh = [a,b,c];
  const en = [{...a, clientId:'local-en',value:'English'}];
  const parent = updateProjectMethods(updateProjectMethods(newProject('local-parent',0),'zh',zh),'en',en);
  const other = updateProjectMethods(newProject('local-other',1),'zh',[{...a,clientId:'local-other-a'}]);
  const nextZh = removeRecord(moveRecord(zh,c.clientId,-1),a.clientId);
  const changed = updateProjectMethods(parent,'zh',nextZh);
  assert.deepEqual(nextZh.map(m=>[m.clientId,m.position]),[['local-c',0],['local-b',1]]);
  assert.equal(changed.methods.en,en);
  const parents = moveRecord([changed,other],changed.clientId,1);
  assert.equal(parents[1].methods,changed.methods);
  assert.equal(parents[0].methods,other.methods);
  assert.deepEqual(projectDisplay(parents[1],'zh').methods,nextZh);
  assert.deepEqual(projectDisplay(parents[1],'en').methods,en);
  const removed = removeRecord(parents,changed.clientId);
  assert.equal(removed.length,1);
  assert.equal(removed[0].methods,other.methods);
  const draft = {...emptyDraft,projects:parents,introduction:{zh:'保留',en:''}};
  assert.equal(moduleIsDirty(draft,'projects'),true);
  assert.equal(moduleFromHash('#projects'),'projects');
  assert.deepEqual(cancelModule(draft,'projects').projects,[]);
  assert.equal(cancelModule(draft,'projects').introduction,draft.introduction);
});
