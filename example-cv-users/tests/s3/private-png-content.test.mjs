import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { ASSET_BUCKET, assetObjectKey } from '../../lib/business/asset-protocol.mjs';
import { preparePrivatePng, privatePngResponse } from '../../lib/business/private-png-content.node.mjs';
import { pngCRC } from '../../lib/business/storage-png-validator.node.mjs';

const id = n => `7c23ab80-2c46-4efe-b986-6e5437da14${String(n).padStart(2, '0')}`;
const input = { request_id: id(1), site_id: id(2), original_filename: 'example.png' };
const target = { site_id: input.site_id, asset_id: id(3) };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = 'image/png';
const error = code => err => err.code === code;

function chunk(name, bytes) {
  const payload = Buffer.concat([Buffer.from(name), bytes]);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(pngCRC(payload));
  return Buffer.concat([length, payload, crc]);
}

function png({ width = 1, height = 1, filter = 0, gray = 50 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([filter, gray]))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function record(bytes) {
  const asset = { ...target, state: 'ready', bucket_id: ASSET_BUCKET, mime_type: mime, object_version: id(4),
    byte_size: bytes.length, sha256: sha(bytes) };
  return { ...asset, object_key: assetObjectKey(asset) };
}

test('valid PNG preserves request scope, computes its own metadata and stages a separate byte snapshot', async () => {
  const original = png();
  const expected = Uint8Array.from(original);
  const staged = preparePrivatePng(input, mime, original);
  original.fill(0);
  const { prepare, bytes, width, height } = await staged;
  assert.deepEqual({ width, height }, { width: 1, height: 1 });
  assert.deepEqual(prepare, { ...input, schema_version: 1, kind: 'image', locale: null, mime_type: mime,
    byte_size: expected.length, sha256: sha(expected) });
  assert.deepEqual(bytes, expected);
  assert.deepEqual(await preparePrivatePng(input, mime, expected), { prepare, bytes, width, height });
});

test('rejects type mismatch, oversized, truncated, corrupt, invalid decoded scanline and huge dimensions', async () => {
  const badCRC = png();
  badCRC[29] ^= 1;
  for (const bytes of [Buffer.from('%PDF-1.7'), Buffer.alloc(65_537), png().subarray(0, -1), badCRC,
    png({ filter: 5 }), png({ width: 2001, height: 1000 })]) {
    await assert.rejects(preparePrivatePng(input, mime, bytes), error('INVALID_CONTENT'));
  }
  for (const contentType of ['application/pdf', 'image/svg+xml', 'image/gif', null]) {
    await assert.rejects(preparePrivatePng(input, contentType, png()), error('INVALID_CONTENT'));
  }
});

test('refuses path filenames, client-selected hashes, keys and mutation flags', async () => {
  for (const value of [{ ...input, original_filename: '../example.png' }, { ...input, sha256: '0'.repeat(64) },
    { ...input, object_key: 'site/file.png' }, { ...input, upsert: true }, { ...input, state: 'ready' }]) {
    await assert.rejects(preparePrivatePng(value, mime, png()), error('INVALID_INPUT'));
  }
});

test('a private ready response serves validated snapshot bytes, no-store and no object URL', async () => {
  const bytes = png();
  const ready = record(bytes);
  const responsePromise = privatePngResponse(target, ready, bytes);
  bytes.fill(0);
  ready.sha256 = null;
  const response = await responsePromise;
  assert.equal(response.headers.get('content-type'), mime);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png());
});

test('rejects non-ready states, cross-site or wrong object binding, bad digest, type and byte length', async () => {
  const bytes = png();
  const ready = record(bytes);
  for (const changes of [
    { state: 'pending' }, { state: 'UNKNOWN' }, { state: 'rejected' }, { state: 'deleted' },
    { site_id: id(5) }, { asset_id: id(5) }, { object_version: id(5) }, { bucket_id: 'public' },
    { object_key: '../other.png' }, { mime_type: 'application/pdf' }, { sha256: '0'.repeat(64) },
    { byte_size: ready.byte_size + 1 },
  ]) await assert.rejects(privatePngResponse(target, { ...ready, ...changes }, bytes), error('ASSET_NOT_AVAILABLE'));
  await assert.rejects(privatePngResponse(target, ready, png({ gray: 51 })), error('ASSET_NOT_AVAILABLE'));
  await assert.rejects(privatePngResponse({ ...target, site_id: id(5) }, ready, bytes), error('ASSET_NOT_AVAILABLE'));
  await assert.rejects(privatePngResponse({ ...target, object_key: ready.object_key }, ready, bytes), error('INVALID_INPUT'));
  const damaged = png({ filter: 5 });
  await assert.rejects(privatePngResponse(target, record(damaged), damaged), error('ASSET_NOT_AVAILABLE'));
});

test('rejects trailing bytes in the compressed payload', async () => {
  const bytes = png();
  const ihdrEnd = 33;
  const compressed = bytes.subarray(41, 41 + bytes.readUInt32BE(ihdrEnd));
  const trailing = Buffer.concat([bytes.subarray(0, ihdrEnd),
    chunk('IDAT', Buffer.concat([compressed, Buffer.from([0])])),
    chunk('IEND', Buffer.alloc(0))]);
  await assert.rejects(preparePrivatePng(input, mime, trailing), error('INVALID_CONTENT'));
});
