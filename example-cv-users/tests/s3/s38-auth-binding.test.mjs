import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { withCredential } from '../../lib/business/identity.mjs';
import { createS38AuthBinding, proveS38AuthClosed } from '../../scripts/s37-hosted/s38-auth-binding.node.mjs';
import { runPrivateRecovery } from '../../scripts/shared/recovery-journal.node.mjs';

const id = n => '7b8fd000-0000-4000-8000-' + String(n).padStart(12, '0');
const sha = value => createHash('sha256').update(value).digest('hex');
const issuer = 'https://s38.fixture.invalid/auth/v1';
const targetFingerprint = sha('fixture-cluster-and-database');
const protectedSha256 = sha('fixture-protected-state');
const epoch = 100;
const credentials = { email: 'fixture@example.invalid', password: 'generated fixture only' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function fixture({ claims: override, headers, wrongSignature, witness, user: userOverride, loseReply } = {}) {
  const uid = id(1);
  const sid = id(2);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'ES256', kid: 'fixture-es256', use: 'sig' };
  const jwks = Buffer.from(JSON.stringify({ keys: [jwk] }));
  const claims = { iss: issuer, aud: 'authenticated', role: 'authenticated', sub: uid, session_id: sid,
    is_anonymous: false, iat: epoch, exp: epoch + 60, amr: [{ method: 'password' }], ...override };
  const unsigned = encode({ alg: 'ES256', kid: jwk.kid, ...headers }) + '.' + encode(claims);
  const signature = wrongSignature ? Buffer.alloc(64) :
    sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const token = unsigned + '.' + signature.toString('base64url');
  const user = { id: uid, email: credentials.email, is_anonymous: false, email_confirmed_at: '2026-01-01', ...userOverride };
  let now = epoch;
  const calls = [];
  const input = { issuer, targetFingerprint, jwks, jwksSha256: sha(jwks), maxLifetimeSeconds: 60, clock: () => now,
    async transport(request) {
      assert.equal(request.issuer, issuer);
      assert.equal(request.targetFingerprint, targetFingerprint);
      calls.push([request.method, request.path, request.requestId]);
      if (request.method === 'POST') {
        assert.deepEqual(request.body, credentials);
        if (loseReply) throw Error('simulated network interruption');
        return { status: 200, body: { access_token: token, refresh_token: 'fixture refresh only', user } };
      }
      assert.equal(request.token, token);
      return { status: 200, body: user };
    },
    async readSession({ uid: observedUid, sid: observedSid, requestId }) {
      calls.push(['OBSERVE', requestId, observedUid, observedSid]);
      return { targetFingerprint, requestId, uid: observedUid, sid: observedSid, active: true, refreshPresent: true,
        createdAt: epoch, observedAt: now, receiptSha256: sha('independent fixture session witness'), ...witness };
    } };
  const binding = createS38AuthBinding(input);
  const attempt = { uid, email: credentials.email, baselineAt: epoch - 1, retiredSids: [id(3)], requestId: id(4),
    userRequestId: id(14), operation: 'password-a', credentials };
  return { binding, input, attempt, calls, token, changeTime(time) { now = time; } };
}

const dispatch = async (operation, digest, effect) => {
  assert.equal(operation, 'password-a');
  assert.match(digest, /^[a-f0-9]{64}$/);
  const receipt = await effect(AbortSignal.timeout(2000));
  assert.deepEqual(Object.keys(receipt).sort(), ['disposition', 'receiptSha256']);
  assert.equal(receipt.disposition, 'committed');
};

test('pinned GoTrue password route yields an opaque UID/SID handle; continuing requires a fresh independent witness', async () => {
  const local = fixture();
  const opened = await local.binding.openPasswordActor({ ...local.attempt, dispatch });
  assert.deepEqual(Object.keys(opened), ['handle', 'uid', 'sid']);
  const { handle, uid, sid } = opened;
  assert.deepEqual(local.binding.verifyActor(handle), { uid: id(1), session_id: id(2) });
  assert.equal(withCredential(handle, token => token), local.token);
  assert.deepEqual(local.calls.slice(0, 2), [['POST', '/token?grant_type=password', id(4)], ['GET', '/user', id(14)]]);
  await local.binding.observeActor({ handle, uid, sid, requestId: id(5), signal: AbortSignal.timeout(2000) });
  assert.deepEqual(local.calls.at(-1), ['OBSERVE', id(5), uid, sid]);
  await assert.rejects(local.binding.observeActor({ handle, uid, sid: id(3), requestId: id(5) }), /ACTOR_SCOPE/);
  local.changeTime(epoch + 60);
  await assert.rejects(local.binding.observeActor({ handle, uid, sid, requestId: id(5) }));
  assert.equal(local.calls.length, 4);
});

test('a pinned digest and ES256 key ID/bytes are required before accepting GoTrue claims', async () => {
  const { input } = fixture();
  assert.throws(() => createS38AuthBinding({ ...input, jwksSha256: sha('changed') }), /JWKS_DIGEST/);
  for (const options of [
    { wrongSignature: true }, { headers: { alg: 'HS256' } }, { headers: { kid: 'new-key' } },
    { headers: { jku: 'https://untrusted.invalid' } },
  ]) {
    const local = fixture(options);
    await assert.rejects(local.binding.openPasswordActor({ ...local.attempt, dispatch }), /PASSWORD_ACTOR_UNPROVEN/);
    assert.deepEqual(local.calls, [['POST', '/token?grant_type=password', id(4)]]);
  }
});

