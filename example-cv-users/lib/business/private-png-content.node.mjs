import { ASSET_BUCKET, assetObjectKey, assetTarget, prepareAssetInput } from './asset-protocol.mjs';
import { deny, exact, sha256, uuid } from './protocol.mjs';
import { validateBoundedPNG } from './storage-png-validator.node.mjs';

const mime = 'image/png';
const minBytes = 45;
const maxBytes = 65_536;

function validLength(length) {
  return Number.isSafeInteger(length) && length >= minBytes && length <= maxBytes;
}

async function inspectPng(source, reject) {
  if (!(source instanceof Uint8Array) || !validLength(source.byteLength)) reject();
  const bytes = Uint8Array.from(source);
  const decoded = validateBoundedPNG(bytes, { mime_type: mime, maxPixels: 2_000_000 });
  if (!decoded.valid) reject();
  return { bytes, sha256: await sha256(bytes), width: decoded.width, height: decoded.height };
}

// Used before prepare or dispatch. The original repository still authorizes the
// site, allocates the object version and persists the intent under request_id.
export async function preparePrivatePng(input, contentType, source) {
  exact(input, ['request_id', 'site_id', 'original_filename']);
  const { request_id, site_id, original_filename } = input;
  if (contentType !== mime) deny('INVALID_CONTENT', 400);
  const result = await inspectPng(source, () => deny('INVALID_CONTENT', 400));
  const prepare = prepareAssetInput({
    schema_version: 1, request_id, site_id, original_filename, kind: 'image',
    locale: null, mime_type: mime, byte_size: result.bytes.length, sha256: result.sha256,
  });
  return Object.freeze({ prepare, bytes: result.bytes, width: result.width, height: result.height });
}

// Content-only. The caller must authorize this exact target and obtain the
// trusted ready record and object from the approved private read path.
export async function privatePngResponse(target, ready, source) {
  const { site_id, asset_id } = assetTarget(target);
  const unavailable = () => deny('ASSET_NOT_AVAILABLE', 404);
  if (!ready || ready.state !== 'ready' || ready.site_id !== site_id || ready.asset_id !== asset_id ||
      ready.bucket_id !== ASSET_BUCKET || ready.mime_type !== mime || !uuid(ready.object_version) ||
      ready.object_key !== assetObjectKey({ site_id, asset_id, object_version: ready.object_version, mime_type: mime })) unavailable();
  const { byte_size, sha256: expected } = ready;
  if (!validLength(byte_size) || typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) unavailable();
  const result = await inspectPng(source, unavailable);
  if (result.bytes.length !== byte_size || result.sha256 !== expected) unavailable();
  return new Response(result.bytes, { headers: {
    'Content-Type': mime,
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  } });
}
