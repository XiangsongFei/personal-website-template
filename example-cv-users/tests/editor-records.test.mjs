import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeEducationCategory, educationCategories, educationCategory, educationDisplay,
  educationTitle, editTranslation, moveRecord, newEducation, newExperience, removeRecord,
} from '../lib/editor/records.ts';
import {cancelModule, emptyDraft, moduleFromHash, moduleIsDirty} from '../lib/editor/draft.ts';

test('new and legacy standard Education stay uncategorized until expressly changed', () => {
  const blank = newEducation('local-a', 0);
  const legacy = {...blank, translations: {zh: {title: '历史标题'}}};
  for (const row of [blank, legacy]) {
    assert.equal(educationCategory(row), null);
    assert.equal(row.persistedCategory, null);
    assert.equal(educationTitle(row, 'en'), '');
  }
  const oldSummer = {...legacy, entryType: 'summerSchool'};
  assert.equal(educationCategory(oldSummer), 'summerSchool');
  assert.equal(oldSummer.category, null);
  assert.equal(oldSummer.persistedCategory, null);
});

test('five categories derive only absent preset titles and preserve explicit empty and custom titles', () => {
  const blank = newEducation('local-a', 0);
  const expected = ['Undergraduate Education', 'Graduate Education', 'Doctoral Education', 'Summer School', ''];
  for (const [index, option] of educationCategories.entries()) {
    const changed = changeEducationCategory(blank, option);
    assert.equal(educationTitle(changed, 'en'), expected[index]);
    assert.equal(changed.persistedCategory, null);
    assert.deepEqual(changed.translations, {});
  }
  const custom = {...blank, translations: {zh: {title: '本科教育'}, en: {title: ''}}};
  const changed = changeEducationCategory(custom, 'doctoral');
  assert.equal(educationTitle(changed, 'zh'), '本科教育');
  assert.equal(educationTitle(changed, 'en'), '');
});

test('category toggles retain the two course sets and their independent languages', () => {
  const summer = {...changeEducationCategory(newEducation('local-a', 0), 'summerSchool'),
    translations: {zh: {courseTitle: '示例课程', courseDescription: '习作\n<纯文本>'}, en: {courseTitle: 'Example course'}}};
  const translations = editTranslation(summer.translations, 'en', {period: '', grade: 'A & B'});
  assert.deepEqual(translations.zh, summer.translations.zh);
  const switched = changeEducationCategory({...summer, translations}, 'custom');
  assert.equal(educationDisplay(switched, 'zh').courseTitle, '');
  assert.equal(switched.translations.zh.courseTitle, '示例课程');
  const restored = changeEducationCategory(switched, 'summerSchool');
  assert.equal(educationDisplay(restored, 'zh').courseDescription, '习作\n<纯文本>');
  assert.equal(educationDisplay(restored, 'en').courseDescription, '');
  assert.equal(educationDisplay(restored, 'en').courseTitle, 'Example course');
  const custom = {...switched, translations: editTranslation(translations, 'zh', {customCategoryLabel: '自定义 ✦'})};
  assert.equal(educationDisplay(custom, 'zh').categoryTitle, '自定义 ✦');
  assert.equal(educationDisplay(custom, 'en').categoryTitle, '');
});

test('move and remove keep client IDs and translations together while maintaining zero-based position', () => {
  const a = {...newEducation('local-a', 0), translations: {zh: {title: '甲'}, en: {title: 'A'}}};
  const b = newEducation('local-b', 1);
  const c = newEducation('local-c', 2);
  const original = [a,b,c];
  assert.equal(moveRecord(original, a.clientId, -1), original);
  assert.equal(moveRecord(original, c.clientId, 1), original);
  assert.equal(moveRecord(original, 'missing', 1), original);
  const moved = moveRecord(original, a.clientId, 1);
  assert.deepEqual(moved.map(row => [row.clientId,row.position]), [['local-b',0],['local-a',1],['local-c',2]]);
  assert.deepEqual(moved[1].translations, a.translations);
  const removed = removeRecord(moved, b.clientId);
  assert.deepEqual(removed.map(row => [row.clientId,row.position]), [['local-a',0],['local-c',1]]);
  assert.equal(a.position, 0);
});

test('Education cancel resets just that module and unknown hashes remain unavailable', () => {
  const modified = {...emptyDraft, introduction: {zh: '保留', en: ''}, education: [newEducation('local-a', 0)]};
  assert.equal(moduleIsDirty(modified, 'education'), true);
  const reset = cancelModule(modified, 'education');
  assert.deepEqual(reset.education, []);
  assert.equal(reset.introduction, modified.introduction);
  assert.equal(reset.profile, modified.profile);
  assert.equal(moduleFromHash('#education'), 'education');
  assert.equal(moduleFromHash('#constructor'), undefined);
});


test('Experience keeps both five-field translations and literal descriptions with the same row', () => {
  const text = '<b>Plain text</b> & café\n' + '长'.repeat(1200);
  const zh = {organization: '示例组', title: '角色', period: '2024 年秋', description: text, location: ''};
  const en = {organization: 'Example lab', title: 'Researcher', period: 'Fall 2024', description: 'Two\nparagraphs.', location: 'Remote'};
  const row = newExperience('local-exp', 0);
  const translated = editTranslation(editTranslation(row.translations, 'zh', zh), 'en', en);
  const change = editTranslation(translated, 'zh', {location: null});
  assert.deepEqual(change.en, en);
  assert.equal(translated.zh.location, '');
  assert.equal(change.zh.location, null);
  const ordered = moveRecord([{...row, translations: change}, newExperience('local-other', 1)], row.clientId, 1);
  assert.equal(ordered[1].clientId, row.clientId);
  assert.equal(ordered[1].translations.zh.description, text);
  const draft = {...emptyDraft, experience: ordered, education: [newEducation('local-edu', 0)]};
  assert.equal(moduleIsDirty(draft, 'experience'), true);
  const reset = cancelModule(draft, 'experience');
  assert.deepEqual(reset.experience, []);
  assert.equal(reset.education, draft.education);
  assert.equal(moduleFromHash('#experience'), 'experience');
});
