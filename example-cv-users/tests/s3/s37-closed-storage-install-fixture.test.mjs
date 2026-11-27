import assert from 'node:assert/strict';
import test from 'node:test';
import { renderS37ClosedStorageInstallFixture } from '../../scripts/s37-hosted/closed-storage-install-fixture.mjs';

const target = Object.freeze({
  clusterSha256: 'a'.repeat(64),
  localMarker: 'b'.repeat(32),
  postmasterStarted: '2026-11-27T00:00:00.000000Z',
});

test('the S3.7 install renderer accepts only a declared local fixture lane and stage', () => {
  for (const input of [
    {}, { lane: 'hosted', stage: 'edge' }, { lane: 'legacy', stage: 'l2' },
    { lane: 'legacy', stage: '__proto__' },
  ]) {
    assert.throws(() => renderS37ClosedStorageInstallFixture(input), /S37_INSTALL_FIXTURE_SCOPE/);
  }
});

test('both original SQL artifacts must match the reviewed digest for their stage', () => {
  for (const stage of ['l1', 'edge']) {
    for (const source of [undefined, '', Buffer.from('BEGIN; COMMIT;'), 'BEGIN; CREATE SCHEMA public; COMMIT;']) {
      assert.throws(() => renderS37ClosedStorageInstallFixture({
        lane: 'empty', stage, source, target, sourceSha256: 'a'.repeat(64),
      }), /S37_INSTALL_SOURCE_DRIFT/);
    }
  }
});
