import test from 'node:test';
import assert from 'node:assert/strict';
import {previewDestination, publicEmailMailto} from '../lib/editor/preview-links.ts';

test('real preview destinations accept HTTP(S) and reject unsafe or malformed addresses', () => {
  assert.deepEqual(previewDestination('https://example.edu/projects/my-work', false), {href: 'https://example.edu/projects/my-work'});
  assert.deepEqual(previewDestination('http://example.org:8080/project#details', false), {href: 'http://example.org:8080/project#details'});
  assert.deepEqual(previewDestination('https://example.org/path@sample', false), {href: 'https://example.org/path@sample'});
  for (const address of ['javascript:alert(1)', 'data:text/html,example', 'file:///tmp/test', '//example.com', 'https:///example.org',
    'https://example.org@outside.invalid', 'https://user:password@example.org', 'https://@example.org', 'https://example.org\\path',
    '\nhttps://example.org', 'https://example.org\u0000', 'https://example.org/\u0085', 'https://example.org/\u202E']) {
    assert.deepEqual(previewDestination(address, false), {status: 'invalid'}, address);
  }
  assert.equal(previewDestination('', false), undefined);
  assert.deepEqual(previewDestination('https://example.org/profile/zh', true), {status: 'example'});
  assert.deepEqual(previewDestination('https://example.org/profile/zh', false), {href: 'https://example.org/profile/zh'});
});

test('mailto encodes mailbox delimiters and cannot add recipients or headers', () => {
  assert.equal(publicEmailMailto('lin+review?&%\'@example.invalid'), 'mailto:lin%2Breview%3F%26%25%27@example.invalid');
  assert.equal(publicEmailMailto('person%0D%0A@example.org'), 'mailto:person%250D%250A@example.org');
  assert.equal(publicEmailMailto('lin@example.com'), 'mailto:lin@example.com');
  for (const value of ['a@example.invalid,b@example.invalid', 'lin@example.invalid?subject=x',
    'mailto:lin@example.invalid', 'lin@example.invalid\r\nBcc: a@example.invalid', 'lin@example.invalid\r\n']) {
    assert.equal(publicEmailMailto(value), undefined, value);
  }
  assert.deepEqual(previewDestination('chen@example.org', true, publicEmailMailto), {status: 'example'});
  assert.deepEqual(previewDestination('lin@example.com', false, publicEmailMailto), {href: 'mailto:lin@example.com'});
});
