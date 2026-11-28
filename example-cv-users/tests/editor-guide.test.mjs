import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyDraft, moduleIsDirty} from '../lib/editor/draft.ts';
import {fillingGuide, guidePlaceholder, hasPreviewContent} from '../lib/editor/filling-guide.ts';
import {newEducation, newProject, newSkill} from '../lib/editor/records.ts';
import {newFocus, newStatus} from '../lib/editor/contact.ts';

test('the filling guide provides bilingual guidance without populating the real draft', () => {
  const fields = [
    ['profile', 'name'], ['introduction', 'introduction'], ['education', 'program'], ['education', 'courseTitle'],
    ['experience', 'description'], ['projects', 'description'], ['skills', 'items'], ['awards', 'name'],
    ['contact', 'availability'], ['links', 'linkedInHref'], ['site-text', 'nav:projects'],
  ];
  for (const [module, field] of fields) {
    assert.ok(guidePlaceholder(module, field, 'zh'), module + ':' + field);
    assert.ok(guidePlaceholder(module, field, 'en'), module + ':' + field);
    assert.equal(moduleIsDirty(emptyDraft, module), false);
  }
  assert.equal(guidePlaceholder('links', 'email', 'shared'), 'chen@example.org');
  assert.ok(guidePlaceholder('projects', 'method:en:local-method', 'en'));
  assert.notEqual(guidePlaceholder('contact', 'detail', 'en', 'focus:record'), guidePlaceholder('contact', 'detail', 'en', 'status:record'));
  assert.equal(hasPreviewContent(fillingGuide), true);
  assert.equal(hasPreviewContent(emptyDraft), false);
});

test('blank rows keep guide mode, while a real field in any module takes priority', () => {
  const blankRows = {
    ...emptyDraft, education: [newEducation('education', 0)], skills: [newSkill('skill', 0)],
    contact: {...emptyDraft.contact, focus: [newFocus('focus', 0)], status: [newStatus('status', 0)]},
    projects: [{...newProject('project', 0), methods: {zh: [{clientId: 'method', position: 0, value: '   '}], en: []}}],
  };
  assert.equal(hasPreviewContent(blankRows), false);
  assert.equal(hasPreviewContent({...emptyDraft, introduction: {zh: '', en: 'My own introduction'}}), true);
  assert.equal(hasPreviewContent({...emptyDraft, 'site-text': {translations: {}, navigation: {en: {projects: 'My projects'}}}}), true);
  assert.equal(hasPreviewContent({...blankRows, projects: [{...blankRows.projects[0], methods: {zh: [], en: [
    {clientId: 'method', position: 0, value: 'Interviews'},
  ]}}]}), true);
});
