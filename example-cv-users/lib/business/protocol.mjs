// Server-only candidate. No production route imports this module.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reserved = new Set(['admin','cms-admin','www','api','auth','hr','mail','support','static','assets']);
export class BusinessError extends Error {
  constructor(code, status = 403) { super(code); this.name = 'BusinessError'; this.code = code; this.status = status; }
}
export const deny = (code = 'BUSINESS_DENIED', status = 403) => { throw new BusinessError(code, status); };
export function exact(value, fields) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) deny('INVALID_INPUT', 400);
  const keys = Object.keys(value).sort(), expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) deny('INVALID_INPUT', 400);
  return value;
}
export const uuid = value => typeof value === 'string' && UUID.test(value);
export function createInput(value) {
  exact(value, ['schema_version','request_id','slug','default_locale']);
  if (value.schema_version !== 1 || !uuid(value.request_id) || typeof value.slug !== 'string' ||
      !/^[a-z][a-z0-9-]{1,46}[a-z0-9]$/.test(value.slug) || reserved.has(value.slug) ||
      !['zh','en'].includes(value.default_locale)) deny('INVALID_INPUT', 400);
  return Object.freeze({ ...value });
}
// Flat scalar input only: JSON.parse alone would silently accept duplicate keys.
export function parseCreate(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 2048) deny('INVALID_INPUT', 400);
  let i = 0; const out = Object.create(null);
  const ws = () => { while (i < text.length && /[ \t\r\n]/.test(text[i])) i++; };
  const string = () => {
    const start = i;
    if (text[i++] !== '"') deny('INVALID_INPUT', 400);
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') { i++; continue; }
      if (c === '"') { try { return JSON.parse(text.slice(start, i)); } catch { deny('INVALID_INPUT', 400); } }
    }
    deny('INVALID_INPUT', 400);
  };
  ws(); if (text[i++] !== '{') deny('INVALID_INPUT', 400);
  ws(); if (text[i] === '}') deny('INVALID_INPUT', 400);
  for (;;) {
    ws(); const key = string();
    if (Object.hasOwn(out, key)) deny('INVALID_INPUT', 400);
    ws(); if (text[i++] !== ':') deny('INVALID_INPUT', 400); ws();
    if (text[i] === '"') out[key] = string();
    else { const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
      if (!match) deny('INVALID_INPUT', 400); i += match[0].length; out[key] = Number(match[0]); }
    ws(); const end = text[i++];
    if (end === '}') break;
    if (end !== ',') deny('INVALID_INPUT', 400);
  }
  ws(); if (i !== text.length) deny('INVALID_INPUT', 400);
  return createInput(out);
}
export const createBytes = input => {
  const p = createInput(input);
  return new TextEncoder().encode(`ecv.create_site.v1\n${p.slug}\n${p.default_locale}\n`);
};
export const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
export const proofFields = ['version','project','action','purpose','uid','session_id','epoch','proof_id','issued_at','expires_at','payload_digest','key_id','event'];
export function validateProof(p, project) {
  exact(p, proofFields);
  if (p.version !== 1 || typeof p.project !== 'string' || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(p.project) || p.project !== project || !['issue','renew','revoke'].includes(p.action) || p.purpose !== 'business' ||
      !uuid(p.uid) || !uuid(p.session_id) || !uuid(p.proof_id) || !Number.isSafeInteger(p.epoch) || p.epoch < 0 ||
      !Number.isSafeInteger(p.issued_at) || p.issued_at < 0 || !Number.isSafeInteger(p.expires_at) ||
      p.expires_at <= p.issued_at || p.expires_at - p.issued_at > 60 ||
      typeof p.payload_digest !== 'string' || !/^[0-9a-f]{64}$/.test(p.payload_digest) ||
      typeof p.key_id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(p.key_id) ||
      p.event !== (p.action === 'issue' ? 'password-login' : 'account-session')) deny('INVALID_PROOF');
  return p;
}
export const grantBytes = p => new TextEncoder().encode(`ecv.business_grant.v1\n${p.action}\n${p.purpose}\n${p.uid}\n${p.session_id}\n${p.epoch}\n`);
export function proofBytes(p) {
  validateProof(p,p.project);
  return new TextEncoder().encode('ecv.proof.v1\n' + proofFields.map(k => String(p[k])).join('\n') + '\n');
}
export function validateResult(result, input) {
  try { exact(result, ['schema_version','request_id','site_id','persisted','publication']);
    exact(result.publication, ['state','snapshot_id','publication_revision']); }
  catch { deny('COMMIT_UNKNOWN', 503); }
  if (!result || result.schema_version !== 1 || result.request_id !== input.request_id || !uuid(result.site_id) ||
      result.persisted !== true || result.publication?.state !== 'unpublished' || result.publication?.snapshot_id !== null ||
      result.publication?.publication_revision !== 0) deny('COMMIT_UNKNOWN', 503);
  return result;
}
