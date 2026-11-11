import {PROJECT} from './binding.mjs';
import { deny, exact, grantBytes, hex, proofBytes, sha256, validateProof } from '../../../lib/business/protocol.mjs';
import { accountContext, loginContext } from '../../../lib/business/identity.mjs';
// Candidate signer deliberately supports only explicitly injected offline-test keys.
// Production and even real local signing remain NOT CONFIGURED in this round.
export function createTestSigner({ mode, keys, activeKeyId, clock, randomUUID = () => crypto.randomUUID() } = {}) {
  const configured = mode === 'offline-test' && keys instanceof Map && typeof clock === 'function';
  return Object.freeze({ async sign({ action, epoch, receipt, handle }) {
    if (!configured) deny('NOT_CONFIGURED', 503);
    const who = action === 'issue' ? loginContext(receipt) : accountContext(handle);
    const key = keys.get(activeKeyId), now = clock();
    if (!key || key.revoked || !(key.not_before <= now && now < key.sign_until) ||
        !(key.bytes instanceof Uint8Array) || key.bytes.length !== 32) deny('NOT_CONFIGURED', 503);
    const p = { version: 1, project: PROJECT, action, purpose: 'business', uid: who.uid, session_id: who.session_id,
      epoch, proof_id: randomUUID(), issued_at: now, expires_at: Math.min(now + 60, key.verify_until),
      payload_digest: '', key_id: activeKeyId, event: action === 'issue' ? 'password-login' : 'account-session' };
    p.payload_digest = await sha256(grantBytes(p)); validateProof(p,PROJECT);
    const k = await crypto.subtle.importKey('raw', key.bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return Object.freeze({ proof: Object.freeze(p), signature: hex(await crypto.subtle.sign('HMAC', k, proofBytes(p))) });
  } });
}
export async function verifyTestProof(envelope, who, { keys, clock }) {
  exact(envelope, ['proof','signature']); const p = validateProof(envelope.proof,PROJECT), now = clock();
  const key = keys.get(p.key_id);
  if (p.uid !== who.uid || p.session_id !== who.session_id || p.issued_at > now || p.expires_at <= now ||
      !key || key.revoked || !(key.not_before <= p.issued_at && p.issued_at < key.sign_until && now < key.verify_until) ||
      p.expires_at > key.verify_until || typeof envelope.signature !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.signature) ||
      await sha256(grantBytes(p)) !== p.payload_digest) deny('INVALID_PROOF');
  const k = await crypto.subtle.importKey('raw', key.bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signature = Uint8Array.from(envelope.signature.match(/../g), x => parseInt(x, 16));
  if (!await crypto.subtle.verify('HMAC', k, signature, proofBytes(p))) deny('INVALID_PROOF');
  return p;
}
