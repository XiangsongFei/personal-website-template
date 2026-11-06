// Adapted from the verified S2 TLS loader. No probe runtime or secret material is imported.
import {constants,lstatSync,realpathSync,readFileSync,openSync,fstatSync,closeSync} from 'node:fs';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {types} from 'node:util';
export const ROOT=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'../..'));
export const PIN=Object.freeze(JSON.parse(readFileSync(new URL('./policy.json',import.meta.url),'utf8')));
export const MATERIAL=resolve(ROOT,'.runtime/tls');
export const CERT=resolve(MATERIAL,'server.crt');
export const KEY=resolve(MATERIAL,'server.key');
export const FINGERPRINT=PIN.serverCertificateSha256;
export const HOST='127.0.0.1';
const fail=code=>{throw Error(code);};
export function checked(path, { directory = false, mode, root = ROOT } = {}) {
  if (path !== root && !path.startsWith(root + sep)) fail('path_outside_users_package');
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (const part of ['', ...parts]) {
    if (part) current = resolve(current, part);
    const s = lstatSync(current);
    if (s.isSymbolicLink() || realpathSync(current) !== current || s.uid !== process.getuid()) fail('unsafe_path');
    if (current !== path && !s.isDirectory()) fail('unsafe_parent');
  }
  const s = lstatSync(path);
  if (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1) fail('unsafe_file_type');
  if (mode !== undefined && (s.mode & 0o777) !== mode) fail('unsafe_permissions');
  return s;
}
export function readPublicCertificate() {
  checked(MATERIAL, { directory: true, mode: 0o700 });
  checked(CERT); checked(KEY, { mode: 0o600 }); // stat only; supervisor never reads the key.
  return validateCertificate(new X509Certificate(readFileSync(CERT)));
}
export function validateCertificate(cert, now = Date.now()) {
  if (cert.fingerprint256.replaceAll(':', '') !== FINGERPRINT) fail('certificate_fingerprint_mismatch');
  if (cert.ca || cert.subjectAltName !== 'IP Address:127.0.0.1' || cert.checkIP(HOST) !== HOST
    || cert.keyUsage?.length !== 1 || cert.keyUsage[0] !== '1.3.6.1.5.5.7.3.1') fail('certificate_scope_mismatch');
  if (!(Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo))) fail('certificate_expired_or_not_yet_valid');
  return cert;
}
// The synchronous consumer must finish SecureContext creation before returning.
// The original PEM Buffer never escapes to argv, files, IPC or diagnostics.
// Called exclusively by the TLS worker (or its isolated offline test). Never import ca.key.
export function loadServerIdentity(role, consume, onStage = () => {}) {
  if (role !== 'tls') fail('private_key_role_denied');
  if (typeof consume !== 'function' || types.isAsyncFunction(consume) || types.isGeneratorFunction(consume)) fail('synchronous_tls_consumer_required');
  onStage('certificate_metadata');
  const certificate = readPublicCertificate();
  onStage('private_key_metadata');
  const before = checked(KEY, { mode: 0o600 });
  onStage('private_key_open');
  const fd = openSync(KEY, constants.O_RDONLY | constants.O_NOFOLLOW);
  let key;
  try {
    onStage('private_key_fstat');
    const actual = fstatSync(fd);
    if (actual.ino !== before.ino || actual.dev !== before.dev || actual.nlink !== 1 || (actual.mode & 0o777) !== 0o600) fail('key_changed');
    onStage('private_key_read'); key = readFileSync(fd);
    onStage('private_key_parse');
    const privateKey = createPrivateKey(key);
    onStage('key_certificate_match');
    if (!certificate.checkPrivateKey(privateKey)) fail('key_certificate_mismatch');
    // Node 24 https.createServer accepts PEM bytes, not PrivateKeyObject.
    // Keep the KeyObject only for the certificate-match check above.
    const result = consume({ cert: certificate.toString(), key });
    if (result && typeof result.then === 'function') fail('synchronous_tls_consumer_required');
    return result;
  } finally {
    key?.fill(0);
    try { closeSync(fd); } catch (error) { onStage('private_key_close'); throw error; }
  }
}
