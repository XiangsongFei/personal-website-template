import test from 'node:test';
import assert from 'node:assert/strict';
import {contactDisplay, contactStatusLabels, emptyContact, newFocus, newStatus} from '../lib/editor/contact.ts';
import {cancelModule, emptyDraft, moduleFromHash, moduleIsDirty} from '../lib/editor/draft.ts';
import {editTranslation, moveRecord, removeRecord} from '../lib/editor/records.ts';

test('contact text, focus and status project only the active language', () => {
  const translations = editTranslation(editTranslation({}, 'zh', {contactLabel: '联系', availability: '可联系\n<示例>'}),
    'en', {contactLabel: 'Contact', availability: 'Open for a conversation'});
  const focus = {...newFocus('local-focus', 0), translations: editTranslation({}, 'zh', {title: '合成重点', detail: '详情'})};
  const status = {...newStatus('local-status', 0), statusType: 'study',
    translations: editTranslation(editTranslation({}, 'zh', {title: '在读', detail: '示例'}), 'en', {title: 'Studying'})};
  const contact = {...emptyContact, translations, focus: [focus], status: [status]};
  assert.deepEqual(contactDisplay(contact, 'zh'), {
    contactLabel: '联系', availability: '可联系\n<示例>',
    focus: [{row: focus, title: '合成重点', detail: '详情'}], status: [{row: status, title: '在读', detail: '示例'}],
  });
  assert.deepEqual(contactDisplay(contact, 'en'), {
    contactLabel: 'Contact', availability: 'Open for a conversation',
    focus: [], status: [{row: status, title: 'Studying', detail: ''}],
  });
  assert.deepEqual(Object.keys(contactStatusLabels), ['study', 'graduation', 'open']);
  assert.equal(newStatus('local', 0).statusType, 'open');
});

test('focus and status orders are independent and Contact cancellation keeps Profile', () => {
  const focus = ['fa', 'fb', 'fc'].map((id, position) => newFocus(id, position));
  const status = ['sa', 'sb', 'sc'].map((id, position) => newStatus(id, position));
  const draft = {...emptyDraft, contact: {...emptyContact, focus, status},
    profile: {...emptyDraft.profile, translations: {...emptyDraft.profile.translations,
      en: {...emptyDraft.profile.translations.en, contactFocusHeading: 'Research interests'}}}};
  const reordered = {...draft.contact, focus: removeRecord(moveRecord(focus, 'fc', -1), 'fa')};
  assert.deepEqual(reordered.focus.map(({clientId, position}) => [clientId, position]), [['fc', 0], ['fb', 1]]);
  assert.equal(reordered.status, draft.contact.status);
  const changed = {...draft, contact: {...reordered, status: moveRecord(status, 'sa', 1)}};
  assert.equal(changed.contact.focus, reordered.focus);
  assert.deepEqual(changed.contact.status.map(r => r.clientId), ['sb', 'sa', 'sc']);
  assert.equal(moduleFromHash('#contact'), 'contact');
  assert.equal(moduleIsDirty(changed, 'contact'), true);
  const cancelled = cancelModule(changed, 'contact');
  assert.equal(cancelled.contact, emptyContact);
  assert.equal(cancelled.profile, draft.profile);
});
