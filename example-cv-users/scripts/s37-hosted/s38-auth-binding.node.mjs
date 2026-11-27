import { createHash, createPublicKey, verify } from 'node:crypto';
import { boundAccountContext, createIdentityAdapter, loginContext } from '../../lib/business/identity.mjs';
import { uuid } from '../../lib/business/protocol.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const fail = code => { throw new Error('S38_AUTH_' + code); };
const epoch = () => Math.floor(Date.now() / 1000);
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const kid = value => typeof value === 'string' && /^[\w.-]{1,128}$/.test(value);
const denied = Object.freeze({ error: Object.freeze({ code: 'IDENTITY_REQUIRED' }) });
const bindings = new WeakSet();

export function isS38AuthBinding(value) { return bindings.has(value); }

function decodePart(part) {
  const bytes = Buffer.from(part, 'base64url');
  if (!bytes.length || bytes.toString('base64url') !== part) fail('JWT');
  return bytes;
}

function decodeObject(bytes) {
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!record(result)) fail('FORMAT');
  return result;
}

function freezeKeys(input, expectedSha256) {
  if (!(input instanceof Uint8Array) || input.byteLength > 65536 || !digest(expectedSha256)) fail('JWKS');
  const bytes = Buffer.from(input);
  if (sha256(bytes) !== expectedSha256) fail('JWKS_DIGEST');
  const { keys } = decodeObject(bytes);
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 16) fail('JWKS');
  const pinned = new Map();
  for (const key of keys) {
    if (!record(key) || key.kty !== 'EC' || key.crv !== 'P-256' || key.alg !== 'ES256' ||
        (key.use !== undefined && key.use !== 'sig') ||
        (key.key_ops !== undefined && (!Array.isArray(key.key_ops) ||
          key.key_ops.length !== 1 || key.key_ops[0] !== 'verify')) ||
        !kid(key.kid) || pinned.has(key.kid) || Object.hasOwn(key, 'd')) fail('JWKS');
    pinned.set(key.kid, createPublicKey({ format: 'jwk', key: {
      kty: key.kty, crv: key.crv, x: key.x, y: key.y,
    } }));
  }
  return pinned;
}

function claimsFor(token, keys, issuer, now, maxLifetime) {
  if (typeof token !== 'string' || token.length > 16384 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) fail('JWT');
  const [headerPart, claimsPart, signaturePart] = token.split('.');
  const header = decodeObject(decodePart(headerPart));
  if (header.alg !== 'ES256' || (header.typ !== undefined && header.typ !== 'JWT') || !kid(header.kid) ||
      Object.keys(header).some(name => !['alg', 'typ', 'kid'].includes(name))) fail('JWT');
  const key = keys.get(header.kid);
  const signature = decodePart(signaturePart);
  if (!key || signature.length !== 64 ||
      !verify('sha256', Buffer.from(headerPart + '.' + claimsPart), { key, dsaEncoding: 'ieee-p1363' }, signature))
    fail('JWT');
  const claims = decodeObject(decodePart(claimsPart));
  if (claims.iss !== issuer || claims.aud !== 'authenticated' || claims.role !== 'authenticated' ||
      !uuid(claims.sub) || !uuid(claims.session_id) || claims.is_anonymous !== false ||
      ![claims.iat, claims.exp, now].every(Number.isSafeInteger) || claims.iat < 0 ||
      !(claims.iat <= now && now < claims.exp && claims.exp - claims.iat <= maxLifetime) ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now)) ||
      !Array.isArray(claims.amr) || !claims.amr.some(item => item?.method === 'password') ||
      claims.amr.some(item => ['otp', 'recovery'].includes(item?.method))) fail('JWT');
  return claims;
}

