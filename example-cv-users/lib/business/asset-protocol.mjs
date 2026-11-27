// S3.5-A offline candidate. No Worker route or Storage transport imports this module.
import { deny, exact, sha256, uuid } from './protocol.mjs';

export const ASSET_BUCKET = 'users-site-assets-private';
export const ASSET_LIMITS = Object.freeze({ avatar: 2 * 1024 ** 2, image: 5 * 1024 ** 2,
  portfolio_attachment: 5 * 1024 ** 2, resume_pdf: 5 * 1024 ** 2 });
const extensions = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' });
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function assetTarget(value) {
  exact(value, ['site_id', 'asset_id']);
  if (!uuid(value.site_id) || !uuid(value.asset_id)) deny('INVALID_INPUT', 400);
  return Object.freeze({ ...value });
}
export function assetCommand(value) {
  exact(value, ['schema_version', 'request_id', 'site_id', 'asset_id']);
  if (value.schema_version !== 1 || !uuid(value.request_id)) deny('INVALID_INPUT', 400);
  assetTarget({ site_id: value.site_id, asset_id: value.asset_id });
  return Object.freeze({ ...value });
}
export function assetOperationInput(value) {
  exact(value, ['schema_version', 'request_id', 'site_id', 'asset_id', 'operation']);
  if (!['prepare_upload', 'complete_upload', 'request_delete'].includes(value.operation)) deny('INVALID_INPUT', 400);
  assetCommand({ schema_version: value.schema_version, request_id: value.request_id, site_id: value.site_id, asset_id: value.asset_id });
  return Object.freeze({ ...value });
}
export function prepareAssetInput(value) {
  exact(value, ['schema_version', 'request_id', 'site_id', 'kind', 'locale', 'original_filename', 'mime_type', 'byte_size', 'sha256']);
  if (value.schema_version !== 1 || !uuid(value.request_id) || !uuid(value.site_id) ||
      typeof value.kind !== 'string' || typeof value.mime_type !== 'string' ||
      !Object.hasOwn(ASSET_LIMITS, value.kind) || !Object.hasOwn(extensions, value.mime_type) ||
      !Number.isSafeInteger(value.byte_size) || value.byte_size < 1 || value.byte_size > ASSET_LIMITS[value.kind] || !digest(value.sha256)) deny('INVALID_INPUT', 400);
  const pdf = value.mime_type === 'application/pdf';
  if ((['avatar', 'image'].includes(value.kind) && pdf) || (value.kind === 'resume_pdf' && !pdf) ||
      (value.kind === 'resume_pdf' ? !['zh', 'en'].includes(value.locale) : value.locale !== null)) deny('INVALID_INPUT', 400);
  if (typeof value.original_filename !== 'string') deny('INVALID_INPUT', 400);
  const name = value.original_filename.normalize('NFC');
  if (!name.trim() || name === '.' || name === '..' || new TextEncoder().encode(name).length > 240 ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069/\\]/u.test(name)) deny('INVALID_INPUT', 400);
  return Object.freeze({ ...value, original_filename: name });
}
export function assetObjectKey({ site_id, asset_id, object_version, mime_type }) {
  if (![site_id, asset_id, object_version].every(uuid) || typeof mime_type !== 'string' || !Object.hasOwn(extensions, mime_type)) deny('INVALID_INPUT', 400);
  return `${site_id}/${asset_id}/${object_version}.${extensions[mime_type]}`;
}
export function prepareAssetDigest(value) {
  const p = prepareAssetInput(value);
  // Explicit order and domain separation; IDs scope the request, not the payload digest.
  return sha256(new TextEncoder().encode(JSON.stringify(['ecv.asset.prepare.v1', p.site_id, p.kind, p.locale,
    p.original_filename, p.mime_type, p.byte_size, p.sha256])));
}
const transitions = Object.freeze({ pending: ['ready', 'rejected'], ready: ['delete_pending'],
  rejected: ['delete_pending'], delete_pending: ['deleted'], deleted: [] });
export function assertAssetTransition(from, to) {
  if (!Object.hasOwn(transitions, from) || !transitions[from].includes(to)) deny('INVALID_ASSET_STATE', 409);
}
// Prefix recognition only. Full decoding/PDF validation and a trusted persisted-object
// receipt are mandatory future gates. This helper must never independently certify ready.
export function recognizeAssetPrefix(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > 5 * 1024 ** 2) deny('INVALID_CONTENT', 400);
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if ([137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (/^%PDF-[12]\.[0-9]/.test(ascii(0, 8))) return 'application/pdf';
  deny('INVALID_CONTENT', 400);
}
