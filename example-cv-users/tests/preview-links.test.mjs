import test from 'node:test';
import assert from 'node:assert/strict';
import {demoPreviewMailto, demoPreviewUrl} from '../lib/editor/preview-links.ts';

test('local preview links accept only validated sample destinations and a non-deliverable mailbox', () => {
  assert.equal(demoPreviewUrl('https://github.com'), 'https://github.com/');
  assert.equal(demoPreviewUrl('https://www.linkedin.com/'), 'https://www.linkedin.com/');
  assert.equal(demoPreviewUrl('http://example.org/project'), 'http://example.org/project');
  for (const address of ['javascript:alert(1)', 'data:text/html,example', '//example.com', 'https://github.com@outside.invalid',
    'https://user@github.com', 'https://github.com:444/', 'https://example.com.outside.invalid', 'https://example.com\\evil',
    'http://localhost:8795/', 'https://files.example.invalid/example.pdf']) {
    assert.equal(demoPreviewUrl(address), undefined, address);
  }

  assert.equal(demoPreviewMailto('lin+review?@example.invalid'), 'mailto:lin%2Breview%3F@example.invalid');
  for (const value of ['lin@example.com', 'a@example.invalid,b@example.invalid', 'lin@example.invalid?subject=x',
    'mailto:lin@example.invalid', 'lin@example.invalid\r\nBcc: a@example.invalid']) {
    assert.equal(demoPreviewMailto(value), undefined, value);
  }
});