// The supplied, separately admitted transport implements GoTrue's fixed Auth
// routes. It must reject redirects and must not retry, refresh or follow a
// caller-supplied URL. There is no default network client or credential source.
export function createS38AuthBinding({ issuer, targetFingerprint, jwks, jwksSha256, maxLifetimeSeconds,
  transport, readSession, clock = epoch } = {}) {
  let url;
  try { url = new URL(issuer); } catch { fail('CONFIG'); }
  if (url.protocol !== 'https:' || url.username || url.password || issuer !== url.origin + '/auth/v1' ||
      !digest(targetFingerprint) || !Number.isInteger(maxLifetimeSeconds) || maxLifetimeSeconds < 1 ||
      maxLifetimeSeconds > 3600 || typeof transport !== 'function' || typeof readSession !== 'function' ||
      transport === readSession || typeof clock !== 'function') fail('CONFIG');
  const keys = freezeKeys(jwks, jwksSha256);
  const bound = new WeakMap();
  const scopeSha256 = sha256(JSON.stringify(['s38.auth.v1', issuer, targetFingerprint, jwksSha256, maxLifetimeSeconds]));

  async function sessionEvidence(uid, sid, requestId, baselineAt, signal) {
    signal.throwIfAborted();
    const row = await readSession({ targetFingerprint, uid, sid, requestId, signal });
    signal.throwIfAborted();
    const now = clock();
    if (!record(row) || row.targetFingerprint !== targetFingerprint || row.requestId !== requestId ||
        row.uid !== uid || row.sid !== sid || row.active !== true || row.refreshPresent !== true ||
        ![row.createdAt, row.observedAt, now].every(Number.isSafeInteger) ||
        !(baselineAt < row.createdAt && row.createdAt <= row.observedAt &&
          row.observedAt <= now && now - row.observedAt <= 5) || !digest(row.receiptSha256))
      fail('SESSION_UNPROVEN');
    return row.receiptSha256;
  }

  async function authRequest({ path, method, requestId, token, body, signal }) {
    signal.throwIfAborted();
    const reply = await transport({ issuer, targetFingerprint, path, method, requestId, token, body, signal });
    signal.throwIfAborted();
    if (reply?.status !== 200 || !record(reply.body)) fail('AUTH_RESULT_UNKNOWN');
    return reply.body;
  }

  // A handle is minted only inside the durable business dispatch callback.
  // Lost/mismatched replies stay UNKNOWN. Recovery reconciles the original
  // request through the independent observer and never invokes password login.
  async function openPasswordActor({ uid, email, baselineAt, retiredSids, requestId, userRequestId,
    operation, dispatch, credentials } = {}) {
    if (!uuid(uid) || !uuid(requestId) || !Number.isSafeInteger(baselineAt) || baselineAt < 0 ||
        baselineAt > clock() || !uuid(userRequestId) || userRequestId === requestId ||
        typeof email !== 'string' || email.length > 254 || !/^[a-z0-9.+_-]+@example\.invalid$/.test(email) ||
        !record(credentials) || credentials.email !== email || typeof credentials.password !== 'string' ||
        credentials.password.length < 1 || credentials.password.length > 1024 ||
        !Array.isArray(retiredSids) || !retiredSids.every(uuid) ||
        typeof operation !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(operation) ||
        typeof dispatch !== 'function') fail('ACTOR_SCOPE');
    const retired = new Set(retiredSids);
    const passwordInput = Object.freeze({ email, password: credentials.password });
    const intentSha256 = sha256(JSON.stringify([scopeSha256, operation, requestId, userRequestId, uid, sha256(email),
      baselineAt, [...retired].sort()]));
    let opened, entered = false;
    await dispatch(operation, intentSha256, async signal => {
      if (entered) fail('DUPLICATE');
      entered = true;
      const identity = createIdentityAdapter({ issuer, clock, auth: {
        async signInWithPassword(body) {
          const result = await authRequest({ path: '/token?grant_type=password', method: 'POST', requestId, body, signal });
          return { data: { session: { access_token: result.access_token, user: result.user }, user: result.user } };
        },
        async verifyTokenAndUser(token) {
          let claims;
          try { claims = claimsFor(token, keys, issuer, clock(), maxLifetimeSeconds); } catch { return denied; }
          if (claims.sub !== uid || claims.iat <= baselineAt || retired.has(claims.session_id)) return denied;
          const user = await authRequest({ path: '/user', method: 'GET', requestId: userRequestId, token, signal });
          return { data: { claims, user } };
        },
      } });
      let login;
      try { login = await identity.passwordLogin(passwordInput); } catch { fail('PASSWORD_ACTOR_UNPROVEN'); }
      const proof = loginContext(login.receipt);
      const who = boundAccountContext(login.handle, identity, issuer);
      if (proof.handle !== login.handle || proof.uid !== uid || proof.session_id !== who.session_id) fail('ACTOR_SCOPE');
      const sid = who.session_id;
      const receiptSha256 = await sessionEvidence(uid, sid, requestId, baselineAt, signal);
      // Returning the identity adapter would leak its password-login method,
      // allowing an otherwise valid caller to dispatch again outside the journal.
      opened = Object.freeze({ handle: login.handle, uid, sid });
      bound.set(login.handle, { identity, uid, sid, baselineAt });
      return { disposition: 'committed', receiptSha256 };
    });
    if (!opened) fail('PASSWORD_ACTOR_UNPROVEN');
    return opened;
  }

  async function observeActor({ handle, uid, sid, requestId, signal }) {
    const expected = bound.get(handle);
    if (!expected || expected.uid !== uid || expected.sid !== sid || !uuid(requestId)) fail('ACTOR_SCOPE');
    boundAccountContext(handle, expected.identity, issuer);
    signal.throwIfAborted();
    const receiptSha256 = await sessionEvidence(uid, sid, requestId, expected.baselineAt, signal);
    // The DB witness may arrive just after expiry.
    boundAccountContext(handle, expected.identity, issuer);
    return receiptSha256;
  }

  function verifyActor(handle) {
    const actor = bound.get(handle);
    if (!actor) fail('ACTOR_SCOPE');
    return boundAccountContext(handle, actor.identity, issuer);
  }

  const binding = Object.freeze({ issuer, targetFingerprint, jwksSha256, scopeSha256, openPasswordActor, observeActor, verifyActor });
  bindings.add(binding);
  return binding;
}

