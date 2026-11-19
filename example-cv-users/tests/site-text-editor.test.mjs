import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelModule, emptyDraft, moduleFromHash, moduleIsDirty, profileLocalized, profileShared} from '../lib/editor/draft.ts';
import {editTranslation} from '../lib/editor/records.ts';
import {editableNavigationSections, emptySiteText, previewOrder, sectionTitleFields, siteNavigationLabel} from '../lib/editor/site-text.ts';

test('site navigation changes labels only for five fixed public sections', () => {
  const navigation = editTranslation(editTranslation({}, 'zh', {projects: '合成导航', education: 'Ignored'}),
    'en', {projects: 'Synthetic navigation'});
  const siteText = {...emptySiteText, navigation};
  assert.deepEqual(editableNavigationSections, ['experience', 'projects', 'skills', 'awards', 'contact']);
  assert.deepEqual(previewOrder, ['profile', 'introduction', 'education', 'experience', 'projects', 'skills', 'awards', 'contact']);
  assert.equal(siteNavigationLabel(siteText, 'zh', 'projects'), '合成导航');
  assert.equal(siteNavigationLabel(siteText, 'en', 'projects'), 'Synthetic navigation');
  for (const key of ['profile', 'education', 'introduction']) {
    assert.equal(siteNavigationLabel(siteText, 'zh', key), undefined);
  }
  assert.equal(siteNavigationLabel(siteText, 'zh', 'skills'), undefined);
});

test('website text is distinct from navigation, Profile, Links and Contact', () => {
  const siteText = {
    navigation: {zh: {projects: '项目导航'}},
    translations: {zh: {projectHeading: '项目标题', portfolioLabel: '简历 PDF', updatedAtLabel: '更新时间'}},
  };
  const draft = {...emptyDraft, 'site-text': siteText};
  assert.equal(sectionTitleFields.projects, 'projectHeading');
  assert.equal(siteNavigationLabel(siteText, 'zh', 'projects'), '项目导航');
  const profileFields = [...Object.keys(profileLocalized), ...Object.keys(profileShared)];
  assert.ok(!Object.keys(siteText.translations.zh).some(key => profileFields.includes(key)));
  assert.equal(moduleFromHash('#site-text'), 'site-text');
  assert.equal(moduleIsDirty(draft, 'site-text'), true);
  const cancelled = cancelModule(draft, 'site-text');
  assert.equal(cancelled['site-text'], emptySiteText);
  for (const section of ['profile', 'contact', 'links', 'projects']) assert.equal(cancelled[section], draft[section]);
});
