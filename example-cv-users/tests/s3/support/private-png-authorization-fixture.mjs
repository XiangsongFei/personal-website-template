import { createBusinessBinding } from '../../../lib/business/binding.mjs';
import { createIdentityAdapter } from '../../../lib/business/identity.mjs';
import { ASSET_BUCKET, assetObjectKey } from '../../../lib/business/asset-protocol.mjs';

export const id = n => '6089b190-83e0-4bcd-82d0-' + String(n).padStart(12, '0');
export const originalAccount = Object.freeze({ uid: id(1), session_id: id(2) });
export const binding = createBusinessBinding({
  project: 'local-png-fixture', authIssuer: 'https://auth.internal.test/auth/v1',
  privateOrigin: 'https://rpc.internal.test', registrarHost: 'db.internal.test', testOnly: true,
});
export const closeRequest = id(15);
export const now = 1_800_000_000_000;

export function command(operation = 'claim') {
  const png = {
    schema_version: 1, request_id: id(3), site_id: id(4), kind: 'image', locale: null,
    original_filename: 'fixture.png', mime_type: 'image/png', byte_size: 69, sha256: '1'.repeat(64),
  };
  const native_version = operation === 'claim' ? null : id(11);
  return {
    operation, request_id: operation === 'prepare' ? png.request_id : id(5),
    grant_id: id(6), generation: 'fixture-v1', epoch: 4, png,
    permit: operation === 'prepare' ? null : {
      id: id(7), intent_id: id(8), asset_id: id(9), object_version: id(10), native_version,
    },
  };
}

export function qualification(input, time = now) {
  const { uid, session_id: sid } = originalAccount;
  const { png, epoch, generation } = input;
  const permit = input.permit === null ? null : {
    ...input.permit, uid, sid, site_id: png.site_id, grant_id: input.grant_id, epoch, generation,
    request_id: input.request_id, prepare_request_id: png.request_id, operation: input.operation,
    mime_type: png.mime_type, byte_size: png.byte_size, sha256: png.sha256, bucket_id: ASSET_BUCKET,
    object_key: assetObjectKey({ site_id: png.site_id, ...input.permit, mime_type: png.mime_type }),
    closed_at: null, issued_at: time - 10_000, expires_at: time + 60_000,
  };
  return {
    now: time, project: binding.project, issuer: binding.authIssuer, businessEnabled: true, proofVerifierReady: true,
    actor: { uid, sid }, session: { uid, sid, live: true },
    site: { id: png.site_id, owner_uid: uid, active: true, active_owner_member: true },
    owner: { uid, epoch, enabled: true, on_hold: false },
    grant: { id: input.grant_id, uid, sid, epoch, purpose: 'business', generation, revoked_at: null,
      issued_at: time - 15_000, last_renewed_at: time - 15_000, expires_at: time + 1_785_000,
      absolute_expires_at: time + 43_185_000 },
    generation: { id: generation, revoked_at: null, not_before: time - 15_000, verify_until: time + 100_000 },
    permit,
  };
}

export function identityFixture({ uid = originalAccount.uid, sid = originalAccount.session_id,
  recovery = false, clock = () => now / 1_000 } = {}) {
  const claims = {
    iss: binding.authIssuer, aud: 'authenticated', role: 'authenticated', sub: uid, session_id: sid,
    exp: Math.floor(clock()) + 10, is_anonymous: false,
    amr: [{ method: 'password' }, ...(recovery ? [{ method: 'recovery' }] : [])],
  };
  return createIdentityAdapter({ issuer: binding.authIssuer, clock, auth: {
    async verifyTokenAndUser() {
      return { data: { claims, user: { id: uid, is_anonymous: false, email_confirmed_at: '2026-01-01T00:00:00Z' } } };
    },
  } });
}
