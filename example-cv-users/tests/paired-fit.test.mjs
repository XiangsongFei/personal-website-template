import test from 'node:test';
import assert from 'node:assert/strict';
import {stackPairedControls} from '../lib/editor/paired-fit.ts';

test('locale pair fits its hypothetical equal tracks and either wide field can stack it', () => {
  assert.equal(stackPairedControls(440, 16, [4, 4], false), false);
  assert.equal(stackPairedControls(440, 16, [160, 160], false), false);
  assert.equal(stackPairedControls(440, 16, [205, 30], false), true);
  assert.equal(stackPairedControls(440, 16, [30, 205], false), true);
  assert.equal(stackPairedControls(440, 16, [210, 270], false), true);
  assert.equal(stackPairedControls(230, 16, [4, 4], false), true);
});

test('independent thresholds prevent oscillation and allow recovery with shorter input or more space', () => {
  assert.equal(stackPairedControls(440, 16, [201, 30], false), false);
  assert.equal(stackPairedControls(440, 16, [201, 30], true), true);
  assert.equal(stackPairedControls(440, 16, [195, 30], true), false);
  assert.equal(stackPairedControls(472, 16, [205, 30], true), false);
  assert.equal(stackPairedControls(0, 16, [205, 30], false), false);
  assert.equal(stackPairedControls(440, 16, [NaN, 30], true), true);
});