// The observer's baseline and terminal rows come from the dedicated read-only
// side, after a zero/partial/full run has stopped. A failed auth effect remains
// unresolved even if the row happens to show no current session.
export function proveS38AuthClosed({ lane, row, targetFingerprint, protectedSha256, expectedDisabledUids,
  unresolved = [] } = {}) {
  const empty = ['sessions', 'refresh', 'grants', 'permits', 'generations', 'openRuns', 'roleLogins', 'connections'];
  const counts = lane === 'A' ? 0 : lane === 'B' ? 3 : -1;
  if (!Array.isArray(unresolved) || unresolved.length || !digest(targetFingerprint) || !digest(protectedSha256) ||
      !record(row) || row.targetFingerprint !== targetFingerprint || row.protectedSha256 !== protectedSha256 ||
      row.gatesClosed !== true || row.runtimeStopped !== true || row.lateWritePossible !== false ||
      row.rolePasswordNull !== true || !digest(row.receiptSha256) || empty.some(field => row[field] !== 0) ||
      !Array.isArray(expectedDisabledUids) || expectedDisabledUids.length !== counts ||
      !expectedDisabledUids.every(uuid) || new Set(expectedDisabledUids).size !== counts ||
      row.accountCount !== counts || !Array.isArray(row.accounts) || row.accounts.length !== counts ||
      expectedDisabledUids.some(uid => row.accounts.filter(account => account?.uid === uid && account.disabled === true).length !== 1))
    fail('CLOSURE_UNPROVEN');
  return Object.freeze({ closed: true, receiptSha256: row.receiptSha256 });
}
