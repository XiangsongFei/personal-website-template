import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelModule, emptyDraft, moduleFromHash, moduleIsDirty} from '../lib/editor/draft.ts';
import {editTranslation} from '../lib/editor/records.ts';
import {emptyLinks, linkedInUrlsDiffer, publicLinksDisplay, safePublicEmail} from '../lib/editor/site-links.ts';

test('public email begins empty and accepts only a single explicit bare mailbox', () => {
  assert.equal(emptyLinks.shared.email, '');
  assert.equal(publicLinksDisplay(emptyLinks, 'zh').email, undefined);
  for (const unsafe of ['', 'mailto:a@example.invalid', 'a@example.invalid?subject=Injection', 'a@example.invalid\r\n',
    'a@example.invalid,b@example.invalid', 'Name <a@example.invalid>', 'a..b@example.invalid', '@example.invalid',
    'a@-example.invalid', 'a@example-.invalid', 'a@example..invalid']) {
    assert.equal(safePublicEmail(unsafe), undefined, unsafe);
  }
  assert.equal(safePublicEmail(' contact+sample@example.invalid '), 'contact+sample@example.invalid');
});

test('public URLs share the HTTP(S) policy and project only the current LinkedIn language', () => {
  for (const unsafe of ['javascript:alert(1)', 'data:text/plain,hello', 'file:///tmp/demo',
    '//example.invalid', 'https://account:password@example.invalid', 'https://exam\nple.invalid']) {
    const draft = {...emptyLinks, shared: {...emptyLinks.shared, github: unsafe},
      translations: {zh: {linkedInHref: unsafe}}};
    assert.equal(publicLinksDisplay(draft, 'zh').github, undefined, unsafe);
    assert.equal(publicLinksDisplay(draft, 'zh').linkedInHref, undefined, unsafe);
  }
  const translations = editTranslation(editTranslation({}, 'zh', {linkedInLabel: '合成领英', linkedInHref: 'https://example.invalid/zh'}),
    'en', {linkedInLabel: 'Synthetic LinkedIn', linkedInHref: 'https://example.invalid/en'});
  const draft = {...emptyLinks, shared: {...emptyLinks.shared, email: 'contact@example.invalid', github: 'http://example.invalid/github',
    linkedInDisplayName: 'Synthetic identity', linkedInLabel: 'Profile'}, translations};
  assert.equal(linkedInUrlsDiffer(draft), true);
  const zh = publicLinksDisplay(draft, 'zh');
  const en = publicLinksDisplay(draft, 'en');
  assert.equal(en.email, zh.email);
  assert.equal(en.github, zh.github);
  assert.equal(en.linkedInDisplayName, zh.linkedInDisplayName);
  assert.equal(en.linkedInActionLabel, zh.linkedInActionLabel);
  assert.equal(zh.linkedInHref, 'https://example.invalid/zh');
  assert.equal(en.linkedInHref, 'https://example.invalid/en');
  assert.equal(zh.linkedInContactLabel, '合成领英');
  assert.equal(en.linkedInContactLabel, 'Synthetic LinkedIn');
  assert.equal(publicLinksDisplay({...draft, translations: {en: translations.en}}, 'zh').linkedInHref, undefined);
  assert.equal(linkedInUrlsDiffer({...draft, translations: {zh: {linkedInHref: ''}, en: translations.en}}), true);
});

test('cancel Links preserves Contact and cancel Contact preserves Links', () => {
  const draft = {...emptyDraft, contact: {...emptyDraft.contact, translations: {zh: {contactLabel: '联系栏'}}},
    links: {...emptyLinks, shared: {...emptyLinks.shared, email: 'contact@example.invalid'}}};
  assert.equal(moduleFromHash('#links'), 'links');
  assert.equal(moduleIsDirty(draft, 'contact'), true);
  assert.equal(moduleIsDirty(draft, 'links'), true);
  assert.equal(cancelModule(draft, 'links').contact, draft.contact);
  assert.equal(cancelModule(draft, 'contact').links, draft.links);
});
