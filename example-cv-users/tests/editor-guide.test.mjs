import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyDraft, moduleIsDirty} from '../lib/editor/draft.ts';
import {fillingGuide, guidePlaceholder} from '../lib/editor/filling-guide.ts';
import {buildPreview, updateGuideOverrides} from '../lib/editor/preview-model.ts';
import {newEducation, newExperience, newProject, newSkill, newAward} from '../lib/editor/records.ts';
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
  assert.deepEqual(buildPreview(emptyDraft, {}, true).content, fillingGuide);
  assert.equal(buildPreview(emptyDraft, {}, false).content, emptyDraft);
});

test('field examples are independent by language and stay out of the real draft', () => {
  const draft = {
    ...emptyDraft,
    profile: {...emptyDraft.profile, translations: {...emptyDraft.profile.translations,
      zh: {...emptyDraft.profile.translations.zh, name: '真名'}}},
    introduction: {...emptyDraft.introduction, en: 'My introduction'},
    'site-text': {translations: {}, navigation: {en: {projects: 'My projects'}}},
  };
  const before = structuredClone(draft);
  const preview = buildPreview(draft, {}, true);
  assert.equal(preview.content.profile.translations.zh.name, '真名');
  assert.equal(preview.exampleField('profile', 'name', 'zh'), undefined);
  assert.equal(preview.content.profile.translations.en.name, 'Chen Zhou');
  assert.equal(preview.exampleField('profile', 'name', 'en'), true);
  assert.equal(preview.content.introduction.en, 'My introduction');
  assert.equal(preview.content.introduction.zh, fillingGuide.introduction.zh);
  assert.equal(preview.content['site-text'].navigation.en.projects, 'My projects');
  assert.equal(preview.exampleField('site-text', 'nav:projects', 'en'), undefined);
  assert.equal(preview.content.education, fillingGuide.education);
  assert.equal(buildPreview(draft, {}, false).content, draft);
  assert.deepEqual(draft, before);
});

test('a real collection replaces the whole example and a deleted collection stays empty until undo', () => {
  const factories = {education: newEducation, experience: newExperience, projects: newProject, skills: newSkill, awards: newAward};
  let overrides = {};
  for (const [module, create] of Object.entries(factories)) {
    const row = create('mine', 0);
    const ownDraft = {...emptyDraft, [module]: [row]};
    const preview = buildPreview(ownDraft, overrides, true);
    assert.deepEqual(preview.content[module], [row]);
    assert.equal(preview.exampleCollection(module, module), undefined);
    overrides = updateGuideOverrides(overrides, ownDraft, emptyDraft, module, false);
    assert.deepEqual(buildPreview(emptyDraft, overrides, true).content[module], []);
  }
  overrides = updateGuideOverrides(overrides, emptyDraft, emptyDraft, 'education', true);
  const undone = buildPreview(emptyDraft, overrides, true);
  assert.equal(undone.content.education, fillingGuide.education);
  assert.deepEqual(undone.content.experience, []);
  const focus = newFocus('own-focus', 0);
  const status = newStatus('own-status', 0);
  const contact = {...emptyDraft, contact: {...emptyDraft.contact, focus: [focus], status: [status]}};
  const onlyStatus = {...contact, contact: {...contact.contact, focus: []}};
  const contactOverrides = updateGuideOverrides({}, contact, onlyStatus, 'contact', false);
  assert.deepEqual(buildPreview(onlyStatus, contactOverrides, true).content.contact.focus, []);
  assert.deepEqual(buildPreview(onlyStatus, contactOverrides, true).content.contact.status, [status]);
  assert.equal(buildPreview(emptyDraft, contactOverrides, true).content.contact.status, fillingGuide.contact.status);
});

test('explicit field clears survive empty draft, hidden examples and unrelated edits', () => {
  const profile = value => ({...emptyDraft, profile: {...emptyDraft.profile,
    shared: {...emptyDraft.profile.shared, footerName: value},
    translations: {...emptyDraft.profile.translations, en: {...emptyDraft.profile.translations.en, name: value}}}});
  const real = profile('My name');
  const cleared = updateGuideOverrides({}, real, emptyDraft, 'profile', false);
  assert.equal(moduleIsDirty(emptyDraft, 'profile'), false);
  assert.equal(buildPreview(emptyDraft, cleared, false).content, emptyDraft);
  const preview = buildPreview(emptyDraft, cleared, true);
  assert.equal(preview.content.profile.shared.footerName, '');
  assert.equal(preview.content.profile.translations.en.name, '');
  assert.equal(preview.content.profile.translations.zh.name, '周晨');
  assert.equal(buildPreview(real, cleared, true).content.profile.shared.footerName, 'My name');
  const undone = updateGuideOverrides(cleared, emptyDraft, emptyDraft, 'profile', true);
  assert.equal(buildPreview(emptyDraft, undone, true).content.profile.translations.en.name, 'Chen Zhou');
});
