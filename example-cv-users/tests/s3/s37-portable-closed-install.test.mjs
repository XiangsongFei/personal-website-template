import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import test from 'node:test';
import { runS37PortableClosedInstall } from '../../scripts/s37-hosted/portable-closed-install.node.mjs';

const base = Object.freeze({
  requestId: 'c5bd54b9-16c7-406e-9f89-11967dcd8532',
  lane: 'empty', stage: 'l1', observerRole: 's37_observer_test',
  psql: realpathSync(process.execPath), expectedProtection: 'a'.repeat(64),
  readProtection: () => assert.fail('no observer or writer is admitted'),
});

test('portable installer refuses non-fixture roles, altered operation keys, and missing protection inputs', async () => {
  for (const options of [
    { observerRole: 'postgres' },
    { observerRole: 's37_observer_bad;SELECT' },
    { requestId: 'unbound' },
    { psql: './psql' },
    { expectedProtection: null },
    { readProtection: null },
  ]) {
    await assert.rejects(runS37PortableClosedInstall({ ...base, ...options }), /S37_PORTABLE_OPTIONS/);
  }
});

test('portable installer rejects out-of-scope stages and source bytes before opening any connection', async () => {
  await assert.rejects(runS37PortableClosedInstall({ ...base, stage: 'publish' }), /S37_INSTALL_FIXTURE_SCOPE/);
  await assert.rejects(runS37PortableClosedInstall({ ...base, source: 'BEGIN; SELECT 1; COMMIT;' }),
    /S37_INSTALL_SOURCE_DRIFT/);
});
