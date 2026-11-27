import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';

import { ASSET_BUCKET, assetObjectKey } from '../../../lib/business/asset-protocol.mjs';
import { preparePrivatePng, privatePngResponse } from '../../../lib/business/private-png-content.node.mjs';

const pgBin = process.env.S35_TEST_PG17_BIN;
assert.ok(isAbsolute(pgBin ?? ''), 'Provide the absolute path to the PostgreSQL fixture binaries');
const pg = (binary, args, input) => execFileSync(join(pgBin, binary), args, {
  input, encoding: 'utf8', timeout: 20_000, env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' },
});
assert.match(pg('postgres', ['--version']), /\b17\.12\b/);

test('PNG receipt matches the PostgreSQL byte count, digest and typed object key', { timeout: 60_000 }, async t => {
  const root = mkdtempSync(join(realpathSync('/tmp'), 'ecv-png-pg-'));
  const data = join(root, 'db');
  const port = '54832';
  let started = false;
  t.after(() => {
    if (started) pg('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    rmSync(root, { recursive: true, force: true });
  });
  pg('initdb', ['-D', data, '-U', 'fixture_admin', '--no-locale', '--encoding=UTF8',
    '--auth-local=trust', '--auth-host=reject']);
  pg('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-o',
    '-c listen_addresses= -k ' + root + ' -p ' + port, '-w', 'start']);
  started = true;

  const mime = 'image/png';
  const bytes = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b55' +
    '0000000a49444154789c6330020000340033ce83246f0000000049454e44ae426082', 'hex');
  const target = { site_id: '20000000-0000-4000-8000-000000000001', asset_id: '20000000-0000-4000-8000-000000000002' };
  const objectVersion = '20000000-0000-4000-8000-000000000003';
  const requestId = '20000000-0000-4000-8000-000000000004';
  const { prepare } = await preparePrivatePng({ request_id: requestId, site_id: target.site_id,
    original_filename: 'fixture.png' }, mime, bytes);

  // Fixture receipt only. The cluster does not implement Supabase Auth, Storage or deployment migrations.
  const receipt = JSON.parse(pg('psql', ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
    '-h', root, '-p', port, '-U', 'fixture_admin', '-d', 'postgres',
    '-v', 'site=' + target.site_id, '-v', 'asset=' + target.asset_id, '-v', 'version=' + objectVersion,
    '-v', 'bytes=' + bytes.toString('hex')], `
    WITH fixture AS (
      SELECT :'site'::uuid AS site_id, :'asset'::uuid AS asset_id, :'version'::uuid AS object_version,
             decode(:'bytes', 'hex') AS body
    )
    SELECT json_build_object(
      'site_id', site_id, 'asset_id', asset_id, 'object_version', object_version,
      'object_key', site_id::text || '/' || asset_id::text || '/' || object_version::text || '.png',
      'mime_type', 'image/png', 'bucket_id', 'users-site-assets-private', 'state', 'ready',
      'byte_size', octet_length(body), 'sha256', encode(sha256(body), 'hex')
    )
    FROM fixture;
  `));
  assert.equal(receipt.bucket_id, ASSET_BUCKET);
  assert.equal(receipt.object_key, assetObjectKey(receipt));
  assert.equal(receipt.sha256, prepare.sha256);
  assert.equal(receipt.byte_size, prepare.byte_size);
  const response = await privatePngResponse(target, receipt, bytes);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  await assert.rejects(privatePngResponse(target, { ...receipt, state: 'pending' }, bytes), {
    code: 'ASSET_NOT_AVAILABLE',
  });
});