test('issuer, role, timeout, Recovery, wrong UID, retired SID and mismatched user are denied', async () => {
  for (const options of [
    { claims: { iss: 'https://other.invalid/auth/v1' } }, { claims: { aud: 'anon' } }, { claims: { exp: epoch } },
    { claims: { role: 'service_role' } }, { claims: { sub: id(6) } }, { claims: { session_id: id(3) } },
    { claims: { iat: epoch - 1, exp: epoch + 59 } },
    { claims: { amr: [{ method: 'password' }, { method: 'recovery' }] } }, { user: { id: id(6) } },
  ]) {
    const local = fixture(options);
    await assert.rejects(local.binding.openPasswordActor({ ...local.attempt, dispatch }), /PASSWORD_ACTOR_UNPROVEN/);
    assert.equal(local.calls.filter(([verb]) => verb === 'OBSERVE').length, 0);
  }
});

test('an auth reply cannot substitute for the exact fresh database UID/SID witness', async () => {
  for (const witness of [
    { uid: id(6) }, { sid: id(3) }, { requestId: id(7) }, { active: false }, { refreshPresent: false },
    { createdAt: epoch - 2 }, { targetFingerprint: sha('other db') }, { observedAt: epoch - 6, createdAt: epoch - 6 },
  ]) {
    const local = fixture({ witness });
    await assert.rejects(local.binding.openPasswordActor({ ...local.attempt, dispatch }), /SESSION_UNPROVEN/);
  }
});

function closure(count, accounts = []) {
  return { accountCount: count, accounts, targetFingerprint, protectedSha256,
    gatesClosed: true, runtimeStopped: true, lateWritePossible: false, rolePasswordNull: true,
    sessions: 0, refresh: 0, grants: 0, permits: 0, generations: 0, openRuns: 0, roleLogins: 0, connections: 0,
    receiptSha256: sha('independent closure witness') };
}

test('zero Actor and three exact disabled accounts prove closure; unresolved logout never gets promoted', () => {
  const closed = { targetFingerprint, protectedSha256 };
  assert.equal(proveS38AuthClosed({ ...closed, lane: 'A', row: closure(0), expectedDisabledUids: [] }).closed, true);
  const uids = [id(7), id(8), id(9)];
  const accounts = uids.map(uid => ({ uid, disabled: true }));
  const historical = { ...closed, lane: 'B', row: closure(3, accounts), expectedDisabledUids: uids };
  assert.equal(proveS38AuthClosed(historical).closed, true);
  assert.throws(() => proveS38AuthClosed({ ...historical, unresolved: [id(4)] }), /CLOSURE_UNPROVEN/);
  assert.throws(() => proveS38AuthClosed({ ...historical, row: { ...historical.row, refresh: 1 } }), /CLOSURE_UNPROVEN/);
  assert.throws(() => proveS38AuthClosed({ ...historical, row: closure(3, [accounts[0], accounts[0], accounts[2]]) }),
    /CLOSURE_UNPROVEN/);
});

test('lost GoTrue login reply leaves only the original-key UNKNOWN and recovery never issues another login', async t => {
  const local = fixture({ loseReply: true });
  const directory = mkdtempSync(join(realpathSync('/tmp'), 'ecv-s38-auth-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let workCount = 0;
  const resolveOriginal = journal => {
    assert.equal(journal.inspect('password-a').state, 'unknown');
    const pins = [local.binding.scopeSha256, 'password-a', id(4), id(14), id(1), sha(credentials.email), epoch - 1, [id(3)]];
    assert.equal(journal.inspect('password-a').intentSha256, sha(JSON.stringify(pins)));
    journal.reconcile('password-a', { disposition: 'committed', receiptSha256: sha('exact compensated original login') });
  };
  const options = { directory, python: realpathSync('/usr/bin/python3'), scopeSha256: sha('auth-recovery'),
    operations: { business: ['password-a'], close: [] },
    async work(journal) {
      workCount++;
      await local.binding.openPasswordActor({ ...local.attempt, dispatch: journal.dispatch });
    },
    close: async () => {},
    observeClosed: async () => proveS38AuthClosed({ lane: 'A', row: closure(0), targetFingerprint, protectedSha256,
      expectedDisabledUids: [], unresolved: [id(4)] }),
  };
  await assert.rejects(runPrivateRecovery(options), /RUN_FAILED/);
  const recovered = await runPrivateRecovery({ ...options, close: resolveOriginal,
    observeClosed: async () => proveS38AuthClosed({ lane: 'A', row: closure(0), targetFingerprint, protectedSha256,
      expectedDisabledUids: [] }),
  });
  assert.equal(recovered.recovered, true);
  assert.equal(workCount, 1);
  assert.deepEqual(local.calls, [['POST', '/token?grant_type=password', id(4)]]);
  for (const name of readdirSync(directory).filter(file => file.endsWith('.json'))) {
    const contents = readFileSync(join(directory, name), 'utf8');
    assert.ok(!contents.includes(local.token) && !contents.includes(credentials.password) && !contents.includes(credentials.email));
  }
});
