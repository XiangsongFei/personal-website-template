import assert from 'node:assert/strict';
import test from 'node:test';
import {bilingualFieldKey, collectEditorFields, fieldModified, modifiedEditorFields, reviewChanges} from '../lib/editor/bilingual-review.ts';
import {emptyDraft, moduleIsDirty} from '../lib/editor/draft.ts';
import {changeEducationCategory, newEducation, newProject, newSkill} from '../lib/editor/records.ts';

const key = (field, item) => bilingualFieldKey({field, item});
const collect = collectEditorFields;

test('opposite edits and acknowledgements complete one round without reversing the reminder', () => {
  const baseline = collect(emptyDraft, 'introduction');
  let previous = baseline, reviews = new Map();
  const edit = (zh, en) => {
    const current = collect({...emptyDraft, introduction: {zh, en}}, 'introduction');
    reviews = reviewChanges(previous, current, baseline, reviews).reviews;
    previous = current;
    return reviews.get(key('introduction'));
  };
  assert.deepEqual(edit('中', ''), {source: 'zh', pending: true});
  reviews.set(key('introduction'), {source: 'zh', pending: false});
  assert.deepEqual(edit('中文', ''), {source: 'zh', pending: true});
  assert.deepEqual(edit('中文', 'E'), {source: 'zh', pending: false});
  assert.deepEqual(edit('中文', 'English'), {source: 'zh', pending: false});
  assert.deepEqual(edit('新版中文', 'English'), {source: 'zh', pending: true});
  assert.equal(edit('', 'English'), undefined);
  assert.deepEqual(edit('', 'New English'), {source: 'en', pending: true});
  assert.equal(edit('', ''), undefined);
  assert.equal(edit('中', 'English'), undefined);
});

test('a stable record keeps its reminder on reorder and loses it when deleted', () => {
  const a = {...newSkill('a', 0), translations: {zh: {items: '甲'}}};
  const b = newSkill('b', 1);
  const baseline = collect({...emptyDraft, skills: [a, b]}, 'skills');
  const changedA = {...a, translations: {zh: {items: '更新'}}};
  const edited = collect({...emptyDraft, skills: [changedA, b]}, 'skills');
  const added = reviewChanges(baseline, edited, baseline, new Map()).reviews;
  const sorted = collect({...emptyDraft, skills: [{...b, position: 0}, {...changedA, position: 1}]}, 'skills');
  assert.deepEqual(reviewChanges(edited, sorted, baseline, added).reviews, added);
  const removed = collect({...emptyDraft, skills: [b]}, 'skills');
  assert.equal(reviewChanges(sorted, removed, baseline, added).reviews.size, 0);
});

test('shared labels and their localized namesakes are separate, and shared preset changes need no review', () => {
  const before = collect(emptyDraft, 'links');
  const after = collect({...emptyDraft, links: {shared: {...emptyDraft.links.shared, linkedInLabel: 'Platform'},
    translations: {en: {linkedInLabel: 'Contact'}}}}, 'links');
  const reviews = reviewChanges(before, after, before, new Map()).reviews;
  assert.equal(reviews.size, 1);
  assert.deepEqual(reviews.get(key('linkedInLabel')), {source: 'en', pending: true});
  assert.equal(fieldModified(after, before, {field: 'linkedInLabel'}, 'shared'), true);

  const row = {...newEducation('a', 0), translations: {zh: {title: '已填标题'}}};
  const education = collect({...emptyDraft, education: [row]}, 'education');
  const category = collect({...emptyDraft, education: [changeEducationCategory(row, 'graduate')]}, 'education');
  assert.equal(reviewChanges(education, category, education, new Map()).reviews.size, 0);
});

test('methods compare a whole language group and keep independent stable item feedback', () => {
  const project = {...newProject('project', 0), methods: {
    zh: [{clientId: 'zh-a', position: 0, value: '原方法'}],
    en: [{clientId: 'en-x', position: 0, value: 'Original'}, {clientId: 'en-y', position: 1, value: 'Another'}],
  }};
  const snapshot = methods => collect({...emptyDraft, projects: [{...project, methods}]}, 'projects');
  const initial = snapshot(project.methods);
  const next = snapshot({...project.methods, zh: [{...project.methods.zh[0], value: '新方法'}]});
  const pending = reviewChanges(initial, next, initial, new Map()).reviews;
  assert.deepEqual([...pending.keys()], [key('methods', 'project')]);
  assert.equal(fieldModified(next, initial, {item: 'project', field: 'method:zh:zh-a'}, 'zh'), true);
  assert.equal(fieldModified(next, initial, {item: 'project', field: 'method:en:en-x'}, 'en'), false);
  const replied = snapshot({zh: [{...project.methods.zh[0], value: '新方法'}],
    en: [{...project.methods.en[0], value: 'New'}, project.methods.en[1]]});
  assert.deepEqual(reviewChanges(next, replied, initial, pending).reviews.get(key('methods', 'project')),
    {source: 'zh', pending: false});
});

test('clearing optional text restores a clean baseline without hiding a cleared preset title', () => {
  const row = changeEducationCategory(newEducation('id', 0), 'graduate');
  const base = {...emptyDraft, education: [row]};
  const draft = translations => ({...emptyDraft, education: [{...row, translations}]});
  assert.equal(moduleIsDirty(draft({zh: {customCategoryLabel: '', title: '研究生教育'}}), 'education', base), false);
  assert.equal(moduleIsDirty(draft({zh: {title: ''}}), 'education', base), true);
  assert.equal(moduleIsDirty({...emptyDraft, 'site-text': {translations: {}, navigation: {en: {projects: ''}}}}, 'site-text'), false);
});


test('persistent preview feedback follows the modified fields and their locale across modules', () => {
  const baseline = {...emptyDraft, projects: [newProject('project-a', 0)]};
  const draft = {...baseline, profile: {...baseline.profile, translations: {
    ...baseline.profile.translations, zh: {...baseline.profile.translations.zh, name: '更新'},
  }}, projects: [{...baseline.projects[0], translations: {en: {title: 'Updated project'}}}]};
  assert.deepEqual(modifiedEditorFields(draft, baseline, ['profile','projects']), [
    {module: 'profile', item: undefined, field: 'name', locale: 'zh'},
    {module: 'projects', item: 'project-a', field: 'title', locale: 'en'},
  ]);
  assert.deepEqual(modifiedEditorFields(baseline, baseline, ['profile','projects']), []);
});
