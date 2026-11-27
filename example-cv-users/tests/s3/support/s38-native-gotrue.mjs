// Test-only process. The caller supplies a freshly created, mode-0700 Unix PG fixture.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { once } from 'node:events';
import { lstatSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createS38AuthBinding } from '../../../scripts/s37-hosted/s38-auth-binding.node.mjs';

export const sha = value => createHash('sha256').update(value).digest('hex');
const fixtureIssuer = 'https://s38.fixture.invalid/auth/v1';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const accountPath = uid => {
  if (!uuid(uid)) throw Error('S38_NATIVE_ACTOR_SCOPE');
  return '/admin/users/' + uid;
};
const boundedSignal = signal => AbortSignal.any([AbortSignal.timeout(3000), ...(signal ? [signal] : [])]);
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export async function startS38NativeGoTrue({ binary, root, postgresPort, fixtureId, targetFingerprint, admin, observe, fingerprint }) {
  const prefix = realpathSync('/tmp') + '/ecv-s38-closed-';
  assert.ok(isAbsolute(binary) && root.startsWith(prefix) && /^[A-Za-z0-9]{6}$/.test(root.slice(prefix.length)) &&
    realpathSync(root) === root && /^[a-f0-9]{32}$/.test(fixtureId) && /^\d{4,5}$/.test(postgresPort));
  const stat = lstatSync(root);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o7777) === 0o700);
  assert.equal(admin(`SELECT current_setting('listen_addresses')='' AND inet_server_addr() IS NULL
    AND current_setting('s38.fixture')='${fixtureId}' AND (${fingerprint})='${targetFingerprint}';`), 't');
  assert.equal(execFileSync(binary, ['version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    'v2.198.0');

  admin(`
    CREATE ROLE postgres NOLOGIN;
    CREATE ROLE supabase_admin NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE supabase_auth_admin LOGIN CREATEROLE NOINHERIT NOBYPASSRLS;
    CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
    ALTER ROLE supabase_auth_admin SET search_path=auth;
    GRANT CREATE ON DATABASE postgres TO supabase_auth_admin;
  `);
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const base = 'http://127.0.0.1:' + port;
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const expectedKey = publicKey.export({ format: 'jwk' });
  const key = { ...privateKey.export({ format: 'jwk' }), kid: 's38-fixture-es256', alg: 'ES256', use: 'sig', key_ops: ['sign'] };
  const uri = 'postgresql://supabase_auth_admin@localhost:' + postgresPort +
    '/postgres?host=' + encodeURIComponent(root) + '&sslmode=disable';
  const env = {
    GOTRUE_JWT_SECRET: randomBytes(32).toString('hex'), GOTRUE_JWT_KEYS: JSON.stringify([key]),
    GOTRUE_JWT_ISSUER: fixtureIssuer, GOTRUE_JWT_ADMIN_ROLES: 'service_role', GOTRUE_JWT_EXP: '600',
    GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_DB_DRIVER: 'postgres', DB_NAMESPACE: 'auth', DATABASE_URL: uri,
    API_EXTERNAL_URL: base, GOTRUE_API_HOST: '127.0.0.1', PORT: String(port), GOTRUE_SITE_URL: base,
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true',
    GOTRUE_SMTP_HOST: '127.0.0.1', GOTRUE_SMTP_PORT: '1',
  };
  execFileSync(binary, ['migrate'], { env, timeout: 20000, stdio: 'ignore' });
  const child = spawn(binary, ['serve'], { env, stdio: 'ignore' });
  const exited = once(child, 'close');
  let stop;
  const close = () => stop ??= (async () => {
    child.kill('SIGTERM');
    const fallback = setTimeout(() => child.kill('SIGKILL'), 1000);
    try { await exited; } finally { clearTimeout(fallback); }
  })();

  async function wire(path, { method = 'GET', requestId, token, body, signal } = {}) {
    const response = await fetch(base + path, { method, redirect: 'error', signal: boundedSignal(signal),
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(requestId ? { 'x-request-id': requestId } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 204) return { status: 204, body: null };
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      if ((length += chunk.length) > 65536) throw Error('S38_NATIVE_RESPONSE_LIMIT');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks, length);
    return { status: response.status, body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), raw };
  }

  try {
    let jwks;
    for (let i = 0; i < 80 && !jwks; i++) {
      assert.equal(child.exitCode, null);
      try {
        const reply = await wire('/.well-known/jwks.json');
        if (reply.status === 200) jwks = reply;
      } catch {}
      if (!jwks) await delay(50);
    }
    const [actualKey] = jwks?.body?.keys ?? [];
    assert.equal(jwks?.body?.keys?.length, 1);
    for (const field of ['kty', 'crv', 'x', 'y']) assert.equal(actualKey[field], expectedKey[field]);
    assert.equal(actualKey.kid, key.kid);
    assert.equal((await wire('/health')).body.version, 'v2.198.0');
    const auth = createS38AuthBinding({
      issuer: fixtureIssuer, targetFingerprint, jwks: jwks.raw, jwksSha256: sha(jwks.raw), maxLifetimeSeconds: 600,
      async transport({ issuer, targetFingerprint: receivedFingerprint, method, path, requestId, token, body, signal }) {
        assert.equal(issuer, fixtureIssuer);
        assert.equal(receivedFingerprint, targetFingerprint);
        assert.ok(uuid(requestId) && ((method === 'POST' && path === '/token?grant_type=password') ||
          (method === 'GET' && path === '/user')));
        const response = await wire(path, { method, requestId, token, body, signal });
        return { status: response.status, body: response.body };
      },
      async readSession({ targetFingerprint: expectedFingerprint, uid, sid, requestId, signal }) {
        signal.throwIfAborted();
        assert.equal(expectedFingerprint, targetFingerprint);
        assert.ok([uid, sid, requestId].every(uuid));
        const snapshot = observe(`SELECT json_build_object('uid',s.user_id,'sid',s.id,
          'createdAt',floor(extract(epoch FROM s.created_at)), 'observedAt',floor(extract(epoch FROM clock_timestamp())),
          'active',coalesce(s.not_after>clock_timestamp(),true) AND coalesce(u.banned_until<=clock_timestamp(),true),
          'refreshPresent',EXISTS(SELECT FROM auth.refresh_tokens t WHERE t.session_id=s.id AND NOT t.revoked),
          'targetFingerprint',${fingerprint},'observer',current_user,'readOnly',current_setting('transaction_read_only'))
          FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id WHERE s.id='${sid}' AND s.user_id='${uid}';`);
        if (!snapshot) return null;
        const row = JSON.parse(snapshot);
        assert.equal(row.observer, 'fixture_observer');
        assert.equal(row.readOnly, 'on');
        return { ...row, requestId, receiptSha256: sha(JSON.stringify([requestId, row])) };
      },
    });
    function adminCredential() {
      const input = encode({ alg: 'ES256', kid: key.kid, typ: 'JWT' }) + '.' +
        encode({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 60 });
      return input + '.' + sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    }
    async function adminRequest(method, path, requestId, body) {
      assert.ok(uuid(requestId));
      const reply = await wire(path, { method, body, requestId, token: adminCredential() });
      assert.equal(reply.status, 200);
      return reply.body;
    }
    return Object.freeze({
      auth, jwks: jwks.raw.toString('utf8'), close,
      async create(credentials, requestId) {
        assert.match(credentials.email, /^s38-[a-f0-9]+@example\.invalid$/);
        const user = await adminRequest('POST', '/admin/users', requestId, { ...credentials, email_confirm: true });
        assert.ok(uuid(user.id));
        assert.equal(user.email, credentials.email);
        return user.id;
      },
      async blocked(uid, blocked, requestId) {
        const user = await adminRequest('PUT', accountPath(uid), requestId, { ban_duration: blocked ? '24h' : 'none' });
        assert.equal(user.id, uid);
        assert.equal(!!user.banned_until, blocked);
      },
      async remove(uid, requestId) {
        await adminRequest('DELETE', accountPath(uid), requestId);
      },
      async logout(token, requestId) {
        assert.ok(uuid(requestId));
        const response = await wire('/logout?scope=local', { method: 'POST', requestId, token });
        assert.equal(response.status, 204);
      },
    });
  } catch (error) {
    await close();
    throw error;
  }
}
